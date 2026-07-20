#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { buildMaterializedMibSourceAdapter } from "./lib/materialized-mib-source-adapter.mjs";

function usage(message = null) {
  if (message) console.error(`ERROR: ${message}`);
  console.error("Usage: node scripts/build-materialized-mib-source-adapter.mjs --upstream CLEAN_GIT_CHECKOUT --workspace ISOLATED_CANDIDATE_DIR --manifest FILE --generated-at ISO");
  process.exit(message ? 2 : 0);
}

function parseArguments(argv) {
  const allowed = new Set(["upstream", "workspace", "manifest", "generated-at"]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--help" && argv.length === 1) usage();
    if (!flag?.startsWith("--") || value === undefined) usage("Every option requires an explicit value");
    const name = flag.slice(2);
    if (!allowed.has(name)) usage(`Unknown option ${flag}`);
    if (values.has(name)) usage(`Duplicate option ${flag}`);
    values.set(name, value);
  }
  for (const required of allowed) if (!values.has(required)) usage(`Missing --${required}`);
  return values;
}

try {
  const values = parseArguments(process.argv.slice(2));
  const manifestPath = path.resolve(values.get("manifest"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const result = await buildMaterializedMibSourceAdapter({
    upstreamRoot: path.resolve(values.get("upstream")),
    workspaceRoot: path.resolve(values.get("workspace")),
    manifest,
    generatedAt: values.get("generated-at")
  });
  console.log(JSON.stringify(result.summary));
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
