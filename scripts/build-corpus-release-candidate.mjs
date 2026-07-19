#!/usr/bin/env node
import path from "node:path";
import process from "node:process";

import { buildReleaseCandidate, verifyReleaseCandidate } from "./lib/corpus-release-candidate.mjs";

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name.startsWith("--")) throw new Error(`unexpected argument: ${name}`);
    if (name === "--help") return { help: true };
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${name}`);
    options[name.slice(2)] = value;
    index += 1;
  }
  return options;
}

function usage() {
  return `Usage:
  node scripts/build-corpus-release-candidate.mjs --release-id ID --generated-at ISO [--output DIR] [--input-root DIR] [--minimum-modules N]
  node scripts/build-corpus-release-candidate.mjs --verify DIR

Build output defaults to .local/corpus-release-candidates/<release-id>. The output directory must not already exist.`;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
  } else if (args.verify) {
    if (Object.keys(args).length !== 1) throw new Error("--verify cannot be combined with build arguments");
    const result = await verifyReleaseCandidate(path.resolve(args.verify));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } else {
    if (!args["release-id"] || !args["generated-at"]) throw new Error("--release-id and --generated-at are required");
    const minimumModules = args["minimum-modules"] === undefined ? null : Number.parseInt(args["minimum-modules"], 10);
    if (minimumModules !== null && (!Number.isSafeInteger(minimumModules) || minimumModules < 1)) throw new Error("--minimum-modules must be a positive integer");
    const inputRoot = path.resolve(args["input-root"] ?? process.cwd());
    const outputRoot = path.resolve(args.output ?? path.join(inputRoot, ".local", "corpus-release-candidates", args["release-id"]));
    const result = await buildReleaseCandidate(inputRoot, outputRoot, {
      releaseId: args["release-id"],
      generatedAt: args["generated-at"],
      minimumModules
    });
    console.log(JSON.stringify({ output: outputRoot, counts: result.report.counts, readiness: result.report.readiness }, null, 2));
    if (!result.report.readiness.activation_ready) process.exitCode = 2;
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  console.error(usage());
  process.exitCode = 1;
}
