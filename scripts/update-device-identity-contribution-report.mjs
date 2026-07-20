#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildDeviceIdentityContributionReport,
  parseDeterministicContributionJson
} from "./lib/device-identity-contributions.mjs";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataRoot = path.join(projectRoot, "data", "device-identity-contributions");

function parseArguments(argv) {
  if (argv.length === 0) return path.join(dataRoot, "review-report.json");
  if (argv.length === 2 && argv[0] === "--output" && path.isAbsolute(argv[1])) return argv[1];
  throw new Error("Usage: node scripts/update-device-identity-contribution-report.mjs [--output <absolute-path>]");
}

async function readContributionJson(fileName) {
  const filePath = path.join(dataRoot, fileName);
  const source = await readFile(filePath, "utf8");
  return parseDeterministicContributionJson(source, path.relative(projectRoot, filePath));
}

async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeReportAtomically(target, bytes) {
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o644
    );
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
    await syncDirectory(directory);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true });
  }
}

export async function updateDeviceIdentityContributionReport({ output } = {}) {
  const [events, reviews] = await Promise.all([
    readContributionJson("events.json"),
    readContributionJson("reviews.json")
  ]);
  const report = buildDeviceIdentityContributionReport(events, reviews);
  const target = output ?? path.join(dataRoot, "review-report.json");
  await writeReportAtomically(target, Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8"));
  return report;
}

async function main() {
  const output = parseArguments(process.argv.slice(2));
  const report = await updateDeviceIdentityContributionReport({ output });
  process.stdout.write(`${JSON.stringify(report.counts)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    const message = Array.isArray(error?.issues) ? error.issues.join("\n") : error?.message ?? "Contribution report update failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
