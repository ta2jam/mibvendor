#!/usr/bin/env node
import process from "node:process";

import {
  ProductionReleaseSwitchError,
  recoverProductionReleaseAudit,
  switchProductionAppPointer
} from "./lib/production-app-pointer.mjs";

function usage(message) {
  if (message) console.error(`ERROR: ${message}`);
  console.error("Usage:\n  node scripts/switch-production-app-pointer.mjs --site <site-root> --action <activate|rollback> --from <current-release> --to <target-release> --occurred-at <UTC> --reason <text> --evidence-url <https-url|none>\n  node scripts/switch-production-app-pointer.mjs --site <site-root> --action recover --occurred-at <UTC> [--clear-stale-lock yes]");
  process.exitCode = 2;
  return null;
}

function parseArguments(argv) {
  const allowed = new Set(["site", "action", "from", "to", "occurred-at", "reason", "evidence-url", "clear-stale-lock"]);
  const switchRequired = new Set(["site", "action", "from", "to", "occurred-at", "reason", "evidence-url"]);
  const recoverAllowed = new Set(["site", "action", "occurred-at", "clear-stale-lock"]);
  const recoverRequired = new Set(["site", "action", "occurred-at"]);
  const values = new Map();
  if (argv.length === 1 && argv[0] === "--help") {
    console.log("Usage:\n  node scripts/switch-production-app-pointer.mjs --site <site-root> --action <activate|rollback> --from <current-release> --to <target-release> --occurred-at <UTC> --reason <text> --evidence-url <https-url|none>\n  node scripts/switch-production-app-pointer.mjs --site <site-root> --action recover --occurred-at <UTC> [--clear-stale-lock yes]");
    return null;
  }
  if (argv.length % 2 !== 0) return usage("Every option requires an explicit value");
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag.startsWith("--")) return usage(`Unexpected argument ${flag}`);
    const name = flag.slice(2);
    if (!allowed.has(name)) return usage(`Unknown option ${flag}`);
    if (values.has(name)) return usage(`Duplicate option ${flag}`);
    values.set(name, value);
  }
  const action = values.get("action");
  const required = action === "recover" ? recoverRequired : switchRequired;
  for (const requiredName of required) {
    if (!values.has(requiredName)) return usage(`Missing --${requiredName}`);
  }
  if (action === "recover" && [...values.keys()].some((name) => !recoverAllowed.has(name))) {
    return usage("Recovery accepts only --site, --action, --occurred-at, and optional --clear-stale-lock yes");
  }
  if (action !== "recover" && values.has("clear-stale-lock")) return usage("--clear-stale-lock is recovery-only");
  if (values.has("clear-stale-lock") && values.get("clear-stale-lock") !== "yes") {
    return usage("--clear-stale-lock requires the exact value yes after confirming no pointer command is running");
  }
  return values;
}

const values = parseArguments(process.argv.slice(2));
if (values) {
  try {
    const result = values.get("action") === "recover"
      ? await recoverProductionReleaseAudit({
        site: values.get("site"),
        occurredAt: values.get("occurred-at"),
        clearStaleLock: values.get("clear-stale-lock") === "yes"
      })
      : await switchProductionAppPointer({
        site: values.get("site"),
        action: values.get("action"),
        expectedCurrentRelease: values.get("from"),
        targetRelease: values.get("to"),
        occurredAt: values.get("occurred-at"),
        reason: values.get("reason"),
        evidenceUrl: values.get("evidence-url") === "none" ? null : values.get("evidence-url")
      });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const prefix = error instanceof ProductionReleaseSwitchError ? error.code : "unexpected-error";
    console.error(`ERROR [${prefix}]: ${error.message}`);
    process.exitCode = 1;
  }
}
