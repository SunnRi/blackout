import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const BEZSVITLA_BASE = "https://bezsvitla.com.ua";
const YASNO_BASE = "https://app.yasno.ua/api/blackout-service/public/shutdowns";
const YASNO_REGION_ID = 25;
const YASNO_DSO_ID = 902;

let cronSecretCache: { value: string; at: number } | null = null;

async function getCronSecret(): Promise<string | null> {
  if (cronSecretCache && Date.now() - cronSecretCache.at < 10 * 60 * 1000) {
    return cronSecretCache.value;
  }
  const { data, error } = await supabase.rpc("get_cron_secret");
  if (error || typeof data !== "string") return null;
  cronSecretCache = { value: data, at: Date.now() };
  return data;
}

const RETENTION_DAYS = 14;
const MINI_APP_URL = Deno.env.get("MINI_APP_URL") ?? "https://bolt.new";

// Minimum number of queues and minimum total slots we expect from a healthy
// source. If a fetch returns fewer, we treat the source as broken rather than
// treating the missing queues as "removed".
const MIN_QUEUES_FOR_HEALTH = 1;
const MIN_SLOTS_FOR_HEALTH = 1;

type Slot = { start: number; end: number; type: string };
type QueueSchedule = { queue: string; slots: Slot[] };
type DaySchedule = { date: string; label: string; schedules: QueueSchedule[]; sourceOk: boolean };

async function fetchWithTimeout(url: string, opts: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function parseBezsvitla(html: string): QueueSchedule[] {
  const results: QueueSchedule[] = [];
  const queueMatches = [...html.matchAll(/Черга\s+(\d\.\d)/g)];
  for (let i = 0; i < queueMatches.length; i++) {
    const queueName = queueMatches[i][1];
    const sectionStart = queueMatches[i].index! + queueMatches[i][0].length;
    const sectionEnd = i + 1 < queueMatches.length
      ? queueMatches[i + 1].index!
      : sectionStart + 5000;
    const section = html.slice(sectionStart, sectionEnd);
    const slots: Slot[] = [];
    for (const m of section.matchAll(
      /bz-schedule-slot--(on|off)[^>]*>.*?(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})/gs,
    )) {
      const startMin = timeToMinutes(m[2]);
      let endMin = timeToMinutes(m[3]);
      if (m[3] === "24:00") endMin = 1440;
      slots.push({ start: startMin, end: endMin, type: m[1] === "off" ? "Definite" : "NotPlanned" });
    }
    if (slots.length > 0) results.push({ queue: queueName, slots });
  }
  return results;
}

// ── Kyiv time helpers ─────────────────────────────────────────
function getKyivNow(): Date {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "Europe/Kyiv" }));
}

function getKyivDateISO(): string {
  return getKyivNow().toISOString().split("T")[0];
}

function getTomorrowDateISO(): string {
  const d = getKyivNow();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

// ── Source health validation ──────────────────────────────────
// A page that returns 200 but has no "Черга" markers is probably a layout
// change or error page, not a real schedule. We refuse to treat it as data.
// Additionally, if we expected N queues (from the previous snapshot) but the
// parser found far fewer, the HTML structure may have changed partially.
function bezsvitlaLooksValid(html: string, parsed: QueueSchedule[], prevQueueCount: number): boolean {
  if (parsed.length === 0) return false;
  // If the page mentions queues but the parser found none, the HTML structure
  // may have changed — don't trust the empty result.
  if (/Черга\s+\d\.\d/.test(html) && parsed.length === 0) return false;
  // If we previously had several queues but now found only 1 with minimal
  // slots, the page may be partially broken.
  if (prevQueueCount >= 3 && parsed.length < Math.ceil(prevQueueCount / 2)) return false;
  // Every parsed queue must have at least MIN_SLOTS_FOR_HEALTH valid slots.
  const totalSlots = parsed.reduce((sum, q) => sum + q.slots.length, 0);
  if (totalSlots < MIN_SLOTS_FOR_HEALTH) return false;
  return true;
}

async function fetchYasnoSchedule(tomorrow: boolean): Promise<{ schedules: QueueSchedule[]; ok: boolean }> {
  try {
    const resp = await fetchWithTimeout(
      `${YASNO_BASE}/regions/${YASNO_REGION_ID}/dsos/${YASNO_DSO_ID}/planned-outages`,
      { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } },
    );
    if (!resp.ok) return { schedules: [], ok: false };
    const planned = await resp.json();
    const schedules: QueueSchedule[] = [];
    for (const [group, data] of Object.entries(planned)) {
      const day = tomorrow
        ? (data as Record<string, unknown>)?.tomorrow as { slots: Slot[] } | undefined
        : (data as Record<string, unknown>)?.today as { slots: Slot[] } | undefined;
      const slots = day?.slots ?? [];
      if (tomorrow && slots.length === 0) continue;
      schedules.push({ queue: group, slots });
    }
    if (schedules.length < MIN_QUEUES_FOR_HEALTH) return { schedules: [], ok: false };
    return { schedules, ok: true };
  } catch {
    return { schedules: [], ok: false };
  }
}

async function fetchBezsvitlaSchedule(
  oblastSlug: string,
  citySlug: string,
  tomorrow: boolean,
  prevQueueCount: number,
): Promise<{ schedules: QueueSchedule[]; ok: boolean }> {
  try {
    const url = tomorrow
      ? `${BEZSVITLA_BASE}/${oblastSlug}/${citySlug}/grafik-na-zavtra`
      : `${BEZSVITLA_BASE}/${oblastSlug}/${citySlug}`;
    const resp = await fetchWithTimeout(
      url,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; PowerBot/1.0)" } },
    );
    if (!resp.ok) return { schedules: [], ok: false };
    const html = await resp.text();
    const parsed = parseBezsvitla(html);
    if (!bezsvitlaLooksValid(html, parsed, prevQueueCount)) return { schedules: [], ok: false };
    return { schedules: parsed, ok: true };
  } catch {
    return { schedules: [], ok: false };
  }
}

// ── Change detection ──────────────────────────────────────────
function slotsFingerprint(slots: Slot[]): string {
  return [...slots]
    .map((s) => `${s.start}-${s.end}:${s.type}`)
    .sort()
    .join("|");
}

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function fmtRange(s: Slot): string {
  return `${formatMinutes(s.start)}–${formatMinutes(s.end)}`;
}

function listSlots(slots: Slot[]): string {
  const txt = slots.slice(0, 3).map(fmtRange).join(", ");
  return slots.length > 3 ? `${txt} та ще ${slots.length - 3}` : txt;
}

function describeDiff(oldSlots: Slot[], newSlots: Slot[]): string {
  const key = (s: Slot) => `${s.start}-${s.end}:${s.type}`;
  const oldSet = new Set(oldSlots.map(key));
  const newSet = new Set(newSlots.map(key));
  const added = newSlots.filter((s) => !oldSet.has(key(s)));
  const removed = oldSlots.filter((s) => !newSet.has(key(s)));

  const isOff = (s: Slot) => s.type === "Definite" || s.type === "off";
  const addedOff = added.filter(isOff);
  const removedOff = removed.filter(isOff);

  const shifted: string[] = [];
  const usedRemoved = new Set<number>();
  const pureAdded: Slot[] = [];
  for (const a of addedOff) {
    const idx = removedOff.findIndex((r, i) =>
      !usedRemoved.has(i) && r.start < a.end && a.start < r.end);
    if (idx >= 0) {
      usedRemoved.add(idx);
      shifted.push(`${fmtRange(removedOff[idx])} на ${fmtRange(a)}`);
    } else {
      pureAdded.push(a);
    }
  }
  const pureRemoved = removedOff.filter((_, i) => !usedRemoved.has(i));

  const parts: string[] = [];
  if (shifted.length > 0) parts.push(`Час відключення змістили: ${shifted.join(", ")}`);
  if (pureAdded.length > 0) parts.push(`Додали відключення: ${listSlots(pureAdded)}`);
  if (pureRemoved.length > 0) parts.push(`Скасували відключення: ${listSlots(pureRemoved)}`);
  const addedOn = added.filter((s) => !isOff(s));
  const removedOn = removed.filter((s) => !isOff(s));
  if (addedOn.length > 0) parts.push(`Додали світло: ${listSlots(addedOn)}`);
  if (removedOn.length > 0) parts.push(`Прибрали світло: ${listSlots(removedOn)}`);
  return parts.join(". ") || "Графік оновили без детальних змін";
}

async function checkCity(
  oblastSlug: string,
  citySlug: string,
  dayData: DaySchedule[],
) {
  const dates = dayData.map((d) => d.date);
  const { data: prevRows } = await supabase
    .from("schedule_snapshots")
    .select("queue, schedule_date, fingerprint")
    .eq("oblast_slug", oblastSlug)
    .eq("city_slug", citySlug)
    .in("schedule_date", dates);

  const { data: followerRows } = await supabase
    .from("user_preferences")
    .select("tg_user_id, queue_group, notify_enabled")
    .eq("oblast_slug", oblastSlug)
    .eq("city_slug", citySlug)
    .not("queue_group", "is", null);
  const followers = (followerRows ?? []) as { tg_user_id: number; queue_group: string; notify_enabled: boolean }[];

  type Snap = { queue: string; schedule_date: string; fingerprint: string };
  const prev = new Map<string, Snap>();
  for (const r of (prevRows ?? []) as Snap[]) {
    prev.set(`${r.queue}|${r.schedule_date}`, r);
  }

  const changes: {
    oblast_slug: string; city_slug: string; queue: string; day: string;
    schedule_date: date;
    change_type: string; summary: string;
    old_slots: Slot[] | null; new_slots: Slot[] | null;
  }[] = [];
  const upserts: {
    oblast_slug: string; city_slug: string; queue: string; schedule_date: string; fingerprint: string; day: string;
  }[] = [];

  for (const day of dayData) {
    if (!day.sourceOk) continue;

    for (const sched of day.schedules) {
      const fp = slotsFingerprint(sched.slots);
      const key = `${sched.queue}|${day.date}`;
      const prevFp = prev.get(key)?.fingerprint;
      if (prevFp === undefined) {
        // First sighting of this queue for this date: baseline only.
      } else if (prevFp !== fp) {
        const prevSlots = prevFp.split("|").filter(Boolean).map((s) => {
          const [range, type] = s.split(":");
          const [start, end] = range.split("-").map(Number);
          return { start, end, type };
        });
        const summary = describeDiff(prevSlots, sched.slots);
        changes.push({
          oblast_slug: oblastSlug, city_slug: citySlug, queue: sched.queue, day: day.label,
          schedule_date: day.date,
          change_type: "changed",
          summary,
          old_slots: prevSlots, new_slots: sched.slots,
        });
      }
      upserts.push({ oblast_slug: oblastSlug, city_slug: citySlug, queue: sched.queue, schedule_date: day.date, fingerprint: fp, day: day.label });
    }

    // Detect queues that disappeared — but only if the source was healthy
    // and returned at least one queue.
    if (day.sourceOk && day.schedules.length > 0) {
      for (const [key, snap] of prev) {
        if (!key.endsWith(`|${day.date}`)) continue;
        if (!day.schedules.some((s) => `${s.queue}|${day.date}` === key)) {
          changes.push({
            oblast_slug: oblastSlug, city_slug: citySlug, queue: snap.queue, day: day.label,
            schedule_date: day.date,
            change_type: "removed",
            summary: "Графік для цієї черги більше не публікується",
            old_slots: null, new_slots: null,
          });
          upserts.push({ oblast_slug: oblastSlug, city_slug: citySlug, queue: snap.queue, schedule_date: day.date, fingerprint: "", day: day.label });
        }
      }
    }
  }

  if (upserts.length > 0) {
    const { error } = await supabase
      .from("schedule_snapshots")
      .upsert(upserts, { onConflict: "oblast_slug,city_slug,queue,schedule_date" });
    if (error) throw new Error(`snapshot upsert: ${error.message}`);
  }

  let insertedChanges: { id: string; queue: string }[] = [];
  if (changes.length > 0) {
    const { data, error } = await supabase
      .from("schedule_change_log")
      .insert(changes)
      .select("id, queue");
    if (error) throw new Error(`change log insert: ${error.message}`);
    insertedChanges = data ?? [];
  }

  // Queue notifications in the outbox instead of sending directly.
  if (insertedChanges.length > 0 && followers.length > 0) {
    const outboxRows: { tg_user_id: number; change_id: string }[] = [];
    for (const ch of insertedChanges) {
      const change = changes.find((c) => c.queue === ch.queue);
      if (!change) continue;
      for (const f of followers) {
        if (f.notify_enabled) {
          outboxRows.push({ tg_user_id: f.tg_user_id, change_id: ch.id });
        }
      }
    }
    if (outboxRows.length > 0) {
      // Deduplicate: don't insert if the same user+change already exists.
      const { error: outboxErr } = await supabase
        .from("notification_outbox")
        .upsert(outboxRows, { onConflict: "tg_user_id,change_id", ignoreDuplicates: true });
      if (outboxErr) console.error("outbox insert:", outboxErr.message);
    }
  }

  const nowIso = new Date().toISOString();
  const { error: stateErr } = await supabase
    .from("schedule_check_state")
    .upsert({
      oblast_slug: oblastSlug,
      city_slug: citySlug,
      last_checked_at: nowIso,
      ...(changes.length > 0 ? { last_change_at: nowIso } : {}),
    }, { onConflict: "oblast_slug,city_slug" });
  if (stateErr) throw new Error(`check state upsert: ${stateErr.message}`);

  return changes.length;
}

async function getCitiesToCheck(): Promise<{ oblast_slug: string; city_slug: string }[]> {
  const { data, error } = await supabase
    .from("user_preferences")
    .select("oblast_slug, city_slug")
    .not("city_slug", "is", null)
    .not("oblast_slug", "is", null);
  if (error) throw error;
  const seen = new Set<string>();
  const list: { oblast_slug: string; city_slug: string }[] = [];
  for (const r of data ?? []) {
    const key = `${r.oblast_slug}/${r.city_slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ oblast_slug: r.oblast_slug!, city_slug: r.city_slug! });
  }
  return list;
}

// ── Outbox sender ─────────────────────────────────────────────
// Process pending notifications: send via Telegram, retry on failure.
const TELEGRAM_API = `https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN") ?? ""}`;
const MAX_OUTBOX_ATTEMPTS = 5;
const OUTBOX_BATCH = 50;

async function processOutbox(): Promise<number> {
  const { data: pending, error } = await supabase
    .from("notification_outbox")
    .select("id, tg_user_id, change_id, attempts")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(OUTBOX_BATCH);

  if (error || !pending || pending.length === 0) return 0;

  let sentCount = 0;
  for (const item of pending as { id: string; tg_user_id: number; change_id: string; attempts: number }[]) {
    // Fetch the change details for the message.
    const { data: changeRow } = await supabase
      .from("schedule_change_log")
      .select("queue, summary, day, schedule_date")
      .eq("id", item.change_id)
      .maybeSingle();

    const change = changeRow as { queue: string; summary: string; day: string; schedule_date: string | null } | null;

    const text =
      `🔔 <b>Оновлення графіків</b>\n\n` +
      `У вашому місті змінили графік відключень${change ? ` (черга ${change.queue})` : ""}.\n` +
      `Відкрийте додаток, щоб побачити що саме змінилося 👇`;

    let sent = false;
    try {
      const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: item.tg_user_id,
          text,
          reply_markup: {
            inline_keyboard: [[
              { text: "⚡️ Переглянути оновлення", web_app: { url: `${MINI_APP_URL}?screen=changes` } },
            ]],
          },
        }),
      });
      const json = await resp.json() as { ok?: boolean };
      sent = !!json.ok;
    } catch {
      sent = false;
    }

    if (sent) {
      sentCount++;
      await supabase
        .from("notification_outbox")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", item.id);
    } else {
      // Exponential backoff: 2^attempts minutes, capped.
      const newAttempts = item.attempts + 1;
      if (newAttempts >= MAX_OUTBOX_ATTEMPTS) {
        await supabase
          .from("notification_outbox")
          .update({ status: "failed", attempts: newAttempts })
          .eq("id", item.id);
      } else {
        const delayMin = Math.min(Math.pow(2, newAttempts), 60);
        const nextAttempt = new Date(Date.now() + delayMin * 60 * 1000).toISOString();
        await supabase
          .from("notification_outbox")
          .update({ attempts: newAttempts, next_attempt_at: nextAttempt })
          .eq("id", item.id);
      }
    }
  }
  return sentCount;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const secret = req.headers.get("x-internal-secret");
    const expected = await getCronSecret();
    if (!expected || secret !== expected) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const url = new URL(req.url);
    if (url.searchParams.get("endpoint") !== "check") {
      return new Response(JSON.stringify({ error: "Unknown endpoint" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const todayDate = getKyivDateISO();
    const tomorrowDate = getTomorrowDateISO();
    const cities = await getCitiesToCheck();
    let totalChanges = 0;
    const checked: { city: string; changes: number }[] = [];

    for (const city of cities) {
      try {
        // Count previous queues for health validation.
        const { count: prevQueueCount } = await supabase
          .from("schedule_snapshots")
          .select("queue", { count: "exact", head: true })
          .eq("oblast_slug", city.oblast_slug)
          .eq("city_slug", city.city_slug)
          .in("schedule_date", [todayDate, tomorrowDate]);

        let todaySchedules: QueueSchedule[] = [];
        let tomorrowSchedules: QueueSchedule[] = [];
        let todayOk = false;
        let tomorrowOk = false;

        if (city.city_slug === "kyiv") {
          const t = await fetchYasnoSchedule(false);
          const tm = await fetchYasnoSchedule(true);
          todaySchedules = t.schedules; todayOk = t.ok;
          tomorrowSchedules = tm.schedules; tomorrowOk = tm.ok;
        } else {
          const t = await fetchBezsvitlaSchedule(city.oblast_slug, city.city_slug, false, prevQueueCount ?? 0);
          const tm = await fetchBezsvitlaSchedule(city.oblast_slug, city.city_slug, true, prevQueueCount ?? 0);
          todaySchedules = t.schedules; todayOk = t.ok;
          tomorrowSchedules = tm.schedules; tomorrowOk = tm.ok;
        }

        const dayData: DaySchedule[] = [
          { date: todayDate, label: "today", schedules: todaySchedules, sourceOk: todayOk },
          { date: tomorrowDate, label: "tomorrow", schedules: tomorrowSchedules, sourceOk: tomorrowOk },
        ];

        const n = await checkCity(city.oblast_slug, city.city_slug, dayData);
        totalChanges += n;
        checked.push({ city: city.city_slug, changes: n });
      } catch (cityErr) {
        console.error(`check failed for ${city.city_slug}:`, cityErr);
      }
    }

    // Process the notification outbox: send pending notifications.
    const sentCount = await processOutbox();

    // Clean up old change log rows and sent outbox entries.
    await supabase
      .from("schedule_change_log")
      .delete()
      .lt("detected_at", new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000).toISOString());

    await supabase
      .from("notification_outbox")
      .delete()
      .eq("status", "sent")
      .lt("sent_at", new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000).toISOString());

    return new Response(JSON.stringify({
      ok: true, checked: checked.length, totalChanges, notificationsSent: sentCount, checked,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("schedule-change-checker error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
