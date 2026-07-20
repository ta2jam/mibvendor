#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  DeviceIdentityContributionError,
  MAX_CONTRIBUTION_DOCUMENT_BYTES,
  emptyContributionEventsDocument,
  emptyContributionReviewsDocument,
  parseDeterministicContributionJson,
  validateDeviceIdentityContributionAppendOnlyTransition
} from "./lib/device-identity-contributions.mjs";

const execFile = promisify(execFileCallback);
const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const COMMIT = /^[0-9a-f]{40}$/u;
const PATHS = Object.freeze({
  events: "data/device-identity-contributions/events.json",
  reviews: "data/device-identity-contributions/reviews.json"
});
const GIT_OUTPUT_OVERHEAD_BYTES = 1024;
const GIT_DIAGNOSTIC_MAX_BYTES = 16 * 1024;

function parseArguments(argv) {
  const allowed = new Set(["base", "head", "actor", "repository-owner"]);
  const values = new Map();
  if (argv.length % 2 !== 0) throw new Error("Every option requires a value");
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option.startsWith("--") || !allowed.has(option.slice(2))) throw new Error(`Unknown option ${option}`);
    if (values.has(option.slice(2))) throw new Error(`Duplicate option ${option}`);
    values.set(option.slice(2), value);
  }
  for (const required of allowed) if (!values.get(required)) throw new Error(`Missing --${required}`);
  if (!COMMIT.test(values.get("base")) || !COMMIT.test(values.get("head"))) throw new Error("base and head must be full lowercase Git commit ids");
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(values.get("actor"))
    || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(values.get("repository-owner"))) {
    throw new Error("actor and repository-owner must be GitHub login names");
  }
  return Object.fromEntries(values);
}

function missingPathAtCommit(error) {
  const stderr = typeof error?.stderr === "string" ? error.stderr : "";
  return stderr.includes("does not exist in") || stderr.includes("exists on disk, but not in");
}

async function assertCommitExists(commit, root) {
  try {
    await execFile("git", ["cat-file", "-e", `${commit}^{commit}`], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: GIT_DIAGNOSTIC_MAX_BYTES
    });
  } catch {
    throw new Error(`Cannot read contribution ledgers: ${commit} is not a Git commit in the selected repository`);
  }
}

async function blobSizeAt(commit, relativePath, root) {
  let stdout;
  try {
    ({ stdout } = await execFile("git", ["cat-file", "-s", `${commit}:${relativePath}`], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: GIT_DIAGNOSTIC_MAX_BYTES
    }));
  } catch (error) {
    await assertCommitExists(commit, root);
    if (missingPathAtCommit(error)) return null;
    throw new Error(`Cannot measure contribution ledger ${relativePath} at ${commit}`);
  }

  const value = stdout.trim();
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error(`Git returned an invalid size for contribution ledger ${relativePath} at ${commit}`);
  }
  const size = BigInt(value);
  if (size > BigInt(MAX_CONTRIBUTION_DOCUMENT_BYTES)) {
    throw new DeviceIdentityContributionError([
      `${relativePath} at ${commit} is ${size} bytes; maximum contribution document size is ${MAX_CONTRIBUTION_DOCUMENT_BYTES} bytes`
    ]);
  }
  return Number(size);
}

async function documentAt(commit, relativePath, fallback, root) {
  const size = await blobSizeAt(commit, relativePath, root);
  if (size === null) return fallback();

  let stdout;
  try {
    ({ stdout } = await execFile("git", ["cat-file", "blob", `${commit}:${relativePath}`], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: MAX_CONTRIBUTION_DOCUMENT_BYTES + GIT_OUTPUT_OVERHEAD_BYTES
    }));
  } catch {
    throw new Error(`Cannot read bounded contribution ledger ${relativePath} at ${commit}`);
  }
  if (Buffer.byteLength(stdout, "utf8") !== size) {
    throw new Error(`Contribution ledger ${relativePath} at ${commit} changed size while reading`);
  }
  try {
    return parseDeterministicContributionJson(stdout, `${commit}:${relativePath}`);
  } catch {
    throw new DeviceIdentityContributionError([
      `${relativePath} at ${commit} is not valid deterministic contribution JSON`
    ]);
  }
}

export async function validateDeviceIdentityContributionGitTransition({
  base,
  head,
  actor,
  repositoryOwner,
  root = projectRoot
}) {
  const beforeEvents = await documentAt(base, PATHS.events, emptyContributionEventsDocument, root);
  const afterEvents = await documentAt(head, PATHS.events, emptyContributionEventsDocument, root);
  const beforeReviews = await documentAt(base, PATHS.reviews, emptyContributionReviewsDocument, root);
  const afterReviews = await documentAt(head, PATHS.reviews, emptyContributionReviewsDocument, root);
  return validateDeviceIdentityContributionAppendOnlyTransition({
    beforeEvents,
    afterEvents,
    beforeReviews,
    afterReviews,
    actor,
    repositoryOwner
  });
}

async function main() {
  const values = parseArguments(process.argv.slice(2));
  const result = await validateDeviceIdentityContributionGitTransition({
    base: values.base,
    head: values.head,
    actor: values.actor,
    repositoryOwner: values["repository-owner"]
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error.issues?.join("\n") ?? error.message}\n`);
    process.exitCode = 1;
  }
}
