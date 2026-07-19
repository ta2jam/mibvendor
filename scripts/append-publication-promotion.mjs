import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  appendPublicationPromotion,
  validatePublicationControls
} from "../src/publication-controls.mjs";

function usage(message) {
  if (message) console.error(`ERROR: ${message}`);
  console.error("Usage: node scripts/append-publication-promotion.mjs --controls <path> --catalog <path> --sources <path> --release <id> --occurred-at <UTC timestamp> --reason <text> --evidence-url <https URL|none> [--output <path>]");
  process.exit(2);
}

function parseArguments(argv) {
  const allowed = new Set(["controls", "catalog", "sources", "release", "occurred-at", "reason", "evidence-url", "output"]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) usage("Every option requires an explicit value");
    const name = flag.slice(2);
    if (!allowed.has(name)) usage(`Unknown option ${flag}`);
    if (values.has(name)) usage(`Duplicate option ${flag}`);
    values.set(name, value);
  }
  for (const required of ["controls", "catalog", "sources", "release", "occurred-at", "reason", "evidence-url"]) {
    if (!values.has(required)) usage(`Missing --${required}`);
  }
  return values;
}

const argumentsByName = parseArguments(process.argv.slice(2));
const resolvePath = (name) => path.resolve(process.cwd(), argumentsByName.get(name));
const controlsPath = resolvePath("controls");
const outputPath = argumentsByName.has("output") ? resolvePath("output") : controlsPath;
const catalogPath = resolvePath("catalog");
const sourcesPath = resolvePath("sources");
const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));

const [controls, catalog, sources] = await Promise.all([
  readJson(controlsPath),
  readJson(catalogPath),
  readJson(sourcesPath)
]);
const releaseId = argumentsByName.get("release");
if (catalog.data_release !== releaseId || sources.data_release !== releaseId) {
  usage("The explicit release must match both catalog inputs");
}

const promoted = appendPublicationPromotion(controls, {
  releaseId,
  occurredAt: argumentsByName.get("occurred-at"),
  reason: argumentsByName.get("reason"),
  evidenceUrl: argumentsByName.get("evidence-url") === "none" ? null : argumentsByName.get("evidence-url")
});
const failures = validatePublicationControls(promoted, {
  releaseId,
  sourceIds: new Set(sources.sources.map((source) => source.id)),
  moduleIds: new Set(catalog.modules.map((module) => module.id))
});
if (failures.length) {
  for (const failure of failures) console.error(`ERROR: ${failure}`);
  process.exit(1);
}

await writeFile(outputPath, `${JSON.stringify(promoted, null, 2)}\n`, "utf8");
console.log(`Appended promotion event ${promoted.events.at(-1).sequence} for ${releaseId} to ${outputPath}`);
