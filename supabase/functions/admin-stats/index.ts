import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const ADMIN_TELEGRAM_ID = 87003816;
const INIT_DATA_TTL_SECONDS = 24 * 60 * 60;

type TelegramUser = { id: number };
type UserPreference = {
  oblast_slug: string | null;
  city_name: string | null;
  notify_enabled: boolean;
  updated_at: string | null;
};
type CheckState = {
  oblast_slug: string;
  city_slug: string;
  last_checked_at: string;
};

function verifyInitData(initData: string): TelegramUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  if (!hash || !Number.isFinite(authDate)) return null;
  if (Date.now() / 1000 - authDate > INIT_DATA_TTL_SECONDS || authDate - Date.now() / 1000 > 60) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()].map(([key, value]) => `${key}=${value}`).sort().join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const computed = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (computed !== hash) return null;
  try {
    const user = JSON.parse(params.get("user") ?? "null") as TelegramUser | null;
    return user && typeof user.id === "number" ? user : null;
  } catch {
    return null;
  }
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    const body = await req.json().catch(() => null) as { initData?: unknown } | null;
    const initData = typeof body?.initData === "string" ? body.initData : "";
    const user = verifyInitData(initData);
    if (!user || user.id !== ADMIN_TELEGRAM_ID) return response({ error: "Unauthorized" }, 403);

    const now = Date.now();
    const activeSince = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const staleBefore = new Date(now - 3 * 60 * 60 * 1000).toISOString();
    const [totalResult, activeResult, preferencesResult, statesResult] = await Promise.all([
      supabase.from("user_preferences").select("tg_user_id", { count: "exact", head: true }),
      supabase.from("user_preferences").select("tg_user_id", { count: "exact", head: true }).gte("updated_at", activeSince),
      supabase.from("user_preferences").select("oblast_slug, city_name, notify_enabled, updated_at"),
      supabase.from("schedule_check_state").select("oblast_slug, city_slug, last_checked_at"),
    ]);
    if (totalResult.error || activeResult.error || preferencesResult.error || statesResult.error) {
      throw new Error("Statistics query failed");
    }

    const preferences = (preferencesResult.data ?? []) as UserPreference[];
    const states = (statesResult.data ?? []) as CheckState[];
    const regions = new Map<string, number>();
    const cities = new Map<string, number>();
    for (const preference of preferences) {
      const region = preference.oblast_slug || "Не вказано";
      regions.set(region, (regions.get(region) ?? 0) + 1);
      const city = preference.city_name || "Не вказано";
      cities.set(city, (cities.get(city) ?? 0) + 1);
    }
    const sorted = (map: Map<string, number>) => [...map.entries()]
      .map(([name, users]) => ({ name, users }))
      .sort((a, b) => b.users - a.users);

    return response({
      generatedAt: new Date().toISOString(),
      users: {
        total: totalResult.count ?? 0,
        activeLast7Days: activeResult.count ?? 0,
        notificationsEnabled: preferences.filter((item) => item.notify_enabled).length,
      },
      regions: sorted(regions),
      cities: sorted(cities).slice(0, 20),
      schedules: {
        trackedCities: states.length,
        fresh: states.filter((item) => item.last_checked_at >= staleBefore).length,
        stale: states.filter((item) => item.last_checked_at < staleBefore).length,
        lastCheckedAt: states.reduce<string | null>((latest, item) => !latest || item.last_checked_at > latest ? item.last_checked_at : latest, null),
      },
    });
  } catch (error) {
    console.error("admin-stats error", error);
    return response({ error: "Unable to load statistics" }, 500);
  }
});
