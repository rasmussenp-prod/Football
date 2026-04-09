export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const q = url.searchParams.get("q") || "football highlights";

  const API_KEY = context.env.YOUTUBE_API_KEY;

  if (!API_KEY) {
    return new Response(JSON.stringify({
      error: "Missing YOUTUBE_API_KEY"
    }), { status: 500 });
  }

  // 🔁 Strong fallback queries
  const queries = [
    q,
    `${q} sky sports`,
    `${q} highlights`,
    "tottenham highlights sky sports",
    "football highlights sky sports"
  ];

  try {
    for (const query of queries) {
      const ytUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=6&q=${encodeURIComponent(query)}&key=${API_KEY}`;

      const res = await fetch(ytUrl);
      const data = await res.json();

      if (data.items && data.items.length) {
        return new Response(JSON.stringify({ items: data.items }), {
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // fallback empty
    return new Response(JSON.stringify({ items: [] }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      error: "YouTube fetch failed",
      detail: err.message
    }), { status: 500 });
  }
}