import { performance } from "node:perf_hooks";
import process from "node:process";

import { parseWalk } from "../prototype/core.mjs";
import { records } from "../prototype/data.mjs";

const lineCount = Number.parseInt(process.argv[2] ?? "50000", 10);
if (!Number.isSafeInteger(lineCount) || lineCount < 1 || lineCount > 50_000) {
  throw new RangeError("line count must be between 1 and 50000");
}

const input = Array.from(
  { length: lineCount },
  (_, index) => `.1.3.6.1.2.1.2.2.1.8.${index + 1} = INTEGER: up(1)`
).join("\n");

const rssBefore = process.memoryUsage().rss;
const started = performance.now();
const result = parseWalk(input, records);
const elapsed = performance.now() - started;
const rssAfter = process.memoryUsage().rss;

console.log(JSON.stringify({
  schema_version: 1,
  runtime: process.version,
  platform: process.platform,
  architecture: process.arch,
  input_bytes: Buffer.byteLength(input),
  input_lines: lineCount,
  resolved_rows: result.resolvedCount,
  elapsed_ms: Number(elapsed.toFixed(3)),
  rss_before_bytes: rssBefore,
  rss_after_bytes: rssAfter,
  rss_delta_bytes: rssAfter - rssBefore
}, null, 2));
