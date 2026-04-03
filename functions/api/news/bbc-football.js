export async function onRequestGet() {
  const feedUrl = "https://feeds.bbci.co.uk/sport/football/rss.xml";

  try {
    const res = await fetch(feedUrl, {
      headers: {
        "user-agent": "FootballCommandCentre/1.0"
      }
    });

    if (!res.ok) {
      return json(
        { error: `BBC feed request failed with ${res.status}` },
        502,
        300
      );
    }

    const xml = await res.text();
    const items = parseRssItems(xml).slice(0, 40);

    return json(
      {
        source: "BBC Sport Football RSS",
        feed: feedUrl,
        itemCount: items.length,
        items
      },
      200,
      300
    );
  } catch (error) {
    return json(
      {
        error: "Could not fetch or parse BBC football feed",
        detail: error instanceof Error ? error.message : String(error)
      },
      500,
      60
    );
  }
}

function parseRssItems(xml) {
  const itemBlocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(m => m[0]);

  return itemBlocks.map(block => {
    const title = decodeXml(getTag(block, "title"));
    const link = decodeXml(getTag(block, "link"));
    const description = cleanDescription(decodeXml(getTag(block, "description")));
    const pubDate = decodeXml(getTag(block, "pubDate"));
    const guid = decodeXml(getTag(block, "guid"));

    return {
      title,
      link,
      description,
      pubDate,
      guid
    };
  }).filter(item => item.title && item.link);
}

function getTag(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? match[1].trim() : "";
}

function cleanDescription(input) {
  if (!input) return "";
  return input
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXml(input) {
  if (!input) return "";
  return input
    .replace(/<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .trim();
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