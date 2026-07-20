import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_RELEASE, createApiHandler, setNormalizedRateLimitClient } from "./src/api.mjs";
import { IDENTITY_PUBLICATION_STATE, IDENTITY_RELEASE, IDENTITY_STATISTICS } from "./src/intelligence.mjs";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(projectRoot, "prototype");
const openApiPath = path.join(projectRoot, "docs", "research", "demand", "phase0-openapi.json");
const productionMonitorUrl = "https://github.com/ta2jam/mibvendor/actions/workflows/production-monitor.yml";
const htmlShellCacheControl = "public, max-age=0, must-revalidate, no-transform";
const trustProxyHeadersByDefault = process.env.TRUST_PROXY_HEADERS === "1";
const configuredTrustedProxyAddresses = new Set((process.env.TRUSTED_PROXY_ADDRESSES ?? "")
  .split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"]
]);

const spaRoutes = [
  /^\/search$/,
  /^\/objects\/[A-Za-z0-9][A-Za-z0-9._-]{0,511}$/,
  /^\/modules\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,
  /^\/enterprises\/[0-9]{1,10}$/,
  /^\/sys-object-ids\/[0-9.]{1,512}$/,
  /^\/releases\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
];

function headerValue(request, name) {
  const value = request.headers[name];
  return typeof value === "string" && !value.includes(",") ? value.trim() : null;
}

function isTrustedProxyHop(address) {
  if (!address) return false;
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (configuredTrustedProxyAddresses.has(address.toLowerCase()) || configuredTrustedProxyAddresses.has(normalized)) return true;
  if (normalized === "::1") return true;
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return isIP(address) === 6 && (/^f[cd]/.test(address.toLowerCase()) || address.toLowerCase().startsWith("fe80:"));
}

function normalizedRateLimitClient(request, trustProxyHeaders) {
  const peer = request.socket.remoteAddress ?? "unknown";
  const cloudflareClient = headerValue(request, "cf-connecting-ip");
  const proxyClient = headerValue(request, "x-real-ip");
  if (trustProxyHeaders && isTrustedProxyHop(peer) && cloudflareClient && proxyClient?.toLowerCase() === cloudflareClient.toLowerCase() && isIP(cloudflareClient)) {
    return `cf:${cloudflareClient.toLowerCase()}`;
  }
  return `peer:${peer.toLowerCase()}`;
}

function isSpaRoute(pathname) {
  return spaRoutes.some((pattern) => pattern.test(pathname));
}

function staticCacheControl(requested) {
  const extension = path.extname(requested);
  if (requested === "index.html") return htmlShellCacheControl;
  if (new Set([".css", ".js", ".mjs"]).has(extension)) return "no-cache";
  return "public, max-age=300, must-revalidate";
}

function serveStatic(request, response, url) {
  if (!new Set(["GET", "HEAD"]).has(request.method)) {
    response.writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" });
    response.end("Method not allowed\n");
    return;
  }
  const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  if (!requested || requested.startsWith(".") || requested.split("/").some((part) => part.startsWith("."))) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found\n");
    return;
  }
  const absolute = path.resolve(root, requested);
  if (!absolute.startsWith(`${root}${path.sep}`)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found\n");
    return;
  }
  try {
    const stat = statSync(absolute);
    if (!stat.isFile()) throw new Error("not a file");
    response.writeHead(200, {
      "content-type": contentTypes.get(path.extname(absolute)) ?? "application/octet-stream",
      "content-length": stat.size,
      "cache-control": staticCacheControl(requested),
      "x-content-type-options": "nosniff"
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(absolute).pipe(response);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found\n");
  }
}

function serveOpenApi(request, response) {
  try {
    const stat = statSync(openApiPath);
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-length": stat.size,
      "cache-control": "public, max-age=300, must-revalidate",
      "x-content-type-options": "nosniff"
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(openApiPath).pipe(response);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found\n");
  }
}

function serveStatus(request, response) {
  if (!new Set(["GET", "HEAD"]).has(request.method)) {
    response.writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end("Method not allowed\n");
    return;
  }
  const payload = Buffer.from(`${JSON.stringify({
    schema_version: 1,
    status: "operational",
    checked_at: new Date().toISOString(),
    version: process.env.APP_VERSION ?? "development",
    commit: process.env.VCS_REF ?? "development",
    data_release: process.env.DATA_RELEASE ?? DATA_RELEASE,
    identity_release: process.env.IDENTITY_RELEASE ?? IDENTITY_RELEASE,
    identity_publication: IDENTITY_PUBLICATION_STATE,
    identity_statistics: IDENTITY_STATISTICS,
    scope: "Live process self-check only; no uptime SLA or incident history.",
    links: {
      health: "/healthz",
      production_monitor: productionMonitorUrl
    }
  })}\n`);
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  if (request.method === "HEAD") response.end();
  else response.end(payload);
}

function serveVersion(request, response) {
  if (!new Set(["GET", "HEAD"]).has(request.method)) {
    response.writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end("Method not allowed\n");
    return;
  }
  const payload = Buffer.from(`${JSON.stringify({
    schema_version: 1,
    version: process.env.APP_VERSION ?? "development",
    commit: process.env.VCS_REF ?? "development",
    data_release: process.env.DATA_RELEASE ?? DATA_RELEASE,
    identity_release: process.env.IDENTITY_RELEASE ?? IDENTITY_RELEASE,
    identity_publication: IDENTITY_PUBLICATION_STATE,
    identity_statistics: IDENTITY_STATISTICS
  })}\n`);
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  if (request.method === "HEAD") response.end();
  else response.end(payload);
}

export function createMibvendorServer({ trustProxyHeaders = trustProxyHeadersByDefault } = {}) {
  const apiHandler = createApiHandler();
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
      setNormalizedRateLimitClient(request, normalizedRateLimitClient(request, trustProxyHeaders));
      if (request.method === "GET" && url.pathname === "/healthz") {
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        response.end("ok\n");
        return;
      }
      if (url.pathname === "/version") {
        serveVersion(request, response);
        return;
      }
      if (url.pathname === "/status") {
        serveStatus(request, response);
        return;
      }
      if (new Set(["GET", "HEAD"]).has(request.method) && url.pathname === "/openapi.json") {
        serveOpenApi(request, response);
        return;
      }
      if (await apiHandler(request, response, url)) return;
      if (new Set(["GET", "HEAD"]).has(request.method) && isSpaRoute(url.pathname)) {
        serveStatic(request, response, { pathname: "/" });
        return;
      }
      serveStatic(request, response, url);
    } catch {
      if (response.headersSent) response.destroy();
      else {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        response.end("Bad request\n");
      }
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number.parseInt(process.env.PORT ?? "8080", 10);
  createMibvendorServer().listen(port, "0.0.0.0", () => {
    console.log(`mibvendor listening on 0.0.0.0:${port}`);
  });
}
