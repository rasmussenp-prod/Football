export async function onRequest(context) {
  const BASE = "https://api.football-data.org/v4";
  const headers = { "X-Auth-Token": context.env.FOOTBALL_DATA_KEY };

  try {
    const [matchesRes, tableRes, newsRes] = await Promise.all([
      fetch(`${BASE}/teams/1044/matches?status=SCHEDULED,FINISHED`, { headers }),
      fetch(`${BASE}/competitions/FL1/standings`, { headers }),
      fetch("https://feeds.bbci.co.uk/sport/football/rss.xml")
    ]);

    const matches = await matchesRes.json();
    const table = await tableRes.json();
    const newsXML = await newsRes.text();

    const parser = new DOMParser();
    const xml = parser.parseFromString(newsXML, "text/xml");

    const items = [...xml.querySelectorAll("item")].slice(0, 20).map(item => ({
      title: item.querySelector("title")?.textContent,
      link: item.querySelector("link")?.textContent,
      pubDate: item.querySelector("pubDate")?.textContent
    }));

    const allMatches = matches.matches || [];
    const now = new Date();

    const next = allMatches.filter(m => new Date(m.utcDate) > now).slice(0, 5);
    const last = allMatches.filter(m => new Date(m.utcDate) <= now).slice(-5).reverse();

    const standings = table.standings?.[0]?.table || [];
    const teamRow = standings.find(t => t.team.id === 1044);

    return new Response(JSON.stringify({
      next,
      last,
      standings,
      news: items,
      stats: {
        position: teamRow?.position,
        points: teamRow?.points,
        played: teamRow?.playedGames
      }
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}