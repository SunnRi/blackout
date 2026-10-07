const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/yasno-api`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export type Oblast = {
  slug: string;
  name: string;
  available: boolean;
};

export type City = {
  slug: string;
  name: string;
};

export type Slot = {
  start: number; // minutes from midnight
  end: number;
  type: string; // "Definite" (off) | "NotPlanned" (on)
};

export type QueueSchedule = {
  queue: string;
  slots: Slot[];
};

export type CitySchedule = {
  city: string;
  source: string;
  updated: string | null;
  schedules: QueueSchedule[];
};

async function apiFetch(endpoint: string, params?: Record<string, string>): Promise<unknown> {
  const u = new URL(API_URL);
  u.searchParams.set('endpoint', endpoint);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      u.searchParams.set(k, v);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const resp = await fetch(u.toString(), {
      headers: {
        Authorization: `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`API error ${resp.status}: ${text}`);
    }
    return resp.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

export async function fetchOblasts(): Promise<Oblast[]> {
  try {
    const data = await apiFetch('oblasts');
    return Array.isArray(data) ? (data as Oblast[]) : [];
  } catch {
    return [];
  }
}

export async function fetchCities(oblastSlug: string): Promise<City[]> {
  try {
    const data = await apiFetch('cities', { oblast: oblastSlug });
    if (!Array.isArray(data)) return [];
    return (data as City[]).filter((c) => c.name && !/(графік|черга|район)/i.test(c.name));
  } catch {
    return [];
  }
}

export async function fetchTodaySchedule(oblastSlug: string, citySlug: string): Promise<CitySchedule> {
  return apiFetch('schedule', { oblast: oblastSlug, city: citySlug }) as Promise<CitySchedule>;
}

export async function fetchTomorrowSchedule(oblastSlug: string, citySlug: string): Promise<CitySchedule> {
  return apiFetch('tomorrow', { oblast: oblastSlug, city: citySlug }) as Promise<CitySchedule>;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
