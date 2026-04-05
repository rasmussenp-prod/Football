export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const q = url.searchParams.get("q");
  if (!q) {
    return json({ error: "Missing q" }, 400);
  }

  try {
    const upstream = new URL("https://www.googleapis.com/youtube/v3/search");
    upstream.searchParams.set("part", "snippet");
    upstream.searchParams.set("type", "video");
    upstream.searchParams.set("order", "date");
    upstream.searchParams.set("maxResults", "4");
    upstream.searchParams.set("q", q);
    upstream.searchParams.set("key", env.YOUTUBE_API_KEY);

    const res = await fetch(upstream.toString());
    const data = await res.json();

    return json(data, res.status);
  } catch (error) {
    return json(
      {
        error: "Could not load YouTube search results",
        detail: String(error)
      },
      500
    );
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}