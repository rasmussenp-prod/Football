export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const q = (url.searchParams.get("q") || "football highlights").trim();
  const API_KEY = context.env.YOUTUBE_API_KEY;

  if (!API_KEY) {
    return json({ error: "Missing YOUTUBE_API_KEY" }, 500);
  }

  try {
    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      maxResults: "6",
      q,
      key: API_KEY,
      order: "relevance",
      regionCode: "GB",
      relevanceLanguage: "en",
      safeSearch: "none"
    });

    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const data = await res.json();

    if (!res.ok) {
      return json({
        error: "YouTube API error",
        detail: data?.error?.message || `Status ${res.status}`
      }, res.status);
    }

    return json({ items: Array.isArray(data.items) ? data.items : [] });
  } catch (error) {
    return json({
      error: "YouTube fetch failed",
      detail: error?.message || String(error)
    }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}