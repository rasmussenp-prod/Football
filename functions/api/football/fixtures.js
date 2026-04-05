export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const team = url.searchParams.get("team");
  const season = url.searchParams.get("season");

  if (!team || !season) {
    return json({ error: "Missing team or season" }, 400);
  }

  try {
    const [live, next, last] = await Promise.all([
      fetchFixtures({ env, team, season, live: "all" }),
      fetchFixtures({ env, team, season, next: "4" }),
      fetchFixtures({ env, team, season, last: "6" })
    ]);

    return json(
      {
        live: live?.response || [],
        next: next?.response || [],
        last: last?.response || []
      },
      200,
      60
    );
  } catch (error) {
    return json(
      {
        error: "Could not load fixtures",
        detail: String(error)
      },
      500,
      30
    );
  }
}

async function fetchFixtures({ env, team, season, live, next, last }) {
  const upstream = new URL("https://v3.football.api-sports.io/fixtures");
  upstream.searchParams.set("team", team);
  upstream.searchParams.set("season", season);

  if (live) upstream.searchParams.set("live", live);
  if (next) upstream.searchParams.set("next", next);
  if (last) upstream.searchParams.set("last", last);

  const res = await fetch(upstream.toString(), {
    method: "GET",
    headers: {
      "x-apisports-key": env.API_FOOTBALL_KEY
    }
  });

  if (!res.ok) {
    throw new Error(`API-Football fixtures failed with status ${res.status}`);
  }

  return res.json();
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