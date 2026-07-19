import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { validateMibModuleAliases } from "./lib/mib-module-aliases.mjs";

export function validateRawMibAnalysis(candidateSet, rawIntake, activeCatalog, aliasDocument, analysis, objectDocument, typeDocument) {
  const failures = [];
  if (analysis.schema_version !== 2 || objectDocument.schema_version !== 1 || typeDocument.schema_version !== 1) failures.push("Raw MIB analysis schema versions drifted");
  if (analysis.activation_state !== "staged-not-active" || objectDocument.activation_state !== "staged-not-active" || typeDocument.activation_state !== "staged-not-active") failures.push("Raw MIB analysis escaped staging");
  if (analysis.baseline_data_release !== activeCatalog.data_release) failures.push("Raw MIB analysis baseline drifted");
  if (analysis.parser_security !== "no-source-code-execution-no-system-mib-enrichment") failures.push("Raw MIB analysis security boundary drifted");
  const expectedDigest = createHash("sha256").update(JSON.stringify({ ...analysis, manifest_sha256: null })).digest("hex");
  if (analysis.manifest_sha256 !== expectedDigest) failures.push("Raw MIB analysis manifest digest drifted");
  const selectedRows = candidateSet.modules.filter((module) => module.selected_format === "raw");
  const selectedByModule = new Map(selectedRows.map((module) => [module.module, module]));
  const artifactById = new Map(rawIntake.artifacts.map((artifact) => [artifact.id, artifact]));
  failures.push(...validateMibModuleAliases(candidateSet, rawIntake, activeCatalog, aliasDocument));
  const aliasByName = new Map((aliasDocument.aliases ?? []).map((alias) => [alias.alias, alias]));
  const moduleByName = new Map();
  for (const module of analysis.modules ?? []) {
    if (moduleByName.has(module.module)) failures.push(`Duplicate raw analysis module ${module.module}`);
    moduleByName.set(module.module, module);
    const selected = selectedByModule.get(module.module);
    if (!selected || selected.selected_artifact_id !== module.selected_artifact_id) failures.push(`Raw analysis selection drifted ${module.module}`);
    const artifact = artifactById.get(module.selected_artifact_id);
    if (!artifact || artifact.artifact_sha256 !== module.artifact_sha256 || artifact.source_id !== module.source_id) failures.push(`Raw analysis provenance drifted ${module.module}`);
    if (!new Set(["static-pass", "static-partial", "static-empty"]).has(module.parser_status)) failures.push(`Raw analysis parser status invalid ${module.module}`);
    if (module.declared_object_count !== module.resolved_object_count + module.unresolved_object_count) failures.push(`Raw analysis object counts drifted ${module.module}`);
    if (module.duplicate_symbol_count !== module.duplicate_symbols?.length || new Set(module.duplicate_symbols).size !== module.duplicate_symbols?.length) failures.push(`Raw analysis duplicate-symbol counts drifted ${module.module}`);
    if (module.dependency_count !== module.dependencies?.length || module.missing_dependency_count !== module.dependencies?.filter((dependency) => dependency.state === "missing").length) failures.push(`Raw analysis dependency counts drifted ${module.module}`);
    if ((module.dependencies ?? []).some((dependency) => !new Set(["active", "selected-raw", "selected-compiled", "alias-active", "alias-selected-raw", "alias-selected-compiled", "missing"]).has(dependency.state))) failures.push(`Raw analysis dependency state invalid ${module.module}`);
    for (const dependency of module.dependencies ?? []) {
      if (dependency.state.startsWith("alias-")) {
        const alias = aliasByName.get(dependency.module);
        if (!alias || dependency.resolved_as !== alias.canonical_module) failures.push(`Raw analysis dependency alias drifted ${module.module}:${dependency.module}`);
      } else if (dependency.resolved_as) failures.push(`Raw analysis direct dependency has alias target ${module.module}:${dependency.module}`);
    }
    if (module.semantic_definition_count !== module.declared_object_count + module.textual_convention_count + module.macro_count) failures.push(`Raw analysis semantic-definition counts drifted ${module.module}`);
    const expectedStatus = module.semantic_definition_count === 0 ? "static-empty" : module.unresolved_object_count === 0 && module.missing_dependency_count === 0 && module.duplicate_symbol_count === 0 ? "static-pass" : "static-partial";
    if (module.parser_status !== expectedStatus) failures.push(`Raw analysis parser status overclaimed ${module.module}`);
  }
  if (moduleByName.size !== selectedByModule.size || [...selectedByModule.keys()].some((module) => !moduleByName.has(module))) failures.push("Raw analysis selected-module coverage drifted");
  const objectKeys = new Set();
  const resolvedCounts = new Map();
  for (const object of objectDocument.objects ?? []) {
    const module = moduleByName.get(object.module);
    if (!module || object.source_artifact_id !== module.selected_artifact_id || object.source_id !== module.source_id) failures.push(`Raw object provenance drifted ${object.id}`);
    if (!/^\d+(?:\.\d+)*$/.test(object.oid)) failures.push(`Raw object OID invalid ${object.id}`);
    const key = `${object.module}:${object.symbol}`;
    if (objectKeys.has(key)) failures.push(`Duplicate raw object ${key}`);
    objectKeys.add(key);
    resolvedCounts.set(object.module, (resolvedCounts.get(object.module) ?? 0) + 1);
    if (object.activation_state !== "staged" || object.parser_method !== "deterministic-static-smi-no-external-execution") failures.push(`Raw object escaped staging ${object.id}`);
  }
  for (const module of analysis.modules ?? []) if (module.resolved_object_count !== (resolvedCounts.get(module.module) ?? 0)) failures.push(`Raw resolved object count drifted ${module.module}`);
  const definitionKeys = new Set();
  const textualConventionCounts = new Map();
  const macroCounts = new Map();
  for (const definition of typeDocument.definitions ?? []) {
    const module = moduleByName.get(definition.module);
    if (!module || definition.source_artifact_id !== module.selected_artifact_id || definition.source_id !== module.source_id) failures.push(`Raw type provenance drifted ${definition.module}:${definition.symbol}`);
    if (!new Set(["textual-convention", "macro"]).has(definition.kind)) failures.push(`Raw type kind invalid ${definition.module}:${definition.symbol}`);
    if (definition.kind === "textual-convention" && !definition.syntax?.trim()) failures.push(`Raw textual-convention syntax missing ${definition.module}:${definition.symbol}`);
    const key = `${definition.module}:${definition.kind}:${definition.symbol}`;
    if (definitionKeys.has(key)) failures.push(`Duplicate raw type ${key}`);
    definitionKeys.add(key);
    if (definition.activation_state !== "staged" || definition.parser_method !== "deterministic-static-smi-no-external-execution") failures.push(`Raw type escaped staging ${key}`);
    const counts = definition.kind === "textual-convention" ? textualConventionCounts : macroCounts;
    counts.set(definition.module, (counts.get(definition.module) ?? 0) + 1);
  }
  for (const module of analysis.modules ?? []) {
    if (module.textual_convention_count !== (textualConventionCounts.get(module.module) ?? 0)) failures.push(`Raw textual-convention count drifted ${module.module}`);
    if (module.macro_count !== (macroCounts.get(module.module) ?? 0)) failures.push(`Raw macro count drifted ${module.module}`);
  }
  const expectedCounts = {
    modules: analysis.modules?.length ?? 0,
    static_pass: analysis.modules?.filter((module) => module.parser_status === "static-pass").length ?? 0,
    static_partial: analysis.modules?.filter((module) => module.parser_status === "static-partial").length ?? 0,
    static_empty: analysis.modules?.filter((module) => module.parser_status === "static-empty").length ?? 0,
    declared_objects: analysis.modules?.reduce((sum, module) => sum + module.declared_object_count, 0) ?? 0,
    resolved_objects: objectDocument.objects?.length ?? 0,
    unresolved_objects: analysis.modules?.reduce((sum, module) => sum + module.unresolved_object_count, 0) ?? 0,
    textual_conventions: analysis.modules?.reduce((sum, module) => sum + module.textual_convention_count, 0) ?? 0,
    macros: analysis.modules?.reduce((sum, module) => sum + module.macro_count, 0) ?? 0,
    semantic_definitions: analysis.modules?.reduce((sum, module) => sum + module.semantic_definition_count, 0) ?? 0,
    duplicate_symbols: analysis.modules?.reduce((sum, module) => sum + module.duplicate_symbol_count, 0) ?? 0,
    modules_with_duplicate_symbols: analysis.modules?.filter((module) => module.duplicate_symbol_count > 0).length ?? 0,
    missing_dependency_edges: analysis.modules?.reduce((sum, module) => sum + module.missing_dependency_count, 0) ?? 0,
    modules_with_missing_dependencies: analysis.modules?.filter((module) => module.missing_dependency_count > 0).length ?? 0
  };
  if (JSON.stringify(analysis.counts) !== JSON.stringify(expectedCounts)) failures.push("Raw MIB analysis top-level counts drifted");
  const expectedGate = expectedCounts.static_pass === expectedCounts.modules ? "passed" : "open";
  if (analysis.parser_gate !== expectedGate) failures.push("Raw MIB parser gate claim drifted");
  return failures;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const [candidateSet, rawIntake, activeCatalog, aliases, analysis, objects, types] = await Promise.all([
    readFile(path.join(root, "data", "corpus-expansion-candidates.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "data", "license-derived-intake.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "data", "mib-catalog.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "data", "mib-module-aliases.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "data", "raw-mib-analysis.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "data", "raw-mib-objects-staging.json.gz")).then((bytes) => JSON.parse(gunzipSync(bytes))),
    readFile(path.join(root, "data", "raw-mib-types-staging.json.gz")).then((bytes) => JSON.parse(gunzipSync(bytes)))
  ]);
  const failures = validateRawMibAnalysis(candidateSet, rawIntake, activeCatalog, aliases, analysis, objects, types);
  if (failures.length) { for (const failure of failures) console.error(failure); process.exitCode = 1; }
  else console.log(`Raw MIB analysis passed: ${analysis.counts.modules} selected modules, ${analysis.counts.resolved_objects} resolved objects; parser gate ${analysis.parser_gate}.`);
}
