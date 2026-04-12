export async function onRequest(context) {
  const API_KEY = context.env.FOOTBALL_DATA_KEY;
  const BASE = "https://api.football-data.org/v4";

  const headers = { "X-Auth-Token": API_KEY };

  try {
    const [teamRes, matchesRes, tableRes] = await Promise.all([
      fetch(`${BASE}/teams/73`, { headers }),
      fetch(`${BASE}/teams/73/matches?status=SCHEDULED,FINISHED`, { headers }),
      fetch(`${BASE}/competitions/PL/standings`, { headers })
    ]);

    const team = await teamRes.json();
    const matches = await matchesRes.json();
    const table = await tableRes.json();

    const allMatches = matches.matches || [];

    const now = new Date();

    const next = allMatches
      .filter(m => new Date(m.utcDate) > now)
      .slice(0, 5);

    const last = allMatches
      .filter(m => new Date(m.utcDate) <= now)
      .slice(-5)
      .reverse();

    const standings = table.standings?.[0]?.table || [];

    const teamRow = standings.find(t => t.team.id === 73);

    return new Response(JSON.stringify({
      team,
      next,
      last,
      standings,
      stats: {
        position: teamRow?.position || null,
        points: teamRow?.points || null,
        played: teamRow?.playedGames || null
      }
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}