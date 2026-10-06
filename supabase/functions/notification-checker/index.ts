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

type OutageSlot = {
  start: number; // minutes from midnight
  end: number;
  type: string; // "Definite" | "NotPlanned"
};

type PlannedOutagesResponse = Record<string, {
  today?: {
    date: string;
    status: string;
    slots: OutageSlot[];
  };
  tomorrow?: {
    date: string;
    status: string;
    slots: OutageSlot[];
  };
  updatedOn?: string;
}>;

type UserPref = {
  tg_user_id: number;
  yasno_region_id: number;
  yasno_dso_id: number;
  yasno_group: string;
  notify_minutes_before: number;
  notify_enabled: boolean;
};

function minutesToTimeStr(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function getKyivNow(): Date {
  const now = new Date();
  // Convert to Europe/Kyiv (UTC+3 currently, but use locale string for safety)
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    // Fetch all users with notifications enabled and Yasno config
    const { data: users, error } = await supabase
      .from("user_preferences")
      .select("tg_user_id, yasno_region_id, yasno_dso_id, yasno_group, notify_minutes_before, notify_enabled")
      .eq("notify_enabled", true)
      .not("yasno_region_id", "is", null)
      .not("yasno_dso_id", "is", null)
      .not("yasno_group", "is", null);

    if (error) throw error;
    if (!users || users.length === 0) {
      return new Response(JSON.stringify({ checked: 0, notified: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const todayISO = getKyivDateISO();
    const currentMinutes = getKyivMinutes();
    let notifiedCount = 0;

    // Group users by region+dso to minimize API calls
    const groupKey = (u: UserPref) => `${u.yasno_region_id}:${u.yasno_dso_id}`;
    const groups = new Map<string, UserPref[]>();
    for (const user of users as UserPref[]) {
      const key = groupKey(user);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(user);
    }

    for (const [key, groupUsers] of groups) {
      const [regionId, dsoId] = key.split(":").map(Number);

      // Fetch planned outages for this region+dso
      const apiUrl = `${YASNO_BASE}/regions/${regionId}/dsos/${dsoId}/planned-outages`;
      const resp = await fetch(apiUrl, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; PowerOutageBot/1.0)",
        },
      });

      if (!resp.ok) {
        console.error(`Yasno API failed for region ${regionId}: ${resp.status}`);
        continue;
      }

      const allGroups = (await resp.json()) as PlannedOutagesResponse;
      const todayData = todayISO;

      for (const user of groupUsers) {
        const groupData = allGroups[user.yasno_group];
        if (!groupData?.today?.slots) continue;

        // Only process "Definite" outage slots
        const definiteSlots = groupData.today.slots.filter(
          (s) => s.type === "Definite",
        );

        for (const slot of definiteSlots) {
          const slotStart = slot.start;
          const minutesUntilOutage = slotStart - currentMinutes;

          // Check if we should notify (within the window: notify_minutes_before to notify_minutes_before+5)
          if (
            minutesUntilOutage > 0 &&
            minutesUntilOutage <= user.notify_minutes_before &&
            minutesUntilOutage >= user.notify_minutes_before - 5
          ) {
            // Check if already sent
            const eventStart = `${todayData}T${minutesToTimeStr(slotStart)}:00`;
            const { data: existing } = await supabase
              .from("sent_notifications")
              .select("id")
              .eq("tg_user_id", user.tg_user_id)
              .eq("event_start", eventStart)
              .maybeSingle();

            if (existing) continue;

            const timeStr = minutesToTimeStr(slotStart);
            const durationMin = slot.end - slot.start;
            const endStr = minutesToTimeStr(slot.end);

            const message =
              `⚡️ <b>Попередження про відключення</b>\n\n` +
              `Світло відключать о <b>${timeStr}</b> (через ~${minutesUntilOutage} хв)\n` +
              `Тривалість: ${durationMin} хв (до ${endStr})\n` +
              `Група: ${user.yasno_group}\n\n` +
              `Підготуйтеся: зарядіть пристрої, перевірте power bank 💡`;

            await sendMessage(user.tg_user_id, message);

            // Record as sent
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
