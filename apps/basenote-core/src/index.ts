import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { readLocalConfig } from "./config.js";

const config = readLocalConfig();

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? config.host}`);

  if (request.method === "GET" && url.pathname === "/healthz") {
    return sendJson(response, 200, {
      mode: config.mode,
      shopifyIntegration: false,
      status: "ok",
    });
  }

  if (url.pathname === "/" && request.method === "GET") {
    return sendJson(response, 200, {
      message: "Base Note Core local-only foundation",
      nextStep: "Read apps/basenote-core/README.md before connecting Shopify.",
      shopifyIntegration: false,
    });
  }

  if (isReservedShopifyPath(url.pathname)) {
    return sendJson(response, 503, {
      error: "local_only",
      message: "Shopify-facing routes are disabled until the documented production gates are complete.",
    });
  }

  return sendJson(response, 404, { error: "not_found" });
});

server.listen(config.port, config.host, () => {
  process.stdout.write(`Base Note Core local-only server listening on http://${config.host}:${config.port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

function isReservedShopifyPath(pathname: string): boolean {
  return pathname.startsWith("/apps/") || pathname.startsWith("/auth") || pathname.startsWith("/webhooks/");
}

function sendJson(response: ServerResponse<IncomingMessage>, status: number, body: unknown): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}
