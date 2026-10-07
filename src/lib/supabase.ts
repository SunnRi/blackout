import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type UserPreferences = {
  id: string;
  tg_user_id: number;
  tg_username: string | null;
  notify_enabled: boolean;
  notify_minutes_before: number;
  oblast_slug: string | null;
  city_slug: string | null;
  queue_group: string | null;
};

export type ScheduleChange = {
  id: string;
  queue: string;
  day: string;
  change_type: string;
  summary: string;
  detected_at: string;
};
