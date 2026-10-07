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
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const RETENTION_DAYS = 14;
const MINI_APP_URL = Deno.env.get("MINI_APP_URL") ?? "https://bolt.new";

type Slot = { start: number; end: number; type: string };
type QueueSchedule = { queue: string; slots: Slot[] };

// ── Fetch with timeout ────────────────────────────────────────
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

// ── Parse bezsvitla HTML ──────────────────────────────────────
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

// ── Yasno (Kyiv) ──────────────────────────────────────────────
async function fetchYasnoSchedule(tomorrow: boolean): Promise<QueueSchedule[]> {
  const resp = await fetchWithTimeout(
    `${YASNO_BASE}/regions/${YASNO_REGION_ID}/dsos/${YASNO_DSO_ID}/planned-outages`,
    { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } },
  );
  if (!resp.ok) throw new Error(`Yasno API ${resp.status}`);
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
  return schedules;
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

  // An outage that moved slightly (e.g. 14:00–16:00 → 15:00–17:00) reads
  // better as a time shift than as separate add + remove.
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
  todaySchedules: QueueSchedule[],
  tomorrowSchedules: QueueSchedule[],
) {
  // Load previous snapshot
  const { data: prevRows } = await supabase
    .from("schedule_snapshots")
    .select("queue, day, fingerprint")
    .eq("oblast_slug", oblastSlug)
    .eq("city_slug", citySlug);

  // Users following this city — they get change notifications
  const { data: followerRows } = await supabase
    .from("user_preferences")
    .select("tg_user_id, queue_group, notify_enabled")
    .eq("oblast_slug", oblastSlug)
    .eq("city_slug", citySlug)
    .not("queue_group", "is", null);
  const followers = (followerRows ?? []) as { tg_user_id: number; queue_group: string; notify_enabled: boolean }[];

  type Snap = { queue: string; day: string; fingerprint: string };
  const prev = new Map<string, Snap>();
  for (const r of (prevRows ?? []) as Snap[]) {
    prev.set(`${r.queue}|${r.day}`, r);
  }

  const changes: {
    oblast_slug: string; city_slug: string; queue: string; day: string;
    change_type: string; summary: string;
    old_slots: Slot[] | null; new_slots: Slot[] | null;
  }[] = [];
  const userNotifs: { tg_user_id: number; day: string; queue: string; summary: string }[] = [];
  const upserts: {
    oblast_slug: string; city_slug: string; queue: string; day: string; fingerprint: string;
  }[] = [];

  for (const day of ["today", "tomorrow"] as const) {
    const schedules = day === "today" ? todaySchedules : tomorrowSchedules;
    for (const sched of schedules) {
      const fp = slotsFingerprint(sched.slots);
      const key = `${sched.queue}|${day}`;
      const prevFp = prev.get(key)?.fingerprint;
      if (prevFp === undefined) {
        // First sighting of this queue: record the baseline snapshot only.
        // It is not a change, so it stays out of the change log.
      } else if (prevFp !== fp) {
        const prevSlots = prevFp.split("|").filter(Boolean).map((s) => {
          const [range, type] = s.split(":");
          const [start, end] = range.split("-").map(Number);
          return { start, end, type };
        });
        const summary = describeDiff(prevSlots, sched.slots);
        changes.push({
          oblast_slug: oblastSlug, city_slug: citySlug, queue: sched.queue, day,
          change_type: "changed",
          summary,
          old_slots: prevSlots, new_slots: sched.slots,
        });
        for (const f of followers) {
          if (f.queue_group === sched.queue && f.notify_enabled) {
            userNotifs.push({ tg_user_id: f.tg_user_id, day, queue: sched.queue, summary });
          }
        }
      }
      upserts.push({ oblast_slug: oblastSlug, city_slug: citySlug, queue: sched.queue, day, fingerprint: fp });
    }
    // Queues that disappeared
    for (const [key, snap] of prev) {
      if (!key.endsWith(`|${day}`)) continue;
      if (!schedules.some((s) => `${s.queue}|${day}` === key)) {
        changes.push({
          oblast_slug: oblastSlug, city_slug: citySlug, queue: snap.queue, day,
          change_type: "removed",
          summary: "Графік для цієї черги більше не публікується",
          old_slots: null, new_slots: null,
        });
        upserts.push({ oblast_slug: oblastSlug, city_slug: citySlug, queue: snap.queue, day, fingerprint: "" });
      }
    }
  }

  if (upserts.length > 0) {
    const { error } = await supabase
      .from("schedule_snapshots")
      .upsert(upserts, { onConflict: "oblast_slug,city_slug,queue,day" });
    if (error) throw new Error(`snapshot upsert: ${error.message}`);
  }
  if (changes.length > 0) {
    const { error } = await supabase
      .from("schedule_change_log")
      .insert(changes);
    if (error) throw new Error(`change log insert: ${error.message}`);
  }
  // City-level check state: powers the honest "last checked" label and the
  // unread red dot in the mini app.
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

  // Push a short heads-up to affected followers: the visual diff lives in the
  // mini app, the message just tells them to check it.
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
                { text: "⚡️ Переглянути оновлення", web_app: { url: MINI_APP_URL } },
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

// ── Cities to check: ones users actually follow ───────────────
async function getCitiesToCheck(): Promise<{ oblast_slug: string; city_slug: string }[]> {
  const { data, error } = await supabase
    .from("user_preferences")
    .select("oblast_slug, city_slug")
    .not("city_slug", "is", null);
  if (error) throw error;
  const seen = new Set<string>();
  const list: { oblast_slug: string; city_slug: string }[] = [];
  for (const r of data ?? []) {
    const key = `${r.oblast_slug}/${r.city_slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ oblast_slug: r.oblast_slug ?? "", city_slug: r.city_slug! });
  }
  return list;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    if (url.searchParams.get("endpoint") !== "check") {
      return new Response(JSON.stringify({ error: "Unknown endpoint" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cities = await getCitiesToCheck();
    let totalChanges = 0;
    const checked: { city: string; changes: number }[] = [];

    for (const city of cities) {
      try {
        let today: QueueSchedule[] = [];
        let tomorrow: QueueSchedule[] = [];
        if (city.city_slug === "kyiv") {
          today = await fetchYasnoSchedule(false);
          tomorrow = await fetchYasnoSchedule(true);
        } else {
          const todayResp = await fetchWithTimeout(
            `${BEZSVITLA_BASE}/${city.oblast_slug}/${city.city_slug}`,
            { headers: { "User-Agent": "Mozilla/5.0 (compatible; PowerBot/1.0)" } },
          );
          if (todayResp.ok) today = parseBezsvitla(await todayResp.text());
          const tomorrowResp = await fetchWithTimeout(
            `${BEZSVITLA_BASE}/${city.oblast_slug}/${city.city_slug}/grafik-na-zavtra`,
            { headers: { "User-Agent": "Mozilla/5.0 (compatible; PowerBot/1.0)" } },
          );
          if (tomorrowResp.ok) tomorrow = parseBezsvitla(await tomorrowResp.text());
        }
    const n = await checkCity(city.oblast_slug, city.city_slug, today, tomorrow);
        totalChanges += n;
        checked.push({ city: city.city_slug, changes: n });
      } catch (cityErr) {
        console.error(`check failed for ${city.city_slug}:`, cityErr);
      }
    }

    // Retention cleanup
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
