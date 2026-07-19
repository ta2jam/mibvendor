#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";

import { createSearchIndex, rankSearchIndex } from "../prototype/core.mjs";

const processStartedAt = performance.now();

function args(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || !value) throw new Error("arguments must be --name value pairs");
    values[name.slice(2)] = value;
  }
  return values;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function summary(values) {
  return {
    iterations: values.length,
    min_ms: Number(Math.min(...values).toFixed(3)),
    p50_ms: Number(percentile(values, 0.5).toFixed(3)),
    p95_ms: Number(percentile(values, 0.95).toFixed(3)),
    max_ms: Number(Math.max(...values).toFixed(3))
  };
}

function resolveOid(input, byOid) {
  const arcs = String(input).replace(/^\./, "").split(".");
  if (!arcs.length || arcs.some((arc) => !/^\d+$/.test(arc))) return null;
  for (let length = arcs.length; length > 0; length -= 1) {
    const record = byOid.get(arcs.slice(0, length).join("."));
    if (record) return { record, instance_suffix: arcs.slice(length) };
  }
  return { record: null, instance_suffix: [] };
}

async function timedFetch(url, init) {
  const started = performance.now();
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`benchmark request failed: ${response.status}`);
  await response.arrayBuffer();
  return performance.now() - started;
}

const options = args(process.argv.slice(2));
if (!options.candidate) throw new Error("--candidate is required");
const candidateRoot = path.resolve(options.candidate);
const exactIterations = Number.parseInt(options["exact-iterations"] ?? "30", 10);
const searchIterations = Number.parseInt(options["search-iterations"] ?? "5", 10);
const batchIterations = Number.parseInt(options["batch-iterations"] ?? "5", 10);
for (const [name, value] of Object.entries({ exactIterations, searchIterations, batchIterations })) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000) throw new Error(`${name} must be between 1 and 1000`);
}

const dataRoot = path.join(candidateRoot, "data");
const [catalog, objectDocument, sourceDocument] = await Promise.all([
  readFile(path.join(dataRoot, "mib-catalog.json"), "utf8").then(JSON.parse),
  readFile(path.join(dataRoot, "mib-objects.json"), "utf8").then(JSON.parse),
  readFile(path.join(dataRoot, "source-catalog.json"), "utf8").then(JSON.parse)
]);
const objectFileBytes = (await stat(path.join(dataRoot, "mib-objects.json"))).size;
const modules = new Map(catalog.modules.map((module) => [module.id.toUpperCase(), module]));
const sources = new Map(sourceDocument.sources.map((source) => [source.id, source]));
if (modules.size !== catalog.modules.length) throw new Error("duplicate candidate module id");
if (objectDocument.objects.some((object) => !modules.has(object.module.toUpperCase()))) throw new Error("candidate object has no module");

// Match the active runtime's principal retained structures without importing or replacing active data.
const resolutionRecords = objectDocument.objects.map((record) => ({
  ...record,
  intent: [],
  related: [],
  table: null,
  row: null,
  index: null,
  notificationObjects: [],
  _catalog: true
}));
const byId = new Map(resolutionRecords.map((record) => [record.id, record]));
const searchIndex = createSearchIndex(resolutionRecords);
const byOid = new Map();
for (const record of resolutionRecords) byOid.set(record.oid, record);
const childrenByParentOid = new Map();
for (const record of byOid.values()) {
  const arcs = record.oid.split(".");
  for (let length = arcs.length - 1; length > 0; length -= 1) {
    const parent = arcs.slice(0, length).join(".");
    if (!byOid.has(parent)) continue;
    const children = childrenByParentOid.get(parent) ?? [];
    children.push(record);
    childrenByParentOid.set(parent, children);
    break;
  }
}

const exactRecord = resolutionRecords[Math.floor(resolutionRecords.length / 2)];
const searchRecord = resolutionRecords.find((record) => record.symbol.length >= 8) ?? exactRecord;
const batchOids = Array.from({ length: 1000 }, (_, index) => resolutionRecords[Math.floor(index * resolutionRecords.length / 1000)].oid);
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  response.setHeader("content-type", "application/json");
  if (request.method === "GET" && url.pathname === "/exact") {
    response.end(JSON.stringify(resolveOid(url.searchParams.get("oid"), byOid)));
    return;
  }
  if (request.method === "GET" && url.pathname === "/search") {
    response.end(JSON.stringify(rankSearchIndex(url.searchParams.get("q") ?? "", searchIndex).map(({ record }) => record)));
    return;
  }
  if (request.method === "POST" && url.pathname === "/batch") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const inputs = JSON.parse(Buffer.concat(chunks));
    if (!Array.isArray(inputs) || inputs.length !== 1000) {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: "benchmark batch must contain exactly 1000 OIDs" }));
      return;
    }
    response.end(JSON.stringify(inputs.map((oid) => resolveOid(oid, byOid))));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "not found" }));
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const startupMs = performance.now() - processStartedAt;
const startupMemory = process.memoryUsage();
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const batchBody = JSON.stringify(batchOids);

await timedFetch(`${base}/exact?oid=${encodeURIComponent(exactRecord.oid)}`);
await timedFetch(`${base}/search?q=${encodeURIComponent(searchRecord.symbol)}`);
await timedFetch(`${base}/batch`, { method: "POST", headers: { "content-type": "application/json" }, body: batchBody });
const exact = [];
const search = [];
const batch = [];
for (let index = 0; index < exactIterations; index += 1) exact.push(await timedFetch(`${base}/exact?oid=${encodeURIComponent(exactRecord.oid)}`));
for (let index = 0; index < searchIterations; index += 1) search.push(await timedFetch(`${base}/search?q=${encodeURIComponent(searchRecord.symbol)}`));
for (let index = 0; index < batchIterations; index += 1) batch.push(await timedFetch(`${base}/batch`, { method: "POST", headers: { "content-type": "application/json" }, body: batchBody }));
const finalMemory = process.memoryUsage();
const maxRssBytes = process.resourceUsage().maxRSS * 1024;
const limitBytes = 512 * 1024 * 1024;
const result = {
  methodology: "cold standalone Node process; candidate JSON parse plus runtime-shaped records/maps/tree; loopback HTTP after one warm-up per operation; response body fully consumed",
  candidate: {
    release_id: catalog.data_release,
    modules: modules.size,
    sources: sources.size,
    objects: resolutionRecords.length,
    object_json_bytes: objectFileBytes
  },
  startup: {
    listen_ready_ms: Number(startupMs.toFixed(3)),
    rss_bytes: startupMemory.rss,
    heap_used_bytes: startupMemory.heapUsed
  },
  latency: {
    exact_oid: { query: exactRecord.oid, ...summary(exact) },
    text_search: { query: searchRecord.symbol, ...summary(search) },
    batch_1000: summary(batch)
  },
  memory_after_benchmark: {
    rss_bytes: finalMemory.rss,
    heap_used_bytes: finalMemory.heapUsed,
    process_max_rss_bytes: maxRssBytes
  },
  gate: {
    rss_limit_bytes: limitBytes,
    startup_rss_pass: startupMemory.rss < limitBytes,
    peak_rss_pass: maxRssBytes < limitBytes
  }
};
console.log(JSON.stringify(result, null, 2));
await new Promise((resolve) => server.close(resolve));
if (!result.gate.startup_rss_pass || !result.gate.peak_rss_pass) process.exitCode = 2;
