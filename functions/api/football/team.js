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
      const data = await fetchWimbledonData();
      setCached("wimbledon", data);
      return json(data);
    }

    return json({ error: "Invalid team" }, 400);

  } catch (err) {
    const cached = getCached(team);
    if (cached) return json(cached);

    return json({
      error: "Team endpoint failed",
      detail: err?.message || String(err)
    }, 500);
  }
}

function normaliseTeam(v) {
  v = String(v || "").toLowerCase();
  if (v.includes("tottenham") || v.includes("spurs")) return "tottenham";
  if (v.includes("wimbledon")) return "wimbledon";
  return null;
}

function setCached(team, data) {
  CACHE[team] = {
    ts: Date.now(),
    data
  };
}

function getCached(team) {
  const item = CACHE[team];
  if (!item) return null;
  if (Date.now() - item.ts > CACHE_TTL_MS) return null;
  return item.data;
}

async function fetchTottenhamDirect(env) {
  if (!env.FOOTBALL_DATA_KEY) {
    throw new Error("Missing FOOTBALL_DATA_KEY");
  }

  const TEAM_ID = 73;

  const res = await fetch(
    "https://api.football-data.org/v4/competitions/PL/matches",
    {
      headers: {
        "X-Auth-Token": env.FOOTBALL_DATA_KEY
      }
    }
  );

  if (!res.ok) {
    throw new Error("Football-data API failed");
  }

  const data = await res.json();

  const matches = data.matches.filter(
    m => m.homeTeam.id === TEAM_ID || m.awayTeam.id === TEAM_ID
  );

  return {
    source: "football-data",
    team: {
      id: 73,
      name: "Tottenham Hotspur"
    },
    matches
  };
}

async function fetchWimbledonData() {
  const res = await fetch(
    "https://www.thesportsdb.com/api/v1/json/3/eventsnext.php?id=133602"
  );

  const data = await res.json();

  return {
    source: "sportsdb",
    team: {
      id: 1044,
      name: "AFC Wimbledon"
    },
    matches: data.events || []
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}