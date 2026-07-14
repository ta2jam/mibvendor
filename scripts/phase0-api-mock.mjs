import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DATA_RELEASE,
  MAX_BATCH_SIZE,
  MAX_BODY_BYTES,
  MAX_OID_LENGTH,
  MAX_QUERY_LENGTH,
  createApiHandler
} from "../src/api.mjs";

export { DATA_RELEASE, MAX_BATCH_SIZE, MAX_BODY_BYTES, MAX_OID_LENGTH, MAX_QUERY_LENGTH };

export function createPhase0ApiMock() {
  const handler = createApiHandler();
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (request.method === "GET" && url.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ status: "ok", mode: "public-alpha" }));
      return;
    }
    if (await handler(request, response, url)) return;
    response.writeHead(404, { "content-type": "application/problem+json" });
    response.end(JSON.stringify({
      type: "https://mibvendor.io/problems/not-found",
      title: "Not found",
      status: 404,
      detail: "No public alpha route matches this request"
    }));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))) {
  const port = Number.parseInt(process.env.PORT ?? "4010", 10);
  createPhase0ApiMock().listen(port, "127.0.0.1", () => {
    console.log(`Public alpha API listening at http://127.0.0.1:${port}`);
  });
}
