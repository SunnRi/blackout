import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createHmac } from "node:crypto";

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

type TGUser = { id: number; username?: string };

// Telegram recommends rejecting initData older than a few minutes to prevent
// replay. Mini apps stay open longer than that, so we allow up to 24h.
const INIT_DATA_TTL_SECONDS = 24 * 60 * 60;

// Verify the HMAC-SHA256 signature Telegram puts on WebApp initData and
// reject stale payloads based on auth_date.
function verifyInitData(initData: string): TGUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  // Check auth_date freshness before doing the expensive HMAC.
  const authDateStr = params.get("auth_date");
  if (!authDateStr) return null;
  const authDate = Number(authDateStr);
  if (!Number.isFinite(authDate)) return null;
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > INIT_DATA_TTL_SECONDS || ageSeconds < -60) return null;

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const computed = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (computed !== hash) return null;
  try {
    const userRaw = params.get("user");
    if (!userRaw) return null;
    return JSON.parse(userRaw) as TGUser;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => null) as { initData?: string } | null;
    const initData = body?.initData;
    if (!initData || typeof initData !== "string") {
      return new Response(
        JSON.stringify({ error: "initData required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const user = verifyInitData(initData);
    if (!user || typeof user.id !== "number") {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("user_preferences")
        .select("notify_enabled, notify_minutes_before, oblast_slug, city_slug, city_name, queue_group, last_seen_changes_at, alt_oblast_slug, alt_city_slug, alt_city_name, alt_queue_group, alt_label, home_label, active_location")
        .eq("tg_user_id", user.id)
        .maybeSingle();
      if (error) throw error;

      // Also fetch per-city seen state for the user's current city.
      const prefs = data as { oblast_slug: string | null; city_slug: string | null } | null;
      let citySeenAt: string | null = null;
      if (prefs?.oblast_slug && prefs?.city_slug) {
        const { data: viewRow } = await supabase
          .from("user_change_views")
          .select("last_seen_at")
          .eq("tg_user_id", user.id)
          .eq("oblast_slug", prefs.oblast_slug)
          .eq("city_slug", prefs.city_slug)
          .maybeSingle();
        citySeenAt = (viewRow as { last_seen_at: string } | null)?.last_seen_at ?? null;
      }

      return new Response(JSON.stringify({
        prefs: data ?? null,
        city_seen_at: citySeenAt,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      const bodyObj = body as { patch?: Record<string, unknown>; markChangesSeen?: boolean; resetAll?: boolean } | null;

      // Full reset: wipe every per-user row so the app and the bot start
      // over as if the user had never onboarded.
      if (bodyObj?.resetAll) {
        await supabase.from("user_preferences").delete().eq("tg_user_id", user.id);
        await supabase.from("sent_notifications").delete().eq("tg_user_id", user.id);
        await supabase.from("user_change_views").delete().eq("tg_user_id", user.id);
        await supabase.from("notification_outbox").delete().eq("tg_user_id", user.id);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const patch = (bodyObj?.patch ?? {}) as Record<string, unknown>;
      const clean: Record<string, unknown> = { updated_at: new Date().toISOString() };

      if (typeof patch.notify_enabled === "boolean") clean.notify_enabled = patch.notify_enabled;
      if (patch.notify_minutes_before === 15 || patch.notify_minutes_before === 30 || patch.notify_minutes_before === 60) {
        clean.notify_minutes_before = patch.notify_minutes_before;
      }
      if (typeof patch.oblast_slug === "string" && /^[a-z0-9-]{1,64}$/.test(patch.oblast_slug)) {
        clean.oblast_slug = patch.oblast_slug;
      }
      if (typeof patch.city_slug === "string" && /^[a-z0-9-/]{1,200}$/.test(patch.city_slug)) {
        // Settlement slugs are hierarchical ("hromada/settlement"), so a slash is valid.
        clean.city_slug = patch.city_slug;
      }
      if (typeof patch.city_name === "string" && patch.city_name.length <= 128) {
        clean.city_name = patch.city_name.replace(/[<>&]/g, "");
      }
      if (typeof patch.queue_group === "string" && /^[\d.]{1,8}$/.test(patch.queue_group)) {
        clean.queue_group = patch.queue_group;
      }
      if (typeof patch.alt_oblast_slug === "string" && /^[a-z0-9-]{1,64}$/.test(patch.alt_oblast_slug)) {
        clean.alt_oblast_slug = patch.alt_oblast_slug;
      }
      if (typeof patch.alt_city_slug === "string" && /^[a-z0-9-/]{1,200}$/.test(patch.alt_city_slug)) {
        clean.alt_city_slug = patch.alt_city_slug;
      }
      if (typeof patch.alt_city_name === "string" && patch.alt_city_name.length <= 128) {
        clean.alt_city_name = patch.alt_city_name.replace(/[<>&]/g, "");
      }
      if (typeof patch.alt_queue_group === "string" && /^[\d.]{1,8}$/.test(patch.alt_queue_group)) {
        clean.alt_queue_group = patch.alt_queue_group;
      }
      if (typeof patch.alt_label === "string") {
        const trimmed = patch.alt_label.trim().slice(0, 24).replace(/[<>&]/g, "");
        clean.alt_label = trimmed.length > 0 ? trimmed : null;
      }
      if (typeof patch.home_label === "string") {
        const trimmed = patch.home_label.trim().slice(0, 24).replace(/[<>&]/g, "");
        clean.home_label = trimmed.length > 0 ? trimmed : null;
      }
      if (patch.alt_city_slug === null && patch.alt_oblast_slug === null) {
        // Explicit reset of the second location.
        clean.alt_oblast_slug = null;
        clean.alt_city_slug = null;
        clean.alt_city_name = null;
        clean.alt_queue_group = null;
        clean.alt_label = null;
        clean.active_location = "home";
      }
      if (patch.active_location === "home" || patch.active_location === "work") {
        clean.active_location = patch.active_location;
      }
      if (bodyObj?.markChangesSeen) {
        // Write per-city seen state to user_change_views so switching cities
        // doesn't leak the seen-state from one city to another.
        const oblast = typeof patch.oblast_slug === "string" ? patch.oblast_slug : null;
        const city = typeof patch.city_slug === "string" ? patch.city_slug : null;
        if (oblast && city) {
          const seenAt = new Date().toISOString();
          await supabase
            .from("user_change_views")
            .upsert({
              tg_user_id: user.id,
              oblast_slug: oblast,
              city_slug: city,
              last_seen_at: seenAt,
            }, { onConflict: "tg_user_id,oblast_slug,city_slug" });
        }
        // Still update the legacy column for backwards compatibility.
        clean.last_seen_changes_at = new Date().toISOString();
      }

      // ── Re-arm outage notifications when delivery settings change ──
      // sent_notifications claims are keyed by (user, event_start): once a
      // lead-time notification is delivered it will never fire again. If the
      // user shortens the interval (60 -> 30 xв), switches the queue or moves
      // home<->work, the old claim would silently block the new notification.
      // Drop future claims so the checker re-arms with the current settings.
      const claimFields = [
        "notify_enabled",
        "notify_minutes_before",
        "queue_group",
        "alt_queue_group",
        "active_location",
      ] as const;
      const cleanHasClaimField = claimFields.some((f) => f in clean);
      if (cleanHasClaimField) {
        const { data: claimPrefs } = await supabase
          .from("user_preferences")
          .select("notify_enabled, notify_minutes_before, queue_group, alt_queue_group, active_location")
          .eq("tg_user_id", user.id)
          .maybeSingle();
        const before = (claimPrefs as Record<string, unknown> | null) ?? {};
        const claimChanged = claimFields.some((f) => {
          const a = clean[f] ?? null;
          const b = before[f] ?? null;
          return String(a ?? "") !== String(b ?? "");
        });
        if (claimChanged) {
          await supabase
            .from("sent_notifications")
            .delete()
            .eq("tg_user_id", user.id)
            .gte("event_start", new Date().toISOString());
        }
      }

      const { error } = await supabase
        .from("user_preferences")
        .upsert({ tg_user_id: user.id, ...clean }, { onConflict: "tg_user_id" });
      if (error) throw error;

      // Return the current prefs so the app can restore city/queue after
      // a reload. Also fetch per-city seen state for the user's current city.
      const { data: fresh } = await supabase
        .from("user_preferences")
        .select("notify_enabled, notify_minutes_before, oblast_slug, city_slug, city_name, queue_group, last_seen_changes_at, alt_oblast_slug, alt_city_slug, alt_city_name, alt_queue_group, alt_label, home_label, active_location")
        .eq("tg_user_id", user.id)
        .maybeSingle();
      const freshPrefs = fresh as { oblast_slug: string | null; city_slug: string | null } | null;
      let citySeenAt: string | null = null;
      if (freshPrefs?.oblast_slug && freshPrefs?.city_slug) {
        const { data: viewRow } = await supabase
          .from("user_change_views")
          .select("last_seen_at")
          .eq("tg_user_id", user.id)
          .eq("oblast_slug", freshPrefs.oblast_slug)
          .eq("city_slug", freshPrefs.city_slug)
          .maybeSingle();
        citySeenAt = (viewRow as { last_seen_at: string } | null)?.last_seen_at ?? null;
      }

      return new Response(JSON.stringify({
        ok: true,
        prefs: fresh ?? null,
        city_seen_at: citySeenAt,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("user-prefs error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
