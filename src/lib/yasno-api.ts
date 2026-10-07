const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/yasno-api`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function apiFetch(endpoint: string, params?: Record<string, string>): Promise<unknown> {
  const u = new URL(API_URL);
  u.searchParams.set('endpoint', endpoint);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      u.searchParams.set(k, v);
    }
  }

  const resp = await fetch(u.toString(), {
    headers: {
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error ${resp.status}: ${text}`);
  }
  return resp.json();
}

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

export async function fetchCities(): Promise<City[]> {
  return apiFetch('cities') as Promise<City[]>;
}

export async function fetchTodaySchedule(citySlug: string): Promise<CitySchedule> {
  return apiFetch('schedule', { city: citySlug }) as Promise<CitySchedule>;
}

export async function fetchTomorrowSchedule(citySlug: string): Promise<CitySchedule> {
  return apiFetch('tomorrow', { city: citySlug }) as Promise<CitySchedule>;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
