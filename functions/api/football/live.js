const TIMEOUT_MS = 1800;
const LIVE_WINDOW_BEFORE_KICKOFF_MS = 15 * 60 * 1000;
const LIVE_WINDOW_AFTER_KICKOFF_MS = 3 * 60 * 60 * 1000;

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const rawTeam = url.searchParams.get("team");
  const season = url.searchParams.get("season") || "";

  const teamKey = normaliseTeam(rawTeam);

  if (!teamKey) {
    return json({ error: "Missing team or season" }, 400);
  }

  try {
    const base = getBaseUrl(context.request.url);

    // 1) Get the unified team data first
    const teamData = await fetchWithTimeout(`${base}/api/football/team?team=${teamKey}`);

    // 2) Try explicit live array from team feed
    const explicitLive = Array.isArray(teamData?.live)
      ? teamData.live.find(match => isLiveStatus(match?.status))
      : null;

    if (explicitLive) {
      return json({
        live: true,
        source: "team.live",
        fixture: mapToLiveFixture(explicitLive, teamKey)
      });
    }

    // 3) Try current-window inference from next + last + live
    const inferred = inferLiveFixture(teamData, teamKey);
    if (inferred) {
      return json({
        live: true,
        source: "inferred",
        fixture: inferred
      });
    }

    // 4) No live match found
    return json({
      live: false,
      season,
      fixture: null
    });
  } catch (err) {
    return json({
      live: false,
      error: "Live endpoint failed",
      detail: err?.message || String(err),
      fixture: null
    }, 200);
  }
}

function normaliseTeam(value) {
  const v = String(value || "").toLowerCase().trim();

  if (["47", "tottenham", "spurs", "tottenham hotspur"].includes(v)) return "tottenham";
  if (["1044", "wimbledon", "afc wimbledon", "dons"].includes(v)) return "wimbledon";

  return null;
}

function getBaseUrl(requestUrl) {
  return requestUrl.split("/api/football/live")[0];
}

function inferLiveFixture(teamData, teamKey) {
  const all = [
    ...(Array.isArray(teamData?.live) ? teamData.live : []),
    ...(Array.isArray(teamData?.next) ? teamData.next : []),
    ...(Array.isArray(teamData?.last) ? teamData.last : [])
  ];

  const now = Date.now();

  // explicit live-like statuses first
  const liveByStatus = all.find(match => isLiveStatus(match?.status));
  if (liveByStatus) {
    return mapToLiveFixture(liveByStatus, teamKey);
  }

  // otherwise infer by kickoff window
  const candidates = all
    .map(match => ({ match, date: parseDate(match?.utcDate || match?.date || match?.kickoff) }))
    .filter(item => item.date);

  const liveWindowMatch = candidates.find(({ match, date }) => {
    const kickoff = date.getTime();
    const status = String(match?.status || "").toUpperCase();

    if (["FINISHED", "POSTPONED", "CANCELLED", "SUSPENDED"].includes(status)) return false;

    return (
      now >= kickoff - LIVE_WINDOW_BEFORE_KICKOFF_MS &&
      now <= kickoff + LIVE_WINDOW_AFTER_KICKOFF_MS
    );
  });

  if (!liveWindowMatch) return null;

  const mapped = mapToLiveFixture(liveWindowMatch.match, teamKey);

  // mark as likely live / match centre window
  if (!mapped.fixture?.status?.short || mapped.fixture.status.short === "SCHEDULED") {
    mapped.fixture.status.short = "LIVE";
    mapped.fixture.status.long = "Match centre";
  }

  return mapped;
}

function mapToLiveFixture(match, teamKey) {
  const homeScore = match?.score?.fullTime?.home ?? match?.score?.home ?? null;
  const awayScore = match?.score?.fullTime?.away ?? match?.score?.away ?? null;

  return {
    fixture: {
      id: match?.id || null,
      date: match?.utcDate || match?.date || match?.kickoff || null,
      venue: {
        name: match?.venue || ""
      },
      status: {
        short: String(match?.status || "LIVE").toUpperCase(),
        long: humanStatus(match?.status)
      }
    },
    league: {
      name: match?.competition?.name || (teamKey === "tottenham" ? "Premier League" : "League One")
    },
    teams: {
      home: {
        name: match?.homeTeam?.name || "Home"
      },
      away: {
        name: match?.awayTeam?.name || "Away"
      }
    },
    goals: {
      home: homeScore,
      away: awayScore
    },
    lineups: match?.lineups || null
  };
}

function humanStatus(status) {
  const s = String(status || "").toUpperCase();
  if (s === "IN_PLAY") return "In play";
  if (s === "PAUSED") return "Paused";
  if (s === "TIMED") return "Timed";
  if (s === "SCHEDULED") return "Scheduled";
  if (s === "FINISHED") return "Finished";
  if (s === "LIVE") return "Live";
  return s || "Live";
}

function isLiveStatus(status) {
  return ["IN_PLAY", "PAUSED", "LIVE", "1H", "HT", "2H", "ET", "BT", "P", "INT"].includes(
    String(status || "").toUpperCase()
  );
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}