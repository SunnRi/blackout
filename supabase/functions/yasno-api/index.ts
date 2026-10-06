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
    const path = url.pathname.replace("/functions/v1/yasno-api", "");
    const params = url.searchParams;

    let yasnoUrl: string;
    const regionId = params.get("regionId");
    const dsoId = params.get("dsoId");

    if (path === "/regions" || path === "" || path === "/") {
      yasnoUrl = `${YASNO_BASE}/addresses/v2/regions`;
    } else if (path === "/planned-outages") {
      if (!regionId || !dsoId) {
        return new Response(
          JSON.stringify({ error: "regionId and dsoId are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      yasnoUrl = `${YASNO_BASE}/regions/${regionId}/dsos/${dsoId}/planned-outages`;
    } else if (path === "/probable-outages") {
      if (!regionId || !dsoId) {
        return new Response(
          JSON.stringify({ error: "regionId and dsoId are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      yasnoUrl = `${YASNO_BASE}/probable-outages?regionId=${encodeURIComponent(regionId)}&dsoId=${encodeURIComponent(dsoId)}`;
    } else if (path === "/streets") {
      const query = params.get("query");
      if (!regionId || !dsoId || !query) {
        return new Response(
          JSON.stringify({ error: "regionId, dsoId, and query are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      yasnoUrl = `${YASNO_BASE}/addresses/v2/streets?regionId=${encodeURIComponent(regionId)}&dsoId=${encodeURIComponent(dsoId)}&query=${encodeURIComponent(query)}`;
    } else if (path === "/houses") {
      const streetId = params.get("streetId");
      const query = params.get("query");
      if (!regionId || !dsoId || !streetId || !query) {
        return new Response(
          JSON.stringify({ error: "regionId, dsoId, streetId, and query are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      yasnoUrl = `${YASNO_BASE}/addresses/v2/houses?regionId=${encodeURIComponent(regionId)}&dsoId=${encodeURIComponent(dsoId)}&streetId=${encodeURIComponent(streetId)}&query=${encodeURIComponent(query)}`;
    } else if (path === "/group") {
      const streetId = params.get("streetId");
      const houseId = params.get("houseId");
      if (!regionId || !dsoId || !streetId || !houseId) {
        return new Response(
          JSON.stringify({ error: "regionId, dsoId, streetId, and houseId are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      yasnoUrl = `${YASNO_BASE}/addresses/v2/group?regionId=${encodeURIComponent(regionId)}&dsoId=${encodeURIComponent(dsoId)}&streetId=${encodeURIComponent(streetId)}&houseId=${encodeURIComponent(houseId)}`;
    } else {
      return new Response(
        JSON.stringify({ error: `Unknown path: ${path}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
