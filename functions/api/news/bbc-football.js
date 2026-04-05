export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const team = (url.searchParams.get("team") || "").toLowerCase();

  const feedUrl = "https://feeds.bbci.co.uk/sport/football/rss.xml";

  const teamTerms = {
    tottenham: [
      "tottenham",
      "spurs",
      "tottenham hotspur",
      "son heung-min",
      "postecoglou"
    ],
    wimbledon: [
      "afc wimbledon",
      "wimbledon",
      "the dons",
      "plough lane"
    ]
  };

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
    const allItems = parseItems(xml);

    let items = allItems;

    if (team && teamTerms[team]) {
      const terms = teamTerms[team];
      items = allItems.filter((item) => {
        const text = `${item.title} ${item.description}`.toLowerCase();
        return terms.some((term) => text.includes(term));
      });
    }

    return json(
      {
        source: "BBC Sport Football RSS",
        feed: feedUrl,
        team: team || null,
        itemCount: items.length,
        items: items.slice(0, 10)
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

function json(data, status = 200, cacheSeconds = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${cacheSeconds}`
    }
  });
}