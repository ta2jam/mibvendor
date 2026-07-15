import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const [active, raw, compiled] = await Promise.all([
  readFile(path.join(root, "data", "mib-catalog.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "data", "license-derived-intake.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "data", "compiled-mib-intake.json"), "utf8").then(JSON.parse)
]);

const formatPriority = { active: 0, raw: 1, compiled: 2 };
const sourcePriority = {
  "osnmpd-mibs": 0,
  "ska-low-sre-vendor-mibs": 1,
  "erlang-otp-snmp": 2,
  "openss7-mibs": 3,
  "pandora-open-mibs": 4,
  "pysnmp-compiled-mibs": 5
};
const variants = [];
for (const module of active.modules) {
  variants.push({ module: module.id, format: "active", source_id: module.source_id, artifact_id: `active:${module.id}`, sha256: module.artifact_sha256, parser_status: "active-release" });
}
for (const artifact of raw.artifacts.filter((item) => item.module !== null)) {
  variants.push({ module: artifact.module, format: "raw", source_id: artifact.source_id, artifact_id: artifact.id, sha256: artifact.artifact_sha256, parser_status: artifact.parser_status });
}
for (const artifact of compiled.artifacts) {
  variants.push({ module: artifact.module, format: "compiled", source_id: artifact.source_id, artifact_id: artifact.id, sha256: artifact.artifact_sha256, parser_status: artifact.parser_status });
}

const byModule = new Map();
for (const variant of variants) {
  const values = byModule.get(variant.module) ?? [];
  values.push(variant);
  byModule.set(variant.module, values);
}
const modules = [];
for (const [module, moduleVariants] of byModule) {
  moduleVariants.sort((left, right) => formatPriority[left.format] - formatPriority[right.format]
    || (sourcePriority[left.source_id] ?? 99) - (sourcePriority[right.source_id] ?? 99)
    || left.artifact_id.localeCompare(right.artifact_id));
  const selected = moduleVariants[0];
  modules.push({
    module,
    activation_state: selected.format === "active" ? "active" : "candidate",
    selected_artifact_id: selected.artifact_id,
    selected_format: selected.format,
    selected_source_id: selected.source_id,
    selected_sha256: selected.sha256,
    selection_policy: selected.format === "active" ? "preserve-active-release" : "raw-before-compiled-then-source-priority",
    variant_count: moduleVariants.length,
    distinct_content_count: new Set(moduleVariants.map((variant) => variant.sha256)).size,
    conflict_state: moduleVariants.length === 1 ? "single" : new Set(moduleVariants.map((variant) => variant.sha256)).size === 1 ? "exact-duplicate" : "content-variants",
    variants: moduleVariants
  });
}
modules.sort((left, right) => left.module.localeCompare(right.module));
const document = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  baseline_data_release: active.data_release,
  activation_state: "candidate-not-active",
  target_unique_module_count: 550,
  counts: {
    active_modules: modules.filter((module) => module.activation_state === "active").length,
    candidate_modules: modules.filter((module) => module.activation_state === "candidate").length,
    unique_modules: modules.length,
    variants: variants.length,
    modules_with_variants: modules.filter((module) => module.variant_count > 1).length,
    content_variant_modules: modules.filter((module) => module.conflict_state === "content-variants").length,
    selected_formats: Object.fromEntries(["active", "compiled", "raw"].map((format) => [format, modules.filter((module) => module.selected_format === format).length]))
  },
  target_met_in_candidate_set: modules.length >= 550,
  manifest_sha256: null,
  modules
};
document.manifest_sha256 = createHash("sha256").update(JSON.stringify({ ...document, manifest_sha256: null })).digest("hex");
await writeFile(path.join(root, "data", "corpus-expansion-candidates.json"), `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(JSON.stringify(document.counts));
