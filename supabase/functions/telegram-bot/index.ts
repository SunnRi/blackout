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

const MINI_APP_URL = Deno.env.get("MINI_APP_URL") ?? "https://bolt.new";

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

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

async function sendMessage(chatId: number, text: string, keyboard?: unknown) {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };
  if (keyboard) body.reply_markup = keyboard;
  const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return resp.json();
}

async function setChatMenuButton() {
  const resp = await fetch(`${TELEGRAM_API}/setChatMenuButton`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      menu_button: {
        type: "web_app",
        text: "Графік світла",
        web_app: { url: MINI_APP_URL },
      },
    }),
  });
  return resp.json();
}

const mainKeyboard = {
  inline_keyboard: [
    [
      {
        text: "Відкрити графік відключень",
        web_app: { url: MINI_APP_URL },
      },
    ],
    [
      { text: "Мій статус", callback_data: "status" },
      { text: "Допомога", callback_data: "help" },
    ],
  ],
};

async function handleStart(msg: TGMessage) {
  const chatId = msg.chat.id;
  const user = msg.from;
  const name = user?.first_name ?? "другу";

  await sendMessage(
    chatId,
    `Привіт, ${name}! ⚡️\n\n` +
      `Я бот для відстеження графіка відключень світла в Україні.\n\n` +
      `Оберіть свою область та групу у веб-додатку, і ви завжди знатимете, коли буде світло, а коли — ні.\n\n` +
      `Натисніть кнопку нижче, щоб відкрити графік:`,
    mainKeyboard,
  );
}

async function handleHelp(chatId: number) {
  await sendMessage(
    chatId,
    `<b>Як користуватися ботом</b>\n\n` +
      `1. Натисніть «Відкрити графік відключень» — відкриється веб-додаток\n` +
      `2. Оберіть свою область та групу відключень\n` +
      `3. Побачите актуальний статус: є світло чи ні\n` +
      `4. Графік на весь тиждень з підсвічуванням поточного часу\n\n` +
      `Команди:\n` +
      `/start — головне меню\n` +
      `/status — швидкий перегляд статусу\n` +
      `/help — ця довідка\n`,
    mainKeyboard,
  );
}

async function handleStatus(callback: TGCallbackQuery) {
  const chatId = callback.message?.chat.id;
  const tgUser = callback.from;
  if (!chatId) return;

  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("region_id, group_id")
    .eq("tg_user_id", tgUser.id)
    .maybeSingle();

  if (!prefs || !prefs.region_id || !prefs.group_id) {
    await sendMessage(
      chatId,
      `Ви ще не обрали область та групу. Натисніть кнопку нижче, щоб налаштувати:`,
      mainKeyboard,
    );
    return;
  }

  const { data: region } = await supabase
    .from("regions")
    .select("name")
    .eq("id", prefs.region_id)
    .maybeSingle();

  const { data: group } = await supabase
    .from("outage_groups")
    .select("label, group_number")
    .eq("id", prefs.group_id)
    .maybeSingle();

  const { data: liveStatus } = await supabase
    .from("live_outage_status")
    .select("status, message")
    .eq("region_id", prefs.region_id)
    .maybeSingle();

  const statusEmoji =
    liveStatus?.status === "red" ? "🔴" : liveStatus?.status === "yellow" ? "🟡" : "🟢";
  const statusText =
    liveStatus?.status === "red"
      ? "Відключення активні"
      : liveStatus?.status === "yellow"
        ? "Можливі відключення"
        : "Система в нормі";

  await sendMessage(
    chatId,
    `<b>Ваш статус</b>\n\n` +
      `📍 Область: ${region?.name ?? "—"}\n` +
      `🔢 Група: ${group?.label ?? "—"}\n\n` +
      `${statusEmoji} Стан енергосистеми: ${statusText}\n` +
      (liveStatus?.message ? `\n${liveStatus.message}\n` : "") +
      `\nВідкрийте веб-додаток для детального графіка:`,
    mainKeyboard,
  );
}

async function handleSavePreferences(chatId: number, tgUser: TGUser, data: string) {
  // data format: "save:region_id:group_id"
  const parts = data.split(":");
  if (parts.length !== 3) return;
  const [, regionId, groupId] = parts;

  await supabase
    .from("user_preferences")
    .upsert(
      {
        tg_user_id: tgUser.id,
        tg_username: tgUser.username ?? null,
        region_id: regionId,
        group_id: groupId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tg_user_id" },
    );

  await sendMessage(chatId, "✅ Налаштування збережено! Тепер ви можете швидко перевіряти статус через /status.", mainKeyboard);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    // GET endpoint to set the webhook + menu button
    if (req.method === "GET") {
      const url = new URL(req.url);
      if (url.searchParams.get("setup") === "true") {
        const webhookUrl = `${url.origin}/functions/v1/telegram-bot`;
        const wb = await fetch(`${TELEGRAM_API}/setWebhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: webhookUrl }),
        });
        const menu = await setChatMenuButton();
        const wbData = await wb.json();
        return new Response(
          JSON.stringify({ webhook: wbData, menu_button: menu }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ status: "ok", info: "Telegram bot webhook is running. GET ?setup=true to configure." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const update: TGUpdate = await req.json();

    // Handle /start command
    if (update.message?.text === "/start" || update.message?.text === "/help") {
      if (update.message.text === "/start") {
        await handleStart(update.message);
      } else {
        await handleHelp(update.message.chat.id);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle /status command
    if (update.message?.text === "/status") {
      const fakeCallback: TGCallbackQuery = {
        id: "0",
        from: update.message.from!,
        message: { chat: update.message.chat, message_id: update.message.message_id },
      };
      await handleStatus(fakeCallback);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle callback queries
    if (update.callback_query) {
      const cb = update.callback_query;
      // Answer the callback to remove loading state
      await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: cb.id }),
      });

      if (cb.data === "status") {
        await handleStatus(cb);
      } else if (cb.data === "help") {
        await handleHelp(cb.message?.chat.id ?? 0);
      } else if (cb.data?.startsWith("save:")) {
        await handleSavePreferences(cb.message?.chat.id ?? 0, cb.from, cb.data);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fallback for any other message
    if (update.message) {
      await sendMessage(
        update.message.chat.id,
        "Натисніть кнопку нижче, щоб відкрити графік відключень ⚡️",
        mainKeyboard,
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Bot error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
