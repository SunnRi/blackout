/*
# Track Telegram bot messages for complete reset

1. New Tables
- `telegram_bot_messages` stores the Telegram chat ID and message ID for every
  message sent by the bot. This gives the reset flow a durable list of messages
  that Telegram allows the bot to delete.

2. Security
- Row level security is enabled.
- The table is internal and is not granted to anon or authenticated clients.
- Only the service role used by the Telegram edge function can read, insert, and
  delete tracking rows.

3. Important Notes
- Telegram Bot API does not provide a get-chat-history method. Messages sent
  before tracking was introduced cannot be discovered retroactively by the bot.
- Existing tracked messages and all future bot messages can be removed during
  a full reset.
*/

CREATE TABLE IF NOT EXISTS public.telegram_bot_messages (
  tg_user_id bigint NOT NULL,
  message_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tg_user_id, message_id)
);

ALTER TABLE public.telegram_bot_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.telegram_bot_messages FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.telegram_bot_messages TO service_role;

CREATE INDEX IF NOT EXISTS telegram_bot_messages_user_idx
  ON public.telegram_bot_messages (tg_user_id, created_at);
