export async function onRequestGet(context) {
  const { env } = context;

  if (!env.FOOTBALL_DATA_KEY) {
    return json({ error: "Missing FOOTBALL_DATA_KEY secret" }, 500, 0);
  }

  // Tottenham Hotspur in football-data.org
  const TEAM_ID = 73;

  // Competition codes from football-data.org
  const COMPETITIONS = {
    PL: "Premier League",
    CL: "Champions League",
    FAC: "FA Cup"
  };

  try {
    const [teamData, plStandingsData, matchesData] = await Promise.all([
      fdFetch(env, `/teams/${TEAM_ID}`),
      fdFetch(env, `/competitions/PL/standings`),
      fdFetch(env, `/teams/${TEAM_ID}/matches?status=SCHEDULED,FINISHED,IN_PLAY,PAUSED`)
    ]);

    const team = normaliseTeam(teamData);

    const allMatches = Array.isArray(matchesData?.matches) ? matchesData.matches : [];
    const spursMatches = allMatches.filter((match) => {
      const code = match?.competition?.code;
      return code === "PL" || code === "CL" || code === "FAC";
    });

    const now = new Date();

    const live = spursMatches
      .filter((m) => isLiveStatus(m?.status))
      .sort(sortByUtcAsc);

    const next = spursMatches
      .filter((m) => {
        if (!m?.utcDate) return false;
        return new Date(m.utcDate) >= now && !isLiveStatus(m?.status);
      })
      .sort(sortByUtcAsc)
      .slice(0, 6);

    const last = spursMatches
      .filter((m) => m?.status === "FINISHED")
      .sort(sortByUtcDesc)
      .slice(0, 6);

    const table = extractStandings(plStandingsData, TEAM_ID);

    return json(
      {
        source: "football-data.org",
        team,
        competitions: COMPETITIONS,
        live: live.map(normaliseMatch),
        next: next.map(normaliseMatch),
        last: last.map(normaliseMatch),
        standings: table.standings,
        standing: table.teamStanding
      },
      200,
      60
    );
  } catch (error) {
    return json(
      {
        error: "Could not load Spurs data from football-data.org",
        detail: String(error)
      },
      500,
      5
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

function normaliseTeam(data) {
  return {
    id: data?.id ?? 73,
    name: data?.name ?? "Tottenham Hotspur",
    shortName: data?.shortName ?? "Spurs",
    tla: data?.tla ?? "TOT",
    crest: data?.crest ?? ""
  };
}

function extractStandings(data, teamId) {
  const allTables = Array.isArray(data?.standings) ? data.standings : [];
  const totalTable =
    allTables.find((table) => table?.type === "TOTAL") ||
    allTables[0] ||
    { table: [] };

  const standings = Array.isArray(totalTable.table)
    ? totalTable.table.map((row) => ({
        position: row?.position ?? null,
        team: {
          id: row?.team?.id ?? null,
          name: row?.team?.name ?? "",
          shortName: row?.team?.shortName ?? "",
          tla: row?.team?.tla ?? "",
          crest: row?.team?.crest ?? ""
        },
        playedGames: row?.playedGames ?? 0,
        points: row?.points ?? 0,
        goalsFor: row?.goalsFor ?? 0,
        goalsAgainst: row?.goalsAgainst ?? 0,
        goalDifference: row?.goalDifference ?? 0,
        won: row?.won ?? 0,
        draw: row?.draw ?? 0,
        lost: row?.lost ?? 0,
        form: row?.form ?? ""
      }))
    : [];

  const teamStanding =
    standings.find((row) => String(row.team.id) === String(teamId)) || null;

  return { standings, teamStanding };
}

function normaliseMatch(match) {
  return {
    id: match?.id ?? null,
    utcDate: match?.utcDate ?? null,
    status: match?.status ?? "",
    minute: match?.minute ?? null,
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
  return ["IN_PLAY", "PAUSED"].includes(String(status || "").toUpperCase());
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