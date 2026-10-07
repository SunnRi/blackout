const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const YASNO_BASE = "https://app.yasno.ua/api/blackout-service/public/shutdowns";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const params = url.searchParams;

    const endpoint = params.get("endpoint") || "regions";
    const regionId = params.get("regionId");
    const dsoId = params.get("dsoId");

    let yasnoUrl: string;

    switch (endpoint) {
      case "regions": {
        yasnoUrl = `${YASNO_BASE}/addresses/v2/regions`;
        break;
      }
      case "planned-outages": {
        if (!regionId || !dsoId) {
          return jsonError("regionId and dsoId are required", 400);
        }
        yasnoUrl = `${YASNO_BASE}/regions/${regionId}/dsos/${dsoId}/planned-outages`;
        break;
      }
      case "probable-outages": {
        if (!regionId || !dsoId) {
          return jsonError("regionId and dsoId are required", 400);
        }
        yasnoUrl = `${YASNO_BASE}/probable-outages?regionId=${encodeURIComponent(regionId)}&dsoId=${encodeURIComponent(dsoId)}`;
        break;
      }
      case "streets": {
        const query = params.get("query");
        if (!regionId || !dsoId || !query) {
          return jsonError("regionId, dsoId, and query are required", 400);
        }
        yasnoUrl = `${YASNO_BASE}/addresses/v2/streets?regionId=${encodeURIComponent(regionId)}&dsoId=${encodeURIComponent(dsoId)}&query=${encodeURIComponent(query)}`;
        break;
      }
      case "houses": {
        const streetId = params.get("streetId");
        const query = params.get("query");
        if (!regionId || !dsoId || !streetId || !query) {
          return jsonError("regionId, dsoId, streetId, and query are required", 400);
        }
        yasnoUrl = `${YASNO_BASE}/addresses/v2/houses?regionId=${encodeURIComponent(regionId)}&dsoId=${encodeURIComponent(dsoId)}&streetId=${encodeURIComponent(streetId)}&query=${encodeURIComponent(query)}`;
        break;
      }
      case "group": {
        const streetId = params.get("streetId");
        const houseId = params.get("houseId");
        if (!regionId || !dsoId || !streetId || !houseId) {
          return jsonError("regionId, dsoId, streetId, and houseId are required", 400);
        }
        yasnoUrl = `${YASNO_BASE}/addresses/v2/group?regionId=${encodeURIComponent(regionId)}&dsoId=${encodeURIComponent(dsoId)}&streetId=${encodeURIComponent(streetId)}&houseId=${encodeURIComponent(houseId)}`;
        break;
      }
      default:
        return jsonError(`Unknown endpoint: ${endpoint}`, 404);
    }

    const resp = await fetch(yasnoUrl, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; PowerOutageBot/1.0)",
      },
    });

    if (!resp.ok) {
      const body = await resp.text();
      return new Response(
        JSON.stringify({ error: `Yasno API returned ${resp.status}`, detail: body }),
        { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await resp.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("yasno-api error:", err);
    return jsonError(err.message, 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
