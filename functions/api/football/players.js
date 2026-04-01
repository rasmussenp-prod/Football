export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const team = url.searchParams.get("team");
  const season = url.searchParams.get("season");

  if (!team || !season) {
    return json({ error: "Missing team or season" }, 400);
  }

  const firstPage = await fetchPlayersPage(env, team, season, 1);
  const totalPages = firstPage?.paging?.total || 1;

  let combined = [...(firstPage?.response || [])];

  if (totalPages > 1) {
    const remainingPages = [];
    for (let page = 2; page <= Math.min(totalPages, 4); page++) {
      remainingPages.push(fetchPlayersPage(env, team, season, page));
    }

    const rest = await Promise.all(remainingPages);
    for (const result of rest) {
      combined.push(...(result?.response || []));
    }
  }

  return json({ response: combined }, 200, 1800);
}

async function fetchPlayersPage(env, team, season, page) {
  const upstream = new URL("https://v3.football.api-sports.io/players");
  upstream.searchParams.set("team", team);
  upstream.searchParams.set("season", season);
  upstream.searchParams.set("page", String(page));

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