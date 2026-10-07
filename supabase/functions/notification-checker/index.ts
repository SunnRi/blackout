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
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const YASNO_BASE = "https://app.yasno.ua/api/blackout-service/public/shutdowns";
const BEZSVITLA_BASE = "https://bezsvitla.com.ua";

type Slot = {
  start: number;
  end: number;
  type: string;
};

type UserPref = {
  tg_user_id: number;
  city_slug: string;
  queue_group: string;
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

async function sendMessage(chatId: number, text: string) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    }),
  });
}

// ── Parse bezsvitla HTML ──────────────────────────────────────
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
    const slotMatches = [...section.matchAll(
      /bz-schedule-slot--(on|off)[^>]*>.*?(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})/gs,
    )];
    for (const m of slotMatches) {
      const status = m[1];
      const [h, min] = m[2].split(":").map(Number);
      const startMin = h * 60 + min;
      let endMin: number;
      if (m[3] === "24:00") endMin = 1440;
      else {
        const [eh, em] = m[3].split(":").map(Number);
        endMin = eh * 60 + em;
      }
      slots.push({
        start: startMin,
        end: endMin,
        type: status === "off" ? "Definite" : "NotPlanned",
      });
    }
    return slots;
  }
  return [];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { data: users, error } = await supabase
      .from("user_preferences")
      .select("tg_user_id, city_slug, queue_group, notify_minutes_before, notify_enabled")
      .eq("notify_enabled", true)
      .not("city_slug", "is", null)
      .not("queue_group", "is", null);

    if (error) throw error;
    if (!users || users.length === 0) {
      return new Response(JSON.stringify({ checked: 0, notified: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const todayISO = getKyivDateISO();
    const currentMinutes = getKyivMinutes();
    let notifiedCount = 0;

    // Group users by city to minimize fetches
    const cityGroups = new Map<string, UserPref[]>();
    for (const user of users as UserPref[]) {
      if (!cityGroups.has(user.city_slug)) cityGroups.set(user.city_slug, []);
      cityGroups.get(user.city_slug)!.push(user);
    }

    for (const [citySlug, cityUsers] of cityGroups) {
      let slotsByQueue: Record<string, Slot[]> = {};

      if (citySlug === "kyiv") {
        // Yasno API for Kyiv city
        const resp = await fetch(
          `${YASNO_BASE}/regions/25/dsos/902/planned-outages`,
          { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } },
        );
        if (!resp.ok) continue;
        const planned = await resp.json();
        for (const [group, data] of Object.entries(planned)) {
          const todaySlots = (data as any)?.today?.slots || [];
          slotsByQueue[group] = todaySlots;
        }
      } else {
        // Bezsvitla for oblast cities
        const resp = await fetch(
          `${BEZSVITLA_BASE}/kyivska-oblast/${citySlug}`,
          { headers: { "User-Agent": "Mozilla/5.0 (compatible; PowerBot/1.0)" } },
        );
        if (!resp.ok) continue;
        const html = await resp.text();
        for (const user of cityUsers) {
          slotsByQueue[user.queue_group] = parseBezsvitla(html, user.queue_group);
        }
      }

      for (const user of cityUsers) {
        const slots = slotsByQueue[user.queue_group];
        if (!slots) continue;

        const definiteSlots = slots.filter((s) => s.type === "Definite");
        for (const slot of definiteSlots) {
          const minutesUntilOutage = slot.start - currentMinutes;
          if (
            minutesUntilOutage > 0 &&
            minutesUntilOutage <= user.notify_minutes_before &&
            minutesUntilOutage >= user.notify_minutes_before - 5
          ) {
            const eventStart = `${todayISO}T${minutesToTimeStr(slot.start)}:00`;
            const { data: existing } = await supabase
              .from("sent_notifications")
              .select("id")
              .eq("tg_user_id", user.tg_user_id)
              .eq("event_start", eventStart)
              .maybeSingle();

            if (existing) continue;

            const timeStr = minutesToTimeStr(slot.start);
            const endStr = minutesToTimeStr(slot.end);
            const durationMin = slot.end - slot.start;

            const message =
              `⚡️ <b>Попередження про відключення</b>\n\n` +
              `Світло відключать о <b>${timeStr}</b> (через ~${minutesUntilOutage} хв)\n` +
              `Тривалість: ${durationMin} хв (до ${endStr})\n` +
              `Черга: ${user.queue_group}\n\n` +
              `Підготуйтеся: зарядіть пристрої 💡`;

            await sendMessage(user.tg_user_id, message);
            await supabase.from("sent_notifications").insert({
              tg_user_id: user.tg_user_id,
              event_start: eventStart,
              event_type: "definite",
            });
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
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
