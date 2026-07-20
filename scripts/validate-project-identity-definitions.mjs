import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { canonicalJsonSha256 } from "./canonical-json.mjs";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const identityRoot = path.join(projectRoot, "data", "device-identities");
const SHA256 = /^[0-9a-f]{64}$/u;
const OID = /^1\.3\.6\.1\.4\.1\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))+$/u;
const REVIEW_OID = /^1\.3\.6\.1\.4\.1\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))*$/u;
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9 ._+()\/-]{0,79}$/u;
const SENSITIVE = [
  /<private>/iu,
  /@|(?:https?|ftp):\/\/|\bwww\./iu,
  /\b(?:api[ _-]?key|token|private[ _-]?key|password|secret|community(?:[ _-]?string)?)\b/iu,
  /\b(?:serial(?:\s+number)?|s\/n)\s*[:=#]\s*\S+/iu,
  /\bSN\s*:\s*\S+/iu,
  /\b(?:host(?:name)?|contact|location)\s*[:=#]\s*\S+/iu,
  /\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/iu,
  /\b[0-9A-F]{4}(?:\.[0-9A-F]{4}){2}\b/iu,
  /\b[0-9A-F]{12}\b/iu,
  /\b[0-9A-F]{8}-[0-9A-F]{4}-[1-5][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\b/iu,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/u,
  /[\u0000-\u001f\u007f]/u
];

const TOP_KEYS = new Set([
  "schema_version", "dataset_id", "snapshot_date", "layer", "publication_mode", "raw_distribution",
  "dataset_license", "source_manifest_sha256", "dataset_sha256", "field_provenance_contracts", "rights_boundary", "counts",
  "sources", "definitions", "quarantine", "rejections"
]);
const COUNT_KEYS = new Set([
  "source_literal_entries", "unique_source_keys", "exact_oid_candidates", "exact_model_definitions",
  "quarantined_entries", "rejected_enterprise_roots", "enterprise_families"
]);
const DEFINITION_KEYS = new Set([
  "id", "sys_object_id", "match_type", "claim_strength", "confidence", "enterprise_number", "model",
  "product_family", "claim_scope", "source_id", "declaration_line", "field_provenance", "firmware_scope"
]);
const REVIEW_KEYS = new Set([
  "source_key", "sys_object_id", "enterprise_number", "declaration_line", "source_text_sha256", "reason"
]);
const QUARANTINE_REASONS = new Set([
  "model-boundary-not-unambiguous", "empty-model-after-summary-strip", "model-too-long",
  "model-missing-alpha-numeric-signal", "model-contains-unsupported-character", "sensitive-or-non-model-value",
  "ambiguous-multi-model-label", "cross-layer-model-conflict", "internal-dictionary-conflict",
  "registry-vendor-conflict", "vendor-symbol-model-conflict"
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function digestWithout(document, field) {
  return canonicalJsonSha256(Object.fromEntries(Object.entries(document).filter(([key]) => key !== field)));
}

function unexpectedKeys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["<not-an-object>"];
  return Object.keys(value).filter((key) => !allowed.has(key));
}

function numericOidCompare(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function hasSafeOidArcs(value) {
  return String(value).split(".").every((part) => {
    const arc = Number(part);
    return Number.isSafeInteger(arc) && arc >= 0 && arc <= 0xffffffff;
  });
}

export async function validateProjectIdentityDefinitions(manifest, dataset, { root = projectRoot } = {}) {
  const failures = [];
  const extras = unexpectedKeys(dataset, TOP_KEYS);
  if (extras.length) failures.push(`Unexpected dataset fields: ${extras.join(", ")}`);
  if (manifest?.schema_version !== 1 || dataset?.schema_version !== 1) failures.push("Schema version drift");
  if (manifest?.layer !== "open-source-project-device-definitions" || dataset?.layer !== manifest?.layer) failures.push("Definition layer drift");
  if (dataset?.dataset_id !== manifest?.dataset_id || dataset?.snapshot_date !== manifest?.snapshot_date) failures.push("Dataset identity drift");
  if (dataset?.publication_mode !== "definition-only" || dataset?.raw_distribution !== "not-provided") failures.push("Publication boundary drift");
  if (dataset?.dataset_license?.spdx !== "GPL-2.0-only"
    || dataset?.dataset_license?.scope !== "RackTables-derived definition content in data/device-identities/project-definitions.json, data/device-identities/runtime-index.json, and API responses"
    || JSON.stringify(dataset.dataset_license) !== JSON.stringify(manifest?.derived_dataset_license)) failures.push("Derived dataset license drift");
  if (dataset?.source_manifest_sha256 !== canonicalJsonSha256(manifest)) failures.push("Source manifest checksum drift");
  if (dataset?.dataset_sha256 !== digestWithout(dataset, "dataset_sha256")) failures.push("Dataset checksum drift");
  if (dataset?.rights_boundary?.source_text_included !== false
    || dataset?.rights_boundary?.source_code_included !== false
    || dataset?.rights_boundary?.raw_api_available !== false
    || dataset?.rights_boundary?.repository_license_signal !== "GPL-2.0-only") failures.push("Rights boundary drift");
  if (manifest?.source_repository?.commit !== "e5fff9f8aab339798ed47e8c6d7d977ed97a82bd"
    || manifest?.source_repository?.source_artifact?.git_blob_oid !== "36af514aae26ed22750d06fb18c8b80a41bfccdb"
    || manifest?.source_repository?.source_artifact?.sha256 !== "9d54ec87a9678fccc9fc1c49e36888362bc2bdeb8130f2b8498cba694f5ae8fa"
    || manifest?.source_repository?.review_artifacts?.[0]?.git_blob_oid !== "84a5d46418cf7537976ca3e29342763caa9ded39"
    || manifest?.source_repository?.review_artifacts?.[0]?.sha256 !== "0e8054b79de03531139f6bb65ea54f7fcd487244fb25d84f7f32edebc80a8dd3"
    || manifest?.source_repository?.license_signal?.spdx !== "GPL-2.0-only") failures.push("Pinned RackTables source identity drift");
  const dispositions = manifest?.fixture_overlap_dispositions;
  const allowedDispositions = new Set(["equivalent-label", "observation-less-specific", "material-disagreement"]);
  if (!Array.isArray(dispositions) || dispositions.length !== 19
    || new Set(dispositions?.map((item) => item.sys_object_id)).size !== 19
    || dispositions?.some((item) => !OID.test(item.sys_object_id ?? "") || !allowedDispositions.has(item.disposition))) {
    failures.push("Fixture-overlap dispositions drift");
  }

  const extraCounts = unexpectedKeys(dataset?.counts, COUNT_KEYS);
  if (extraCounts.length) failures.push(`Unexpected count fields: ${extraCounts.join(", ")}`);
  if (JSON.stringify(dataset?.counts) !== JSON.stringify(manifest?.expected_counts)) failures.push("Measured counts do not match the manifest gates");
  if (!Array.isArray(dataset?.sources) || dataset.sources.length !== 1
    || !Array.isArray(dataset?.definitions) || !Array.isArray(dataset?.quarantine) || !Array.isArray(dataset?.rejections)) {
    return [...failures, "Required dataset arrays are missing"];
  }
  if (dataset.definitions.length !== dataset.counts.exact_model_definitions
    || dataset.quarantine.length !== dataset.counts.quarantined_entries
    || dataset.rejections.length !== dataset.counts.rejected_enterprise_roots
    || dataset.definitions.length + dataset.quarantine.length !== dataset.counts.exact_oid_candidates
    || dataset.counts.exact_oid_candidates + dataset.rejections.length !== dataset.counts.source_literal_entries) failures.push("Dataset count arithmetic drift");

  const definitionOids = new Set();
  for (const [index, definition] of dataset.definitions.entries()) {
    const extra = unexpectedKeys(definition, DEFINITION_KEYS);
    if (extra.length) failures.push(`${definition.id ?? index}: unexpected definition fields: ${extra.join(", ")}`);
    if (!OID.test(definition.sys_object_id ?? "") || !hasSafeOidArcs(definition.sys_object_id)) failures.push(`${definition.id ?? index}: invalid exact sysObjectID`);
    if (definitionOids.has(definition.sys_object_id)) failures.push(`${definition.id ?? index}: duplicate sysObjectID`);
    definitionOids.add(definition.sys_object_id);
    const pen = Number(definition.sys_object_id?.split(".")[6]);
    if (!Number.isSafeInteger(definition.enterprise_number) || definition.enterprise_number !== pen) failures.push(`${definition.id ?? index}: PEN mismatch`);
    if (!SAFE_MODEL.test(definition.model ?? "") || SENSITIVE.some((pattern) => pattern.test(definition.model))) failures.push(`${definition.id ?? index}: unsafe model`);
    if (definition.match_type !== "exact" || definition.claim_strength !== "exact_model"
      || definition.confidence !== "medium" || definition.claim_scope !== "open-source-project-device-definition"
      || definition.source_id !== "racktables-known-switches"
      || definition.field_provenance !== "racktables-static-label-normalization-v1"
      || definition.firmware_scope !== "not_established" || definition.product_family !== null) failures.push(`${definition.id ?? index}: claim contract drift`);
    if (!Number.isSafeInteger(definition.declaration_line) || definition.declaration_line < 2452 || definition.declaration_line > 4625) failures.push(`${definition.id ?? index}: declaration line drift`);
    if (index > 0 && numericOidCompare(dataset.definitions[index - 1].sys_object_id, definition.sys_object_id) >= 0) failures.push("Definitions are not numeric-OID sorted");
  }

  for (const [kind, records] of [["quarantine", dataset.quarantine], ["rejection", dataset.rejections]]) {
    for (const [index, record] of records.entries()) {
      const extra = unexpectedKeys(record, REVIEW_KEYS);
      if (extra.length) failures.push(`${kind} ${index}: unexpected fields: ${extra.join(", ")}`);
      if (!REVIEW_OID.test(record.sys_object_id ?? "") || !hasSafeOidArcs(record.sys_object_id)
        || !/^\d+(?:\.\d+)*$/u.test(record.source_key ?? "") || !hasSafeOidArcs(record.source_key)) failures.push(`${kind} ${index}: unsafe OID`);
      if (!SHA256.test(record.source_text_sha256 ?? "")) failures.push(`${kind} ${index}: invalid source-text digest`);
      if (Object.hasOwn(record, "source_text") || Object.hasOwn(record, "text") || Object.hasOwn(record, "description")) failures.push(`${kind} ${index}: raw source text retained`);
      if (kind === "quarantine" && !QUARANTINE_REASONS.has(record.reason)) failures.push(`${kind} ${index}: unknown reason`);
      if (kind === "rejection" && record.reason !== "enterprise-root-not-exact-device") failures.push(`${kind} ${index}: unknown reason`);
    }
  }
  if (!dataset.rejections.some((record) => record.sys_object_id === "1.3.6.1.4.1.4413")) failures.push("Enterprise-root rejection is missing");
  if (!dataset.quarantine.some((record) => record.sys_object_id === "1.3.6.1.4.1.10977.11825.11833.97.25451.12800.100.4.4" && record.reason === "registry-vendor-conflict")) failures.push("Registry-vendor conflict quarantine is missing");
  if (dataset.definitions.some((record) => record.enterprise_number === 10977)) failures.push("Registry-vendor conflict escaped into definitions");
  if (!dataset.definitions.some((record) => record.sys_object_id === "1.3.6.1.4.1.12356.101.1.3002" && record.model === "FG310B")) failures.push("Whitespace-free static assignment was dropped");

  for (const artifact of manifest?.source_repository?.license_signal?.files ?? []) {
    const retained = path.resolve(root, artifact.retained_path ?? "");
    if (!retained.startsWith(`${path.resolve(root)}${path.sep}`)) {
      failures.push(`${artifact.path}: retained path escaped root`);
      continue;
    }
    try {
      const bytes = await readFile(retained);
      if (bytes.length !== artifact.bytes || sha256(bytes) !== artifact.sha256) failures.push(`${artifact.path}: retained license drift`);
      const text = bytes.toString("utf8");
      if (artifact.path === "COPYING" && (!text.includes("version 2 of the License") || !text.includes("A full text of the GPLv2 license is available in the \"LICENSE\" file."))) failures.push("COPYING markers drift");
      if (artifact.path === "LICENSE" && (!text.includes("GNU GENERAL PUBLIC LICENSE") || !text.includes("Version 2, June 1991"))) failures.push("LICENSE markers drift");
    } catch {
      failures.push(`${artifact.path}: retained license missing`);
    }
  }
  return failures;
}

async function main() {
  const [manifest, dataset] = await Promise.all([
    readFile(path.join(identityRoot, "project-definitions-manifest.json"), "utf8").then(JSON.parse),
    readFile(path.join(identityRoot, "project-definitions.json"), "utf8").then(JSON.parse)
  ]);
  const failures = await validateProjectIdentityDefinitions(manifest, dataset);
  if (failures.length) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify(dataset.counts)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
