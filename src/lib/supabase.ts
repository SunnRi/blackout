import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type UserPreferences = {
  id: string;
  tg_user_id: number;
  tg_username: string | null;
  region_id: string | null;
  group_id: string | null;
  notify_enabled: boolean;
  yasno_region_id: number | null;
  yasno_dso_id: number | null;
  yasno_group: string | null;
  notify_minutes_before: number;
  street_name: string | null;
  house_name: string | null;
};
