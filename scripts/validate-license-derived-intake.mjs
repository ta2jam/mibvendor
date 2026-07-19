import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  ARTIFACT_NOTICE_EVIDENCE_CANONICALIZATION,
  ARTIFACT_RESTRICTIVE_NOTICE_RULE_IDS,
  ARTIFACT_RESTRICTIVE_NOTICE_SCANNER_VERSION,
  scanArtifactRestrictiveNotices
} from "./lib/artifact-restrictive-notices.mjs";

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
  if (manifest.schema_version !== 2) failures.push("License-derived intake schema version must be 2");
  if (!Number.isFinite(Date.parse(manifest.generated_at))) failures.push("License-derived intake generated_at is invalid");
  if (manifest.policy !== "repository-license-signal-unless-artifact-notice-conflicts") failures.push("License-derived intake policy drifted");
  if (manifest.activation_state !== "staged-not-active") failures.push("License-derived intake escaped staging");
  if (manifest.parser_gate !== "open") failures.push("License-derived intake parser gate was over-promoted");
  if (manifest.active_data_release_at_generation !== activeCatalog.data_release) failures.push("Active data release changed during intake");
  if (manifest.artifact_notice_gate?.scanner_version !== ARTIFACT_RESTRICTIVE_NOTICE_SCANNER_VERSION
    || manifest.artifact_notice_gate?.evidence_canonicalization !== ARTIFACT_NOTICE_EVIDENCE_CANONICALIZATION) failures.push("Artifact notice gate contract drifted");

  const sourceById = new Map(discovery.sources.map((source) => [source.id, source]));
  const eligibleCandidateIds = new Set(discovery.candidates
    .filter((candidate) => candidate.source_type === "mib-file"
      && candidate.publication_mode === "redistributable"
      && candidate.rights_review === "approved-by-repository-license-signal")
    .map((candidate) => candidate.id));
  const artifactIds = new Set();
  const stagedPaths = new Set();
  const stagedPathCasefolds = new Set();
  const manifestPaths = new Set();
  const excludedPaths = new Set();
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
    if (!eligibleCandidateIds.has(artifact.id)) failures.push(`Ineligible intake artifact ${artifact.id}`);
    if (artifact.license_basis !== "repository-license-signal") failures.push(`Artifact license basis drifted ${artifact.id}`);
    if (artifact.parser_status !== "not-run") failures.push(`Artifact parser state was over-promoted ${artifact.id}`);
    if (artifact.module === null && artifact.active_module_collision !== null) failures.push(`Missing-declaration artifact has a collision claim ${artifact.id}`);
    if (artifact.module !== null && typeof artifact.active_module_collision !== "boolean") failures.push(`Declared module lacks collision state ${artifact.id}`);
    const quarantined = artifact.retention_state === "metadata-only-evidence";
    if (quarantined) {
      if (artifact.publication_mode !== "quarantine"
        || artifact.activation_state !== "quarantined-not-retained"
        || artifact.intake_validation !== "restrictive-notice-conflict"
        || artifact.staged_path !== null) failures.push(`Quarantined artifact state drifted ${artifact.id}`);
      if (!safeStagedPath(artifact.excluded_staged_path)) failures.push(`Unsafe excluded staged artifact path ${artifact.id}`);
      else excludedPaths.add(artifact.excluded_staged_path);
      if (!Array.isArray(artifact.restrictive_notice_conflicts) || artifact.restrictive_notice_conflicts.length === 0) {
        failures.push(`Quarantined artifact notice evidence missing ${artifact.id}`);
      } else {
        const evidenceKeys = new Set();
        for (const evidence of artifact.restrictive_notice_conflicts) {
          const key = `${evidence.rule_id}\0${evidence.line_start}\0${evidence.line_end}`;
          if (evidenceKeys.has(key)
            || !ARTIFACT_RESTRICTIVE_NOTICE_RULE_IDS.includes(evidence.rule_id)
            || !new Set(["confidentiality", "prohibited-use-or-redistribution", "restricted-audience"]).has(evidence.category)
            || !Number.isSafeInteger(evidence.line_start)
            || !Number.isSafeInteger(evidence.line_end)
            || evidence.line_start < 1
            || evidence.line_end < evidence.line_start
            || !/^[0-9a-f]{64}$/.test(evidence.excerpt_sha256 ?? "")) failures.push(`Quarantined artifact notice evidence invalid ${artifact.id}`);
          evidenceKeys.add(key);
        }
      }
      continue;
    }
    if (artifact.retention_state !== "retained"
      || artifact.publication_mode !== "redistributable"
      || artifact.activation_state !== "staged"
      || artifact.excluded_staged_path !== null
      || !Array.isArray(artifact.restrictive_notice_conflicts)
      || artifact.restrictive_notice_conflicts.length !== 0) failures.push(`Retained artifact state drifted ${artifact.id}`);
    const expectedIntakeValidation = artifact.module === null ? "module-declaration-missing" : "module-declaration-only";
    if (artifact.intake_validation !== expectedIntakeValidation) failures.push(`Artifact parser state was over-promoted ${artifact.id}`);
    if (!safeStagedPath(artifact.staged_path)) {
      failures.push(`Unsafe staged artifact path ${artifact.id}`);
      continue;
    }
    if (stagedPaths.has(artifact.staged_path)) failures.push(`Duplicate staged path ${artifact.staged_path}`);
    stagedPaths.add(artifact.staged_path);
    const stagedPathCasefold = artifact.staged_path.normalize("NFD").toLowerCase();
    if (stagedPathCasefolds.has(stagedPathCasefold)) failures.push(`Case-insensitive staged path collision ${artifact.staged_path}`);
    stagedPathCasefolds.add(stagedPathCasefold);
    manifestPaths.add(artifact.staged_path);
    try {
      const bytes = await readFile(path.join(root, "data", artifact.staged_path));
      if (bytes.length !== artifact.bytes) failures.push(`Artifact size drifted ${artifact.id}`);
      if (sha256(bytes) !== artifact.source_sha256 || sha256(bytes) !== artifact.artifact_sha256) failures.push(`Artifact SHA-256 drifted ${artifact.id}`);
      if (gitBlobOid(bytes) !== artifact.git_blob_oid) failures.push(`Artifact Git blob drifted ${artifact.id}`);
      if (scanArtifactRestrictiveNotices(bytes.toString("utf8")).length) failures.push(`Retained artifact has a restrictive notice ${artifact.id}`);
    } catch {
      failures.push(`Missing staged artifact ${artifact.id}`);
    }
  }

  if (artifactIds.size !== eligibleCandidateIds.size || [...eligibleCandidateIds].some((id) => !artifactIds.has(id))) failures.push("Eligible MIB intake coverage drifted");
  const retainedArtifacts = (manifest.artifacts ?? []).filter((artifact) => artifact.retention_state === "retained");
  const quarantinedArtifacts = (manifest.artifacts ?? []).filter((artifact) => artifact.retention_state === "metadata-only-evidence");
  const missingDeclarationCount = retainedArtifacts.filter((artifact) => artifact.module === null).length;
  const collisionCount = retainedArtifacts.filter((artifact) => artifact.active_module_collision === true).length;
  const collisionFreeCount = retainedArtifacts.filter((artifact) => artifact.module !== null && artifact.active_module_collision === false).length;
  if (manifest.counts?.sources !== manifest.sources?.length) failures.push("Intake source count drift");
  if (manifest.counts?.artifacts !== manifest.artifacts?.length) failures.push("Intake artifact count drift");
  if (manifest.counts?.retained_artifacts !== retainedArtifacts.length) failures.push("Intake retained-artifact count drift");
  if (manifest.counts?.restrictive_notice_quarantined !== quarantinedArtifacts.length) failures.push("Intake restrictive-notice quarantine count drift");
  if (manifest.counts?.module_declaration_missing !== missingDeclarationCount) failures.push("Intake module-declaration count drift");
  if (manifest.counts?.active_module_collisions !== collisionCount) failures.push("Intake collision count drift");
  if (manifest.counts?.collision_free_candidates !== collisionFreeCount) failures.push("Intake collision-free count drift");
  for (const source of manifest.sources ?? []) {
    if (source.artifact_count !== (manifest.artifacts ?? []).filter((artifact) => artifact.source_id === source.id).length) failures.push(`Intake source artifact count drift ${source.id}`);
    if (source.retained_artifact_count !== retainedArtifacts.filter((artifact) => artifact.source_id === source.id).length) failures.push(`Intake source retained count drift ${source.id}`);
    if (source.quarantined_artifact_count !== quarantinedArtifacts.filter((artifact) => artifact.source_id === source.id).length) failures.push(`Intake source quarantine count drift ${source.id}`);
  }
  try {
    const actualPaths = (await walkFiles(path.join(root, "data", "staging", "license-derived", "raw-mibs")))
      .map((file) => path.relative(path.join(root, "data"), file));
    for (const actualPath of actualPaths) {
      if (!manifestPaths.has(actualPath)) failures.push(`Unmanifested staged file ${actualPath}`);
      if (excludedPaths.has(actualPath)) failures.push(`Quarantined raw artifact was retained ${actualPath}`);
    }
    for (const manifestPath of manifestPaths) {
      if (!actualPaths.includes(manifestPath)) failures.push(`Manifest references missing staged file ${manifestPath}`);
    }
  } catch {
    failures.push("License-derived staging directory is missing");
  }
  for (const excludedPath of excludedPaths) {
    try {
      await access(path.join(root, "data", excludedPath));
      failures.push(`Quarantined raw artifact exists ${excludedPath}`);
    } catch {
      // Absence is required.
    }
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
    console.log(`License-derived intake passed: ${manifest.counts.retained_artifacts} retained artifacts, ${manifest.counts.restrictive_notice_quarantined} restrictive-notice quarantined, ${manifest.counts.collision_free_candidates} collision-free; parser gate open.`);
  }
}
