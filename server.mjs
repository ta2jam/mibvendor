import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_RELEASE, createApiHandler } from "./src/api.mjs";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(projectRoot, "prototype");
const openApiPath = path.join(projectRoot, "docs", "research", "demand", "phase0-openapi.json");
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

function isSpaRoute(pathname) {
  return spaRoutes.some((pattern) => pattern.test(pathname));
}

function staticCacheControl(requested) {
  const extension = path.extname(requested);
  if (requested === "index.html" || new Set([".css", ".js", ".mjs"]).has(extension)) return "no-cache";
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

export function createMibvendorServer() {
  const apiHandler = createApiHandler();
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
      if (request.method === "GET" && url.pathname === "/healthz") {
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        response.end("ok\n");
        return;
      }
      if (request.method === "GET" && url.pathname === "/version") {
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify({
          schema_version: 1,
          version: process.env.APP_VERSION ?? "development",
          commit: process.env.VCS_REF ?? "development",
          data_release: process.env.DATA_RELEASE ?? DATA_RELEASE
        }));
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
