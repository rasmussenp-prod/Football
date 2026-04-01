export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const q = url.searchParams.get("q");
  if (!q) {
    return json({ error: "Missing q" }, 400);
  }

  const upstream = new URL("https://www.googleapis.com/youtube/v3/search");
  upstream.searchParams.set("part", "snippet");
  upstream.searchParams.set("type", "video");
  upstream.searchParams.set("maxResults", "3");
  upstream.searchParams.set("order", "relevance");
  upstream.searchParams.set("q", q);
  upstream.searchParams.set("regionCode", "GB");
  upstream.searchParams.set("relevanceLanguage", "en");
  upstream.searchParams.set("safeSearch", "strict");
  upstream.searchParams.set("key", env.YOUTUBE_API_KEY);

  const res = await fetch(upstream.toString());
  const data = await res.json();

  return json(data, res.status, 21600);
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