export async function onRequestGet() {
  const TEAM_NAME = "AFC Wimbledon";
  const TEAM_SHORT = "Wimbledon";
  const TEAM_TLA = "AWF";
  const TEAM_ID = 1044;

  const FIXTURES_URL = "https://www.skysports.com/afc-wimbledon-scores-fixtures";
  const TABLE_URL = "https://www.skysports.com/league-1-table";

  try {
    const [fixturesHtml, tableHtml] = await Promise.all([
      fetchText(FIXTURES_URL),
      fetchText(TABLE_URL)
    ]);

    const fixtureText = htmlToText(fixturesHtml);
    const tableText = htmlToText(tableHtml);

    const parsedFixtures = parseSkyFixtures(fixtureText, TEAM_NAME);
    const parsedTable = parseSkyLeagueOneTable(tableText, TEAM_NAME, TEAM_ID);

    return json(
      {
        source: "Sky Sports scrape",
        team: {
          id: TEAM_ID,
          name: TEAM_NAME,
          shortName: TEAM_SHORT,
          tla: TEAM_TLA,
          crest: ""
        },
        live: parsedFixtures.live,
        next: parsedFixtures.next,
        last: parsedFixtures.last,
        standings: parsedTable.standings,
        standing: parsedTable.teamStanding
      },
      200,
      300
    );
  } catch (error) {
    return json(
      {
        error: "Could not load Wimbledon data from Sky Sports",
        detail: String(error)
      },
      500,
      30
    );
  }
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 FootballCommandCentre/1.0"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fetch failed for ${url}: ${res.status} ${text.slice(0, 200)}`);
  }

  return res.text();
}

function htmlToText(html) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style[\s\S]*?<\/style>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|tr|h1|h2|h3|h4|h5|h6)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim()
  );
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\u00a0/g, " ");
}

function parseSkyFixtures(text, teamName) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const dateLineRegex = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}(st|nd|rd|th)\s+[A-Za-z]+$/i;
  const finishedRegex = /^(.+?),\s*(\d+)\.\s+(.+?),\s*(\d+)\.\s+Full time\.?$/i;
  const scheduledRegex = /^(.+?)\s+vs\s+(.+?)\.\s+Kick-off at\s+([0-9:apm\.]+)$/i;

  let currentDate = null;
  const fixtures = [];

  for (const line of lines) {
    if (dateLineRegex.test(line)) {
      currentDate = line;
      continue;
    }

    const finishedMatch = line.match(finishedRegex);
    if (finishedMatch && currentDate) {
      const [, home, homeGoals, away, awayGoals] = finishedMatch;
      if (!includesTeam(home, away, teamName)) continue;

      fixtures.push(
        makeFixture({
          dateLabel: currentDate,
          home: cleanName(home),
          away: cleanName(away),
          competition: "Sky Bet League One",
          status: "FINISHED",
          scoreHome: Number(homeGoals),
          scoreAway: Number(awayGoals)
        })
      );
      continue;
    }

    const scheduledMatch = line.match(scheduledRegex);
    if (scheduledMatch && currentDate) {
      const [, home, away, kickOff] = scheduledMatch;
      if (!includesTeam(home, away, teamName)) continue;

      fixtures.push(
        makeFixture({
          dateLabel: currentDate,
          home: cleanName(home),
          away: cleanName(away),
          competition: "Sky Bet League One",
          status: "SCHEDULED",
          kickOff: normaliseKickoff(kickOff)
        })
      );
    }
  }

  const now = new Date();

  const live = fixtures.filter((f) => ["IN_PLAY", "PAUSED"].includes(f.status));

  const next = fixtures
    .filter((f) => f.status === "SCHEDULED")
    .sort((a, b) => new Date(a.utcDate || 0) - new Date(b.utcDate || 0))
    .slice(0, 6);

  const last = fixtures
    .filter((f) => f.status === "FINISHED")
    .sort((a, b) => new Date(b.utcDate || 0) - new Date(a.utcDate || 0))
    .slice(0, 6);

  return { live, next, last };
}

function parseSkyLeagueOneTable(text, teamName, teamId) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const startIndex = lines.findIndex((line) => line.startsWith("Last updated:"));
  if (startIndex === -1) {
    return { standings: [], teamStanding: null };
  }

  const standings = [];

  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("Key") || line.startsWith("Promotion:") || line.startsWith("Relegation:")) {
      break;
    }

    const parsed = parseTableRow(line);
    if (parsed) standings.push(parsed);
  }

  const teamStanding =
    standings.find((row) => row.team.name.toLowerCase() === teamName.toLowerCase()) || null;

  if (teamStanding) {
    teamStanding.team.id = teamId;
  }

  return { standings, teamStanding };
}

function parseTableRow(line) {
  const tokens = line.split(/\s+/).filter(Boolean);
  if (tokens.length < 10) return null;
  if (!/^\d+$/.test(tokens[0])) return null;

  const lastEight = tokens.slice(-8);
  if (!lastEight.every((token, idx) => idx === 6 ? /^[+-]?\d+$/.test(token) : /^\d+$/.test(token))) {
    return null;
  }

  const position = Number(tokens[0]);
  const teamTokens = tokens.slice(1, -8).filter((t) => t.toLowerCase() !== "image");
  const teamName = cleanName(teamTokens.join(" "));
  if (!teamName) return null;

  const [played, won, draw, lost, goalsFor, goalsAgainst, goalDifference, points] = lastEight;

  return {
    position,
    team: {
      id: null,
      name: teamName,
      shortName: teamName,
      tla: makeTla(teamName),
      crest: ""
    },
    playedGames: Number(played),
    points: Number(points),
    goalsFor: Number(goalsFor),
    goalsAgainst: Number(goalsAgainst),
    goalDifference: Number(goalDifference),
    won: Number(won),
    draw: Number(draw),
    lost: Number(lost),
    form: ""
  };
}

function makeFixture({ dateLabel, home, away, competition, status, scoreHome = null, scoreAway = null, kickOff = null }) {
  const utcDate = buildUtcDate(dateLabel, kickOff);

  return {
    id: makeFixtureId(home, away, utcDate),
    utcDate,
    status,
    competition: {
      code: "EL1",
      name: competition
    },
    stage: "",
    matchday: null,
    venue: "",
    homeTeam: {
      id: home.toLowerCase() === "afc wimbledon" ? 1044 : null,
      name: home,
      shortName: home,
      tla: makeTla(home),
      crest: ""
    },
    awayTeam: {
      id: away.toLowerCase() === "afc wimbledon" ? 1044 : null,
      name: away,
      shortName: away,
      tla: makeTla(away),
      crest: ""
    },
    score: {
      winner:
        scoreHome === null || scoreAway === null
          ? null
          : scoreHome > scoreAway
            ? "HOME_TEAM"
            : scoreAway > scoreHome
              ? "AWAY_TEAM"
              : "DRAW",
      fullTime: {
        home: scoreHome,
        away: scoreAway
      },
      halfTime: {
        home: null,
        away: null
      }
    }
  };
}

function buildUtcDate(dateLabel, kickOff) {
  const clean = dateLabel.replace(/(\d+)(st|nd|rd|th)/i, "$1");
  const currentYear = new Date().getUTCFullYear();
  const withYear = `${clean} ${currentYear}`;
  const base = new Date(withYear);

  if (Number.isNaN(base.getTime())) return null;

  if (!kickOff) {
    base.setUTCHours(15, 0, 0, 0);
    return base.toISOString();
  }

  const [hours, minutes] = parseKickoff(kickOff);
  base.setUTCHours(hours, minutes, 0, 0);
  return base.toISOString();
}

function parseKickoff(kickOff) {
  const normalised = kickOff.replace(/\./g, ":").trim().toLowerCase();
  const match = normalised.match(/^(\d{1,2}):(\d{2})(am|pm)?$/);
  if (!match) return [15, 0];

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3];

  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;

  return [hours, minutes];
}

function normaliseKickoff(kickOff) {
  return kickOff.replace(/\./g, ":");
}

function includesTeam(home, away, teamName) {
  const t = teamName.toLowerCase();
  return home.toLowerCase().includes(t) || away.toLowerCase().includes(t);
}

function cleanName(name) {
  return name.replace(/\s+/g, " ").replace(/\.$/, "").trim();
}

function makeTla(name) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function makeFixtureId(home, away, utcDate) {
  const raw = `${home}-${away}-${utcDate || ""}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
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