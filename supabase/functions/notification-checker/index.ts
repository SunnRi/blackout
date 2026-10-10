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

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
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
const YASNO_BASE = "https://app.yasno.ua/api/blackout-service/public/shutdowns";
const BEZSVITLA_BASE = "https://bezsvitla.com.ua";

type Slot = { start: number; end: number; type: string };

type UserPref = {
  tg_user_id: number;
  oblast_slug: string;
  city_slug: string;
  queue_group: string;
  alt_oblast_slug: string | null;
  alt_city_slug: string | null;
  alt_queue_group: string | null;
  notify_minutes_before: number;
  notify_enabled: boolean;
};

function minutesToTimeStr(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function getKyivNow(): Date {
  const now = new Date();
  const kyivStr = now.toLocaleString("en-US", { timeZone: "Europe/Kyiv" });
  return new Date(kyivStr);
}

function getKyivMinutes(): number {
  const now = getKyivNow();
  return now.getHours() * 60 + now.getMinutes();
}

function getKyivDateISO(): string {
  const now = getKyivNow();
  return now.toISOString().split("T")[0];
}

// Send a Telegram message and return true only if Telegram confirmed delivery.
async function sendMessage(chatId: number, text: string): Promise<boolean> {
  try {
    const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    const json = await resp.json() as { ok?: boolean };
    return !!json.ok;
  } catch {
    return false;
  }
}

function parseBezsvitla(html: string, targetQueue: string): Slot[] {
  const queueMatches = [...html.matchAll(/Черга\s+(\d\.\d)/g)];
  for (let i = 0; i < queueMatches.length; i++) {
    if (queueMatches[i][1] !== targetQueue) continue;
    const sectionStart = queueMatches[i].index! + queueMatches[i][0].length;
    const sectionEnd = i + 1 < queueMatches.length
      ? queueMatches[i + 1].index!
      : sectionStart + 5000;
    const section = html.slice(sectionStart, sectionEnd);
    const slots: Slot[] = [];
    for (const m of section.matchAll(
      /bz-schedule-slot--(on|off)[^>]*>.*?(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})/gs,
    )) {
      const [h, min] = m[2].split(":").map(Number);
      const startMin = h * 60 + min;
      let endMin: number;
      if (m[3] === "24:00") endMin = 1440;
      else {
        const [eh, em] = m[3].split(":").map(Number);
        endMin = eh * 60 + em;
      }
      slots.push({ start: startMin, end: endMin, type: m[1] === "off" ? "Definite" : "NotPlanned" });
    }
    return slots;
  }
  return [];
}

// Fetch and parse all queues from bezsvitla for one city page.
function parseBezsvitlaAll(html: string): Record<string, Slot[]> {
  const result: Record<string, Slot[]> = {};
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
      const [h, min] = m[2].split(":").map(Number);
      const startMin = h * 60 + min;
      let endMin: number;
      if (m[3] === "24:00") endMin = 1440;
      else {
        const [eh, em] = m[3].split(":").map(Number);
        endMin = eh * 60 + em;
      }
      slots.push({ start: startMin, end: endMin, type: m[1] === "off" ? "Definite" : "NotPlanned" });
    }
    result[queueName] = slots;
  }
  return result;
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

    const { data: users, error } = await supabase
      .from("user_preferences")
      .select("tg_user_id, oblast_slug, city_slug, queue_group, alt_oblast_slug, alt_city_slug, alt_queue_group, notify_minutes_before, notify_enabled")
      .eq("notify_enabled", true)
      .not("city_slug", "is", null)
      .not("queue_group", "is", null)
      .not("oblast_slug", "is", null);

    if (error) throw error;
    if (!users || users.length === 0) {
      return new Response(JSON.stringify({ checked: 0, notified: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const todayISO = getKyivDateISO();
    const currentMinutes = getKyivMinutes();
    let notifiedCount = 0;

    // Group users by location: each user can have home and optional alt (work).
    type CityGroup = { oblast: string; city: string };
    const cityGroups = new Map<string, CityGroup & { users: UserPref[] }>();
    for (const user of users as UserPref[]) {
      const locations: { oblast: string; city: string; queue: string }[] = [
        { oblast: user.oblast_slug, city: user.city_slug, queue: user.queue_group },
      ];
      if (user.alt_oblast_slug && user.alt_city_slug && user.alt_queue_group) {
        locations.push({ oblast: user.alt_oblast_slug, city: user.alt_city_slug, queue: user.alt_queue_group });
      }
      for (const loc of locations) {
        const key = `${loc.oblast}/${loc.city}`;
        if (!cityGroups.has(key)) {
          cityGroups.set(key, { oblast: loc.oblast, city: loc.city, users: [] });
        }
        cityGroups.get(key)!.users.push(user);
      }
    }

    for (const { oblast: oblastSlug, city: citySlug, users: cityUsers } of cityGroups.values()) {
      // Each user's queue in THIS city (home or alt whichever matches).
      const queueByUser = new Map<number, string>();
      for (const user of cityUsers) {
        if (user.oblast_slug === oblastSlug && user.city_slug === citySlug) queueByUser.set(user.tg_user_id, user.queue_group);
        else if (user.alt_oblast_slug === oblastSlug && user.alt_city_slug === citySlug && user.alt_queue_group) queueByUser.set(user.tg_user_id, user.alt_queue_group);
      }
      const slotsByQueue: Record<string, Slot[]> = {};

      if (citySlug === "kyiv") {
        const resp = await fetch(
          `${YASNO_BASE}/regions/25/dsos/902/planned-outages`,
          { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } },
        );
        if (!resp.ok) continue;
        const planned = await resp.json();
        for (const [group, data] of Object.entries(planned)) {
          const todayData = (data as Record<string, unknown>)?.today as { slots: Slot[] } | undefined;
          slotsByQueue[group] = todayData?.slots ?? [];
        }
      } else {
        const resp = await fetch(
          `${BEZSVITLA_BASE}/${oblastSlug}/${citySlug}`,
          { headers: { "User-Agent": "Mozilla/5.0 (compatible; PowerBot/1.0)" } },
        );
        if (!resp.ok) continue;
        const html = await resp.text();
        const parsed = parseBezsvitlaAll(html);
        for (const queue of new Set(queueByUser.values())) {
          slotsByQueue[queue] = parsed[queue] ?? [];
        }
      }

      for (const user of cityUsers) {
        const queue = queueByUser.get(user.tg_user_id);
        if (!queue) continue;
        const slots = slotsByQueue[queue];
        if (!slots || slots.length === 0) continue;

        const definiteSlots = slots.filter((s) => s.type === "Definite");
        for (const slot of definiteSlots) {
          const minutesUntilOutage = slot.start - currentMinutes;
          if (
            minutesUntilOutage > 0 &&
            minutesUntilOutage <= user.notify_minutes_before
          ) {
            const eventStart = `${todayISO}T${minutesToTimeStr(slot.start)}:00`;

            // Claim the notification slot before sending: insert first,
            // then send only if the insert succeeded (row was new).
            const { error: insertErr } = await supabase
              .from("sent_notifications")
              .insert({
                tg_user_id: user.tg_user_id,
                event_start: eventStart,
                event_type: "definite",
              });

            if (insertErr) continue; // already claimed by a concurrent run

            const timeStr = minutesToTimeStr(slot.start);
            const endStr = minutesToTimeStr(slot.end);
            const durationMin = slot.end - slot.start;

            const message =
              `⚡️ <b>Попередження про відключення</b>\n\n` +
              `Світло відключать о <b>${timeStr}</b> (через ~${minutesUntilOutage} хв)\n` +
              `Тривалість: ${durationMin} хв (до ${endStr})\n` +
              `Черга: ${queue}\n\n` +
              `🕐 Час приблизний — оператор (ДТЕК та ін.) сам обирає точний час, тож можливі відхилення.\n\n` +
              `Підготуйтеся заздалегідь:\n` +
              `• Не заходьте в ліфт перед відключенням\n` +
              `• Зарядіть телефони, електроніку, зарядні станції та павербанки\n\n` +
              `Бережіть себе 💙💛`;

            const sent = await sendMessage(user.tg_user_id, message);
            if (!sent) {
              // Delivery failed — remove the claim so the next run can retry.
              await supabase
                .from("sent_notifications")
                .delete()
                .eq("tg_user_id", user.tg_user_id)
                .eq("event_start", eventStart);
              continue;
            }
            notifiedCount++;
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ checked: users.length, notified: notifiedCount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("notification-checker error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
