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

  // ✅ convert "Saturday 12 April 3:00pm" → ISO
  function toISODate(dateStr = "", timeStr = "15:00") {
    try {
      const full = `${dateStr} ${timeStr}`.replace(/\./g, ":");
      const d = new Date(full);
      return isNaN(d) ? new Date().toISOString() : d.toISOString();
    } catch {
      return new Date().toISOString();
    }
  }

  function parseSkyMatches(html) {
    const items = [];
    const blocks = html.split(/(?=View fixture)/g);

    for (const block of blocks) {
      if (!block.includes("AFC Wimbledon")) continue;

      const dateMatch = block.match(/([A-Za-z]+ \d{1,2} [A-Za-z]+)/);
      const date = dateMatch ? dateMatch[1] : "";

      const resultMatch =
        block.match(/(.+?) (\d+) AFC Wimbledon (\d+)/) ||
        block.match(/AFC Wimbledon (\d+) (.+?) (\d+)/);

      if (resultMatch) {
        let home, away, hs, as;

        if (resultMatch[0].startsWith("AFC Wimbledon")) {
          home = "AFC Wimbledon";
          hs = Number(resultMatch[1]);
          away = resultMatch[2];
          as = Number(resultMatch[3]);
        } else {
          home = resultMatch[1];
          hs = Number(resultMatch[2]);
          away = "AFC Wimbledon";
          as = Number(resultMatch[3]);
        }

        items.push({
          id: `${home}-${away}-${date}`,
          utcDate: toISODate(date, "15:00"),
          status: "FINISHED",
          competition: { name: "League One" },
          homeTeam: { name: home, crest: "" },
          awayTeam: { name: away, crest: "" },
          score: {
            home: hs,
            away: as,
            fullTime: { home: hs, away: as }
          }
        });

        continue;
      }

      const upcomingMatch =
        block.match(/AFC Wimbledon are scheduled to play (.+?) .*?(\d{1,2}[:.]\d{2}[ap]m)/i) ||
        block.match(/(.+?) are scheduled to play AFC Wimbledon .*?(\d{1,2}[:.]\d{2}[ap]m)/i);

      if (upcomingMatch) {
        let home = "AFC Wimbledon";
        let away = upcomingMatch[1];
        let time = upcomingMatch[2];

        if (block.includes("play AFC Wimbledon")) {
          home = upcomingMatch[1];
          away = "AFC Wimbledon";
        }

        items.push({
          id: `${home}-${away}-${date}`,
          utcDate: toISODate(date, time),
          status: "SCHEDULED",
          competition: { name: "League One" },
          homeTeam: { name: home, crest: "" },
          awayTeam: { name: away, crest: "" },
          score: {
            home: null,
            away: null,
            fullTime: { home: null, away: null }
          }
        });
      }
    }

    return items;
  }

  function parseTable(html) {
    const rows = [];
    const start = html.indexOf("Sky Bet League One Table");
    if (start === -1) return [];

    const section = html.slice(start, start + 30000);

    const regex = /(\d+)\s+([A-Za-z .'-]+)\s+(\d+)\s+(\d+)/g;

    let m;
    while ((m = regex.exec(section))) {
      rows.push({
        position: Number(m[1]),
        team: { name: m[2], crest: "" },
        playedGames: Number(m[3]),
        points: Number(m[4])
      });
    }

    return rows;
  }

  function parseRSS(xml) {
    return (xml.match(/<item>([\s\S]*?)<\/item>/g) || []).map(item => ({
      title: cleanText(item.match(/<title>(.*?)<\/title>/)?.[1] || ""),
      link: cleanText(item.match(/<link>(.*?)<\/link>/)?.[1] || ""),
      description: cleanText(item.match(/<description>(.*?)<\/description>/)?.[1] || ""),
      thumbnail: item.match(/url="([^"]+)"/)?.[1] || ""
    }));
  }

  try {
    const [matchesRes, tableRes, rssRes] = await Promise.all([
      fetch("https://www.skysports.com/afc-wimbledon-scores-fixtures"),
      fetch("https://www.skysports.com/league-1-table"),
      fetch("https://feeds.bbci.co.uk/sport/football/rss.xml")
    ]);

    const matchesHtml = await matchesRes.text();
    const tableHtml = await tableRes.text();
    const rssText = await rssRes.text();

    const matches = parseSkyMatches(matchesHtml);
    const standings = parseTable(tableHtml);

    const next = matches.filter(m => m.status === "SCHEDULED").slice(0, 6);
    const last = matches.filter(m => m.status === "FINISHED").slice(0, 6);

    const teamRow = standings.find(r =>
      r.team.name.toLowerCase().includes("wimbledon")
    );

    return new Response(JSON.stringify({
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
        position: teamRow?.position || null,
        points: teamRow?.points || null,
        played: teamRow?.playedGames || null
      },
      news: parseRSS(rssText).slice(0, 6)
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: "Wimbledon failed",
      detail: error.message
    }), { status: 500 });
  }
}