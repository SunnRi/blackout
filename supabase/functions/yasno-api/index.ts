const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const YASNO_BASE = "https://app.yasno.ua/api/blackout-service/public/shutdowns";
const BEZSVITLA_BASE = "https://bezsvitla.com.ua";

// ── Kyiv city via Yasno API (region 25, dso 902) ──────────────
const YASNO_REGION_ID = 25;
const YASNO_DSO_ID = 902;

// All oblasts of Ukraine with their bezsvitla slugs.
// `available: false` = no schedules published on bezsvitla yet.
const OBLASTS: { slug: string; name: string; available: boolean }[] = [
  { slug: "vinnytska-oblast", name: "Вінницька область", available: true },
  { slug: "volynska-oblast", name: "Волинська область", available: true },
  { slug: "dnipropetrovska-oblast", name: "Дніпропетровська область", available: true },
  { slug: "donetska-oblast", name: "Донецька область", available: false },
  { slug: "zhytomyrska-oblast", name: "Житомирська область", available: true },
  { slug: "zakarpatska-oblast", name: "Закарпатська область", available: true },
  { slug: "zaporizka-oblast", name: "Запорізька область", available: true },
  { slug: "ivano-frankivska-oblast", name: "Івано-Франківська область", available: true },
  { slug: "kyivska-oblast", name: "Київська область", available: true },
  { slug: "kirovohradska-oblast", name: "Кіровоградська область", available: true },
  { slug: "luhanska-oblast", name: "Луганська область", available: false },
  { slug: "lvivska-oblast", name: "Львівська область", available: true },
  { slug: "mykolaivska-oblast", name: "Миколаївська область", available: true },
  { slug: "odeska-oblast", name: "Одеська область", available: true },
  { slug: "poltavska-oblast", name: "Полтавська область", available: true },
  { slug: "rivnenska-oblast", name: "Рівненська область", available: true },
  { slug: "sumska-oblast", name: "Сумська область", available: true },
  { slug: "ternopilska-oblast", name: "Тернопільська область", available: true },
  { slug: "kharkivska-oblast", name: "Харківська область", available: true },
  { slug: "khersonska-oblast", name: "Херсонська область", available: true },
  { slug: "khmelnytska-oblast", name: "Хмельницька область", available: true },
  { slug: "cherkaska-oblast", name: "Черкаська область", available: true },
  { slug: "chernivetska-oblast", name: "Чернівецька область", available: true },
  { slug: "chernihivska-oblast", name: "Чернігівська область", available: true },
];

type Slot = {
  start: number; // minutes from midnight
  end: number;
  type: string; // "Definite" | "NotPlanned" | "on" | "off"
};

type QueueSchedule = {
  queue: string;
  slots: Slot[];
};

type CitySchedule = {
  city: string;
  source: string;
  updated: string | null;
  schedules: QueueSchedule[];
};

// ── Parse bezsvitla HTML to extract schedule data ─────────────
function parseBezsvitla(html: string): QueueSchedule[] {
  const results: QueueSchedule[] = [];
  const queueMatches = [...html.matchAll(/Черга\s+(\d\.\d)/g)];

  for (let i = 0; i < queueMatches.length; i++) {
    const queueName = queueMatches[i][1];
    const sectionStart = queueMatches[i].index! + queueMatches[i][0].length;
    const sectionEnd = i + 1 < queueMatches.length
      ? queueMatches[i + 1].index!
      : sectionStart + 5000;
    const section = html.slice(sectionStart, sectionEnd);

    const slots: Slot[] = [];
    const slotMatches = [...section.matchAll(
      /bz-schedule-slot--(on|off)[^>]*>.*?(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})/gs,
    )];

    for (const m of slotMatches) {
      const status = m[1]; // "on" or "off"
      const startStr = m[2];
      const endStr = m[3];
      const startMin = timeToMinutes(startStr);
      let endMin = timeToMinutes(endStr);
      if (endStr === "24:00") endMin = 1440;

      slots.push({
        start: startMin,
        end: endMin,
        type: status === "off" ? "Definite" : "NotPlanned",
      });
    }

    if (slots.length > 0) {
      results.push({ queue: queueName, slots });
    }
  }

  return results;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// ── Fetch with timeout ────────────────────────────────────────
async function fetchWithTimeout(url: string, opts: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      ...opts,
      signal: controller.signal,
    });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

// ── bezsvitla helpers ─────────────────────────────────────────
async function fetchBezsvitlaCities(oblastSlug: string): Promise<{ slug: string; name: string }[]> {
  const resp = await fetchWithTimeout(`${BEZSVITLA_BASE}/${oblastSlug}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PowerBot/1.0)" },
  });
  if (!resp.ok) return [];

  const html = await resp.text();
  const cities: { slug: string; name: string }[] = [];
  const seen = new Set<string>();

  // City cards link to /<oblast>/<city>
  const cardPattern = new RegExp(
    `<a[^>]*href="/${oblastSlug}/([a-z0-9-]+)"[^>]*>(.*?)</a>`,
    "gs",
  );
  for (const m of html.matchAll(cardPattern)) {
    const slug = m[1];
    if (slug === "grafik-na-zavtra" || seen.has(slug)) continue;
    seen.add(slug);
    const name = m[2].replace(/<[^>]+>/g, "").trim();
    if (name && name.length > 1) cities.push({ slug, name });
  }
  return cities;
}

async function fetchBezsvitlaSchedule(
  oblastSlug: string,
  citySlug: string,
  tomorrow: boolean,
): Promise<CitySchedule> {
  const path = tomorrow
    ? `${BEZSVITLA_BASE}/${oblastSlug}/${citySlug}/grafik-na-zavtra`
    : `${BEZSVITLA_BASE}/${oblastSlug}/${citySlug}`;

  const resp = await fetchWithTimeout(path, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PowerBot/1.0)" },
  });
  if (!resp.ok) {
    if (tomorrow) {
      return { city: citySlug, source: "bezsvitla", updated: null, schedules: [] };
    }
    throw new Error(`Failed to fetch city page: ${resp.status}`);
  }
  const html = await resp.text();
  const schedules = parseBezsvitla(html);
  const updatedMatch = html.match(/Оновлено\s+([\d.]+\s+[\d:]+)/);
  const updated = updatedMatch ? updatedMatch[1] : null;
  return { city: citySlug, source: "bezsvitla", updated, schedules };
}

// ── Yasno helpers (Kyiv city) ─────────────────────────────────
async function fetchYasnoSchedule(tomorrow: boolean): Promise<CitySchedule> {
  const plannedResp = await fetchWithTimeout(
    `${YASNO_BASE}/regions/${YASNO_REGION_ID}/dsos/${YASNO_DSO_ID}/planned-outages`,
    { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } },
  );
  if (!plannedResp.ok) {
    throw new Error(`Yasno API returned ${plannedResp.status}`);
  }
  const planned = await plannedResp.json();
  const schedules: QueueSchedule[] = [];
  for (const [group, data] of Object.entries(planned)) {
    const day = tomorrow
      ? (data as Record<string, unknown>)?.tomorrow as { slots: Slot[] } | undefined
      : (data as Record<string, unknown>)?.today as { slots: Slot[] } | undefined;
    const slots = day?.slots ?? [];
    if (tomorrow && slots.length === 0) continue;
    schedules.push({ queue: group, slots });
  }
  return {
    city: "kyiv",
    source: "yasno",
    updated: ((planned["1.1"] as Record<string, unknown>)?.updatedOn as string) ?? null,
    schedules,
  };
}

// ── Main handler ──────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const params = url.searchParams;
    const endpoint = params.get("endpoint") || "oblasts";

    switch (endpoint) {
      // ── All oblasts of Ukraine ─────────────────────────────
      case "oblasts": {
        return jsonResponse(OBLASTS);
      }

      // ── Cities for an oblast (bezsvitla) ───────────────────
      case "cities": {
        const oblast = params.get("oblast");
        if (!oblast) return jsonError("oblast is required", 400);

        if (oblast === "kyiv-city") {
          return jsonResponse([{ slug: "kyiv", name: "Київ" }]);
        }

        const cities = await fetchBezsvitlaCities(oblast);
        if (cities.length === 0) {
          return jsonError("No cities found for this oblast", 404);
        }
        return jsonResponse(cities);
      }

      // ── Schedule for a specific city ───────────────────────
      case "schedule": {
        const citySlug = params.get("city");
        const oblast = params.get("oblast");
        if (!citySlug) return jsonError("city is required", 400);

        if (oblast === "kyiv-city" || citySlug === "kyiv") {
          return jsonResponse(await fetchYasnoSchedule(false));
        }
        if (!oblast) return jsonError("oblast is required", 400);
        return jsonResponse(await fetchBezsvitlaSchedule(oblast, citySlug, false));
      }

      // ── Tomorrow schedule for a city ───────────────────────
      case "tomorrow": {
        const citySlug = params.get("city");
        const oblast = params.get("oblast");
        if (!citySlug) return jsonError("city is required", 400);

        if (oblast === "kyiv-city" || citySlug === "kyiv") {
          return jsonResponse(await fetchYasnoSchedule(true));
        }
        if (!oblast) return jsonError("oblast is required", 400);
        return jsonResponse(await fetchBezsvitlaSchedule(oblast, citySlug, true));
      }

      default:
        return jsonError(`Unknown endpoint: ${endpoint}`, 404);
    }
  } catch (err) {
    console.error("yasno-api error:", err);
    return jsonError(err instanceof Error ? err.message : "Internal error", 500);
  }
});

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status: number) {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
