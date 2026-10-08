/*
# Fix: change notifications never queued

The schedule-change-checker upserts into notification_outbox with
onConflict: "tg_user_id,change_id", but the table only had a non-unique
index on that pair. PostgREST requires a UNIQUE constraint for
ON CONFLICT, so every outbox insert failed and users never received
"график обновился" messages. Replace the plain index with a unique one.
*/

DROP INDEX IF EXISTS public.idx_outbox_user_change;

ALTER TABLE public.notification_outbox
  ADD CONSTRAINT notification_outbox_user_change_uniq UNIQUE (tg_user_id, change_id);
