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

  function stripHtmlToText(html = "") {
    return cleanText(
      String(html)
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
    );
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

  function monthIndex(name = "") {
    const months = {
      january: 0,
      february: 1,
      march: 2,
      april: 3,
      may: 4,
      june: 5,
      july: 6,
      august: 7,
      september: 8,
      october: 9,
      november: 10,
      december: 11
    };
    return months[String(name).toLowerCase()] ?? 0;
  }

  function toIsoFromUkLabel(dateLabel = "", timeLabel = "15:00") {
    const m = String(dateLabel).match(
      /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)/i
    );
    if (!m) return null;

    const day = Number(m[2]);
    const month = monthIndex(m[3]);
    const now = new Date();
    let year = now.getUTCFullYear();

    let hours = 15;
    let minutes = 0;

    const t = String(timeLabel).trim().toLowerCase().replace(/\./g, ":");
    const tm = t.match(/(\d{1,2}):(\d{2})(am|pm)?/i);
    if (tm) {
      hours = Number(tm[1]);
      minutes = Number(tm[2]);
      const mer = tm[3];
      if (mer === "pm" && hours < 12) hours += 12;
      if (mer === "am" && hours === 12) hours = 0;
    }

    let d = new Date(Date.UTC(year, month, day, hours, minutes, 0));

    if (d.getTime() < now.getTime() - 1000 * 60 * 60 * 24 * 180) {
      d = new Date(Date.UTC(year + 1, month, day, hours, minutes, 0));
    }

    return d.toISOString();
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
    const text = stripHtmlToText(html);
    const start = text.indexOf("Sky Bet League One Table");
    if (start === -1) return [];

    const section = text.slice(start, start + 12000);
    const rows = [];

    const knownTeams = [
      "Lincoln City",
      "Cardiff City",
      "Blackpool",
      "Bolton Wanderers",
      "Barnsley",
      "Reading",
      "Huddersfield Town",
      "AFC Wimbledon",
      "Stockport County",
      "Luton Town",
      "Burton Albion",
      "Wigan Athletic",
      "Plymouth Argyle",
      "Charlton Athletic",
      "Peterborough United",
      "Wycombe Wanderers",
      "Port Vale",
      "Leyton Orient",
      "Bristol Rovers",
      "Rotherham United",
      "Northampton Town",
      "Exeter City",
      "Mansfield Town",
      "Stevenage",
      "Shrewsbury Town",
      "Cambridge United",
      "Wrexham",
      "Crawley Town",
      "Birmingham City",
      "Blackburn Rovers"
    ];

    for (const teamName of knownTeams) {
      const escapedTeam = teamName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rowRegex = new RegExp(
        `(\\d+)\\s+${escapedTeam}\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+([+-]?\\d+)\\s+(\\d+)`,
        "i"
      );
      const match = section.match(rowRegex);

      if (match) {
        const position = Number(match[1]);
        const playedGames = Number(match[2]);
        const won = Number(match[3]);
        const draw = Number(match[4]);
        const lost = Number(match[5]);
        const goalsFor = Number(match[6]);
        const goalsAgainst = Number(match[7]);
        const goalDifference = Number(match[8]);
        const points = Number(match[9]);

        if (
          !Number.isNaN(position) &&
          !Number.isNaN(playedGames) &&
          !Number.isNaN(points)
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
    }

    rows.sort((a, b) => a.position - b.position);
    return rows;
  }

  function parseSkyWimbledonMatches(html) {
    const text = stripHtmlToText(html);
    const next = [];
    const last = [];

    const dateBlockRegex =
      /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+[\s\S]*?(?=(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+|$)/gi;

    let block;
    while ((block = dateBlockRegex.exec(text)) !== null) {
      const chunk = block[0];
      const dateMatch = chunk.match(
        /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+/i
      );
      const currentDate = dateMatch ? cleanText(dateMatch[0]) : "";

      if (!chunk.includes("AFC Wimbledon")) continue;
      if (!chunk.includes("Sky Bet League One")) continue;

      let m = chunk.match(/([A-Za-z0-9 .'\-&]+),\s*(\d+)\.\s*AFC Wimbledon,\s*(\d+)\.\s*Full time\./i);
      if (m) {
        last.push({
          id: `res-${currentDate}-${cleanText(m[1])}-AFC Wimbledon`,
          utcDate: toIsoFromUkLabel(currentDate, "15:00"),
          status: "FINISHED",
          venue: "",
          competition: { name: "League One" },
          homeTeam: { id: null, name: cleanText(m[1]), crest: "" },
          awayTeam: { id: null, name: "AFC Wimbledon", crest: "" },
          score: {
            home: Number(m[2]),
            away: Number(m[3]),
            fullTime: { home: Number(m[2]), away: Number(m[3]) }
          }
        });
        continue;
      }

      m = chunk.match(/AFC Wimbledon,\s*(\d+)\.\s*([A-Za-z0-9 .'\-&]+),\s*(\d+)\.\s*Full time\./i);
      if (m) {
        last.push({
          id: `res-${currentDate}-AFC Wimbledon-${cleanText(m[2])}`,
          utcDate: toIsoFromUkLabel(currentDate, "15:00"),
          status: "FINISHED",
          venue: "",
          competition: { name: "League One" },
          homeTeam: { id: null, name: "AFC Wimbledon", crest: "" },
          awayTeam: { id: null, name: cleanText(m[2]), crest: "" },
          score: {
            home: Number(m[1]),
            away: Number(m[3]),
            fullTime: { home: Number(m[1]), away: Number(m[3]) }
          }
        });
        continue;
      }

      m = chunk.match(/AFC Wimbledon vs ([A-Za-z0-9 .'\-&]+)\.\s*Kick-off at (\d{1,2}:\d{2}[ap]m)/i);
      if (m) {
        next.push({
          id: `fix-${currentDate}-AFC Wimbledon-${cleanText(m[1])}`,
          utcDate: toIsoFromUkLabel(currentDate, m[2]),
          status: "SCHEDULED",
          venue: "",
          competition: { name: "League One" },
          homeTeam: { id: null, name: "AFC Wimbledon", crest: "" },
          awayTeam: { id: null, name: cleanText(m[1]), crest: "" },
          score: {
            home: null,
            away: null,
            fullTime: { home: null, away: null }
          }
        });
        continue;
      }

      m = chunk.match(/([A-Za-z0-9 .'\-&]+) vs AFC Wimbledon\.\s*Kick-off at (\d{1,2}:\d{2}[ap]m)/i);
      if (m) {
        next.push({
          id: `fix-${currentDate}-${cleanText(m[1])}-AFC Wimbledon`,
          utcDate: toIsoFromUkLabel(currentDate, m[2]),
          status: "SCHEDULED",
          venue: "",
          competition: { name: "League One" },
          homeTeam: { id: null, name: cleanText(m[1]), crest: "" },
          awayTeam: { id: null, name: "AFC Wimbledon", crest: "" },
          score: {
            home: null,
            away: null,
            fullTime: { home: null, away: null }
          }
        });
      }
    }

    return { next: next.slice(0, 8), last: last.slice(0, 8) };
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
    const teamRow =
      standings.find((row) =>
        ["wimbledon", "afc wimbledon"].includes(normaliseTeamName(row.team?.name))
      ) || null;

    const news = filterWimbledonNews(parseRSS(rssText)).slice(0, 8);

    return new Response(JSON.stringify({
      team: {
        id: TEAM_ID,
        name: "AFC Wimbledon",
        shortName: "Wimbledon",
        tla: "AWF",
        crest: ""
      },
      next: parsedMatches.next,
      last: parsedMatches.last,
      standings,
      stats: {
        position: teamRow?.position ?? null,
        points: teamRow?.points ?? null,
        played: teamRow?.playedGames ?? null,
        playedGames: teamRow?.playedGames ?? null
      },
      news
    }), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: "Could not load Wimbledon data",
      detail: error.message
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  }
}