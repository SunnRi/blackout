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

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
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

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const RETENTION_DAYS = 14;
const MINI_APP_URL = Deno.env.get("MINI_APP_URL") ?? "https://bolt.new";

type Slot = { start: number; end: number; type: string };
type QueueSchedule = { queue: string; slots: Slot[] };
type DaySchedule = { date: string; schedules: QueueSchedule[]; sourceOk: boolean };

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

// ── Source validators ─────────────────────────────────────────
// A page that returns 200 but has no "Черга" markers is probably a layout
// change or error page, not a real schedule. We refuse to treat it as data.
function bezsvitlaLooksValid(html: string, parsed: QueueSchedule[]): boolean {
  if (parsed.length > 0) return true;
  // If the page mentions queues but the parser found no slots, the HTML
  // structure may have changed — don't trust the empty result.
  if (/Черга\s+\d\.\d/.test(html)) return false;
  return false;
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
    return { schedules, ok: true };
  } catch {
    return { schedules: [], ok: false };
  }
}

async function fetchBezsvitlaSchedule(oblastSlug: string, citySlug: string, tomorrow: boolean): Promise<{ schedules: QueueSchedule[]; ok: boolean }> {
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
    if (!bezsvitlaLooksValid(html, parsed)) return { schedules: [], ok: false };
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
  dayData: { date: string; label: string; schedules: QueueSchedule[]; sourceOk: boolean }[],
) {
  // Load previous snapshots for the dates we're checking
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
    change_type: string; summary: string;
    old_slots: Slot[] | null; new_slots: Slot[] | null;
  }[] = [];
  const userNotifs: { tg_user_id: number; day: string; queue: string; summary: string }[] = [];
  const upserts: {
    oblast_slug: string; city_slug: string; queue: string; schedule_date: string; fingerprint: string; day: string;
  }[] = [];

  for (const day of dayData) {
    // If the source returned garbage or was unreachable, skip this day
    // entirely: don't compare, don't delete, don't notify.
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
          change_type: "changed",
          summary,
          old_slots: prevSlots, new_slots: sched.slots,
        });
        for (const f of followers) {
          if (f.queue_group === sched.queue && f.notify_enabled) {
            userNotifs.push({ tg_user_id: f.tg_user_id, day: day.label, queue: sched.queue, summary });
          }
        }
      }
      upserts.push({ oblast_slug: oblastSlug, city_slug: citySlug, queue: sched.queue, schedule_date: day.date, fingerprint: fp, day: day.label });
    }

    // Detect queues that disappeared — but only if the source was healthy
    // and returned at least one queue. If the source returned zero queues
    // we cannot distinguish "all schedules removed" from "source broken",
    // so we err on the side of caution and skip removal detection.
    if (day.sourceOk && day.schedules.length > 0) {
      for (const [key, snap] of prev) {
        if (!key.endsWith(`|${day.date}`)) continue;
        if (!day.schedules.some((s) => `${s.queue}|${day.date}` === key)) {
          changes.push({
            oblast_slug: oblastSlug, city_slug: citySlug, queue: snap.queue, day: day.label,
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
  if (changes.length > 0) {
    const { error } = await supabase
      .from("schedule_change_log")
      .insert(changes);
    if (error) throw new Error(`change log insert: ${error.message}`);
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

  if (BOT_TOKEN && userNotifs.length > 0) {
    const seen = new Set<number>();
    for (const n of userNotifs) {
      if (seen.has(n.tg_user_id)) continue;
      seen.add(n.tg_user_id);
      const text =
        `🔔 <b>Оновлення графіків</b>\n\n` +
        `У вашому місті змінили графік відключень.\n` +
        `Відкрийте додаток, щоб побачити що саме змінилося 👇`;
      try {
        await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: n.tg_user_id,
            text,
            reply_markup: {
              inline_keyboard: [[
                { text: "⚡️ Переглянути оновлення", web_app: { url: `${MINI_APP_URL}?screen=changes` } },
              ]],
            },
          }),
        });
      } catch (sendErr) {
        console.error(`notify user ${n.tg_user_id} failed:`, sendErr);
      }
    }
  }
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
          const t = await fetchBezsvitlaSchedule(city.oblast_slug, city.city_slug, false);
          const tm = await fetchBezsvitlaSchedule(city.oblast_slug, city.city_slug, true);
          todaySchedules = t.schedules; todayOk = t.ok;
          tomorrowSchedules = tm.schedules; tomorrowOk = tm.ok;
        }

        const dayData = [
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

    await supabase
      .from("schedule_change_log")
      .delete()
      .lt("detected_at", new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000).toISOString());

    return new Response(JSON.stringify({ ok: true, checked: checked.length, totalChanges, checked }), {
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
