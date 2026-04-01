export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const team = url.searchParams.get("team");
  const season = url.searchParams.get("season");

  if (!team || !season) {
    return json({ error: "Missing team or season" }, 400);
  }

  const [live, next, last] = await Promise.all([
    fetchFixtures({ env, team, season, live: "all" }),
    fetchFixtures({ env, team, season, next: "3" }),
    fetchFixtures({ env, team, season, last: "10" })
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