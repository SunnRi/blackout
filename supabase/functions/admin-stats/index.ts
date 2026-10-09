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
const BOT_TOKEN = (Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "").trim();
const PREV_BOT_TOKEN = "8673742763:AAE4GID8P_tXvAB7RkVq8vA4dCwis656Fj8";
const ADMIN_TELEGRAM_ID = 87003816;
const INIT_DATA_TTL_SECONDS = 24 * 60 * 60;

type TelegramUser = { id: number };
type UserPreference = {
  tg_user_id: number;
  tg_username: string | null;
  oblast_slug: string | null;
  city_slug: string | null;
  city_name: string | null;
  queue_group: string | null;
  notify_enabled: boolean;
  notify_minutes_before: number;
  created_at: string | null;
  updated_at: string | null;
  active_location: string | null;
  alt_city_name: string | null;
};
type CheckState = {
  oblast_slug: string;
  city_slug: string;
  last_checked_at: string;
  last_change_at: string | null;
};

function checkHmac(dataCheckString: string, hash: string, token: string): boolean {
  try {
    if (!token) return false;
    const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
    const computed = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    return computed === hash;
  } catch {
    return false;
  }
}

function verifyInitData(initData: string): TelegramUser | null {
  if (!initData || typeof initData !== "string") return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDateStr = params.get("auth_date");
  if (!hash || !authDateStr) return null;
  const authDate = Number(authDateStr);
  if (!Number.isFinite(authDate)) return null;

  // Allow up to 24 hours age, and allow up to 10 minutes of clock skew into the future
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > INIT_DATA_TTL_SECONDS || ageSeconds < -600) return null;

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");

  // Validate signature with the current token, falling back to previous token if Telegram client has cached session
  let valid = checkHmac(dataCheckString, hash, BOT_TOKEN);
  if (!valid && PREV_BOT_TOKEN) {
    valid = checkHmac(dataCheckString, hash, PREV_BOT_TOKEN);
  }
  if (!valid) return null;

  try {
    const userRaw = params.get("user");
    if (!userRaw) return null;
    const user = JSON.parse(userRaw) as TelegramUser;
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
    const initData = typeof body?.initData === "string" ? body.initData.trim() : "";
    const user = verifyInitData(initData);
    if (!user) {
      return response({ error: "Не вдалося перевірити автентифікацію Telegram (спробуйте перезапустити бота через /start)" }, 403);
    }
    if (user.id !== ADMIN_TELEGRAM_ID) {
      return response({ error: `Доступ заборонено (користувач ${user.id} не є адміністратором)` }, 403);
    }

    const now = Date.now();
    const activeSince = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const staleBefore = new Date(now - 3 * 60 * 60 * 1000).toISOString();
    const [totalResult, activeResult, preferencesResult, statesResult] = await Promise.all([
      supabase.from("user_preferences").select("tg_user_id", { count: "exact", head: true }),
      supabase.from("user_preferences").select("tg_user_id", { count: "exact", head: true }).gte("updated_at", activeSince),
      supabase.from("user_preferences").select(
        "tg_user_id, tg_username, oblast_slug, city_slug, city_name, queue_group, notify_enabled, notify_minutes_before, created_at, updated_at, active_location, alt_city_name",
      ),
      supabase.from("schedule_check_state").select("oblast_slug, city_slug, last_checked_at, last_change_at"),
    ]);
    if (totalResult.error || activeResult.error || preferencesResult.error || statesResult.error) {
      const errMessage =
        totalResult.error?.message ||
        activeResult.error?.message ||
        preferencesResult.error?.message ||
        statesResult.error?.message;
      throw new Error(`Помилка запиту до бази даних: ${errMessage}`);
    }

    const preferences = (preferencesResult.data ?? []) as UserPreference[];
    const states = (statesResult.data ?? []) as CheckState[];

    // Group users by oblast, with full per-user detail for drill-down.
    const regionMap = new Map<string, UserPreference[]>();
    for (const pref of preferences) {
      const region = pref.oblast_slug || "Не вказано";
      const list = regionMap.get(region) ?? [];
      list.push(pref);
      regionMap.set(region, list);
    }
    const regions = [...regionMap.entries()]
      .map(([name, users]) => ({
        name,
        userCount: users.length,
        users: users
          .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
          .map((u) => ({
            tgUserId: u.tg_user_id,
            username: u.tg_username,
            cityName: u.city_name,
            queueGroup: u.queue_group,
            notifyEnabled: u.notify_enabled,
            notifyMinutesBefore: u.notify_minutes_before,
            activeLocation: u.active_location,
            altCityName: u.alt_city_name,
            createdAt: u.created_at,
            updatedAt: u.updated_at,
          })),
      }))
      .sort((a, b) => b.userCount - a.userCount);

    // City popularity
    const cityMap = new Map<string, number>();
    for (const pref of preferences) {
      const city = pref.city_name || "Не вказано";
      cityMap.set(city, (cityMap.get(city) ?? 0) + 1);
    }
    const cities = [...cityMap.entries()]
      .map(([name, userCount]) => ({ name, users: userCount }))
      .sort((a, b) => b.users - a.users)
      .slice(0, 20);

    // Per-city schedule check details
    const cityChecks = states
      .map((s) => ({
        oblastSlug: s.oblast_slug,
        citySlug: s.city_slug,
        lastCheckedAt: s.last_checked_at,
        lastChangeAt: s.last_change_at,
        isStale: s.last_checked_at < staleBefore,
      }))
      .sort((a, b) => b.lastCheckedAt.localeCompare(a.lastCheckedAt));

    return response({
      generatedAt: new Date().toISOString(),
      users: {
        total: totalResult.count ?? 0,
        activeLast7Days: activeResult.count ?? 0,
        notificationsEnabled: preferences.filter((item) => item.notify_enabled).length,
      },
      regions,
      cities,
      schedules: {
        trackedCities: states.length,
        fresh: states.filter((item) => item.last_checked_at >= staleBefore).length,
        stale: states.filter((item) => item.last_checked_at < staleBefore).length,
        lastCheckedAt: states.reduce<string | null>((latest, item) => !latest || item.last_checked_at > latest ? item.last_checked_at : latest, null),
        lastChangeAt: states.reduce<string | null>((latest, item) => {
          if (!item.last_change_at) return latest;
          return !latest || item.last_change_at > latest ? item.last_change_at : latest;
        }, null),
        cityChecks,
      },
    });
  } catch (error) {
    console.error("admin-stats error", error);
    return response({ error: error instanceof Error ? error.message : "Unable to load statistics" }, 500);
  }
});
