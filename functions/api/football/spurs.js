export async function onRequestGet(context) {
  const { env } = context;

  if (!env.FOOTBALL_DATA_KEY) {
    return json({ error: "Missing FOOTBALL_DATA_KEY secret" }, 500, 0);
  }

  const TEAM_ID = 73;
  const TEAM = {
    id: 73,
    name: "Tottenham Hotspur",
    shortName: "Spurs",
    tla: "TOT",
    crest: "https://crests.football-data.org/73.svg"
  };

  try {
    const today = new Date();
    const dateFrom = addDays(today, -120);
    const dateTo = addDays(today, 180);

    // Single upstream call only, to avoid the flaky /teams/73 and /standings endpoints
    const matchesData = await fdFetch(
      env,
      `/competitions/PL/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`
    );

    const allMatches = (Array.isArray(matchesData?.matches) ? matchesData.matches : [])
      .filter((match) =>
        String(match?.homeTeam?.id) === String(TEAM_ID) ||
        String(match?.awayTeam?.id) === String(TEAM_ID)
      )
      .filter((match, index, arr) => {
        const id = String(match?.id || "");
        return id ? arr.findIndex((m) => String(m?.id || "") === id) === index : true;
      });

    const now = new Date();

    const live = allMatches
      .filter((match) => isLiveStatus(match?.status))
      .sort(sortByUtcAsc);

    const next = allMatches
      .filter((match) => {
        if (!match?.utcDate) return false;
        return new Date(match.utcDate) >= now && !isLiveStatus(match?.status);
      })
      .sort(sortByUtcAsc)
      .slice(0, 8);

    const last = allMatches
      .filter((match) => String(match?.status || "").toUpperCase() === "FINISHED")
      .sort(sortByUtcDesc)
      .slice(0, 8);

    return json(
      {
        source: "football-data.org",
        team: TEAM,
        live: live.map(normaliseMatch),
        next: next.map(normaliseMatch),
        last: last.map(normaliseMatch),
        standings: [],
        standing: null
      },
      200,
      300
    );
  } catch (error) {
    return json(
      {
        error: "Could not load Spurs data from football-data.org",
        detail: error?.message || String(error)
      },
      500,
      10
    );
  }
}

async function fdFetch(env, path) {
  const url = `https://api.football-data.org/v4${path}`;

  const res = await fetch(url, {
    headers: {
      "X-Auth-Token": env.FOOTBALL_DATA_KEY
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} failed: ${res.status} ${text}`);
  }

  return res.json();
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function normaliseMatch(match) {
  return {
    id: match?.id ?? null,
    utcDate: match?.utcDate ?? null,
    status: match?.status ?? "",
    competition: {
      code: match?.competition?.code ?? "",
      name: match?.competition?.name ?? ""
    },
    stage: match?.stage ?? "",
    matchday: match?.matchday ?? null,
    venue: match?.venue ?? "",
    homeTeam: {
      id: match?.homeTeam?.id ?? null,
      name: match?.homeTeam?.name ?? "",
      shortName: match?.homeTeam?.shortName ?? "",
      tla: match?.homeTeam?.tla ?? "",
      crest: match?.homeTeam?.crest ?? ""
    },
    awayTeam: {
      id: match?.awayTeam?.id ?? null,
      name: match?.awayTeam?.name ?? "",
      shortName: match?.awayTeam?.shortName ?? "",
      tla: match?.awayTeam?.tla ?? "",
      crest: match?.awayTeam?.crest ?? ""
    },
    score: {
      winner: match?.score?.winner ?? null,
      fullTime: {
        home: match?.score?.fullTime?.home ?? null,
        away: match?.score?.fullTime?.away ?? null
      },
      halfTime: {
        home: match?.score?.halfTime?.home ?? null,
        away: match?.score?.halfTime?.away ?? null
      }
    }
  };
}

function isLiveStatus(status) {
  return ["IN_PLAY", "PAUSED", "LIVE"].includes(String(status || "").toUpperCase());
}

function sortByUtcAsc(a, b) {
  return new Date(a?.utcDate || 0) - new Date(b?.utcDate || 0);
}

function sortByUtcDesc(a, b) {
  return new Date(b?.utcDate || 0) - new Date(a?.utcDate || 0);
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