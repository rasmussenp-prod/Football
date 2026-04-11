const TIMEOUT_MS = 1800;
const CACHE_TTL_MS = 2 * 60 * 1000;

// simple in-memory cache per worker instance
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
      return await handleTottenham(context);
    }

    if (team === "wimbledon") {
      return await handleWimbledon(context);
    }

    return json({ error: "Invalid team" }, 400);
  } catch (err) {
    return json({
      error: "Team endpoint failed",
      detail: err?.message || String(err)
    }, 500);
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

async function handleTottenham(context) {
  const base = getBaseUrl(context.request.url);
  const primaryUrl = `${base}/api/football/spurs`;

  try {
    const data = await fetchWithTimeout(primaryUrl);
    const normalised = normalisePrimaryShape(data, "tottenham");
    setCached("tottenham", normalised);
    return json(normalised);
  } catch (err) {
    const cached = getCached("tottenham");
    if (cached) return json(cached);
    throw err;
  }
}

async function handleWimbledon(context) {
  const base = getBaseUrl(context.request.url);
  const primaryUrl = `${base}/api/football/wimbledon`;

  try {
    const data = await fetchWithTimeout(primaryUrl);
    const normalised = normalisePrimaryShape(data, "wimbledon");

    // if the primary source gives us usable fixtures/results, keep it
    if ((normalised.next?.length || 0) > 0 || (normalised.last?.length || 0) > 0) {
      setCached("wimbledon", normalised);
      return json(normalised);
    }

    throw new Error("Primary Wimbledon source returned no useful fixtures");
  } catch (primaryErr) {
    try {
      const fallback = await fetchWimbledonFallback();
      setCached("wimbledon", fallback);
      return json(fallback);
    } catch (fallbackErr) {
      const cached = getCached("wimbledon");
      if (cached) return json(cached);
      throw fallbackErr;
    }
  }
}

async function fetchWimbledonFallback() {
  // AFC Wimbledon team id used in your app: 1044
  // TheSportsDB fallback ids used here:
  // - team next / previous schedule endpoints
  // These are free schedule endpoints in their documentation.
  const teamId = "133602";

  const [nextData, lastData] = await Promise.all([
    fetchWithTimeout(`https://www.thesportsdb.com/api/v1/json/3/eventsnext.php?id=${teamId}`),
    fetchWithTimeout(`https://www.thesportsdb.com/api/v1/json/3/eventslast.php?id=${teamId}`)
  ]);

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

  // best-effort ISO
  const combined = `${datePart}T${timePart}`.replace(" ", "T");
  const d = new Date(combined);
  if (!Number.isNaN(d.getTime())) return d.toISOString();

  return `${datePart}T${timePart}`;
}

function normalisePrimaryShape(data, teamKey) {
  return {
    source: data?.source || `${teamKey} primary`,
    team: data?.team || {
      id: teamKey === "tottenham" ? 47 : 1044,
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

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!res.ok) {
      throw new Error(`Fetch failed ${res.status} for ${url}`);
    }

    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

function isBlank(v) {
  return v === null || v === undefined || v === "";
}

function initials(name) {
  return String(name || "")
    .split(/\s+/)
    .map(part => part[0] || "")
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