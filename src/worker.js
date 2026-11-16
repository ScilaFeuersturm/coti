// Punto de entrada del Cloudflare Worker de Coti.
// - /api/*  → API (D1)
// - /p/*    → página pública del presupuesto (quote.html)
// - el resto lo sirve Cloudflare directo desde /public (ver "assets" en wrangler.jsonc)

import { createApiHandler, SECURITY_HEADERS } from "./app.js";

const handleApi = createApiHandler();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }

    if (url.pathname.startsWith("/p/")) {
      // Todas las URLs /p/<id> muestran la misma página; el id lo lee el JS de la página.
      const page = await env.ASSETS.fetch(new Request(new URL("/quote", url), { method: "GET" }));
      const res = new Response(page.body, page);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
      res.headers.set("X-Robots-Tag", "noindex");
      res.headers.set("Cache-Control", "no-cache");
      return res;
    }

    return env.ASSETS.fetch(request);
  }
};
