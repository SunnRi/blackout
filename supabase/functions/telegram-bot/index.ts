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
const MINI_APP_URL = "https://botsvitla.bolt.host";
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const BEZSVITLA_BASE = "https://bezsvitla.com.ua";
const YASNO_BASE = "https://app.yasno.ua/api/blackout-service/public/shutdowns";
const YASNO_REGION_ID = 25;
const YASNO_DSO_ID = 902;

type Slot = { start: number; end: number; type: string };

type TGUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

type TGMessage = {
  message_id: number;
  from?: TGUser;
  chat: { id: number; type: string };
  text?: string;
};

type TGCallbackQuery = {
  id: string;
  from: TGUser;
  message?: { chat: { id: number }; message_id: number };
  data?: string;
};

type TGUpdate = {
  update_id: number;
  message?: TGMessage;
  callback_query?: TGCallbackQuery;
};

type UserPref = {
  oblast_slug: string | null;
  city_slug: string | null;
  city_name: string | null;
  queue_group: string | null;
  notify_enabled: boolean;
  notify_minutes_before: number;
};

// ── Mini app → bot confirmation (Telegram initData verification) ──
type MiniAppConfirm = {
  action: "prefs_saved";
  initData: string;
  city: string;
  queue: string;
};

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

async function handlePrefsSaved(confirm: MiniAppConfirm) {
  const user = verifyInitData(confirm.initData);
  if (!user) return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
    status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  const queue = String(confirm.queue).replace(/[<>&]/g, "");
  const city = String(confirm.city).replace(/[<>&]/g, "");
  await sendMessage(
    user.id,
    `✅ <b>Налаштування збережено</b>\n\n` +
      `📍 Місто: <b>${city}</b>\n` +
      `🔢 Черга: <b>${queue}</b>\n\n` +
      `Графік у боті та веб-додатку тепер однаковий. Коли світло вимкнуть, я попереджу заздалегідь 🔔`,
    mainKeyboard,
  );
  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Telegram helpers ──────────────────────────────────────────
async function tgCall(method: string, body: Record<string, unknown>) {
  const resp = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return resp.json();
}

async function sendMessage(chatId: number, text: string, keyboard?: unknown) {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };
  if (keyboard) body.reply_markup = keyboard;
  return tgCall("sendMessage", body);
}

async function editMessage(chatId: number, messageId: number, text: string, keyboard?: unknown) {
  return tgCall("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
}

async function answerCallback(id: string, text?: string) {
  return tgCall("answerCallbackQuery", {
    callback_query_id: id,
    ...(text ? { text, show_alert: false } : {}),
  });
}

// Update the bot's own message in place when possible (AJAX-style),
// fall back to a new message for commands where there is nothing to edit.
async function sendOrUpdate(
  chatId: number,
  editOf: number | undefined,
  text: string,
  keyboard?: unknown,
) {
  if (editOf) {
    const res = await editMessage(chatId, editOf, text, keyboard) as { ok?: boolean };
    if (res?.ok) return;
  }
  await sendMessage(chatId, text, keyboard);
}

function setChatMenuButton() {
  return tgCall("setChatMenuButton", {
    menu_button: {
      type: "web_app",
      text: "Графік світла",
      web_app: { url: MINI_APP_URL },
    },
  });
}

const mainKeyboard = {
  inline_keyboard: [
    [
      { text: "🟢 Мій статус", callback_data: "status" },
      { text: "🕒 Коли світло", callback_data: "next" },
    ],
    [{ text: "🔔 Сповіщення", callback_data: "settings" }],
  ],
};

// Live-view keyboards: a refresh button that re-renders the same message
// in place, plus a way back to the main menu without piling up messages.
function liveViewKeyboard(self: "status" | "next") {
  return {
    inline_keyboard: [
      [
        { text: "🔄 Оновити", callback_data: `refresh:${self}` },
        { text: self === "status" ? "🕒 Коли світло" : "🟢 Мій статус", callback_data: self === "status" ? "next" : "status" },
      ],
      [{ text: "⬅️ Меню", callback_data: "back" }],
    ],
  };
}

function settingsKeyboard(notifyEnabled: boolean, minutes: number) {
  return {
    inline_keyboard: [
      [{
        text: notifyEnabled ? "🔔 Увімкнені ✓" : "🔕 Вимкнені",
        callback_data: "toggle_notify",
      }],
      [
        { text: `${minutes === 15 ? "✓ " : ""}15 хв`, callback_data: "notify:15" },
        { text: `${minutes === 30 ? "✓ " : ""}30 хв`, callback_data: "notify:30" },
        { text: `${minutes === 60 ? "✓ " : ""}60 хв`, callback_data: "notify:60" },
      ],
      [{ text: "⬅️ Назад", callback_data: "back" }],
    ],
  };
}

// ── Time helpers (Kyiv) ───────────────────────────────────────
function getKyivNow(): Date {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "Europe/Kyiv" }));
}

function minutesToTime(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h} год ${m} хв`;
  if (h > 0) return `${h} год`;
  return `${m} хв`;
}

// ── Schedule helpers ──────────────────────────────────────────
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
      slots.push({
        start: startMin,
        end: endMin,
        type: m[1] === "off" ? "Definite" : "NotPlanned",
      });
    }
    return slots;
  }
  return [];
}

async function fetchYasnoSlots(queue: string, tomorrow: boolean): Promise<Slot[]> {
  const resp = await fetch(
    `${YASNO_BASE}/regions/${YASNO_REGION_ID}/dsos/${YASNO_DSO_ID}/planned-outages`,
    { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } },
  );
  if (!resp.ok) throw new Error(`Yasno API ${resp.status}`);
  const planned = await resp.json();
  const day = tomorrow ? "tomorrow" : "today";
  const data = (planned as Record<string, unknown>)[queue] as Record<string, unknown> | undefined;
  return (data?.[day] as { slots: Slot[] } | undefined)?.slots ?? [];
}

async function fetchTodaySlots(
  oblastSlug: string,
  citySlug: string,
  queue: string,
): Promise<Slot[]> {
  if (citySlug === "kyiv") return fetchYasnoSlots(queue, false);
  const resp = await fetch(
    `${BEZSVITLA_BASE}/${oblastSlug || "kyivska-oblast"}/${citySlug}`,
    { headers: { "User-Agent": "Mozilla/5.0 (compatible; PowerBot/1.0)" } },
  );
  if (!resp.ok) throw new Error(`bezsvitla ${resp.status}`);
  return parseBezsvitla(await resp.text(), queue);
}

async function fetchTomorrowSlots(
  oblastSlug: string,
  citySlug: string,
  queue: string,
): Promise<Slot[]> {
  if (citySlug === "kyiv") return fetchYasnoSlots(queue, true);
  const resp = await fetch(
    `${BEZSVITLA_BASE}/${oblastSlug || "kyivska-oblast"}/${citySlug}/grafik-na-zavtra`,
    { headers: { "User-Agent": "Mozilla/5.0 (compatible; PowerBot/1.0)" } },
  );
  if (!resp.ok) throw new Error(`bezsvitla ${resp.status}`);
  return parseBezsvitla(await resp.text(), queue);
}

// ── User preferences (shared with the mini app) ───────────────
async function getUserPref(tgUserId: number): Promise<UserPref | null> {
  const { data } = await supabase
    .from("user_preferences")
    .select("oblast_slug, city_slug, city_name, queue_group, notify_enabled, notify_minutes_before")
    .eq("tg_user_id", tgUserId)
    .maybeSingle();
  return (data as UserPref) ?? null;
}

function prefConfigured(p: UserPref | null): p is UserPref & {
  city_slug: string; queue_group: string;
} {
  return !!p && !!p.city_slug && !!p.queue_group;
}

async function updateNotifySettings(
  tgUserId: number,
  patch: { notify_enabled?: boolean; notify_minutes_before?: number },
) {
  // Keep tg_username unchanged by not touching it; upsert only the patch.
  const { data: existing } = await supabase
    .from("user_preferences")
    .select("tg_username")
    .eq("tg_user_id", tgUserId)
    .maybeSingle();
  await supabase
    .from("user_preferences")
    .upsert(
      {
        tg_user_id: tgUserId,
        tg_username: (existing as { tg_username: string | null } | null)?.tg_username ?? null,
        ...patch,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tg_user_id" },
    );
}

// ── Messages ──────────────────────────────────────────────────
// On /start the priority is to get the user into the mini app right away:
// a prominent open-app button first, regular bot actions below.
function startKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📊 Відкрити графік світла", web_app: { url: MINI_APP_URL } }],
      [
        { text: "🟢 Мій статус", callback_data: "status" },
        { text: "🕒 Коли світло", callback_data: "next" },
      ],
      [{ text: "🔔 Сповіщення", callback_data: "settings" }],
    ],
  };
}

async function handleStart(msg: TGMessage) {
  const chatId = msg.chat.id;
  const name = msg.from?.first_name ?? "друг";
  await sendMessage(
    chatId,
    `👋 Привіт, <b>${name}</b>!

` +
      `⚡️ <b>Світло Бот</b> — ваш помічник у графіках відключень.

` +
      `⬇️ Натисніть кнопку <b>«Відкрити графік світла»</b> під цим повідомленням — додаток відкриється одразу.
` +
      `(Та сама дія — синя кнопка меню <b>зліва</b> біля поля введення.)

` +
      `<b>Що я вмію:</b>
` +
      `🔔 — попереджаю про відключення заздалегідь
` +
      `📡 — повідомляю, якщо графік змінився
` +
      `🟢 — показую, чи є світло зараз
` +
      `🕒 — показую найближчі відключення

` +
      `<i>Спочатку оберіть місто та чергу у додатку, потім увімкніть сповіщення 🔔</i>`,
    startKeyboard(),
  );
}

async function handleHelp(chatId: number) {
  await sendMessage(
    chatId,
    `<b>📖 Як користуватися</b>

` +
      `<b>1.</b> 📲 Натисніть <b>синю кнопку меню зліва</b> внизу чата (біля поля введення) — відкриється додаток «Графік світла». Оберіть там область, місто і чергу
` +
      `<b>2.</b> У «🔔 Сповіщення» увімкніть повідомлення й оберіть інтервал — 15, 30 або 60 хвилин
` +
      `<b>3.</b> Я сам напишу, коли світло вимкнуть, і повідомлю про зміни графіка

` +
      `<i>Кнопки під цим повідомленням працюють тут, у чаті: статус, розклад, сповіщення — все оновлюється без зайвих повідомлень.</i>

` +
      `<b>⚙️ Команди</b>
` +
      `/start — головне меню
` +
      `/status — чи є світло зараз
` +
      `/next — найближчі відключення
` +
      `/help — ця довідка`,
    mainKeyboard,
  );
}

async function handleSettings(chatId: number, tgUserId: number, editOf?: number) {
  const pref = await getUserPref(tgUserId);
  const enabled = pref?.notify_enabled ?? false;
  const minutes = pref?.notify_minutes_before ?? 60;
  const text =
    `<b>🔔 Налаштування сповіщень</b>

` +
    `Попереджу про відключення заздалегідь і повідомляю про зміни графіка.

` +
    `<b>За скільки хвилин попереджати:</b>

` +
    `<i>Спільно з веб-додатком 📊</i>`;
  const keyboard = settingsKeyboard(enabled, minutes);
  if (editOf) {
    await editMessage(chatId, editOf, text, keyboard);
  } else {
    await sendMessage(chatId, text, keyboard);
  }
}

async function handleStatus(chatId: number, tgUserId: number, editOf?: number) {
  const pref = await getUserPref(tgUserId);
  if (!prefConfigured(pref)) {
    await sendOrUpdate(
      chatId,
      editOf,
      `⚙️ Спочатку оберіть місто та чергу в додатку «Графік світла» (синя кнопка меню зліва) — і я покажу ваш статус.`,
      mainKeyboard,
    );
    return;
  }

  let slots: Slot[];
  try {
    slots = await fetchTodaySlots(pref.oblast_slug ?? "", pref.city_slug!, pref.queue_group!);
  } catch {
    await sendOrUpdate(
      chatId,
      editOf,
      `😴 Не вдалося завантажити графік. Спробуйте трохи пізніше.`,
      liveViewKeyboard("status"),
    );
    return;
  }

  if (slots.length === 0) {
    await sendOrUpdate(
      chatId,
      editOf,
      `📭 <b>Графік відключень ще не опубліковано</b>\n\nЧекаємо оновлення інформації — як тільки з'явиться, повідомлю.`,
      liveViewKeyboard("status"),
    );
    return;
  }

  const now = getKyivNow();
  const cur = now.getHours() * 60 + now.getMinutes();
  const current = slots.find((s) => cur >= s.start && cur < s.end);
  const isOff = current?.type === "Definite";

  const nextOn = slots
    .filter((s) => s.type !== "Definite" && s.start > cur)
    .sort((a, b) => a.start - b.start)[0];
  const nextOut = slots
    .filter((s) => s.type === "Definite" && s.start > cur)
    .sort((a, b) => a.start - b.start)[0];

  let body: string;
  if (isOff) {
    const until = current ? formatDuration(current.end - cur) : "";
    body = `🔴 <b>Світла немає</b>
` +
      `⏱ Світло повернеться о <b>${minutesToTime(current!.end)}</b> · через ${until}`;
    if (nextOn) body += `\n\n🟢 Далі світло: <b>${minutesToTime(nextOn.start)} – ${minutesToTime(nextOn.end)}</b>`;
  } else {
    body = `🟢 <b>Світло є</b>`;
    if (current) body += `\n⏱ До ${minutesToTime(current.end)} · ${formatDuration(current.end - cur)}`;
    if (nextOut) {
      const mins = nextOut.start - cur;
      body += `\n\n🔴 Відключення о <b>${minutesToTime(nextOut.start)}</b> · через ${formatDuration(mins)}`;
      body += `\n🔌 Без світла до ${minutesToTime(nextOut.end)}`;
    } else {
      body += `\n\n✅ Більше відключень сьогодні не заплановано`;
    }
  }

  await sendOrUpdate(
    chatId,
    editOf,
    `${body}\n\n───────────\n📍 ${pref.city_name ?? pref.city_slug} · черга ${pref.queue_group}`,
    liveViewKeyboard("status"),
  );
}

async function handleNext(chatId: number, tgUserId: number, editOf?: number) {
  const pref = await getUserPref(tgUserId);
  if (!prefConfigured(pref)) {
    await sendOrUpdate(
      chatId,
      editOf,
      `⚙️ Спочатку оберіть місто та чергу в додатку «Графік світла» (синя кнопка меню зліва) — і я покажу розклад.`,
      mainKeyboard,
    );
    return;
  }

  let todaySlots: Slot[] = [];
  let tomorrowSlots: Slot[] = [];
  try {
    todaySlots = await fetchTodaySlots(pref.oblast_slug ?? "", pref.city_slug!, pref.queue_group!);
    tomorrowSlots = await fetchTomorrowSlots(pref.oblast_slug ?? "", pref.city_slug!, pref.queue_group!);
  } catch {
    await sendOrUpdate(chatId, editOf, `😴 Не вдалося завантажити графік. Спробуйте трохи пізніше.`, liveViewKeyboard("next"));
    return;
  }

  if (todaySlots.length === 0 && tomorrowSlots.length === 0) {
    await sendOrUpdate(
      chatId,
      editOf,
      `📭 <b>Графік відключень ще не опубліковано</b>\n\nЧекаємо оновлення інформації — як тільки з'явиться, повідомлю.`,
      liveViewKeyboard("next"),
    );
    return;
  }

  const now = getKyivNow();
  const cur = now.getHours() * 60 + now.getMinutes();
  const offToday = todaySlots
    .filter((s) => s.type === "Definite" && s.end > cur)
    .sort((a, b) => a.start - b.start);

  let text = `🕒 <b>Найближчі відключення</b>
📍 ${pref.city_name ?? pref.city_slug} · черга ${pref.queue_group}
───────────`;

  if (offToday.length > 0) {
    text += `\n\n<b>📅 Сьогодні:</b>\n`;
    for (const s of offToday.slice(0, 4)) {
      const active = cur >= s.start && cur < s.end;
      text += `${active ? "🔴" : "▫️"} <b>${minutesToTime(s.start)} – ${minutesToTime(s.end)}</b> · ${formatDuration(s.end - s.start)}${active ? " · <i>зараз</i>" : ""}\n`;
    }
  } else {
    text += `\n\n✅ Сьогодні відключень більше немає`;
  }

  const offTomorrow = tomorrowSlots.filter((s) => s.type === "Definite");
  if (offTomorrow.length > 0) {
    text += `\n\n<b>🌙 Завтра:</b>\n`;
    for (const s of offTomorrow.slice(0, 4)) {
      text += `▫️ <b>${minutesToTime(s.start)} – ${minutesToTime(s.end)}</b> · ${formatDuration(s.end - s.start)}\n`;
    }
  } else if (tomorrowSlots.length > 0) {
    text += `\n\n🟢 Завтра відключень не заплановано`;
  } else {
    text += `\n\n📭 Графік на завтра ще не опубліковано`;
  }

  await sendOrUpdate(chatId, editOf, text, liveViewKeyboard("next"));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    // Telegram's webhook calls carry the shared secret header; the mini app's
    // "prefs saved" confirmation authenticates via initData signature instead.
    // GET ?setup=true is allowed so the webhook can be (re)registered, but it
    // performs no user actions.
    const secretHeader = req.headers.get("x-telegram-bot-api-secret-token") ??
      req.headers.get("x-internal-secret");
    const webhookSecret = BOT_TOKEN.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48) || "bot-webhook";
    const isSetupGet = req.method === "GET" &&
      new URL(req.url).searchParams.get("setup") === "true";
    let body: unknown = null;
    if (secretHeader !== BOT_TOKEN && secretHeader !== webhookSecret && !isSetupGet) {
      body = await req.json().catch(() => null);
      const action = body && typeof body === "object" && "action" in body
        ? (body as { action?: unknown }).action
        : null;
      if (action !== "prefs_saved") {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else if (req.method === "POST") {
      body = await req.json().catch(() => null);
    }

    if (req.method === "GET") {
      const url = new URL(req.url);
      if (url.searchParams.get("setup") === "true") {
        const webhookUrl = `${url.origin.replace(/^http:/, "https:")}/functions/v1/telegram-bot`;
        // Telegram requires the secret token to be A-Z, a-z, 0-9, _ and - only.
        const webhookSecret = BOT_TOKEN.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48) || "bot-webhook";
        const wb = await tgCall("setWebhook", {
          url: webhookUrl,
          secret_token: webhookSecret,
        });
        const menu = await setChatMenuButton();
        return new Response(
          JSON.stringify({ webhook: wb, menu_button: menu }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ status: "ok", info: "Telegram bot webhook is running. GET ?setup=true to configure." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Read the body once above, then dispatch: Telegram webhook updates vs
    // mini-app confirmations arrive as POSTs to the same function.
    if (
      body && typeof body === "object" && "action" in body &&
      (body as { action?: unknown }).action === "prefs_saved"
    ) {
      return await handlePrefsSaved(body as MiniAppConfirm);
    }

    const update = body as TGUpdate;

    if (update.message?.text?.startsWith("/")) {
      const chatId = update.message.chat.id;
      const cmd = update.message.text.split("@")[0];
      if (cmd === "/start") await handleStart(update.message);
      else if (cmd === "/help") await handleHelp(chatId);
      else if (cmd === "/status" && update.message.from) await handleStatus(chatId, update.message.from.id);
      else if (cmd === "/next" && update.message.from) await handleNext(chatId, update.message.from.id);
      else if (cmd === "/settings" && update.message.from) await handleSettings(chatId, update.message.from.id);
      else {
        await sendMessage(chatId, `Не знаю таку команду 🤔 Спробуйте /help`, mainKeyboard);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message?.chat.id ?? 0;
      const messageId = cb.message?.message_id;
      const userId = cb.from.id;

      if (cb.data === "toggle_notify") {
        const pref = await getUserPref(userId);
        const newValue = !(pref?.notify_enabled ?? false);
        await updateNotifySettings(userId, { notify_enabled: newValue });
        await answerCallback(cb.id, newValue ? "🔔 Сповіщення увімкнені" : "🔕 Сповіщення вимкнені");
        if (messageId) await handleSettings(chatId, userId, messageId);
      } else if (cb.data === "notify:15" || cb.data === "notify:30" || cb.data === "notify:60") {
        const minutes = Number(cb.data.split(":")[1]);
        await updateNotifySettings(userId, { notify_minutes_before: minutes, notify_enabled: true });
        await answerCallback(cb.id, `⏰ Попереджатимемо за ${minutes} хв`);
        if (messageId) await handleSettings(chatId, userId, messageId);
      } else if (cb.data === "settings") {
        await answerCallback(cb.id);
        if (messageId) await handleSettings(chatId, userId, messageId);
        else await handleSettings(chatId, userId);
      } else if (cb.data === "back") {
        await answerCallback(cb.id);
        if (messageId) {
          await editMessage(chatId, messageId, `Головне меню ⚡️`, mainKeyboard);
        } else {
          await sendMessage(chatId, `Головне меню ⚡️`, mainKeyboard);
        }
      } else {
        await answerCallback(cb.id);
        // status/next/refresh all re-render the same message in place.
        if (cb.data === "status" || cb.data === "refresh:status") await handleStatus(chatId, userId, messageId);
        else if (cb.data === "next" || cb.data === "refresh:next") await handleNext(chatId, userId, messageId);
        else if (cb.data === "help") await handleHelp(chatId);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (update.message) {
      await sendMessage(
        update.message.chat.id,
        `Натисніть кнопку нижче, щоб відкрити графік відключень ⚡️`,
        mainKeyboard,
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Bot error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
