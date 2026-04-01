export async function onRequestGet(context) {
  const { env } = context;

  return new Response(JSON.stringify({
    hasKey: !!env.YOUTUBE_API_KEY,
    keyPreview: env.YOUTUBE_API_KEY
      ? env.YOUTUBE_API_KEY.slice(0, 6)
      : null
  }), {
    headers: { "content-type": "application/json" }
  });
} 