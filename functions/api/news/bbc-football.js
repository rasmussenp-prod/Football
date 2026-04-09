export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const team = url.searchParams.get("team") || "";

  const RSS_URL = "https://feeds.bbci.co.uk/sport/football/rss.xml";

  try {
    const res = await fetch(RSS_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    const xml = await res.text();

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(match => {
      const item = match[1];

      const getTag = (tag) => {
        const m = item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
        return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
      };

      // 🖼️ IMAGE EXTRACTION (important)
      const mediaThumb = item.match(/<media:thumbnail[^>]*url="([^"]+)"/);
      const mediaContent = item.match(/<media:content[^>]*url="([^"]+)"/);
      const enclosure = item.match(/<enclosure[^>]*url="([^"]+)"/);

      const image =
        mediaThumb?.[1] ||
        mediaContent?.[1] ||
        enclosure?.[1] ||
        "";

      return {
        title: getTag("title"),
        link: getTag("link"),
        pubDate: getTag("pubDate"),
        description: getTag("description"),
        image
      };
    });

    return new Response(JSON.stringify({ items }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      error: "BBC fetch failed",
      detail: err.message
    }), { status: 500 });
  }
}