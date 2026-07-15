import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function gitBlobOid(bytes) {
  return createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest("hex");
}
function safePath(value) {
  return typeof value === "string" && value.startsWith("staging/license-derived/compiled-mibs/")
    && !path.isAbsolute(value) && !value.split("/").includes("..");
}
async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(absolute));
    else files.push(absolute);
  }
  return files;
}

export async function validateCompiledMibIntake(root, discovery, activeCatalog, manifest, objectDocument) {
  const failures = [];
  if (manifest.schema_version !== 1 || objectDocument.schema_version !== 1) failures.push("Compiled MIB intake schema version must be 1");
  if (manifest.activation_state !== "staged-not-active" || objectDocument.activation_state !== "staged-not-active") failures.push("Compiled MIB intake escaped staging");
  if (manifest.parser_security !== "static-analysis-only-no-python-execution") failures.push("Compiled MIB parser security boundary drifted");
  if (manifest.active_data_release_at_generation !== activeCatalog.data_release) failures.push("Compiled MIB active release drifted");
  const eligibleIds = new Set(discovery.candidates.filter((candidate) => candidate.source_type === "compiled-mib-module"
    && candidate.publication_mode === "redistributable" && candidate.rights_review === "approved-by-repository-license-signal").map((candidate) => candidate.id));
  const sourceById = new Map(discovery.sources.map((source) => [source.id, source]));
  const artifactById = new Map();
  const manifestPaths = new Set();
  for (const source of manifest.sources ?? []) {
    const discovered = sourceById.get(source.id);
    if (discovered?.repository_license.status !== "license-derived-approval") failures.push(`Compiled MIB source lacks approval ${source.id}`);
    if (source.commit !== discovered?.commit || source.license?.spdx !== discovered?.repository_license.spdx) failures.push(`Compiled MIB source provenance drifted ${source.id}`);
    if (!source.license?.files?.length) failures.push(`Compiled MIB source license missing ${source.id}`);
    for (const licenseFile of source.license?.files ?? []) {
      if (!safePath(licenseFile.staged_path)) { failures.push(`Unsafe compiled MIB license path ${source.id}`); continue; }
      manifestPaths.add(licenseFile.staged_path);
      try {
        const bytes = await readFile(path.join(root, "data", licenseFile.staged_path));
        if (sha256(bytes) !== licenseFile.sha256 || gitBlobOid(bytes) !== licenseFile.git_blob_oid) failures.push(`Compiled MIB license hash drifted ${source.id}`);
      } catch { failures.push(`Compiled MIB license missing ${source.id}`); }
    }
  }
  for (const artifact of manifest.artifacts ?? []) {
    if (artifactById.has(artifact.id)) failures.push(`Duplicate compiled MIB artifact ${artifact.id}`);
    artifactById.set(artifact.id, artifact);
    if (!eligibleIds.has(artifact.id)) failures.push(`Ineligible compiled MIB artifact ${artifact.id}`);
    if (!safePath(artifact.staged_path)) { failures.push(`Unsafe compiled MIB artifact path ${artifact.id}`); continue; }
    manifestPaths.add(artifact.staged_path);
    if (artifact.parser_method !== "static-regex-no-execution" || !["static-pass", "static-pass-with-warnings"].includes(artifact.parser_status)) failures.push(`Compiled MIB parser status drifted ${artifact.id}`);
    if (artifact.license_basis !== "repository-license-signal" || artifact.publication_mode !== "redistributable" || artifact.activation_state !== "staged") failures.push(`Compiled MIB publication state drifted ${artifact.id}`);
    try {
      const bytes = await readFile(path.join(root, "data", artifact.staged_path));
      if (bytes.length !== artifact.bytes || sha256(bytes) !== artifact.artifact_sha256 || sha256(bytes) !== artifact.source_sha256 || gitBlobOid(bytes) !== artifact.git_blob_oid) failures.push(`Compiled MIB artifact hash drifted ${artifact.id}`);
    } catch { failures.push(`Compiled MIB artifact missing ${artifact.id}`); }
  }
  if (artifactById.size !== eligibleIds.size || [...eligibleIds].some((id) => !artifactById.has(id))) failures.push("Compiled MIB intake coverage drifted");
  const objectKeys = new Set();
  const objectCounts = new Map();
  for (const object of objectDocument.objects ?? []) {
    const artifact = artifactById.get(object.source_artifact_id);
    if (!artifact) failures.push(`Compiled object has unknown artifact ${object.id}`);
    if (!/^\d+(?:\.\d+)*$/.test(object.oid)) failures.push(`Compiled object has invalid OID ${object.id}`);
    const key = `${object.source_artifact_id}:${object.module}:${object.symbol}`;
    if (objectKeys.has(key)) failures.push(`Duplicate compiled object ${key}`);
    objectKeys.add(key);
    objectCounts.set(object.source_artifact_id, (objectCounts.get(object.source_artifact_id) ?? 0) + 1);
    if (artifact && object.module !== artifact.module) failures.push(`Compiled object module drifted ${object.id}`);
    if (object.parser_method !== "static-regex-no-execution") failures.push(`Compiled object parser method drifted ${object.id}`);
  }
  for (const artifact of manifest.artifacts ?? []) {
    if (artifact.object_count !== (objectCounts.get(artifact.id) ?? 0)) failures.push(`Compiled artifact object count drifted ${artifact.id}`);
  }
  const warningCount = (manifest.artifacts ?? []).filter((artifact) => artifact.parser_warnings.length > 0).length;
  const collisionCount = (manifest.artifacts ?? []).filter((artifact) => artifact.active_module_collision).length;
  if (manifest.counts?.sources !== manifest.sources?.length || manifest.counts?.artifacts !== manifest.artifacts?.length || manifest.counts?.objects !== objectDocument.objects?.length) failures.push("Compiled MIB top-level count drift");
  if (manifest.counts?.parser_warning_artifacts !== warningCount || manifest.counts?.active_module_collisions !== collisionCount || manifest.counts?.collision_free_modules !== (manifest.artifacts?.length ?? 0) - collisionCount) failures.push("Compiled MIB classification count drift");
  try {
    const actualPaths = (await walkFiles(path.join(root, "data", "staging", "license-derived", "compiled-mibs"))).map((file) => path.relative(path.join(root, "data"), file));
    for (const actualPath of actualPaths) if (!manifestPaths.has(actualPath)) failures.push(`Unmanifested compiled MIB file ${actualPath}`);
    for (const manifestPath of manifestPaths) if (!actualPaths.includes(manifestPath)) failures.push(`Missing manifest compiled MIB file ${manifestPath}`);
  } catch { failures.push("Compiled MIB staging directory is missing"); }
  return failures;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const [discovery, activeCatalog, manifest, objects] = await Promise.all([
    readFile(path.join(root, "data", "source-discovery.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "data", "mib-catalog.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "data", "compiled-mib-intake.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "data", "compiled-mib-objects-staging.json"), "utf8").then(JSON.parse)
  ]);
  const failures = await validateCompiledMibIntake(root, discovery, activeCatalog, manifest, objects);
  if (failures.length) { for (const failure of failures) console.error(failure); process.exitCode = 1; }
  else console.log(`Compiled MIB intake passed: ${manifest.counts.artifacts} modules, ${manifest.counts.objects} static objects; no Python executed.`);
}
