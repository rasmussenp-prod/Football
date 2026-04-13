export async function onRequest(context) {
  const API_KEY = context.env.FOOTBALL_DATA_KEY;
  const BASE = "https://api.football-data.org/v4";
  const TEAM_ID = 1044;

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
      .replace(/\s+/g, " ")
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

  function filterWimbledonNews(items) {
    const terms = ["afc wimbledon", "wimbledon", "dons", "plough lane"];
    const filtered = items.filter((item) => {
      const text = `${item.title} ${item.description}`.toLowerCase();
      return terms.some((term) => text.includes(term));
    });
    return filtered.length ? filtered : items;
  }

  function formatMatch(match) {
    return {
      id: match.id,
      utcDate: match.utcDate,
      status: match.status,
      venue: match.venue || "",
      competition: {
        name: match.competition?.name || "League One"
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

  function normaliseTeamName(name = "") {
    return cleanText(name)
      .toLowerCase()
      .replace(/^afc\s+/, "")
      .replace(/\s+fc$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseSkySportsLeagueOneTable(html) {
    const start = html.indexOf("Sky Bet League One Table");
    if (start === -1) return [];

    const endCandidates = [
      html.indexOf("##### Key", start),
      html.indexOf("Promotion:", start),
      html.indexOf("Partners", start)
    ].filter((n) => n !== -1);

    const end = endCandidates.length ? Math.min(...endCandidates) : start + 30000;
    const section = html.slice(start, end);

    const rows = [];
    const rowRegex = /(\d+)\s+(?:【\d+†Image†www\.skysports\.com】\s+|Image\s+)(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([+-]?\d+)\s+(\d+)/g;

    let match;
    while ((match = rowRegex.exec(section)) !== null) {
      const teamNameRaw = match[2]
        .replace(/【\d+†/g, "")
        .replace(/】/g, "")
        .replace(/†www\.skysports\.com/g, "")
        .trim();

      const position = Number(match[1]);
      const playedGames = Number(match[3]);
      const won = Number(match[4]);
      const draw = Number(match[5]);
      const lost = Number(match[6]);
      const goalsFor = Number(match[7]);
      const goalsAgainst = Number(match[8]);
      const goalDifference = Number(match[9]);
      const points = Number(match[10]);

      if (
        !Number.isNaN(position) &&
        !Number.isNaN(playedGames) &&
        !Number.isNaN(points)
      ) {
        rows.push({
          position,
          team: {
            id: null,
            name: cleanText(teamNameRaw),
            crest: ""
          },
          playedGames,
          won,
          draw,
          lost,
          goalsFor,
          goalsAgainst,
          goalDifference,
          points,
          form: ""
        });
      }
    }

    return rows;
  }

  try {
    const [matchesRes, skyTableRes, rssRes] = await Promise.all([
      fetch(`${BASE}/teams/${TEAM_ID}/matches?status=SCHEDULED,FINISHED`, { headers }),
      fetch("https://www.skysports.com/league-1-table"),
      fetch("https://feeds.bbci.co.uk/sport/football/rss.xml")
    ]);

    if (!matchesRes.ok) throw new Error(`Matches request failed: ${matchesRes.status}`);
    if (!skyTableRes.ok) throw new Error(`Sky table request failed: ${skyTableRes.status}`);
    if (!rssRes.ok) throw new Error(`RSS request failed: ${rssRes.status}`);

    const matchesJson = await matchesRes.json();
    const skyTableHtml = await skyTableRes.text();
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

    const standings = parseSkySportsLeagueOneTable(skyTableHtml);

    const teamRow =
      standings.find((row) =>
        ["wimbledon", "afc wimbledon"].includes(normaliseTeamName(row.team?.name))
      ) || null;

    const rssItems = parseRSS(rssText);
    const news = filterWimbledonNews(rssItems).slice(0, 8);

    const payload = {
      team: {
        id: TEAM_ID,
        name: "AFC Wimbledon",
        shortName: "Wimbledon",
        tla: "AWF",
        crest: ""
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