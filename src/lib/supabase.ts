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
  city_slug: string | null;
  queue_group: string | null;
};
