import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  ARTIFACT_NOTICE_EVIDENCE_CANONICALIZATION,
  ARTIFACT_RESTRICTIVE_NOTICE_SCANNER_VERSION,
  scanArtifactRestrictiveNotices
} from "./lib/artifact-restrictive-notices.mjs";

const root = process.cwd();
const discovery = JSON.parse(await readFile(path.join(root, "data", "source-discovery.json"), "utf8"));
const activeCatalog = JSON.parse(await readFile(path.join(root, "data", "mib-catalog.json"), "utf8"));
const outputRoot = path.join(root, "data", "staging", "license-derived", "raw-mibs");
const manifestPath = path.join(root, "data", "license-derived-intake.json");

function digest(algorithm, bytes) {
  return createHash(algorithm).update(bytes).digest("hex");
}

function gitBlobOid(bytes) {
  return digest("sha1", Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]));
}

function moduleName(text) {
  return text.match(/^\s*([A-Za-z][A-Za-z0-9-]*)\s+DEFINITIONS(?:\s+IMPLICIT\s+TAGS)?\s*::=\s*BEGIN/m)?.[1] ?? null;
}

async function fetchBytes(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "mibvendor-license-derived-intake/1 (+https://mibvendor.io)" },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Could not fetch ${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function mapLimit(values, limit, task) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

function safeRelative(candidatePath) {
  if (!candidatePath || path.isAbsolute(candidatePath) || candidatePath.split("/").includes("..")) {
    throw new Error(`Unsafe intake path: ${candidatePath}`);
  }
  return candidatePath;
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const sourceById = new Map(discovery.sources.map((source) => [source.id, source]));
const activeModuleIds = new Set(activeCatalog.modules.map((module) => module.id));
const candidates = discovery.candidates.filter((candidate) => candidate.source_type === "mib-file"
  && candidate.publication_mode === "redistributable"
  && candidate.rights_review === "approved-by-repository-license-signal");

const stagedPathKeys = new Map();
for (const candidate of candidates) {
  const candidatePath = path.join(candidate.source_id, "files", safeRelative(candidate.path));
  const key = candidatePath.normalize("NFD").toLowerCase();
  stagedPathKeys.set(key, (stagedPathKeys.get(key) ?? 0) + 1);
}

function stagedArtifactPath(candidate) {
  const candidatePath = path.join(candidate.source_id, "files", safeRelative(candidate.path));
  const key = candidatePath.normalize("NFD").toLowerCase();
  if (stagedPathKeys.get(key) === 1) return candidatePath;
  const parsed = path.parse(candidatePath);
  const suffix = digest("sha256", candidate.id).slice(0, 12);
  return path.join(parsed.dir, `${parsed.name}.case-${suffix}${parsed.ext}`);
}

const artifacts = await mapLimit(candidates, 8, async (candidate) => {
  const source = sourceById.get(candidate.source_id);
  if (!source || source.repository_license.status !== "license-derived-approval") {
    throw new Error(`Candidate has no license-derived source approval: ${candidate.id}`);
  }
  const bytes = await fetchBytes(candidate.pinned_url);
  const actualGitBlobOid = gitBlobOid(bytes);
  if (actualGitBlobOid !== candidate.git_blob_oid) {
    throw new Error(`Git blob mismatch for ${candidate.id}: expected ${candidate.git_blob_oid}, got ${actualGitBlobOid}`);
  }
  const module = moduleName(bytes.toString("utf8"));
  const restrictiveNoticeConflicts = scanArtifactRestrictiveNotices(bytes.toString("utf8"));
  const relativeOutputPath = stagedArtifactPath(candidate);
  const absoluteOutputPath = path.join(outputRoot, relativeOutputPath);
  if (restrictiveNoticeConflicts.length === 0) {
    await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
    await writeFile(absoluteOutputPath, bytes);
  }
  return {
    id: candidate.id,
    source_id: candidate.source_id,
    module,
    source_path: candidate.path,
    staged_path: restrictiveNoticeConflicts.length === 0 ? path.relative(path.join(root, "data"), absoluteOutputPath) : null,
    excluded_staged_path: restrictiveNoticeConflicts.length === 0 ? null : path.relative(path.join(root, "data"), absoluteOutputPath),
    pinned_url: candidate.pinned_url,
    source_revision: source.commit,
    git_blob_oid: candidate.git_blob_oid,
    bytes: bytes.length,
    source_sha256: digest("sha256", bytes),
    artifact_sha256: digest("sha256", bytes),
    license_spdx: source.repository_license.spdx,
    license_basis: "repository-license-signal",
    publication_mode: restrictiveNoticeConflicts.length === 0 ? "redistributable" : "quarantine",
    activation_state: restrictiveNoticeConflicts.length === 0 ? "staged" : "quarantined-not-retained",
    retention_state: restrictiveNoticeConflicts.length === 0 ? "retained" : "metadata-only-evidence",
    intake_validation: restrictiveNoticeConflicts.length > 0
      ? "restrictive-notice-conflict"
      : module
        ? "module-declaration-only"
        : "module-declaration-missing",
    restrictive_notice_conflicts: restrictiveNoticeConflicts,
    parser_status: "not-run",
    active_module_collision: module ? activeModuleIds.has(module) : null
  };
});

const sourceIds = [...new Set(artifacts.map((artifact) => artifact.source_id))].sort();
const sources = [];
for (const sourceId of sourceIds) {
  const source = sourceById.get(sourceId);
  const licenseFiles = [];
  for (const licenseFile of source.repository_license.files) {
    const bytes = await fetchBytes(licenseFile.pinned_url);
    const actualGitBlobOid = gitBlobOid(bytes);
    if (actualGitBlobOid !== licenseFile.git_blob_oid) {
      throw new Error(`License Git blob mismatch for ${sourceId}:${licenseFile.path}`);
    }
    const relativeOutputPath = path.join(sourceId, "licenses", safeRelative(licenseFile.path));
    const absoluteOutputPath = path.join(outputRoot, relativeOutputPath);
    await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
    await writeFile(absoluteOutputPath, bytes);
    licenseFiles.push({
      source_path: licenseFile.path,
      staged_path: path.relative(path.join(root, "data"), absoluteOutputPath),
      pinned_url: licenseFile.pinned_url,
      git_blob_oid: licenseFile.git_blob_oid,
      sha256: digest("sha256", bytes)
    });
  }
  sources.push({
    id: source.id,
    repository: source.repository,
    commit: source.commit,
    license: {
      spdx: source.repository_license.spdx,
      name: source.repository_license.name,
      basis: "repository-license-signal",
      files: licenseFiles
    },
    artifact_count: artifacts.filter((artifact) => artifact.source_id === source.id).length,
    retained_artifact_count: artifacts.filter((artifact) => artifact.source_id === source.id && artifact.retention_state === "retained").length,
    quarantined_artifact_count: artifacts.filter((artifact) => artifact.source_id === source.id && artifact.retention_state === "metadata-only-evidence").length
  });
}

artifacts.sort((left, right) => left.id.localeCompare(right.id));
const manifest = {
  schema_version: 2,
  generated_at: new Date().toISOString(),
  policy: "repository-license-signal-unless-artifact-notice-conflicts",
  activation_state: "staged-not-active",
  parser_gate: "open",
  active_data_release_at_generation: activeCatalog.data_release,
  artifact_notice_gate: {
    scanner_version: ARTIFACT_RESTRICTIVE_NOTICE_SCANNER_VERSION,
    policy: "direct restrictive, prohibitive, or confidential artifact notice overrides a repository-license signal",
    excluded_non_signals: ["copyright notice", "all rights reserved", "trademark notice"],
    evidence_canonicalization: ARTIFACT_NOTICE_EVIDENCE_CANONICALIZATION
  },
  counts: {
    sources: sources.length,
    artifacts: artifacts.length,
    retained_artifacts: artifacts.filter((artifact) => artifact.retention_state === "retained").length,
    restrictive_notice_quarantined: artifacts.filter((artifact) => artifact.retention_state === "metadata-only-evidence").length,
    module_declaration_missing: artifacts.filter((artifact) => artifact.retention_state === "retained" && artifact.module === null).length,
    active_module_collisions: artifacts.filter((artifact) => artifact.retention_state === "retained" && artifact.active_module_collision === true).length,
    collision_free_candidates: artifacts.filter((artifact) => artifact.retention_state === "retained" && artifact.module !== null && artifact.active_module_collision === false).length
  },
  sources,
  artifacts
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify(manifest.counts));
