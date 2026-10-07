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

// Verify the HMAC-SHA256 signature Telegram puts on WebApp initData.
function verifyInitData(initData: string): TGUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
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
        .select("notify_enabled, notify_minutes_before, oblast_slug, city_slug, city_name, queue_group")
        .eq("tg_user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return new Response(JSON.stringify({ prefs: data ?? null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      const patch = (body?.patch ?? {}) as Record<string, unknown>;
      const clean: Record<string, unknown> = { updated_at: new Date().toISOString() };

      if (typeof patch.notify_enabled === "boolean") clean.notify_enabled = patch.notify_enabled;
      if (patch.notify_minutes_before === 15 || patch.notify_minutes_before === 30 || patch.notify_minutes_before === 60) {
        clean.notify_minutes_before = patch.notify_minutes_before;
      }
      if (typeof patch.oblast_slug === "string" && /^[a-z0-9-]{1,64}$/.test(patch.oblast_slug)) {
        clean.oblast_slug = patch.oblast_slug;
      }
      if (typeof patch.city_slug === "string" && /^[a-z0-9-]{1,64}$/.test(patch.city_slug)) {
        clean.city_slug = patch.city_slug;
      }
      if (typeof patch.city_name === "string" && patch.city_name.length <= 128) {
        clean.city_name = patch.city_name.replace(/[<>&]/g, "");
      }
      if (typeof patch.queue_group === "string" && /^[\d.]{1,8}$/.test(patch.queue_group)) {
        clean.queue_group = patch.queue_group;
      }

      const { error } = await supabase
        .from("user_preferences")
        .upsert({ tg_user_id: user.id, ...clean }, { onConflict: "tg_user_id" });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), {
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
