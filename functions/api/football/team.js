export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const team = url.searchParams.get("team");

  if (!team) {
    return json({ error: "Missing team param" }, 400);
  }

  try {
    let endpoint = "";

    if (team === "tottenham") {
      endpoint = "/api/football/spurs";
    } else if (team === "wimbledon") {
      endpoint = "/api/football/wimbledon";
    } else {
      return json({ error: "Unknown team" }, 400);
    }

    const res = await fetch(new URL(endpoint, request.url));
    const data = await res.json();

    return json(data, 200, 30);
  } catch (err) {
    return json(
      {
        error: "Team endpoint failed",
        detail: String(err)
      },
      500,
      5
    );
  }
}

function json(data, status = 200, cacheSeconds = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${cacheSeconds}`
    }
  });
}