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
    const filtered = items.filter((item) => {
      const text = `${item.title} ${item.description}`.toLowerCase();
      return terms.some((term) => text.includes(term));
    });
    return filtered.length ? filtered : items;
  }

  function normaliseTeamName(name = "") {
    return cleanText(name)
      .toLowerCase()
      .replace(/^afc\s+/, "")
      .replace(/\s+fc$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseSkyLeagueOneTable(html) {
    const start = html.indexOf("Sky Bet League One Table");
    if (start === -1) return [];

    const endCandidates = [
      html.indexOf("##### Key", start),
      html.indexOf("Promotion:", start),
      html.indexOf("Partners", start),
      html.indexOf("Watch Sky Sports", start)
    ].filter((n) => n !== -1);

    const end = endCandidates.length ? Math.min(...endCandidates) : start + 40000;
    const section = html.slice(start, end);

    const rows = [];
    const rowRegex = /(\d+)\s+(?:Image\s+)?([A-Za-z0-9 .'\-&]+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([+-]?\d+)\s+(\d+)/g;

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
    const fixtures = [];
    const sections = html.split(/(?=###\s+Sky Bet League One)/g);

    for (const section of sections) {
      if (!section.includes("AFC Wimbledon")) continue;

      const dateHeaderMatch = section.match(/##\s+([A-Za-z]+\s+\d{1,2}[a-z]{0,2}\s+[A-Za-z]+)/i);
      const sectionDateLabel = dateHeaderMatch ? cleanText(dateHeaderMatch[1]) : "";

      const fixtureMatch =
        section.match(/View fixture\s+(.+?)\s+(\d+)\s+AFC Wimbledon\s+(\d+)\s+FT/i) ||
        section.match(/View fixture\s+AFC Wimbledon\s+(\d+)\s+(.+?)\s+(\d+)\s+FT/i) ||
        section.match(/([A-Za-z0-9 .'\-&]+)\s+(\d+)\.\s*AFC Wimbledon,\s*(\d+)\.\s*Full time\./i) ||
        section.match(/AFC Wimbledon,\s*(\d+)\.\s*([A-Za-z0-9 .'\-&]+)\s+(\d+)\.\s*Full time\./i);

      const upcomingMatch =
        section.match(/View fixture\s+AFC Wimbledon are scheduled to play\s+(.+?)\s+\.\s+(\d{1,2}\.\d{2}[ap]m)/i) ||
        section.match(/View fixture\s+(.+?)\s+are scheduled to play\s+AFC Wimbledon\s+\.\s+(\d{1,2}\.\d{2}[ap]m)/i) ||
        section.match(/AFC Wimbledon vs (.+?)\. Kick-off at (\d{1,2}:\d{2}[ap]m)/i) ||
        section.match(/(.+?) vs AFC Wimbledon\. Kick-off at (\d{1,2}:\d{2}[ap]m)/i);

      if (fixtureMatch) {
        let homeTeam = "";
        let awayTeam = "";
        let homeScore = null;
        let awayScore = null;

        if (fixtureMatch[0].includes("View fixture") && fixtureMatch[0].includes("AFC Wimbledon")) {
          if (/View fixture\s+(.+?)\s+(\d+)\s+AFC Wimbledon\s+(\d+)\s+FT/i.test(fixtureMatch[0])) {
            homeTeam = cleanText(fixtureMatch[1]);
            homeScore = Number(fixtureMatch[2]);
            awayTeam = "AFC Wimbledon";
            awayScore = Number(fixtureMatch[3]);
          } else {
            homeTeam = "AFC Wimbledon";
            homeScore = Number(fixtureMatch[1]);
            awayTeam = cleanText(fixtureMatch[2]);
            awayScore = Number(fixtureMatch[3]);
          }
        } else {
          if (fixtureMatch[0].startsWith("AFC Wimbledon")) {
            homeTeam = "AFC Wimbledon";
            homeScore = Number(fixtureMatch[1]);
            awayTeam = cleanText(fixtureMatch[2]);
            awayScore = Number(fixtureMatch[3]);
          } else {
            homeTeam = cleanText(fixtureMatch[1]);
            homeScore = Number(fixtureMatch[2]);
            awayTeam = "AFC Wimbledon";
            awayScore = Number(fixtureMatch[3]);
          }
        }

        fixtures.push({
          id: `res-${sectionDateLabel}-${homeTeam}-${awayTeam}`,
          utcDate: sectionDateLabel || null,
          status: "FINISHED",
          venue: "",
          competition: { name: "League One" },
          homeTeam: { id: null, name: homeTeam, crest: "" },
          awayTeam: { id: null, name: awayTeam, crest: "" },
          score: {
            home: homeScore,
            away: awayScore,
            fullTime: { home: homeScore, away: awayScore }
          }
        });

        continue;
      }

      if (upcomingMatch) {
        let homeTeam = "";
        let awayTeam = "";
        let kickOff = cleanText(upcomingMatch[2] || "");

        if (upcomingMatch[0].includes("AFC Wimbledon are scheduled to play")) {
          homeTeam = "AFC Wimbledon";
          awayTeam = cleanText(upcomingMatch[1]);
        } else if (upcomingMatch[0].includes("scheduled to play AFC Wimbledon")) {
          homeTeam = cleanText(upcomingMatch[1]);
          awayTeam = "AFC Wimbledon";
        } else if (upcomingMatch[0].startsWith("AFC Wimbledon vs")) {
          homeTeam = "AFC Wimbledon";
          awayTeam = cleanText(upcomingMatch[1]);
        } else {
          homeTeam = cleanText(upcomingMatch[1]);
          awayTeam = "AFC Wimbledon";
        }

        fixtures.push({
          id: `fix-${sectionDateLabel}-${homeTeam}-${awayTeam}`,
          utcDate: sectionDateLabel || null,
          status: "SCHEDULED",
          venue: "",
          competition: { name: "League One" },
          homeTeam: { id: null, name: homeTeam, crest: "" },
          awayTeam: { id: null, name: awayTeam, crest: "" },
          score: {
            home: null,
            away: null,
            fullTime: { home: null, away: null }
          },
          kickOff
        });
      }
    }

    return fixtures;
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

    const parsedMatches = parseSkyWimbledonMatches(scoresFixturesHtml);
    const standings = parseSkyLeagueOneTable(tableHtml);

    const next = parsedMatches.filter((m) => m.status === "SCHEDULED").slice(0, 8);
    const last = parsedMatches.filter((m) => m.status === "FINISHED").slice(0, 8);

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