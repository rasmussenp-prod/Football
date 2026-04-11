const CACHE_TTL_MS = 2 * 60 * 1000;

const CACHE = {
  tottenham: null,
  wimbledon: null
};

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const team = normaliseTeam(url.searchParams.get("team"));

  if (!team) {
    return json({ error: "Missing or invalid team" }, 400);
  }

  try {
    if (team === "tottenham") {
      const data = await fetchTottenhamDirect(context.env);
      setCached("tottenham", data);
      return json(data);
    }

    if (team === "wimbledon") {
      const data = await fetchWimbledonData(context);
      setCached("wimbledon", data);
      return json(data);
    }

    return json({ error: "Invalid team" }, 400);
  } catch (err) {
    const cached = getCached(team);
    if (cached) {
      return json(cached);
    }

    return json(
      {
        error: "Team endpoint failed",
        detail: err?.message || String(err)
      },
      500
    );
  }
}

function normaliseTeam(value) {
  const v = String(value || "").toLowerCase().trim();
  if (!v) return null;
  if (["tottenham", "spurs", "tottenham hotspur", "47"].includes(v)) return "tottenham";
  if (["wimbledon", "afc wimbledon", "dons", "1044"].includes(v)) return "wimbledon";
  return null;
}

function getBaseUrl(requestUrl) {
  return requestUrl.split("/api/football/team")[0];
}

function getCached(team) {
  const item = CACHE[team];
  if (!item) return null;
  if (Date.now() - item.ts > CACHE_TTL_MS) return null;
  return item.data;
}

function setCached(team, data) {
  CACHE[team] = {
    ts: Date.now(),
    data
  };
}

async function fetchTottenhamDirect(env) {
  if (!env.FOOTBALL_DATA_KEY) {
    throw new Error("Missing FOOTBALL_DATA_KEY secret");
  }

  const TEAM_ID = 73;
  const COMPETITIONS = ["PL", "CL", "FAC", "ELC"];

  const today = new Date();
  const dateFrom = addDays(today, -120);
  const dateTo = addDays(today, 180);

  const [teamData, plStandingsData, ...competitionResults] = await Promise.all([
    fdFetch(env, `/teams/${TEAM_ID}`),
    fdFetchSafe(env, `/competitions/PL/standings`),
    ...COMPETITIONS.map((code) =>
      fdFetchSafe(env, `/competitions/${code}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`)
    )
  ]);

  const allMatches = competitionResults
    .flatMap((result) => Array.isArray(result?.matches) ? result.matches : [])
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

  const table = extractStandings(plStandingsData, TEAM_ID);

  return {
    source: "football-data.org",
    team: normaliseFdTeam(teamData),
    live: live.map(normaliseFdMatch),
    next: next.map(normaliseFdMatch),
    last: last.map(normaliseFdMatch),
    standings: table.standings,
    standing: table.teamStanding
  };
}

async function fetchWimbledonData(context) {
  const base = getBaseUrl(context.request.url);
  const primaryUrl = `${base}/api/football/wimbledon`;

  try {
    const res = await fetch(primaryUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!res.ok) {
      throw new Error(`Wimbledon primary failed ${res.status}`);
    }

    const data = await res.json();
    const normalised = normalisePrimaryShape(data, "wimbledon");

    if ((normalised.next?.length || 0) > 0 || (normalised.last?.length || 0) > 0) {
      return normalised;
    }

    throw new Error("Primary Wimbledon source returned no useful fixtures");
  } catch {
    return await fetchWimbledonFallback();
  }
}

async function fetchWimbledonFallback() {
  const teamId = "133602";

  const [nextRes, lastRes] = await Promise.all([
    fetch(`https://www.thesportsdb.com/api/v1/json/3/eventsnext.php?id=${teamId}`, {
      headers: { "User-Agent": "Mozilla/5.0" }
    }),
    fetch(`https://www.thesportsdb.com/api/v1/json/3/eventslast.php?id=${teamId}`, {
      headers: { "User-Agent": "Mozilla/5.0" }
    })
  ]);

  if (!nextRes.ok || !lastRes.ok) {
    throw new Error("Wimbledon fallback failed");
  }

  const nextData = await nextRes.json();
  const lastData = await lastRes.json();

  return {
    source: "TheSportsDB fallback",
    team: {
      id: 1044,
      name: "AFC Wimbledon",
      shortName: "Wimbledon",
      tla: "AW",
      crest: ""
    },
    live: [],
    next: mapSportsDbEvents(nextData?.events || [], { forceStatus: "SCHEDULED" }),
    last: mapSportsDbEvents(lastData?.results || lastData?.events || [], { forceStatus: "FINISHED" }),
    standings: [],
    standing: null
  };
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

async function fdFetchSafe(env, path) {
  try {
    return await fdFetch(env, path);
  } catch {
    return { matches: [] };
  }
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function normaliseFdTeam(data) {
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

function normaliseFdMatch(match) {
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

function normalisePrimaryShape(data, teamKey) {
  return {
    source: data?.source || `${teamKey} primary`,
    team: data?.team || {
      id: teamKey === "tottenham" ? 73 : 1044,
      name: teamKey === "tottenham" ? "Tottenham Hotspur" : "AFC Wimbledon",
      shortName: teamKey === "tottenham" ? "Spurs" : "Wimbledon",
      tla: teamKey === "tottenham" ? "TOT" : "AW",
      crest: ""
    },
    live: Array.isArray(data?.live) ? data.live : [],
    next: Array.isArray(data?.next) ? data.next : [],
    last: Array.isArray(data?.last) ? data.last : [],
    standings: Array.isArray(data?.standings) ? data.standings : [],
    standing: data?.standing || null
  };
}

function mapSportsDbEvents(events, options = {}) {
  const forceStatus = options.forceStatus || "";

  return events.map((e) => {
    const utcDate = toIsoFromSportsDb(e);
    const homeScore = isBlank(e.intHomeScore) ? null : Number(e.intHomeScore);
    const awayScore = isBlank(e.intAwayScore) ? null : Number(e.intAwayScore);

    return {
      id: e.idEvent || `${e.strHomeTeam}-${e.strAwayTeam}-${utcDate}`,
      utcDate,
      status: forceStatus || inferStatusFromSportsDb(e),
      competition: {
        code: "",
        name: e.strLeague || e.strLeagueAlternate || "Competition"
      },
      stage: e.strRound || "",
      matchday: null,
      venue: e.strVenue || "",
      homeTeam: {
        id: null,
        name: e.strHomeTeam || "Home",
        shortName: e.strHomeTeam || "Home",
        tla: initials(e.strHomeTeam),
        crest: ""
      },
      awayTeam: {
        id: null,
        name: e.strAwayTeam || "Away",
        shortName: e.strAwayTeam || "Away",
        tla: initials(e.strAwayTeam),
        crest: ""
      },
      score: {
        winner: null,
        fullTime: {
          home: homeScore,
          away: awayScore
        },
        halfTime: {
          home: null,
          away: null
        }
      }
    };
  });
}

function inferStatusFromSportsDb(event) {
  const hasScore = !isBlank(event.intHomeScore) || !isBlank(event.intAwayScore);
  return hasScore ? "FINISHED" : "SCHEDULED";
}

function toIsoFromSportsDb(event) {
  const datePart = event.dateEvent || event.strTimestamp || "";
  const timePart = event.strTime || "15:00:00";

  if (event.strTimestamp) {
    const d = new Date(event.strTimestamp);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  const combined = `${datePart}T${timePart}`.replace(" ", "T");
  const d = new Date(combined);
  if (!Number.isNaN(d.getTime())) return d.toISOString();

  return `${datePart}T${timePart}`;
}

function isBlank(v) {
  return v === null || v === undefined || v === "";
}

function initials(name) {
  return String(name || "")
    .split(/\s+/)
    .map((part) => part[0] || "")
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}