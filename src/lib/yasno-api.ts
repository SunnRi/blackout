const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/yasno-api`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Fallback city list used when the Edge Function is unreachable
const FALLBACK_CITIES = [
  { slug: 'kyiv', name: 'Київ (місто)' },
  { slug: 'bila-tserkva', name: 'Біла Церква' },
  { slug: 'boryspil', name: 'Бориспіль' },
  { slug: 'brovary', name: 'Бровари' },
  { slug: 'bucha', name: 'Буча' },
  { slug: 'boyarka', name: 'Боярка' },
  { slug: 'vasylkiv', name: 'Васильків' },
  { slug: 'vyshhorod', name: 'Вишгород' },
  { slug: 'vyshneve', name: 'Вишневе' },
  { slug: 'irpin', name: 'Ірпінь' },
  { slug: 'obukhiv', name: 'Обухів' },
  { slug: 'fastiv', name: 'Фастів' },
  { slug: 'yahotyn', name: 'Яготин' },
  { slug: 'pereiaslav', name: 'Переяслав' },
  { slug: 'slavutych', name: 'Славутич' },
  { slug: 'kaharlyk', name: 'Кагарлик' },
  { slug: 'myronivka', name: 'Миронівка' },
  { slug: 'tetiiv', name: 'Тетіїв' },
  { slug: 'uzyn', name: 'Узин' },
  { slug: 'berezan', name: 'Березань' },
  { slug: 'bohuslav', name: 'Богуслав' },
  { slug: 'ruzhyn', name: 'Ружин' },
];

async function apiFetch(endpoint: string, params?: Record<string, string>): Promise<unknown> {
  const u = new URL(API_URL);
  u.searchParams.set('endpoint', endpoint);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      u.searchParams.set(k, v);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

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
  try {
    return await apiFetch('cities') as City[];
  } catch {
    return FALLBACK_CITIES;
  }
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
