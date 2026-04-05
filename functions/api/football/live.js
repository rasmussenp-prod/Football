export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const team = url.searchParams.get("team");
  const season = url.searchParams.get("season");

  if (!team || !season) {
    return json({ error: "Missing team or season" }, 400, 0);
  }

  try {
    const liveFixturesData = await fetchApiSports(env, "/fixtures", {
      team,
      season,
      live: "all"
    });

    const liveFixtures = Array.isArray(liveFixturesData?.response)
      ? liveFixturesData.response
      : [];

    const teamLiveFixture =
      liveFixtures.find((fixture) => {
        const homeId = fixture?.teams?.home?.id;
        const awayId = fixture?.teams?.away?.id;
        return String(homeId) === String(team) || String(awayId) === String(team);
      }) || null;

    if (!teamLiveFixture) {
      return json(
        {
          live: false,
          teamId: Number(team),
          fixture: null,
          events: []
        },
        200,
        15
      );
    }

    const fixtureId = teamLiveFixture?.fixture?.id;

    const eventsData = await fetchApiSports(env, "/fixtures/events", {
      fixture: fixtureId
    });

    const events = Array.isArray(eventsData?.response) ? eventsData.response : [];

    return json(
      {
        live: true,
        teamId: Number(team),
        fixture: teamLiveFixture,
        events: normaliseEvents(events)
      },
      200,
      15
    );
  } catch (error) {
    return json(
      {
        error: "Could not load live match data",
        detail: String(error)
      },
      500,
      5
    );
  }
}

async function fetchApiSports(env, path, params = {}) {
  const upstream = new URL(`https://v3.football.api-sports.io${path}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      upstream.searchParams.set(key, String(value));
    }
  });

  const res = await fetch(upstream.toString(), {
    method: "GET",
    headers: {
      "x-apisports-key": env.API_FOOTBALL_KEY
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API-Sports ${path} failed: ${res.status} ${text}`);
  }

  return res.json();
}

function normaliseEvents(events) {
  return events
    .map((event) => ({
      time: event?.time?.elapsed ?? null,
      extra: event?.time?.extra ?? null,
      team: event?.team?.name ?? "",
      teamId: event?.team?.id ?? null,
      player: event?.player?.name ?? "",
      assist: event?.assist?.name ?? "",
      type: event?.type ?? "",
      detail: event?.detail ?? "",
      comments: event?.comments ?? ""
    }))
    .sort((a, b) => {
      const aTime = Number(a.time ?? 0);
      const bTime = Number(b.time ?? 0);
      return bTime - aTime;
    });
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