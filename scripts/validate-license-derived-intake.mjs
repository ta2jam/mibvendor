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

function safeStagedPath(stagedPath) {
  return typeof stagedPath === "string"
    && stagedPath.startsWith("staging/license-derived/raw-mibs/")
    && !path.isAbsolute(stagedPath)
    && !stagedPath.split("/").includes("..");
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

export async function validateLicenseDerivedIntake(root, discovery, activeCatalog, manifest) {
  const failures = [];
  if (manifest.schema_version !== 1) failures.push("License-derived intake schema version must be 1");
  if (!Number.isFinite(Date.parse(manifest.generated_at))) failures.push("License-derived intake generated_at is invalid");
  if (manifest.policy !== "repository-license-signal-is-publication-permission") failures.push("License-derived intake policy drifted");
  if (manifest.activation_state !== "staged-not-active") failures.push("License-derived intake escaped staging");
  if (manifest.parser_gate !== "open") failures.push("License-derived intake parser gate was over-promoted");
  if (manifest.active_data_release_at_generation !== activeCatalog.data_release) failures.push("Active data release changed during intake");

  const sourceById = new Map(discovery.sources.map((source) => [source.id, source]));
  const eligibleCandidateIds = new Set(discovery.candidates
    .filter((candidate) => candidate.source_type === "mib-file"
      && candidate.publication_mode === "redistributable"
      && candidate.rights_review === "approved-by-repository-license-signal")
    .map((candidate) => candidate.id));
  const artifactIds = new Set();
  const stagedPaths = new Set();
  const manifestPaths = new Set();
  for (const source of manifest.sources ?? []) {
    const discoveredSource = sourceById.get(source.id);
    if (!discoveredSource) failures.push(`Unknown intake source ${source.id}`);
    if (discoveredSource?.repository_license.status !== "license-derived-approval") failures.push(`Intake source lacks license-derived approval ${source.id}`);
    if (source.commit !== discoveredSource?.commit) failures.push(`Intake source revision drifted ${source.id}`);
    if (source.license?.spdx === "NOASSERTION" || source.license?.spdx !== discoveredSource?.repository_license.spdx) failures.push(`Intake source license drifted ${source.id}`);
    if (!Array.isArray(source.license?.files) || source.license.files.length === 0) failures.push(`Intake source has no retained license ${source.id}`);
    for (const licenseFile of source.license?.files ?? []) {
      if (!safeStagedPath(licenseFile.staged_path)) {
        failures.push(`Unsafe staged license path ${source.id}`);
        continue;
      }
      manifestPaths.add(licenseFile.staged_path);
      try {
        const bytes = await readFile(path.join(root, "data", licenseFile.staged_path));
        if (sha256(bytes) !== licenseFile.sha256) failures.push(`License SHA-256 drifted ${source.id}:${licenseFile.source_path}`);
        if (gitBlobOid(bytes) !== licenseFile.git_blob_oid) failures.push(`License Git blob drifted ${source.id}:${licenseFile.source_path}`);
      } catch {
        failures.push(`Missing staged license ${source.id}:${licenseFile.source_path}`);
      }
    }
  }

  for (const artifact of manifest.artifacts ?? []) {
    if (artifactIds.has(artifact.id)) failures.push(`Duplicate intake artifact ${artifact.id}`);
    artifactIds.add(artifact.id);
    if (stagedPaths.has(artifact.staged_path)) failures.push(`Duplicate staged path ${artifact.staged_path}`);
    stagedPaths.add(artifact.staged_path);
    manifestPaths.add(artifact.staged_path);
    if (!eligibleCandidateIds.has(artifact.id)) failures.push(`Ineligible intake artifact ${artifact.id}`);
    if (artifact.license_basis !== "repository-license-signal") failures.push(`Artifact license basis drifted ${artifact.id}`);
    if (artifact.publication_mode !== "redistributable") failures.push(`Artifact publication mode drifted ${artifact.id}`);
    if (artifact.activation_state !== "staged") failures.push(`Artifact escaped staging ${artifact.id}`);
    const expectedIntakeValidation = artifact.module === null ? "module-declaration-missing" : "module-declaration-only";
    if (artifact.intake_validation !== expectedIntakeValidation || artifact.parser_status !== "not-run") failures.push(`Artifact parser state was over-promoted ${artifact.id}`);
    if (artifact.module === null && artifact.active_module_collision !== null) failures.push(`Missing-declaration artifact has a collision claim ${artifact.id}`);
    if (artifact.module !== null && typeof artifact.active_module_collision !== "boolean") failures.push(`Declared module lacks collision state ${artifact.id}`);
    if (!safeStagedPath(artifact.staged_path)) {
      failures.push(`Unsafe staged artifact path ${artifact.id}`);
      continue;
    }
    try {
      const bytes = await readFile(path.join(root, "data", artifact.staged_path));
      if (bytes.length !== artifact.bytes) failures.push(`Artifact size drifted ${artifact.id}`);
      if (sha256(bytes) !== artifact.source_sha256 || sha256(bytes) !== artifact.artifact_sha256) failures.push(`Artifact SHA-256 drifted ${artifact.id}`);
      if (gitBlobOid(bytes) !== artifact.git_blob_oid) failures.push(`Artifact Git blob drifted ${artifact.id}`);
    } catch {
      failures.push(`Missing staged artifact ${artifact.id}`);
    }
  }

  if (artifactIds.size !== eligibleCandidateIds.size || [...eligibleCandidateIds].some((id) => !artifactIds.has(id))) failures.push("Eligible MIB intake coverage drifted");
  const missingDeclarationCount = (manifest.artifacts ?? []).filter((artifact) => artifact.module === null).length;
  const collisionCount = (manifest.artifacts ?? []).filter((artifact) => artifact.active_module_collision === true).length;
  const collisionFreeCount = (manifest.artifacts ?? []).filter((artifact) => artifact.module !== null && artifact.active_module_collision === false).length;
  if (manifest.counts?.sources !== manifest.sources?.length) failures.push("Intake source count drift");
  if (manifest.counts?.artifacts !== manifest.artifacts?.length) failures.push("Intake artifact count drift");
  if (manifest.counts?.module_declaration_missing !== missingDeclarationCount) failures.push("Intake module-declaration count drift");
  if (manifest.counts?.active_module_collisions !== collisionCount) failures.push("Intake collision count drift");
  if (manifest.counts?.collision_free_candidates !== collisionFreeCount) failures.push("Intake collision-free count drift");
  for (const source of manifest.sources ?? []) {
    if (source.artifact_count !== (manifest.artifacts ?? []).filter((artifact) => artifact.source_id === source.id).length) failures.push(`Intake source artifact count drift ${source.id}`);
  }
  try {
    const actualPaths = (await walkFiles(path.join(root, "data", "staging", "license-derived", "raw-mibs")))
      .map((file) => path.relative(path.join(root, "data"), file));
    for (const actualPath of actualPaths) {
      if (!manifestPaths.has(actualPath)) failures.push(`Unmanifested staged file ${actualPath}`);
    }
    for (const manifestPath of manifestPaths) {
      if (!actualPaths.includes(manifestPath)) failures.push(`Manifest references missing staged file ${manifestPath}`);
    }
  } catch {
    failures.push("License-derived staging directory is missing");
  }
  return failures;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const discovery = JSON.parse(await readFile(path.join(root, "data", "source-discovery.json"), "utf8"));
  const activeCatalog = JSON.parse(await readFile(path.join(root, "data", "mib-catalog.json"), "utf8"));
  const manifest = JSON.parse(await readFile(path.join(root, "data", "license-derived-intake.json"), "utf8"));
  const failures = await validateLicenseDerivedIntake(root, discovery, activeCatalog, manifest);
  if (failures.length) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
  } else {
    console.log(`License-derived intake passed: ${manifest.counts.artifacts} staged artifacts, ${manifest.counts.collision_free_candidates} collision-free; parser gate open.`);
  }
}
