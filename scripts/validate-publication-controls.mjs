import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { validatePublicationControls } from "../src/publication-controls.mjs";

const root = process.cwd();
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
const controls = await readJson("data/publication-controls.json");
const catalog = await readJson("data/mib-catalog.json");
const sources = await readJson("data/source-catalog.json");
const failures = validatePublicationControls(controls, {
  releaseId: catalog.data_release,
  sourceIds: new Set(sources.sources.map((source) => source.id)),
  moduleIds: new Set(catalog.modules.map((module) => module.id))
});

if (failures.length) {
  for (const failure of failures) console.error(`ERROR: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Publication controls passed: ${controls.events.length} chained events, ${controls.disabled_sources.length} disabled sources, ${controls.disabled_modules.length} disabled modules.`);
}
