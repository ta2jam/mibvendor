import {
  DATA_RELEASE,
  DIRECTORY_ONLY_SOURCE_COUNT,
  ENTERPRISE_COUNT,
  IANA_PEN_SOURCE,
  MIB_MODULE_COUNT,
  REDISTRIBUTABLE_MODULE_COUNT,
  SYS_OBJECT_ID_COUNT,
  findObject,
  findModule,
  findSource,
  listModules,
  listSources,
  lookupEnterprise,
  lookupSysObjectId,
  moduleDependencies,
  objectRecords,
  publicObject,
  publicModule,
  rawModule,
  resolveObject,
  searchObjects
} from "./intelligence.mjs";

export { DATA_RELEASE } from "./intelligence.mjs";
export const MAX_BATCH_SIZE = 1_000;
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_OID_LENGTH = 512;
export const MAX_QUERY_LENGTH = 200;
export const RATE_LIMIT = 120;
export const RATE_WINDOW_SECONDS = 60;
export const MAX_MODULE_PAGE_SIZE = 100;

function writeJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "content-type": status >= 400 ? "application/problem+json" : "application/json",
    "cache-control": status >= 400 ? "no-store" : "public, max-age=300, must-revalidate",
    "access-control-allow-origin": "*",
    "x-content-type-options": "nosniff",
    ...headers
  });
  response.end(JSON.stringify(body));
}

function problem(response, status, type, title, detail) {
  writeJson(response, status, { type, title, status, detail }, { "cache-control": "no-store" });
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

function createRateLimiter() {
  const windows = new Map();
  let requestCount = 0;
  return (request, response) => {
    requestCount += 1;
    if (requestCount % 1_000 === 0) {
      const now = Date.now();
      for (const [key, value] of windows) {
        if (value.resetAt <= now) windows.delete(key);
      }
    }
    const key = request.headers["x-real-ip"] ?? request.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    let window = windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + RATE_WINDOW_SECONDS * 1_000 };
      windows.set(key, window);
    }
    window.count += 1;
    const remaining = Math.max(0, RATE_LIMIT - window.count);
    const headers = {
      "ratelimit-limit": String(RATE_LIMIT),
      "ratelimit-remaining": String(remaining),
      "ratelimit-reset": String(Math.ceil(window.resetAt / 1_000))
    };
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    if (window.count <= RATE_LIMIT) return true;
    response.setHeader("retry-after", String(Math.ceil((window.resetAt - now) / 1_000)));
    problem(response, 429, "https://mibvendor.io/problems/rate-limit-exceeded", "Rate limit exceeded", `Public alpha limit is ${RATE_LIMIT} requests per ${RATE_WINDOW_SECONDS} seconds per client`);
    return false;
  };
}

export function createApiHandler() {
  const allowRequest = createRateLimiter();
  return async function handleApi(request, response, url) {
    if (request.method === "OPTIONS" && url.pathname.startsWith("/v1/")) {
      response.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400"
      });
      response.end();
      return true;
    }
    if (!url.pathname.startsWith("/v1/")) return false;
    if (!allowRequest(request, response)) return true;

    if (request.method === "GET" && url.pathname === "/v1/data-release") {
      writeJson(response, 200, {
        data_release: DATA_RELEASE,
        status: "public-alpha",
        production_data: true,
        object_count: objectRecords.length,
        enterprise_count: ENTERPRISE_COUNT,
        sys_object_id_count: SYS_OBJECT_ID_COUNT,
        module_count: MIB_MODULE_COUNT,
        redistributable_module_count: REDISTRIBUTABLE_MODULE_COUNT,
        directory_only_source_count: DIRECTORY_ONLY_SOURCE_COUNT,
        enterprise_registry: IANA_PEN_SOURCE
      });
      return true;
    }

    if (request.method === "GET" && url.pathname === "/v1/modules") {
      const query = url.searchParams.get("q") ?? "";
      const publisher = url.searchParams.get("publisher") ?? "";
      const limit = Number(url.searchParams.get("limit") ?? 50);
      const cursor = Number(url.searchParams.get("cursor") ?? 0);
      if (query.length > MAX_QUERY_LENGTH || publisher.length > 64 || !Number.isInteger(limit) || limit < 1 || limit > MAX_MODULE_PAGE_SIZE || !Number.isInteger(cursor) || cursor < 0) {
        problem(response, 422, "https://mibvendor.io/problems/invalid-module-query", "Invalid module query", `q is at most ${MAX_QUERY_LENGTH} characters; limit is 1-${MAX_MODULE_PAGE_SIZE}; cursor is a non-negative integer`);
        return true;
      }
      writeJson(response, 200, { data_release: DATA_RELEASE, query, publisher, cursor, limit, ...listModules({ query, publisher, limit, cursor }) });
      return true;
    }

    if (request.method === "GET" && url.pathname === "/v1/sources") {
      const mode = url.searchParams.get("mode") ?? "";
      const allowedModes = new Set(["", "redistributable", "metadata-only", "directory-only"]);
      if (!allowedModes.has(mode)) {
        problem(response, 422, "https://mibvendor.io/problems/invalid-source-mode", "Invalid source mode", "Use redistributable, metadata-only, or directory-only");
        return true;
      }
      const results = listSources({ mode });
      writeJson(response, 200, { data_release: DATA_RELEASE, mode: mode || null, total: results.length, results });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/v1/resolve:batch") {
      try {
        const body = await readJson(request);
        if (!body || !Array.isArray(body.oids)) {
          problem(response, 422, "https://mibvendor.io/problems/invalid-batch", "Invalid batch", "oids must be an array");
          return true;
        }
        if (body.data_release !== undefined && body.data_release !== DATA_RELEASE) {
          problem(response, 409, "https://mibvendor.io/problems/data-release-unavailable", "Data release unavailable", "This public alpha exposes only its active immutable release");
          return true;
        }
        if (body.oids.length > MAX_BATCH_SIZE) {
          problem(response, 413, "https://mibvendor.io/problems/batch-too-large", "Batch too large", `Maximum ${MAX_BATCH_SIZE} OIDs`);
          return true;
        }
        if (!body.oids.every((oid) => typeof oid === "string" && oid.length <= MAX_OID_LENGTH)) {
          problem(response, 422, "https://mibvendor.io/problems/invalid-batch", "Invalid batch", `Every OID must be a string of at most ${MAX_OID_LENGTH} characters`);
          return true;
        }
        writeJson(response, 200, { data_release: DATA_RELEASE, results: body.oids.map(resolveObject) });
      } catch (error) {
        if (error instanceof RangeError) {
          problem(response, 413, "https://mibvendor.io/problems/body-too-large", "Body too large", error.message);
        } else {
          problem(response, 400, "https://mibvendor.io/problems/invalid-json", "Invalid JSON", "Request body must be valid JSON");
        }
      }
      return true;
    }

    if (request.method === "GET" && url.pathname === "/v1/search") {
      const query = url.searchParams.get("q") ?? "";
      if (query.length > MAX_QUERY_LENGTH) {
        problem(response, 422, "https://mibvendor.io/problems/query-too-long", "Query too long", `Maximum ${MAX_QUERY_LENGTH} characters`);
        return true;
      }
      writeJson(response, 200, { data_release: DATA_RELEASE, query, results: searchObjects(query) });
      return true;
    }

    const objectMatch = url.pathname.match(/^\/v1\/objects\/([^/]+)$/);
    if (request.method === "GET" && objectMatch) {
      const record = findObject(decodeURIComponent(objectMatch[1]));
      if (!record) {
        problem(response, 404, "https://mibvendor.io/problems/object-not-found", "Object not found", "No object has this id in the active public alpha release");
        return true;
      }
      writeJson(response, 200, { data_release: DATA_RELEASE, object: publicObject(record) });
      return true;
    }

    const rawModuleMatch = url.pathname.match(/^\/v1\/modules\/([^/]+)\/raw$/);
    if (request.method === "GET" && rawModuleMatch) {
      const moduleId = decodeURIComponent(rawModuleMatch[1]);
      const module = findModule(moduleId);
      if (!module) {
        problem(response, 404, "https://mibvendor.io/problems/module-not-found", "Module not found", "No module has this id in the active rights-cleared release");
        return true;
      }
      if (!module.raw_download || module.publication_mode !== "redistributable") {
        problem(response, 451, "https://mibvendor.io/problems/raw-unavailable-due-to-rights", "Raw MIB unavailable due to rights", "Use the official source URL in the module metadata; mibvendor does not redistribute this file");
        return true;
      }
      const raw = rawModule(moduleId);
      response.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "content-length": raw.bytes.length,
        "content-disposition": `attachment; filename="${module.id}.mib"`,
        "cache-control": "public, max-age=86400, immutable",
        "access-control-allow-origin": "*",
        "x-content-type-options": "nosniff",
        "x-content-sha256": module.artifact_sha256,
        "link": `<${module.license.url}>; rel="license", <${module.source_url}>; rel="original"`
      });
      response.end(raw.bytes);
      return true;
    }

    const moduleMatch = url.pathname.match(/^\/v1\/modules\/([^/]+)$/);
    if (request.method === "GET" && moduleMatch) {
      const module = findModule(decodeURIComponent(moduleMatch[1]));
      if (!module) {
        problem(response, 404, "https://mibvendor.io/problems/module-not-found", "Module not found", "No module has this id in the active rights-cleared release");
        return true;
      }
      writeJson(response, 200, { data_release: DATA_RELEASE, module: publicModule(module) });
      return true;
    }

    const sourceMatch = url.pathname.match(/^\/v1\/sources\/([^/]+)$/);
    if (request.method === "GET" && sourceMatch) {
      const source = findSource(decodeURIComponent(sourceMatch[1]));
      if (!source) {
        problem(response, 404, "https://mibvendor.io/problems/source-not-found", "Source not found", "No reviewed source has this id");
        return true;
      }
      writeJson(response, 200, { data_release: DATA_RELEASE, source });
      return true;
    }

    const enterpriseMatch = url.pathname.match(/^\/v1\/enterprises\/([^/]+)$/);
    if (request.method === "GET" && enterpriseMatch) {
      const raw = decodeURIComponent(enterpriseMatch[1]);
      if (!/^\d+$/.test(raw) || Number(raw) > 0xffffffff) {
        problem(response, 422, "https://mibvendor.io/problems/invalid-enterprise-number", "Invalid enterprise number", "Use one decimal uint32 PEN value");
        return true;
      }
      const enterprise = lookupEnterprise(Number(raw));
      if (!enterprise) {
        problem(response, 404, "https://mibvendor.io/problems/enterprise-not-found", "Enterprise not found", "The number is not present in the bundled IANA registry snapshot");
        return true;
      }
      writeJson(response, 200, { data_release: DATA_RELEASE, enterprise });
      return true;
    }

    const sysObjectIdMatch = url.pathname.match(/^\/v1\/sys-object-ids\/([^/]+)$/);
    if (request.method === "GET" && sysObjectIdMatch) {
      const input = decodeURIComponent(sysObjectIdMatch[1]);
      if (input.length > MAX_OID_LENGTH) {
        problem(response, 422, "https://mibvendor.io/problems/invalid-oid", "Invalid OID", `Maximum ${MAX_OID_LENGTH} characters`);
        return true;
      }
      const result = lookupSysObjectId(input);
      if (result.status === "invalid") {
        problem(response, 422, "https://mibvendor.io/problems/invalid-oid", "Invalid OID", "Use a dot-separated numeric OID");
        return true;
      }
      writeJson(response, 200, { data_release: DATA_RELEASE, result });
      return true;
    }

    const dependencyMatch = url.pathname.match(/^\/v1\/modules\/([^/]+)\/dependencies$/);
    if (request.method === "GET" && dependencyMatch) {
      const dependencies = moduleDependencies(decodeURIComponent(dependencyMatch[1]));
      if (!dependencies) {
        problem(response, 404, "https://mibvendor.io/problems/module-not-found", "Module not found", "No module has this id in the active public alpha release");
        return true;
      }
      writeJson(response, 200, { data_release: DATA_RELEASE, ...dependencies });
      return true;
    }

    problem(response, 404, "https://mibvendor.io/problems/not-found", "Not found", "No public alpha API route matches this request");
    return true;
  };
}
