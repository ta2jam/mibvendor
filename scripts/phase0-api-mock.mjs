import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

import { records } from "../prototype/data.mjs";
import { resolveOid, searchRecords } from "../prototype/core.mjs";

export const DATA_RELEASE = "phase0-synthetic-1";
export const MAX_BATCH_SIZE = 1_000;
const MAX_BODY_BYTES = 64 * 1024;

function stableId(record) {
  return `${record.module.toLowerCase()}--${record.symbol.toLowerCase()}`;
}

function publicObject(record) {
  return {
    id: stableId(record),
    module: record.module,
    symbol: record.symbol,
    oid: record.oid,
    kind: record.kind,
    syntax: record.syntax,
    access: record.access,
    revision: record.revision,
    semantics: {
      table: record.table,
      index: record.index
    },
    provenance: {
      source: record.source,
      source_url: record.sourceUrl,
      publication_status: "prototype_only",
      rights_tier: "Q",
      scopes: []
    }
  };
}

function writeJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "content-type": status >= 400 ? "application/problem+json" : "application/json",
    "cache-control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(body));
}

function problem(response, status, type, title, detail) {
  writeJson(response, status, { type, title, status, detail });
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new RangeError("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function matchObject(pathname) {
  const match = pathname.match(/^\/v1\/objects\/([^/]+)$/);
  if (!match) return null;
  return records.find((record) => stableId(record) === decodeURIComponent(match[1])) ?? null;
}

export function createPhase0ApiMock() {
  return createServer(async (request, response) => {
    const base = `http://${request.headers.host ?? "127.0.0.1"}`;
    const url = new URL(request.url ?? "/", base);

    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, { status: "ok", mode: "phase0-synthetic" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/data-release") {
      writeJson(response, 200, {
        data_release: DATA_RELEASE,
        status: "synthetic",
        production_data: false,
        object_count: records.length
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/resolve:batch") {
      try {
        const body = await readJson(request);
        if (!body || !Array.isArray(body.oids)) {
          problem(response, 422, "https://mibvendor.io/problems/invalid-batch", "Invalid batch", "oids must be an array");
          return;
        }
        if (body.oids.length > MAX_BATCH_SIZE) {
          problem(response, 413, "https://mibvendor.io/problems/batch-too-large", "Batch too large", `Maximum ${MAX_BATCH_SIZE} OIDs`);
          return;
        }

        const results = body.oids.map((input) => {
          const resolved = resolveOid(input, records);
          if (!resolved) return { input, status: "invalid" };
          if (!resolved.record) return { input, status: "not_found" };
          return {
            input,
            status: "resolved",
            object: publicObject(resolved.record),
            instance_suffix: resolved.instance
          };
        });
        writeJson(response, 200, { data_release: DATA_RELEASE, results });
      } catch (error) {
        if (error instanceof RangeError) {
          problem(response, 413, "https://mibvendor.io/problems/body-too-large", "Body too large", error.message);
        } else {
          problem(response, 400, "https://mibvendor.io/problems/invalid-json", "Invalid JSON", "Request body must be valid JSON");
        }
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/search") {
      const query = url.searchParams.get("q") ?? "";
      const results = searchRecords(query, records).slice(0, 20).map(publicObject);
      writeJson(response, 200, { data_release: DATA_RELEASE, query, results });
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/v1/objects/")) {
      const record = matchObject(url.pathname);
      if (!record) {
        problem(response, 404, "https://mibvendor.io/problems/object-not-found", "Object not found", "No synthetic object has this id");
        return;
      }
      writeJson(response, 200, { data_release: DATA_RELEASE, object: publicObject(record) });
      return;
    }

    const dependencyMatch = url.pathname.match(/^\/v1\/modules\/([^/]+)\/dependencies$/);
    if (request.method === "GET" && dependencyMatch) {
      const moduleName = decodeURIComponent(dependencyMatch[1]).toUpperCase();
      const present = records.some((record) => record.module === moduleName);
      if (!present) {
        problem(response, 404, "https://mibvendor.io/problems/module-not-found", "Module not found", "No synthetic module has this id");
        return;
      }
      writeJson(response, 200, {
        data_release: DATA_RELEASE,
        module: moduleName,
        dependencies: moduleName === "IF-MIB" ? ["SNMPv2-SMI", "SNMPv2-TC"] : []
      });
      return;
    }

    const changesMatch = url.pathname.match(/^\/v1\/releases\/([^/]+)\/changes$/);
    if (request.method === "GET" && changesMatch) {
      writeJson(response, 200, {
        data_release: decodeURIComponent(changesMatch[1]),
        since: url.searchParams.get("since"),
        changes: [],
        next_cursor: null,
        note: "Synthetic Phase 0 response; diff-feed demand is unvalidated."
      });
      return;
    }

    problem(response, 404, "https://mibvendor.io/problems/not-found", "Not found", "No Phase 0 mock route matches this request");
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))) {
  const port = Number.parseInt(process.env.PORT ?? "4010", 10);
  const server = createPhase0ApiMock();
  server.listen(port, "127.0.0.1", () => {
    console.log(`Phase 0 synthetic API listening at http://127.0.0.1:${port}`);
  });
}
