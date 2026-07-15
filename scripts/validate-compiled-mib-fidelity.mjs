import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export function validateCompiledMibFidelity(candidateSet, document) {
  const failures = [];
  if (document.schema_version !== 1) failures.push("Compiled MIB fidelity schema version must be 1");
  if (document.activation_state !== "staged-not-active") failures.push("Compiled MIB fidelity escaped staging");
  if (document.method !== "symbol-level-cross-format-comparison") failures.push("Compiled MIB fidelity method drifted");
  const expectedDigest = createHash("sha256").update(JSON.stringify({ ...document, manifest_sha256: null })).digest("hex");
  if (document.manifest_sha256 !== expectedDigest) failures.push("Compiled MIB fidelity digest drifted");
  const moduleNames = new Set();
  const totals = { raw_objects: 0, compiled_objects: 0, union_symbols: 0, exact_oid: 0, oid_mismatch: 0, raw_only: 0, compiled_only: 0, access_comparable: 0, access_exact: 0, description_comparable: 0, description_presence_exact: 0 };
  for (const module of document.modules ?? []) {
    if (moduleNames.has(module.module)) failures.push(`Duplicate compiled fidelity module ${module.module}`);
    moduleNames.add(module.module);
    for (const key of Object.keys(totals)) totals[key] += module[key];
    if (module.oid_mismatch !== module.oid_mismatches?.length) failures.push(`Compiled fidelity mismatch count drifted ${module.module}`);
    if (module.union_symbols !== module.exact_oid + module.oid_mismatch + module.raw_only + module.compiled_only) failures.push(`Compiled fidelity symbol partition drifted ${module.module}`);
    const ratio = module.union_symbols === 0 ? 0 : Number((module.exact_oid / module.union_symbols).toFixed(6));
    if (module.exact_oid_ratio !== ratio) failures.push(`Compiled fidelity module ratio drifted ${module.module}`);
  }
  const selectedCompiled = candidateSet.modules.filter((module) => module.selected_format === "compiled").map((module) => module.module);
  if (document.counts?.selected_compiled_modules !== selectedCompiled.length) failures.push("Compiled fidelity selected-module count drifted");
  if (document.counts?.comparable_modules !== document.modules?.length) failures.push("Compiled fidelity comparable-module count drifted");
  for (const [key, value] of Object.entries(totals)) if (document.counts?.[key] !== value) failures.push(`Compiled fidelity total drifted ${key}`);
  const exactOidRatio = totals.union_symbols === 0 ? 0 : Number((totals.exact_oid / totals.union_symbols).toFixed(6));
  if (document.counts?.exact_oid_ratio !== exactOidRatio) failures.push("Compiled fidelity global ratio drifted");
  if (document.counts?.unverified_selected_compiled_modules !== document.unverified_selected_compiled_modules?.length) failures.push("Compiled fidelity unverified count drifted");
  if ((document.unverified_selected_compiled_modules ?? []).some((module) => !selectedCompiled.includes(module))) failures.push("Compiled fidelity unverified set contains non-selected module");
  const criteria = document.gate_criteria;
  const expectedGate = (document.modules?.length ?? 0) >= criteria.minimum_comparable_modules
    && exactOidRatio >= criteria.minimum_exact_oid_ratio
    && totals.oid_mismatch <= criteria.maximum_oid_mismatches
    && (document.unverified_selected_compiled_modules?.length ?? 0) <= criteria.maximum_unverified_selected_compiled_modules ? "passed" : "open";
  if (document.gate !== expectedGate) failures.push("Compiled MIB fidelity gate claim drifted");
  return failures;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const [candidateSet, document] = await Promise.all([
    readFile(path.join(root, "data", "corpus-expansion-candidates.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "data", "compiled-mib-fidelity.json"), "utf8").then(JSON.parse)
  ]);
  const failures = validateCompiledMibFidelity(candidateSet, document);
  if (failures.length) { for (const failure of failures) console.error(failure); process.exitCode = 1; }
  else console.log(`Compiled MIB fidelity passed validation: ${document.counts.comparable_modules} comparable modules, gate ${document.gate}.`);
}
