export async function onRequest(context) {
  const API_KEY = context.env.FOOTBALL_DATA_KEY;
  const BASE = "https://api.football-data.org/v4";
  const TEAM_ID = 1044; // AFC Wimbledon
  const COMPETITION_CODE = "FL1"; // League One

  const headers = {
    "X-Auth-Token": API_KEY
  };

  function cleanText(value = "") {
    return String(value)
      .replace(/<!\[CDATA\[/g, "")
      .replace(/\]\]>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
  }

  function parseRSS(xmlText) {
    const items = [];
    const matches = xmlText.match(/<item>([\s\S]*?)<\/item>/gi) || [];

    for (const item of matches) {
      const getTag = (tag) => {
        const match = item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
        return match ? cleanText(match[1]) : "";
      };

      const thumbMatch =
        item.match(/<media:thumbnail[^>]*url="([^"]+)"/i) ||
        item.match(/<media:content[^>]*url="([^"]+)"/i) ||
        item.match(/<enclosure[^>]*url="([^"]+)"/i);

      items.push({
        title: getTag("title"),
        link: getTag("link"),
        description: getTag("description"),
        pubDate: getTag("pubDate"),
        thumbnail: thumbMatch ? thumbMatch[1] : ""
      });
    }

    return items;
  }

  function formatMatch(match) {
    return {
      id: match.id,
      utcDate: match.utcDate,
      status: match.status,
      venue: match.venue || "",
      competition: {
        name: match.competition?.name || ""
      },
      homeTeam: {
        id: match.homeTeam?.id,
        name: match.homeTeam?.name || "",
        crest: match.homeTeam?.crest || ""
      },
      awayTeam: {
        id: match.awayTeam?.id,
        name: match.awayTeam?.name || "",
        crest: match.awayTeam?.crest || ""
      },
      score: {
        home: match.score?.fullTime?.home ?? null,
        away: match.score?.fullTime?.away ?? null,
        fullTime: {
          home: match.score?.fullTime?.home ?? null,
          away: match.score?.fullTime?.away ?? null
        }
      }
    };
  }

  function filterWimbledonNews(items) {
    const terms = ["afc wimbledon", "wimbledon", "dons", "plough lane"];
    const filtered = items.filter((item) => {
      const text = `${item.title} ${item.description}`.toLowerCase();
      return terms.some((term) => text.includes(term));
    });

    return filtered.length ? filtered : items;
  }

  try {
    const [teamRes, matchesRes, standingsRes, rssRes] = await Promise.all([
      fetch(`${BASE}/teams/${TEAM_ID}`, { headers }),
      fetch(`${BASE}/teams/${TEAM_ID}/matches?status=SCHEDULED,FINISHED`, { headers }),
      fetch(`${BASE}/competitions/${COMPETITION_CODE}/standings`, { headers }),
      fetch("https://feeds.bbci.co.uk/sport/football/rss.xml")
    ]);

    if (!teamRes.ok) {
      throw new Error(`Team request failed: ${teamRes.status}`);
    }
    if (!matchesRes.ok) {
      throw new Error(`Matches request failed: ${matchesRes.status}`);
    }
    if (!standingsRes.ok) {
      throw new Error(`Standings request failed: ${standingsRes.status}`);
    }
    if (!rssRes.ok) {
      throw new Error(`RSS request failed: ${rssRes.status}`);
    }

    const teamJson = await teamRes.json();
    const matchesJson = await matchesRes.json();
    const standingsJson = await standingsRes.json();
    const rssText = await rssRes.text();

    const allMatches = Array.isArray(matchesJson.matches) ? matchesJson.matches : [];
    const now = Date.now();

    const upcoming = allMatches
      .filter((m) => {
        const t = new Date(m.utcDate).getTime();
        return !Number.isNaN(t) && t >= now;
      })
      .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
      .slice(0, 8)
      .map(formatMatch);

    const finished = allMatches
      .filter((m) => {
        const t = new Date(m.utcDate).getTime();
        return !Number.isNaN(t) && t < now;
      })
      .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
      .slice(0, 8)
      .map(formatMatch);

    const standings =
      standingsJson?.standings?.[0]?.table?.map((row) => ({
        position: row.position,
        playedGames: row.playedGames,
        points: row.points,
        goalDifference: row.goalDifference,
        form: row.form || "",
        team: {
          id: row.team?.id,
          name: row.team?.name || "",
          crest: row.team?.crest || ""
        }
      })) || [];

    const teamRow = standings.find((row) => String(row.team?.id) === String(TEAM_ID));

    const rssItems = parseRSS(rssText);
    const news = filterWimbledonNews(rssItems).slice(0, 8);

    const payload = {
      team: {
        id: teamJson?.id || TEAM_ID,
        name: teamJson?.name || "AFC Wimbledon",
        shortName: teamJson?.shortName || "Wimbledon",
        tla: teamJson?.tla || "AWF",
        crest: teamJson?.crest || ""
      },
      next: upcoming,
      last: finished,
      standings,
      stats: {
        position: teamRow?.position ?? null,
        points: teamRow?.points ?? null,
        played: teamRow?.playedGames ?? null
      },
      news
    };

    return new Response(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Could not load Wimbledon data",
        detail: error.message
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        }
      }
    );
  }
}