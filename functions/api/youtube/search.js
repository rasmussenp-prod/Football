export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const team = (url.searchParams.get("team") || "").toLowerCase().trim();
  const rawQ = (url.searchParams.get("q") || "football highlights").trim();

  const API_KEY = context.env.YOUTUBE_API_KEY;

  if (!API_KEY) {
    return json(
      { error: "Missing YOUTUBE_API_KEY" },
      500
    );
  }

  // Sky Sports Premier League channel
  const SKY_SPORTS_PL_CHANNEL_ID = "UCNAf1k0yIjyGu3k9BwAg3lg";

  // Build a tight query plan.
  // For Spurs, prefer Sky Sports Premier League.
  // For Wimbledon, prefer Sky Sports Football phrasing but do not hard fail on channel restriction.
  const plans = buildPlans(team, rawQ, SKY_SPORTS_PL_CHANNEL_ID);

  try {
    for (const plan of plans) {
      const data = await youtubeSearch(API_KEY, plan);

      const items = Array.isArray(data?.items) ? data.items : [];
      if (items.length) {
        return json({
          items: dedupeByVideoId(items).slice(0, 8),
          sourceQuery: plan.q,
          sourceChannelId: plan.channelId || ""
        });
      }
    }

    return json({
      items: [],
      sourceQuery: rawQ,
      sourceChannelId: ""
    });
  } catch (err) {
    return json(
      {
        error: "YouTube fetch failed",
        detail: err?.message || String(err)
      },
      500
    );
  }
}

function buildPlans(team, rawQ, skySportsPLChannelId) {
  if (team === "tottenham") {
    return [
      {
        q: rawQ || "Tottenham Hotspur EPL",
        channelId: skySportsPLChannelId
      },
      {
        q: "Tottenham Hotspur EPL",
        channelId: skySportsPLChannelId
      },
      {
        q: "Tottenham Hotspur highlights",
        channelId: skySportsPLChannelId
      },
      {
        q: "Spurs highlights",
        channelId: skySportsPLChannelId
      },
      {
        q: "Tottenham Hotspur EPL",
        channelId: ""
      },
      {
        q: "Tottenham Hotspur highlights Sky Sports",
        channelId: ""
      }
    ];
  }

  if (team === "wimbledon") {
    return [
      {
        q: rawQ || "AFC Wimbledon highlights Sky Sports Football",
        channelId: ""
      },
      {
        q: "AFC Wimbledon highlights Sky Sports Football",
        channelId: ""
      },
      {
        q: "AFC Wimbledon League One highlights",
        channelId: ""
      },
      {
        q: "AFC Wimbledon highlights",
        channelId: ""
      }
    ];
  }

  return [
    { q: rawQ, channelId: "" },
    { q: `${rawQ} highlights`, channelId: "" },
    { q: "football highlights", channelId: "" }
  ];
}

async function youtubeSearch(apiKey, plan) {
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    maxResults: "8",
    q: plan.q,
    key: apiKey,
    order: "relevance",
    regionCode: "GB",
    relevanceLanguage: "en",
    videoEmbeddable: "true",
    videoSyndicated: "true",
    safeSearch: "none"
  });

  if (plan.channelId) {
    params.set("channelId", plan.channelId);
  }

  const endpoint = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
  const res = await fetch(endpoint, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.error?.message || `YouTube API error ${res.status}`);
  }

  return data;
}

function dedupeByVideoId(items) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const id = item?.id?.videoId || item?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }

  return out;
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