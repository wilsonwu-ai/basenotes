// basenote-media: static asset CDN for blog images/video (Cloudflare Workers Static Assets).
// Files under ./public are served at https://basenote-media.<account>.workers.dev/<path>.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("basenote-media ok", { headers: { "content-type": "text/plain" } });
    }
    const res = await env.ASSETS.fetch(request);
    if (res.status === 200) {
      const h = new Headers(res.headers);
      h.set("cache-control", "public, max-age=31536000, immutable");
      h.set("access-control-allow-origin", "*");
      return new Response(res.body, { status: 200, headers: h });
    }
    return res;
  },
};
