export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const league = url.searchParams.get("league");
  const season = url.searchParams.get("season");

  if (!league || !season) {
    return json({ error: "Missing league or season" }, 400);
  }

  try {
    const upstream = new URL("https://v3.football.api-sports.io/standings");
    upstream.searchParams.set("league", league);
    upstream.searchParams.set("season", season);

    const res = await fetch(upstream.toString(), {
      method: "GET",
      headers: {
        "x-apisports-key": env.API_FOOTBALL_KEY
      }
    });

    const data = await res.json();
    return json(data, res.status, 300);
  } catch (error) {
    return json(
      {
        error: "Could not load standings",
        detail: String(error)
      },
      500,
      60
    );
  }
}

function json(data, status = 200, cacheSeconds = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${cacheSeconds}`
    }
  });
}