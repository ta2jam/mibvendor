import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export function validateCorpusExpansionCandidates(active, raw, compiled, document) {
  const failures = [];
  if (document.schema_version !== 1) failures.push("Corpus candidate schema version must be 1");
  if (document.activation_state !== "candidate-not-active") failures.push("Corpus candidates escaped staging");
  if (document.baseline_data_release !== active.data_release) failures.push("Corpus candidate baseline drifted");
  if (document.target_unique_module_count !== 550) failures.push("Corpus candidate target drifted");
  const expectedDigest = createHash("sha256").update(JSON.stringify({ ...document, manifest_sha256: null })).digest("hex");
  if (document.manifest_sha256 !== expectedDigest) failures.push("Corpus candidate manifest digest drifted");
  const moduleNames = new Set();
  const selectedArtifacts = new Set();
  const knownArtifacts = new Set([
    ...active.modules.map((module) => `active:${module.id}`),
    ...raw.artifacts.filter((artifact) => artifact.module !== null).map((artifact) => artifact.id),
    ...compiled.artifacts.map((artifact) => artifact.id)
  ]);
  for (const module of document.modules ?? []) {
    if (moduleNames.has(module.module)) failures.push(`Duplicate corpus candidate module ${module.module}`);
    moduleNames.add(module.module);
    if (!knownArtifacts.has(module.selected_artifact_id)) failures.push(`Unknown selected corpus artifact ${module.module}`);
    if (selectedArtifacts.has(module.selected_artifact_id)) failures.push(`Selected corpus artifact reused ${module.selected_artifact_id}`);
    selectedArtifacts.add(module.selected_artifact_id);
    if (!module.variants?.some((variant) => variant.artifact_id === module.selected_artifact_id)) failures.push(`Selected corpus artifact absent from variants ${module.module}`);
    if (module.variant_count !== module.variants?.length) failures.push(`Corpus variant count drifted ${module.module}`);
    const distinct = new Set((module.variants ?? []).map((variant) => variant.sha256)).size;
    if (module.distinct_content_count !== distinct) failures.push(`Corpus distinct content count drifted ${module.module}`);
    const expectedConflict = module.variant_count === 1 ? "single" : distinct === 1 ? "exact-duplicate" : "content-variants";
    if (module.conflict_state !== expectedConflict) failures.push(`Corpus conflict state drifted ${module.module}`);
    if (module.activation_state === "active" && module.selected_format !== "active") failures.push(`Active corpus module selection drifted ${module.module}`);
    if (module.activation_state === "candidate" && module.selected_format === "active") failures.push(`Candidate corpus module selection drifted ${module.module}`);
  }
  const variants = (document.modules ?? []).reduce((count, module) => count + module.variant_count, 0);
  const activeCount = (document.modules ?? []).filter((module) => module.activation_state === "active").length;
  const candidateCount = (document.modules ?? []).filter((module) => module.activation_state === "candidate").length;
  if (document.counts?.unique_modules !== document.modules?.length || document.counts?.variants !== variants) failures.push("Corpus candidate top-level count drift");
  if (document.counts?.active_modules !== activeCount || document.counts?.candidate_modules !== candidateCount) failures.push("Corpus candidate state count drift");
  const selectedFormats = Object.fromEntries(["active", "compiled", "raw"].map((format) => [format, (document.modules ?? []).filter((module) => module.selected_format === format).length]));
  if (JSON.stringify(document.counts?.selected_formats) !== JSON.stringify(selectedFormats)) failures.push("Corpus candidate format count drift");
  if (document.target_met_in_candidate_set !== ((document.modules?.length ?? 0) >= document.target_unique_module_count)) failures.push("Corpus candidate target claim drift");
  if ((document.modules?.length ?? 0) < 550) failures.push("Corpus candidate unique module target not met");
  return failures;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const [active, raw, compiled, document] = await Promise.all([
    readFile(path.join(root, "data", "mib-catalog.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "data", "license-derived-intake.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "data", "compiled-mib-intake.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "data", "corpus-expansion-candidates.json"), "utf8").then(JSON.parse)
  ]);
  const failures = validateCorpusExpansionCandidates(active, raw, compiled, document);
  if (failures.length) { for (const failure of failures) console.error(failure); process.exitCode = 1; }
  else console.log(`Corpus candidate inventory passed: ${document.counts.unique_modules} unique modules across ${document.counts.variants} variants.`);
}
