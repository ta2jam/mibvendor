import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

import { importBindingsFor, importsFor, parseDefinitions, parseMacros, parseTextualConventions, resolveObjects } from "./update-mib-catalog.mjs";
import { validateMibModuleAliases } from "./lib/mib-module-aliases.mjs";

const root = process.cwd();
const [candidateSet, rawIntake, activeCatalog, activeObjects, compiledObjects, aliasDocument] = await Promise.all([
  readFile(path.join(root, "data", "corpus-expansion-candidates.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "data", "license-derived-intake.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "data", "mib-catalog.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "data", "mib-objects.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "data", "compiled-mib-objects-staging.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "data", "mib-module-aliases.json"), "utf8").then(JSON.parse)
]);

const artifactById = new Map(rawIntake.artifacts.map((artifact) => [artifact.id, artifact]));
const selectedRawRows = candidateSet.modules.filter((module) => module.selected_format === "raw");
const selectedRawModules = new Set(selectedRawRows.map((module) => module.module));
const selectedCompiledModules = new Set(candidateSet.modules.filter((module) => module.selected_format === "compiled").map((module) => module.module));
const activeModules = new Set(activeCatalog.modules.map((module) => module.id));
const parsedModules = [];
const moduleInputs = [];
const aliasFailures = validateMibModuleAliases(candidateSet, rawIntake, activeCatalog, aliasDocument);
if (aliasFailures.length) throw new Error(`MIB module alias gate failed:\n${aliasFailures.join("\n")}`);
const aliases = new Map(aliasDocument.aliases.map((alias) => [alias.alias, alias.canonical_module]));

for (const row of selectedRawRows) {
  const artifact = artifactById.get(row.selected_artifact_id);
  if (!artifact) throw new Error(`Selected raw artifact is missing: ${row.selected_artifact_id}`);
  const bytes = await readFile(path.join(root, "data", artifact.staged_path));
  const text = bytes.toString("utf8");
  const parsedObjects = parseDefinitions(text, row.module);
  const textualConventions = parseTextualConventions(text, row.module);
  const macros = parseMacros(text, row.module);
  const symbolCounts = new Map();
  for (const object of parsedObjects) symbolCounts.set(object.symbol, (symbolCounts.get(object.symbol) ?? 0) + 1);
  const duplicateSymbols = [...symbolCounts.entries()].filter(([, count]) => count > 1).map(([symbol]) => symbol).sort();
  const objects = parsedObjects.filter((object) => symbolCounts.get(object.symbol) === 1);
  const dependencies = importsFor(text);
  const imports = Object.fromEntries(Object.entries(importBindingsFor(text)).map(([symbol, sourceModule]) => [symbol, aliases.get(sourceModule) ?? sourceModule]));
  parsedModules.push({ module: row.module, objects, imports });
  moduleInputs.push({ row, artifact, dependencies, declaredObjects: objects, duplicateSymbols, textualConventions, macros });
}

const externalObjects = [
  ...activeObjects.objects,
  ...compiledObjects.objects.filter((object) => selectedCompiledModules.has(object.module))
].map((object) => ({ module: object.module, symbol: object.symbol, oid: object.oid }));
const resolvedObjects = resolveObjects(parsedModules, [], { externalObjects, useNetSnmp: false });
const resolvedByModule = new Map();
for (const object of resolvedObjects) {
  const values = resolvedByModule.get(object.module) ?? [];
  values.push(object);
  resolvedByModule.set(object.module, values);
}

function dependencyState(dependency) {
  if (activeModules.has(dependency)) return "active";
  if (selectedRawModules.has(dependency)) return "selected-raw";
  if (selectedCompiledModules.has(dependency)) return "selected-compiled";
  return "missing";
}

function dependencyRecord(dependency) {
  const directState = dependencyState(dependency);
  if (directState !== "missing") return { module: dependency, state: directState };
  const resolvedAs = aliases.get(dependency);
  if (!resolvedAs) return { module: dependency, state: "missing" };
  const aliasedState = dependencyState(resolvedAs);
  return aliasedState === "missing"
    ? { module: dependency, state: "missing" }
    : { module: dependency, state: `alias-${aliasedState}`, resolved_as: resolvedAs };
}

const modules = moduleInputs.map(({ row, artifact, dependencies, declaredObjects, duplicateSymbols, textualConventions, macros }) => {
  const resolved = resolvedByModule.get(row.module) ?? [];
  const dependencyRecords = dependencies.map(dependencyRecord);
  const missingDependencies = dependencyRecords.filter((dependency) => dependency.state === "missing").length;
  const unresolvedObjects = declaredObjects.length - resolved.length;
  const semanticDefinitionCount = declaredObjects.length + textualConventions.length + macros.length;
  const parserStatus = semanticDefinitionCount === 0
    ? "static-empty"
    : unresolvedObjects === 0 && missingDependencies === 0 && duplicateSymbols.length === 0
      ? "static-pass"
      : "static-partial";
  return {
    module: row.module,
    selected_artifact_id: row.selected_artifact_id,
    source_id: artifact.source_id,
    artifact_sha256: artifact.artifact_sha256,
    parser_method: "deterministic-static-smi-no-external-execution",
    parser_status: parserStatus,
    declared_object_count: declaredObjects.length,
    resolved_object_count: resolved.length,
    unresolved_object_count: unresolvedObjects,
    textual_convention_count: textualConventions.length,
    macro_count: macros.length,
    semantic_definition_count: semanticDefinitionCount,
    duplicate_symbol_count: duplicateSymbols.length,
    duplicate_symbols: duplicateSymbols,
    dependency_count: dependencies.length,
    missing_dependency_count: missingDependencies,
    dependencies: dependencyRecords
  };
}).sort((left, right) => left.module.localeCompare(right.module));

const moduleByName = new Map(modules.map((module) => [module.module, module]));
const objects = resolvedObjects.map((object) => ({
  ...object,
  source_id: moduleByName.get(object.module).source_id,
  source_artifact_id: moduleByName.get(object.module).selected_artifact_id,
  activation_state: "staged",
  parser_method: "deterministic-static-smi-no-external-execution"
}));
const types = moduleInputs.flatMap(({ row, artifact, textualConventions, macros }) => [
  ...textualConventions.map((definition) => ({
    ...definition,
    source_id: artifact.source_id,
    source_artifact_id: row.selected_artifact_id,
    activation_state: "staged",
    parser_method: "deterministic-static-smi-no-external-execution"
  })),
  ...macros.map((definition) => ({
    ...definition,
    source_id: artifact.source_id,
    source_artifact_id: row.selected_artifact_id,
    activation_state: "staged",
    parser_method: "deterministic-static-smi-no-external-execution"
  }))
]).sort((left, right) => left.module.localeCompare(right.module) || left.symbol.localeCompare(right.symbol));
const counts = {
  modules: modules.length,
  static_pass: modules.filter((module) => module.parser_status === "static-pass").length,
  static_partial: modules.filter((module) => module.parser_status === "static-partial").length,
  static_empty: modules.filter((module) => module.parser_status === "static-empty").length,
  declared_objects: modules.reduce((sum, module) => sum + module.declared_object_count, 0),
  resolved_objects: objects.length,
  unresolved_objects: modules.reduce((sum, module) => sum + module.unresolved_object_count, 0),
  textual_conventions: modules.reduce((sum, module) => sum + module.textual_convention_count, 0),
  macros: modules.reduce((sum, module) => sum + module.macro_count, 0),
  semantic_definitions: modules.reduce((sum, module) => sum + module.semantic_definition_count, 0),
  duplicate_symbols: modules.reduce((sum, module) => sum + module.duplicate_symbol_count, 0),
  modules_with_duplicate_symbols: modules.filter((module) => module.duplicate_symbol_count > 0).length,
  missing_dependency_edges: modules.reduce((sum, module) => sum + module.missing_dependency_count, 0),
  modules_with_missing_dependencies: modules.filter((module) => module.missing_dependency_count > 0).length
};
const document = {
  schema_version: 2,
  generated_at: new Date().toISOString(),
  activation_state: "staged-not-active",
  baseline_data_release: activeCatalog.data_release,
  parser_gate: counts.modules > 0 && counts.static_pass === counts.modules ? "passed" : "open",
  parser_security: "no-source-code-execution-no-system-mib-enrichment",
  counts,
  manifest_sha256: null,
  modules
};
document.manifest_sha256 = createHash("sha256").update(JSON.stringify({ ...document, manifest_sha256: null })).digest("hex");
await writeFile(path.join(root, "data", "raw-mib-analysis.json"), `${JSON.stringify(document, null, 2)}\n`, "utf8");
await writeFile(path.join(root, "data", "raw-mib-objects-staging.json.gz"), gzipSync(Buffer.from(`${JSON.stringify({ schema_version: 1, activation_state: "staged-not-active", objects })}\n`), { level: 9, mtime: 0 }));
await writeFile(path.join(root, "data", "raw-mib-types-staging.json.gz"), gzipSync(Buffer.from(`${JSON.stringify({ schema_version: 1, activation_state: "staged-not-active", definitions: types })}\n`), { level: 9, mtime: 0 }));
console.log(JSON.stringify({ parser_gate: document.parser_gate, ...counts }));
