import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { canonicalJsonSha256 } from "./canonical-json.mjs";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SOURCE_ID = "librenms-os-detection";
const SOURCE_REVISION = "dfba713a2ffd39c2b6619cccdec016e04a06a027";
const SOURCE_TREE = "cea8a6f237abf69eb9ce419873b6e22ef1ae91db";
const DATASET_ID = "librenms-platform-prefixes-2026-07-20.1";
const INPUT_ROOT = "resources/definitions/os_detection";
const ENTERPRISE_ROOT = [1, 3, 6, 1, 4, 1];
const QUARANTINE_REASONS = new Set([
  "conditional-clause", "multi-platform-prefix", "outside-enterprise-tree", "pen-root-only", "shared-net-snmp-agent",
]);
const EXPECTED_CONFLICT_PREFIXES = [
  "1.3.6.1.4.1.193.81.1.1.3",
  "1.3.6.1.4.1.1916.2",
  "1.3.6.1.4.1.3373.1103",
].sort(compareOid);
const EXPECTED_MEASUREMENTS = {
  input_files: 806,
  files_with_discovery: 803,
  discovery_clauses: 898,
  sys_object_id_clauses: 721,
  sys_object_id_literals: 1_013,
  conditional_literals: 222,
  unconditional_literals: 791,
  quarantined_non_enterprise_literals: 6,
  quarantined_pen_root_literals: 124,
  quarantined_shared_agent_prefixes: 3,
  quarantined_multi_platform_prefixes: 3,
  published_prefixes: 655,
  platforms: 406,
  enterprises: 266,
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareOid(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function withoutField(document, field) {
  return Object.fromEntries(Object.entries(document).filter(([key]) => key !== field));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function unexpectedKeys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["<not-an-object>"];
  return Object.keys(value).filter((key) => !allowed.has(key));
}

function oidParts(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)*$/.test(value)) return null;
  const tokens = value.split(".");
  if (tokens.some((token) => token.length > 1 && token.startsWith("0"))) return null;
  const arcs = tokens.map(Number);
  if (arcs.some((arc) => !Number.isSafeInteger(arc) || arc < 0 || arc > 0xffffffff)) return null;
  return arcs;
}

function underInputRoot(sourcePath) {
  return typeof sourcePath === "string"
    && sourcePath.startsWith(`${INPUT_ROOT}/`)
    && sourcePath.endsWith(".yaml")
    && !sourcePath.split("/").includes("..");
}

export function validateProjectIdentityPrefixes(manifest, dataset) {
  const failures = [];
  const manifestKeys = new Set(["schema_version", "dataset_id", "source", "policy", "limits", "inputs", "measurements", "input_total_bytes", "manifest_sha256"]);
  const datasetKeys = new Set(["schema_version", "dataset_id", "generated_at", "layer", "publication_mode", "raw_distribution", "dataset_license", "source_manifest_sha256", "dataset_sha256", "counts", "sources", "prefixes", "quarantine"]);
  for (const key of unexpectedKeys(manifest, manifestKeys)) failures.push(`Unexpected manifest field ${key}`);
  for (const key of unexpectedKeys(dataset, datasetKeys)) failures.push(`Unexpected dataset field ${key}`);
  if (manifest.schema_version !== 1 || dataset.schema_version !== 1) failures.push("Project prefix schema version must be 1");
  if (manifest.dataset_id !== DATASET_ID || dataset.dataset_id !== DATASET_ID) failures.push("Project prefix dataset id drifted");
  if (manifest.manifest_sha256 !== canonicalJsonSha256(withoutField(manifest, "manifest_sha256"))) failures.push("Project prefix manifest digest drifted");
  if (dataset.dataset_sha256 !== canonicalJsonSha256(withoutField(dataset, "dataset_sha256"))) failures.push("Project prefix dataset digest drifted");
  if (dataset.source_manifest_sha256 !== manifest.manifest_sha256) failures.push("Project prefix dataset is not bound to its manifest");
  if (dataset.generated_at !== null || dataset.layer !== "open-source-project-platform-prefixes"
    || dataset.publication_mode !== "definition-only" || dataset.raw_distribution !== "not-provided") failures.push("Project prefix publication boundary drifted");
  if (!sameJson(manifest.measurements, EXPECTED_MEASUREMENTS)) failures.push("Project prefix measurements drifted");

  const source = manifest.source;
  if (source?.id !== SOURCE_ID || source?.repository !== "librenms/librenms" || source?.revision !== SOURCE_REVISION
    || source?.source_date !== "2026-07-18" || source?.input_root !== INPUT_ROOT || source?.input_tree_git_oid !== SOURCE_TREE
    || source?.parser !== "librenms-os-detection-yaml-v1") failures.push("Project prefix source provenance drifted");
  if (source?.license_scope !== "resources/definitions/os_detection-derived-platform-prefixes"
    || source?.license?.status !== "approved" || source?.license?.spdx !== "GPL-3.0-or-later"
    || source?.license?.classifier !== "manual-pinned-content-v1" || source?.license?.failures?.length !== 0
    || source?.license?.evidence?.length !== 2) failures.push("Project prefix license decision drifted");
  if (!source?.commit_url?.includes(SOURCE_REVISION)) failures.push("Project prefix source URL is not immutable");
  if (manifest.policy?.raw_yaml_retained !== false || manifest.policy?.source_descriptions_retained !== false
    || manifest.policy?.copied_vendor_mib_content_retained !== false || manifest.policy?.model_or_family_claims !== false
    || manifest.policy?.match_method !== "arc-bound-longest-prefix" || manifest.policy?.exact_identity_precedence !== true
    || !sameJson(manifest.policy?.accepted_clause_keys, ["sysObjectID"])) failures.push("Project prefix policy drifted");
  if (manifest.limits?.max_files !== 1_000 || manifest.limits?.max_file_bytes !== 8_192
    || manifest.limits?.max_total_bytes !== 1_048_576) failures.push("Project prefix resource limits drifted");

  const inputByPath = new Map();
  let totalBytes = 0;
  let previousPath = null;
  for (const input of manifest.inputs ?? []) {
    for (const key of unexpectedKeys(input, new Set(["path", "mode", "git_blob_oid", "sha256", "bytes"]))) failures.push(`Unexpected input field ${key}`);
    if (!underInputRoot(input.path)) failures.push(`Unsafe prefix input path ${input.path}`);
    if (inputByPath.has(input.path)) failures.push(`Duplicate prefix input path ${input.path}`);
    if (previousPath !== null && previousPath.localeCompare(input.path) >= 0) failures.push(`Prefix inputs are not sorted at ${input.path}`);
    previousPath = input.path;
    inputByPath.set(input.path, input);
    if (!new Set(["100644", "100755"]).has(input.mode)) failures.push(`Unsafe prefix input mode ${input.path}`);
    if (!/^[0-9a-f]{40}$/.test(input.git_blob_oid ?? "") || !/^[0-9a-f]{64}$/.test(input.sha256 ?? "")) failures.push(`Invalid prefix input digest ${input.path}`);
    if (!Number.isSafeInteger(input.bytes) || input.bytes < 1 || input.bytes > manifest.limits.max_file_bytes) failures.push(`Invalid prefix input size ${input.path}`);
    totalBytes += input.bytes ?? 0;
  }
  if (inputByPath.size !== 806 || totalBytes !== manifest.input_total_bytes || totalBytes > manifest.limits.max_total_bytes) failures.push("Project prefix input inventory drifted");

  const prefixKeys = new Set();
  let previousPrefix = null;
  const platforms = new Set();
  const enterprises = new Set();
  for (const prefix of dataset.prefixes ?? []) {
    for (const key of unexpectedKeys(prefix, new Set([
      "oid_prefix", "enterprise_number", "platform", "match_method", "claim_strength", "confidence", "claim_scope",
      "source_id", "source_path", "git_blob_oid", "source_sha256",
    ]))) failures.push(`Unexpected prefix field ${key}`);
    const arcs = oidParts(prefix.oid_prefix);
    if (!arcs || arcs.length <= ENTERPRISE_ROOT.length + 1 || !ENTERPRISE_ROOT.every((arc, index) => arcs[index] === arc)) failures.push(`Invalid project prefix ${prefix.oid_prefix}`);
    if (arcs && prefix.enterprise_number !== arcs[ENTERPRISE_ROOT.length]) failures.push(`Project prefix PEN drift ${prefix.oid_prefix}`);
    if (prefixKeys.has(prefix.oid_prefix)) failures.push(`Duplicate project prefix ${prefix.oid_prefix}`);
    prefixKeys.add(prefix.oid_prefix);
    if (previousPrefix !== null && compareOid(previousPrefix, prefix.oid_prefix) >= 0) failures.push(`Project prefixes are not sorted at ${prefix.oid_prefix}`);
    previousPrefix = prefix.oid_prefix;
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(prefix.platform ?? "")) failures.push(`Invalid project platform ${prefix.platform}`);
    if (prefix.match_method !== "prefix" || prefix.claim_strength !== "platform" || prefix.confidence !== "medium"
      || prefix.claim_scope !== "open-source-project-platform-prefix" || prefix.source_id !== SOURCE_ID) failures.push(`Project prefix claim boundary drift ${prefix.oid_prefix}`);
    const input = inputByPath.get(prefix.source_path);
    if (!input || input.git_blob_oid !== prefix.git_blob_oid || input.sha256 !== prefix.source_sha256) failures.push(`Project prefix evidence drift ${prefix.oid_prefix}`);
    platforms.add(prefix.platform);
    enterprises.add(prefix.enterprise_number);
  }

  const reasonCounts = {};
  const conflictPrefixes = [];
  let previousQuarantineKey = null;
  for (const row of dataset.quarantine ?? []) {
    for (const key of unexpectedKeys(row, new Set([
      "source_path", "git_blob_oid", "source_sha256", "clause_index", "literal_index", "normalized_oid", "platform", "reason",
    ]))) failures.push(`Unexpected quarantine field ${key}`);
    const input = inputByPath.get(row.source_path);
    if (!input || input.git_blob_oid !== row.git_blob_oid || input.sha256 !== row.source_sha256) failures.push(`Project prefix quarantine evidence drift ${row.source_path}`);
    if (!Number.isSafeInteger(row.clause_index) || row.clause_index < 0 || !Number.isSafeInteger(row.literal_index) || row.literal_index < 0) failures.push(`Invalid quarantine selector ${row.source_path}`);
    if (row.normalized_oid !== null && !oidParts(row.normalized_oid)) failures.push(`Invalid normalized quarantine OID ${row.normalized_oid}`);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(row.platform ?? "") || !QUARANTINE_REASONS.has(row.reason)) failures.push(`Invalid quarantine disposition ${row.source_path}`);
    const sortKey = `${row.source_path}\0${String(row.clause_index).padStart(6, "0")}\0${String(row.literal_index).padStart(6, "0")}\0${row.reason}`;
    if (previousQuarantineKey !== null && previousQuarantineKey.localeCompare(sortKey) >= 0) failures.push(`Project prefix quarantine is not sorted at ${row.source_path}`);
    previousQuarantineKey = sortKey;
    reasonCounts[row.reason] = (reasonCounts[row.reason] ?? 0) + 1;
    if (row.reason === "multi-platform-prefix") conflictPrefixes.push(row.normalized_oid);
  }
  const orderedReasonCounts = Object.fromEntries(Object.entries(reasonCounts).sort(([left], [right]) => left.localeCompare(right)));
  const expectedCounts = {
    prefixes: prefixKeys.size,
    platforms: platforms.size,
    enterprises: enterprises.size,
    quarantined_literals: dataset.quarantine?.length ?? 0,
    quarantine_reasons: orderedReasonCounts,
  };
  if (!sameJson(dataset.counts, expectedCounts) || dataset.counts.prefixes !== 655 || dataset.counts.platforms !== 406
    || dataset.counts.enterprises !== 266 || dataset.counts.quarantined_literals !== 358) failures.push("Project prefix dataset counts drifted");
  if (!sameJson(conflictPrefixes.sort(compareOid), EXPECTED_CONFLICT_PREFIXES)) failures.push("Project prefix multi-platform quarantine drifted");
  if (dataset.prefixes?.some((prefix) => EXPECTED_CONFLICT_PREFIXES.includes(prefix.oid_prefix))) failures.push("A multi-platform prefix escaped quarantine");

  const datasetSource = dataset.sources?.[0];
  if (dataset.sources?.length !== 1 || datasetSource?.id !== SOURCE_ID || datasetSource?.revision !== SOURCE_REVISION
    || datasetSource?.input_tree_git_oid !== SOURCE_TREE || datasetSource?.repository_license_signal !== "GPL-3.0-or-later"
    || datasetSource?.license_classifier !== "manual-pinned-content-v1"
    || datasetSource?.license_scope !== "resources/definitions/os_detection-derived-platform-prefixes"
    || !datasetSource?.source_url?.includes(SOURCE_REVISION)) failures.push("Project prefix dataset source drifted");
  if (dataset.dataset_license?.spdx !== "GPL-3.0-or-later"
    || dataset.dataset_license?.license_path !== "data/device-identities/licenses/librenms/LICENSE.txt"
    || dataset.dataset_license?.notice_path !== "data/device-identities/licenses/librenms/README.md"
    || !dataset.dataset_license?.source_offer_url?.includes(SOURCE_REVISION)) failures.push("Project prefix dataset license boundary drifted");

  const serialized = JSON.stringify(dataset);
  for (const prohibited of ["description", "raw_yaml", "raw_content", "sysDescr", "community", "serial_number"]) {
    if (serialized.includes(`\"${prohibited}\"`)) failures.push(`Project prefix dataset contains prohibited field ${prohibited}`);
  }
  return failures;
}

async function main() {
  const manifestBytes = await readFile(path.join(projectRoot, "data/device-identities/project-prefixes-manifest.json"));
  const datasetBytes = await readFile(path.join(projectRoot, "data/device-identities/project-prefixes.json"));
  const manifest = JSON.parse(manifestBytes);
  const dataset = JSON.parse(datasetBytes);
  const failures = validateProjectIdentityPrefixes(manifest, dataset);
  const licenseBytes = await readFile(path.join(projectRoot, "data/device-identities/licenses/librenms/LICENSE.txt"));
  const noticeBytes = await readFile(path.join(projectRoot, "data/device-identities/licenses/librenms/README.md"));
  if (sha256(licenseBytes) !== "67c255477940ba46460c0e6774401897e99ef9e1f82fb08d6a9b7680f39dd038") failures.push("Retained LibreNMS license digest drifted");
  if (sha256(noticeBytes) !== "83c5e62a686a95f178a00c2bfbd25a7cdc4a0b2880ebfda250fb72e70e0d2ae3") failures.push("Retained LibreNMS notice digest drifted");
  if (failures.length) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  } else process.stdout.write(`${JSON.stringify(dataset.counts)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
