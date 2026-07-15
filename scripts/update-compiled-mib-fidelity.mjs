import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { gunzipSync } from "node:zlib";

const root = process.cwd();
const [candidateSet, rawObjectsDocument, compiledObjectsDocument] = await Promise.all([
  readFile(path.join(root, "data", "corpus-expansion-candidates.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "data", "raw-mib-objects-staging.json.gz")).then((bytes) => JSON.parse(gunzipSync(bytes))),
  readFile(path.join(root, "data", "compiled-mib-objects-staging.json"), "utf8").then(JSON.parse)
]);

function objectsByModule(objects) {
  const result = new Map();
  for (const object of objects) {
    const values = result.get(object.module) ?? [];
    values.push(object);
    result.set(object.module, values);
  }
  return result;
}

const rawByModule = objectsByModule(rawObjectsDocument.objects);
const compiledByModule = objectsByModule(compiledObjectsDocument.objects);
const comparableModuleNames = [...rawByModule.keys()].filter((module) => compiledByModule.has(module)).sort();
const modules = comparableModuleNames.map((module) => {
  const raw = new Map(rawByModule.get(module).map((object) => [object.symbol, object]));
  const compiled = new Map(compiledByModule.get(module).map((object) => [object.symbol, object]));
  const symbols = [...new Set([...raw.keys(), ...compiled.keys()])].sort();
  let exactOid = 0;
  let oidMismatch = 0;
  let rawOnly = 0;
  let compiledOnly = 0;
  let accessComparable = 0;
  let accessExact = 0;
  let descriptionComparable = 0;
  let descriptionPresenceExact = 0;
  const oidMismatches = [];
  for (const symbol of symbols) {
    const rawObject = raw.get(symbol);
    const compiledObject = compiled.get(symbol);
    if (!rawObject) { compiledOnly += 1; continue; }
    if (!compiledObject) { rawOnly += 1; continue; }
    if (rawObject.oid === compiledObject.oid) exactOid += 1;
    else { oidMismatch += 1; oidMismatches.push({ symbol, raw_oid: rawObject.oid, compiled_oid: compiledObject.oid }); }
    if (rawObject.access !== null && compiledObject.access !== null) {
      accessComparable += 1;
      if (rawObject.access.replaceAll("-", "").toLowerCase() === compiledObject.access.replaceAll("-", "").toLowerCase()) accessExact += 1;
    }
    descriptionComparable += 1;
    if ((rawObject.description !== null) === compiledObject.description_present) descriptionPresenceExact += 1;
  }
  return {
    module,
    raw_objects: raw.size,
    compiled_objects: compiled.size,
    union_symbols: symbols.length,
    exact_oid: exactOid,
    oid_mismatch: oidMismatch,
    raw_only: rawOnly,
    compiled_only: compiledOnly,
    access_comparable: accessComparable,
    access_exact: accessExact,
    description_comparable: descriptionComparable,
    description_presence_exact: descriptionPresenceExact,
    exact_oid_ratio: symbols.length === 0 ? 0 : Number((exactOid / symbols.length).toFixed(6)),
    oid_mismatches: oidMismatches
  };
});
const totals = modules.reduce((counts, module) => {
  for (const key of ["raw_objects", "compiled_objects", "union_symbols", "exact_oid", "oid_mismatch", "raw_only", "compiled_only", "access_comparable", "access_exact", "description_comparable", "description_presence_exact"]) counts[key] += module[key];
  return counts;
}, { raw_objects: 0, compiled_objects: 0, union_symbols: 0, exact_oid: 0, oid_mismatch: 0, raw_only: 0, compiled_only: 0, access_comparable: 0, access_exact: 0, description_comparable: 0, description_presence_exact: 0 });
const selectedCompiled = candidateSet.modules.filter((module) => module.selected_format === "compiled").map((module) => module.module).sort();
const unverifiedSelectedCompiled = selectedCompiled.filter((module) => !rawByModule.has(module));
const gateCriteria = {
  minimum_comparable_modules: 50,
  minimum_exact_oid_ratio: 0.95,
  maximum_oid_mismatches: 0,
  maximum_unverified_selected_compiled_modules: 0
};
const exactOidRatio = totals.union_symbols === 0 ? 0 : Number((totals.exact_oid / totals.union_symbols).toFixed(6));
const gatePassed = modules.length >= gateCriteria.minimum_comparable_modules
  && exactOidRatio >= gateCriteria.minimum_exact_oid_ratio
  && totals.oid_mismatch <= gateCriteria.maximum_oid_mismatches
  && unverifiedSelectedCompiled.length <= gateCriteria.maximum_unverified_selected_compiled_modules;
const document = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  activation_state: "staged-not-active",
  method: "symbol-level-cross-format-comparison",
  gate: gatePassed ? "passed" : "open",
  gate_criteria: gateCriteria,
  counts: {
    comparable_modules: modules.length,
    selected_compiled_modules: selectedCompiled.length,
    unverified_selected_compiled_modules: unverifiedSelectedCompiled.length,
    ...totals,
    exact_oid_ratio: exactOidRatio
  },
  unverified_selected_compiled_modules: unverifiedSelectedCompiled,
  manifest_sha256: null,
  modules
};
document.manifest_sha256 = createHash("sha256").update(JSON.stringify({ ...document, manifest_sha256: null })).digest("hex");
await writeFile(path.join(root, "data", "compiled-mib-fidelity.json"), `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ gate: document.gate, ...document.counts }));
