export async function onRequestGet() {
  const feedUrl = "https://feeds.bbci.co.uk/sport/football/rss.xml";

  try {
    const response = await fetch(feedUrl, {
      headers: {
        "user-agent": "FootballCommandCentre/1.0"
      }
    });

    if (!response.ok) {
      return json(
        { error: `The BBC feed request failed with status ${response.status}` },
        502,
        300
      );
    }

    const xml = await response.text();
    const items = parseItems(xml).slice(0, 40);

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
        error: "Could not fetch BBC football feed",
        detail: String(error)
      },
      500,
      60
    );
  }
}

function parseItems(xml) {
  const matches = xml.match(/<item[\s\S]*?<\/item>/g) || [];

  return matches
    .map((itemXml) => {
      return {
        title: decodeXml(getTagValue(itemXml, "title")),
        link: decodeXml(getTagValue(itemXml, "link")),
        description: stripHtml(decodeXml(getTagValue(itemXml, "description"))),
        pubDate: decodeXml(getTagValue(itemXml, "pubDate")),
        guid: decodeXml(getTagValue(itemXml, "guid"))
      };
    })
    .filter((item) => item.title && item.link);
}

function getTagValue(xml, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : "";
}

function stripHtml(text) {
  if (!text) return "";
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeXml(text) {
  if (!text) return "";

  return text
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, function (_, num) {
      return String.fromCharCode(Number(num));
    })
    .trim();
}

function json(data, status, cacheSeconds) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${cacheSeconds || 0}`
    }
  });
} 