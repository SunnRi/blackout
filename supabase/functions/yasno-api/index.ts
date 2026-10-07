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
  const queuePattern = /Черга\s+(\d\.\d)/g;
  const slotPattern =
    /bz-schedule-slot--(on|off)[^>]*>.*?(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})/gs;

  // Split by "Черга X.X" to isolate each queue section
  const sections = html.split(/Черга\s+\d\.\d/);
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

// ── Main handler ──────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const params = url.searchParams;
    const endpoint = params.get("endpoint") || "cities";

    switch (endpoint) {
      // ── Kyiv oblast cities from bezsvitla ──────────────────
      case "cities": {
        const resp = await fetchWithTimeout(`${BEZSVITLA_BASE}/kyivska-oblast`, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; PowerBot/1.0)" },
        });
        const html = await resp.text();
        // Extract city links
        const cityPattern = /href="\/kyivska-oblast\/([a-z-]+)"/g;
        const cities: { slug: string; name: string }[] = [];
        const seen = new Set<string>();
        const matches = [...html.matchAll(cityPattern)];
        for (const m of matches) {
          const slug = m[1];
          if (slug === "grafik-na-zavtra") continue;
          if (seen.has(slug)) continue;
          seen.add(slug);
          // Convert slug to readable name
          const name = slug
            .split("-")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");
          cities.push({ slug, name });
        }
        // Add Kyiv city as a special entry
        cities.unshift({ slug: "kyiv", name: "Київ (місто)" });
        return jsonResponse(cities);
      }

      // ── Schedule for a specific city ───────────────────────
      case "schedule": {
        const citySlug = params.get("city");
        if (!citySlug) return jsonError("city is required", 400);

        if (citySlug === "kyiv") {
          // Use Yasno API for Kyiv city
          const plannedResp = await fetchWithTimeout(
            `${YASNO_BASE}/regions/${YASNO_REGION_ID}/dsos/${YASNO_DSO_ID}/planned-outages`,
            { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } },
          );
          if (!plannedResp.ok) {
            return jsonError(`Yasno API returned ${plannedResp.status}`, plannedResp.status);
          }
          const planned = await plannedResp.json();
          // Transform to unified format
          const schedules: QueueSchedule[] = [];
          for (const [group, data] of Object.entries(planned)) {
            const todaySlots = (data as any)?.today?.slots || [];
            schedules.push({ queue: group, slots: todaySlots });
          }
          const result: CitySchedule = {
            city: "kyiv",
            source: "yasno",
            updated: (planned["1.1"] as any)?.updatedOn || null,
            schedules,
          };
          return jsonResponse(result);
        }

        // Use bezsvitla for oblast cities
        const resp = await fetchWithTimeout(
          `${BEZSVITLA_BASE}/kyivska-oblast/${citySlug}`,
          { headers: { "User-Agent": "Mozilla/5.0 (compatible; PowerBot/1.0)" } },
        );
        if (!resp.ok) {
          return jsonError(`Failed to fetch city page: ${resp.status}`, resp.status);
        }
        const html = await resp.text();
        const schedules = parseBezsvitla(html);

        // Extract updated time
        const updatedMatch = html.match(/Оновлено\s+([\d.]+\s+[\d:]+)/);
        const updated = updatedMatch ? updatedMatch[1] : null;

        const result: CitySchedule = {
          city: citySlug,
          source: "bezsvitla",
          updated,
          schedules,
        };
        return jsonResponse(result);
      }

      // ── Tomorrow schedule for a city ───────────────────────
      case "tomorrow": {
        const citySlug = params.get("city");
        if (!citySlug) return jsonError("city is required", 400);

        if (citySlug === "kyiv") {
          const plannedResp = await fetchWithTimeout(
            `${YASNO_BASE}/regions/${YASNO_REGION_ID}/dsos/${YASNO_DSO_ID}/planned-outages`,
            { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } },
          );
          const planned = await plannedResp.json();
          const schedules: QueueSchedule[] = [];
          for (const [group, data] of Object.entries(planned)) {
            const tomorrowSlots = (data as any)?.tomorrow?.slots || [];
            if (tomorrowSlots.length > 0) {
              schedules.push({ queue: group, slots: tomorrowSlots });
            }
          }
          const result: CitySchedule = {
            city: "kyiv",
            source: "yasno",
            updated: (planned["1.1"] as any)?.updatedOn || null,
            schedules,
          };
          return jsonResponse(result);
        }

        // bezsvitla tomorrow
        const resp = await fetchWithTimeout(
          `${BEZSVITLA_BASE}/kyivska-oblast/${citySlug}/grafik-na-zavtra`,
          { headers: { "User-Agent": "Mozilla/5.0 (compatible; PowerBot/1.0)" } },
        );
        if (!resp.ok) {
          // No tomorrow schedule available
          return jsonResponse({
            city: citySlug,
            source: "bezsvitla",
            updated: null,
            schedules: [],
          });
        }
        const html = await resp.text();
        const schedules = parseBezsvitla(html);
        const updatedMatch = html.match(/Оновлено\s+([\d.]+\s+[\d:]+)/);
        const updated = updatedMatch ? updatedMatch[1] : null;
        const result: CitySchedule = {
          city: citySlug,
          source: "bezsvitla",
          updated,
          schedules,
        };
        return jsonResponse(result);
      }

      default:
        return jsonError(`Unknown endpoint: ${endpoint}`, 404);
    }
  } catch (err) {
    console.error("yasno-api error:", err);
    return jsonError(err.message, 500);
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
