export async function onRequest() {
  const TEAM_ID = 1044;

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
    return items.filter((item) => {
      const text = `${item.title} ${item.description}`.toLowerCase();
      return terms.some((term) => text.includes(term));
    });
  }

  function normaliseTeamName(name = "") {
    return cleanText(name)
      .toLowerCase()
      .replace(/^afc\s+/, "")
      .replace(/\s+fc$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseUkDate(dateLabel, timeLabel = "15:00") {
    // examples:
    // "Monday 6th April"
    // "Wednesday 15th April"
    const now = new Date();
    const year = now.getFullYear();

    const cleanedDate = cleanText(dateLabel)
      .replace(/(\d+)(st|nd|rd|th)/gi, "$1");

    const cleanedTime = cleanText(timeLabel)
      .replace(/\./g, ":")
      .toLowerCase();

    const combined = `${cleanedDate} ${year} ${cleanedTime}`;
    const d = new Date(combined);

    if (!Number.isNaN(d.getTime())) return d.toISOString();

    const fallback = new Date();
    return fallback.toISOString();
  }

  function parseSkyLeagueOneTable(html) {
    const anchor = html.indexOf("Sky Bet League One Table");
    if (anchor === -1) return [];

    const section = html.slice(anchor, anchor + 12000);
    const rows = [];

    const rowRegex = /(\d+)\s+【\d+†Image†www\.skysports\.com】\s+【\d+†\s*([^】]+?)\s*】\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([+-]?\d+)\s+(\d+)/g;

    let match;
    while ((match = rowRegex.exec(section)) !== null) {
      const position = Number(match[1]);
      const teamName = cleanText(match[2]);
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
        !Number.isNaN(points) &&
        teamName
      ) {
        rows.push({
          position,
          team: {
            id: null,
            name: teamName,
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

  function parseSkyWimbledonMatches(html) {
    const results = [];
    const fixtures = [];

    // Split on visible date headings like "Monday 6th April"
    const dateBlocks = html.split(/(?=Monday \d{1,2}(?:st|nd|rd|th)? [A-Za-z]+|Tuesday \d{1,2}(?:st|nd|rd|th)? [A-Za-z]+|Wednesday \d{1,2}(?:st|nd|rd|th)? [A-Za-z]+|Thursday \d{1,2}(?:st|nd|rd|th)? [A-Za-z]+|Friday \d{1,2}(?:st|nd|rd|th)? [A-Za-z]+|Saturday \d{1,2}(?:st|nd|rd|th)? [A-Za-z]+|Sunday \d{1,2}(?:st|nd|rd|th)? [A-Za-z]+)/g);

    for (const block of dateBlocks) {
      if (!block.includes("AFC Wimbledon")) continue;
      if (!block.includes("Sky Bet League One")) continue;

      const dateMatch = block.match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+/i);
      const dateLabel = dateMatch ? dateMatch[0] : "";

      // Finished: "Lincoln City, 1. AFC Wimbledon, 0. Full time."
      const finishedPattern1 = /([A-Za-z0-9 .'\-&]+),\s*(\d+)\.\s*AFC Wimbledon,\s*(\d+)\.\s*Full time\./i;
      const finishedPattern2 = /AFC Wimbledon,\s*(\d+)\.\s*([A-Za-z0-9 .'\-&]+),\s*(\d+)\.\s*Full time\./i;

      const fm1 = block.match(finishedPattern1);
      const fm2 = block.match(finishedPattern2);

      if (fm1) {
        results.push({
          id: `res-${dateLabel}-${fm1[1]}-AFC Wimbledon`,
          utcDate: parseUkDate(dateLabel, "15:00"),
          status: "FINISHED",
          venue: "",
          competition: { name: "League One" },
          homeTeam: { id: null, name: cleanText(fm1[1]), crest: "" },
          awayTeam: { id: null, name: "AFC Wimbledon", crest: "" },
          score: {
            home: Number(fm1[2]),
            away: Number(fm1[3]),
            fullTime: {
              home: Number(fm1[2]),
              away: Number(fm1[3])
            }
          }
        });
        continue;
      }

      if (fm2) {
        results.push({
          id: `res-${dateLabel}-AFC Wimbledon-${fm2[2]}`,
          utcDate: parseUkDate(dateLabel, "15:00"),
          status: "FINISHED",
          venue: "",
          competition: { name: "League One" },
          homeTeam: { id: null, name: "AFC Wimbledon", crest: "" },
          awayTeam: { id: null, name: cleanText(fm2[2]), crest: "" },
          score: {
            home: Number(fm2[1]),
            away: Number(fm2[3]),
            fullTime: {
              home: Number(fm2[1]),
              away: Number(fm2[3])
            }
          }
        });
        continue;
      }

      // Upcoming: "AFC Wimbledon vs Stockport County. Kick-off at 7:45pm"
      const upcomingPattern1 = /AFC Wimbledon vs ([A-Za-z0-9 .'\-&]+)\.\s*Kick-off at (\d{1,2}:\d{2}[ap]m)/i;
      const upcomingPattern2 = /([A-Za-z0-9 .'\-&]+) vs AFC Wimbledon\.\s*Kick-off at (\d{1,2}:\d{2}[ap]m)/i;

      const um1 = block.match(upcomingPattern1);
      const um2 = block.match(upcomingPattern2);

      if (um1) {
        fixtures.push({
          id: `fix-${dateLabel}-AFC Wimbledon-${um1[1]}`,
          utcDate: parseUkDate(dateLabel, um1[2]),
          status: "SCHEDULED",
          venue: "",
          competition: { name: "League One" },
          homeTeam: { id: null, name: "AFC Wimbledon", crest: "" },
          awayTeam: { id: null, name: cleanText(um1[1]), crest: "" },
          score: {
            home: null,
            away: null,
            fullTime: { home: null, away: null }
          }
        });
        continue;
      }

      if (um2) {
        fixtures.push({
          id: `fix-${dateLabel}-${um2[1]}-AFC Wimbledon`,
          utcDate: parseUkDate(dateLabel, um2[2]),
          status: "SCHEDULED",
          venue: "",
          competition: { name: "League One" },
          homeTeam: { id: null, name: cleanText(um2[1]), crest: "" },
          awayTeam: { id: null, name: "AFC Wimbledon", crest: "" },
          score: {
            home: null,
            away: null,
            fullTime: { home: null, away: null }
          }
        });
      }
    }

    return {
      next: fixtures.slice(0, 8),
      last: results.slice(0, 8)
    };
  }

  try {
    const [scoresFixturesRes, tableRes, rssRes] = await Promise.all([
      fetch("https://www.skysports.com/afc-wimbledon-scores-fixtures"),
      fetch("https://www.skysports.com/league-1-table"),
      fetch("https://feeds.bbci.co.uk/sport/football/rss.xml")
    ]);

    if (!scoresFixturesRes.ok) throw new Error(`Scores/fixtures request failed: ${scoresFixturesRes.status}`);
    if (!tableRes.ok) throw new Error(`League One table request failed: ${tableRes.status}`);
    if (!rssRes.ok) throw new Error(`RSS request failed: ${rssRes.status}`);

    const scoresFixturesHtml = await scoresFixturesRes.text();
    const tableHtml = await tableRes.text();
    const rssText = await rssRes.text();

    const { next, last } = parseSkyWimbledonMatches(scoresFixturesHtml);
    const standings = parseSkyLeagueOneTable(tableHtml);

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
      next,
      last,
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