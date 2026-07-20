import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { canonicalJsonSha256 } from "./canonical-json.mjs";
import { conflictGroups } from "./update-device-identities.mjs";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const DATASET_KEYS = new Set([
  "schema_version", "snapshot_id", "snapshot_date", "layer", "publication_mode", "raw_distribution",
  "source_manifest_sha256", "dataset_sha256", "field_provenance_contracts", "normalization_rules",
  "rights_boundary", "counts", "sources", "conflicts", "records"
]);
const SOURCE_KEYS = new Set([
  "id", "layer", "vendor", "enterprise_number", "pen", "organization_name", "organization_key",
  "root_symbol", "root_oid", "source_repository_commit", "source_path", "evidence_url", "source_url",
  "git_blob_oid", "sha256", "source_license_signal", "artifact_rights", "publication_mode",
  "raw_distribution", "official_source_url", "official_source_status", "official_source"
]);
const RECORD_KEYS = new Set([
  "id", "sys_object_id", "match_type", "claim_strength", "confidence", "vendor", "enterprise_number",
  "pen", "organization_name", "organization_key", "model", "model_identifier", "model_normalization",
  "product_family", "source_symbol", "parent_symbol", "source_id", "declaration_line", "publication_mode",
  "field_provenance"
]);
const CONFLICT_KEYS = new Set(["sys_object_id", "record_ids"]);
const COUNT_KEYS = new Set([
  "sources", "vendor_families", "records", "exact_oid_keys", "exact_models", "product_families",
  "vendor_identifiers", "conflict_oids", "organization_keys"
]);
const MANIFEST_KEYS = new Set([
  "schema_version", "snapshot_id", "snapshot_date", "policy", "source_repository", "enterprise_registry",
  "organization_link_snapshot", "adapters"
]);
const POLICY_KEYS = new Set([
  "layer", "publication_mode", "raw_distribution", "descriptions_included", "scope", "exact_key_boundary",
  "exact_model_auto_rule", "exact_model_symbol_allowlist", "product_family_symbol_allowlist", "normalization_rule_ids", "family_symbol_markers"
]);
const ADAPTER_KEYS = new Set([
  "id", "vendor", "enterprise_number", "root_symbol", "root_oid", "force_claim_strength",
  "definition_artifact", "root_artifact", "official_source"
]);
const DEFINITION_ARTIFACT_KEYS = new Set([
  "path", "git_blob_oid", "sha256", "sys_object_id_evidence_line", "artifact_rights", "notice_line"
]);
const ROOT_ARTIFACT_KEYS = new Set(["path", "git_blob_oid", "sha256", "root_declaration_line"]);
const OFFICIAL_SOURCE_KEYS = new Set(["status", "repository_url", "commit", "path", "url", "sha256", "note", "reason"]);
const SOURCE_REPOSITORY_KEYS = new Set(["id", "repository_url", "commit", "local_path", "license_signal"]);
const LICENSE_SIGNAL_KEYS = new Set(["spdx", "basis", "files"]);
const LICENSE_FILE_KEYS = new Set(["path", "git_blob_oid", "sha256", "url"]);
const ENTERPRISE_REGISTRY_KEYS = new Set([
  "path", "document_sha256", "document_canonical_sha256", "source_url", "source_sha256"
]);
const ORGANIZATION_SNAPSHOT_KEYS = new Set([
  "repository_url", "commit", "path", "git_blob_oid", "sha256", "links", "unlinked_policy"
]);
const ORGANIZATION_LINK_KEYS = new Set(["pen", "organization_key"]);
const RIGHTS_BOUNDARY_KEYS = new Set([
  "repository_license_signal", "artifact_notice_precedence", "descriptions_included", "raw_mib_included"
]);
const PROVENANCE_CONTRACT_KEYS = new Set(["vendor-mib-assignment-v1"]);
const PROVENANCE_FIELD_KEYS = new Set([
  "sys_object_id", "source_symbol", "model", "product_family", "enterprise_number", "organization_key", "vendor"
]);
const ORGANIZATION_KEY = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,79}$/u;

function unexpectedKeys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["<not-an-object>"];
  return Object.keys(value).filter((key) => !allowed.has(key));
}

function boundedString(value, max) {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function digestWithout(document, field) {
  return canonicalJsonSha256(Object.fromEntries(Object.entries(document).filter(([key]) => key !== field)));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function oidParts(oid) {
  if (typeof oid !== "string" || !/^(?:0|1|2)(?:\.(?:0|[1-9][0-9]*))+$/.test(oid)) return null;
  return oid.split(".").map(Number);
}

function recordCompare(left, right) {
  const a = left.sys_object_id.split(".").map(Number);
  const b = right.sys_object_id.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return left.source_id.localeCompare(right.source_id) || left.source_symbol.localeCompare(right.source_symbol);
}

function expectedCounts(dataset) {
  const uniqueOids = new Set(dataset.records.map((record) => record.sys_object_id));
  return {
    sources: dataset.sources.length,
    vendor_families: new Set(dataset.sources.map((source) => source.enterprise_number)).size,
    records: dataset.records.length,
    exact_oid_keys: uniqueOids.size,
    exact_models: dataset.records.filter((record) => record.claim_strength === "exact_model").length,
    product_families: dataset.records.filter((record) => record.claim_strength === "product_family").length,
    vendor_identifiers: dataset.records.filter((record) => record.claim_strength === "vendor_identifier").length,
    conflict_oids: conflictGroups(dataset.records).length,
    organization_keys: dataset.sources.filter((source) => source.organization_key !== null).length
  };
}

export function classifyIdentityClaims(claims) {
  if (!Array.isArray(claims) || claims.length === 0) return { state: "unknown", claims: [] };
  const unique = new Map();
  for (const claim of claims) {
    const key = JSON.stringify([claim.claim_strength, claim.model, claim.product_family, claim.source_id]);
    if (!unique.has(key)) unique.set(key, claim);
  }
  const preserved = [...unique.values()];
  const material = new Set(preserved.map((claim) => JSON.stringify([claim.claim_strength, claim.model, claim.product_family])));
  if (material.size > 1) return { state: "conflicting_evidence", claims: preserved };
  return { state: preserved[0].claim_strength, claims: preserved };
}

export function validateDeviceIdentities(manifest, dataset) {
  const failures = [];
  if (manifest?.schema_version !== 1) failures.push("Source manifest schema drift");
  if (dataset?.schema_version !== 1) failures.push("Dataset schema drift");
  const extraTopLevel = unexpectedKeys(dataset, DATASET_KEYS);
  if (extraTopLevel.length) failures.push(`Unexpected dataset fields: ${extraTopLevel.join(", ")}`);
  const extraManifest = unexpectedKeys(manifest, MANIFEST_KEYS);
  if (extraManifest.length) failures.push(`Unexpected source manifest fields: ${extraManifest.join(", ")}`);
  const extraPolicy = unexpectedKeys(manifest?.policy, POLICY_KEYS);
  if (extraPolicy.length) failures.push(`Unexpected source policy fields: ${extraPolicy.join(", ")}`);
  const extraSourceRepository = unexpectedKeys(manifest?.source_repository, SOURCE_REPOSITORY_KEYS);
  if (extraSourceRepository.length) failures.push(`Unexpected source-repository fields: ${extraSourceRepository.join(", ")}`);
  const extraLicenseSignal = unexpectedKeys(manifest?.source_repository?.license_signal, LICENSE_SIGNAL_KEYS);
  if (extraLicenseSignal.length) failures.push(`Unexpected license-signal fields: ${extraLicenseSignal.join(", ")}`);
  for (const licenseFile of manifest?.source_repository?.license_signal?.files ?? []) {
    const extraLicenseFile = unexpectedKeys(licenseFile, LICENSE_FILE_KEYS);
    if (extraLicenseFile.length) failures.push(`Unexpected license-file fields: ${extraLicenseFile.join(", ")}`);
  }
  const extraEnterpriseRegistry = unexpectedKeys(manifest?.enterprise_registry, ENTERPRISE_REGISTRY_KEYS);
  if (extraEnterpriseRegistry.length) failures.push(`Unexpected enterprise-registry fields: ${extraEnterpriseRegistry.join(", ")}`);
  const extraOrganizationSnapshot = unexpectedKeys(manifest?.organization_link_snapshot, ORGANIZATION_SNAPSHOT_KEYS);
  if (extraOrganizationSnapshot.length) failures.push(`Unexpected organization-snapshot fields: ${extraOrganizationSnapshot.join(", ")}`);
  for (const link of manifest?.organization_link_snapshot?.links ?? []) {
    const extraLink = unexpectedKeys(link, ORGANIZATION_LINK_KEYS);
    if (extraLink.length) failures.push(`Unexpected organization-link fields: ${extraLink.join(", ")}`);
  }
  if (manifest?.snapshot_id !== "librenms-vendor-mib-identity-dfba713a-2026-07-20"
    || manifest?.policy?.layer !== "vendor-mib-factual-metadata"
    || manifest?.policy?.publication_mode !== "metadata-only"
    || manifest?.policy?.raw_distribution !== "denied"
    || manifest?.policy?.descriptions_included !== false) failures.push("Source manifest policy identifiers drift");
  if (manifest?.source_repository?.id !== "librenms"
    || manifest?.source_repository?.repository_url !== "https://github.com/librenms/librenms"
    || manifest?.source_repository?.commit !== "dfba713a2ffd39c2b6619cccdec016e04a06a027"
    || manifest?.source_repository?.license_signal?.spdx !== "GPL-3.0-or-later") failures.push("Pinned source repository identity drift");
  if (!Array.isArray(manifest?.adapters) || manifest.adapters.length < 10) {
    failures.push("At least 10 source adapters are required");
    return failures;
  }
  if (!Array.isArray(dataset?.sources) || !Array.isArray(dataset?.records) || !Array.isArray(dataset?.conflicts)) {
    return [...failures, "Dataset arrays are missing"];
  }
  if (dataset.snapshot_id !== manifest.snapshot_id || dataset.snapshot_date !== manifest.snapshot_date) failures.push("Snapshot identity drift");
  if (dataset.layer !== "vendor-mib-factual-metadata") failures.push("Dataset layer drift");
  if (dataset.publication_mode !== "metadata-only" || dataset.raw_distribution !== "denied") failures.push("Dataset publication boundary drift");
  if (dataset.rights_boundary?.raw_mib_included !== false || dataset.rights_boundary?.descriptions_included !== false) {
    failures.push("Raw MIB or source descriptions cannot be included");
  }
  const extraRights = unexpectedKeys(dataset.rights_boundary, RIGHTS_BOUNDARY_KEYS);
  if (extraRights.length) failures.push(`Unexpected rights-boundary fields: ${extraRights.join(", ")}`);
  const extraContracts = unexpectedKeys(dataset.field_provenance_contracts, PROVENANCE_CONTRACT_KEYS);
  if (extraContracts.length) failures.push(`Unexpected provenance-contract fields: ${extraContracts.join(", ")}`);
  const extraProvenanceFields = unexpectedKeys(dataset.field_provenance_contracts?.["vendor-mib-assignment-v1"], PROVENANCE_FIELD_KEYS);
  if (extraProvenanceFields.length) failures.push(`Unexpected field-provenance fields: ${extraProvenanceFields.join(", ")}`);
  if (dataset.source_manifest_sha256 !== canonicalJsonSha256(manifest)) failures.push("Source manifest checksum drift");
  if (dataset.dataset_sha256 !== digestWithout(dataset, "dataset_sha256")) failures.push("Dataset checksum drift");

  const adapterById = new Map(manifest.adapters.map((adapter) => [adapter.id, adapter]));
  if (adapterById.size !== manifest.adapters.length) failures.push("Duplicate adapter id");
  if (new Set(manifest.adapters.map((adapter) => adapter.root_oid)).size !== manifest.adapters.length) failures.push("Duplicate adapter root OID");
  for (const adapter of manifest.adapters) {
    const extraAdapter = unexpectedKeys(adapter, ADAPTER_KEYS);
    if (extraAdapter.length) failures.push(`${adapter.id ?? "<unknown>"}: unexpected adapter fields: ${extraAdapter.join(", ")}`);
    const extraDefinition = unexpectedKeys(adapter.definition_artifact, DEFINITION_ARTIFACT_KEYS);
    if (extraDefinition.length) failures.push(`${adapter.id ?? "<unknown>"}: unexpected definition-artifact fields: ${extraDefinition.join(", ")}`);
    const extraRoot = unexpectedKeys(adapter.root_artifact, ROOT_ARTIFACT_KEYS);
    if (extraRoot.length) failures.push(`${adapter.id ?? "<unknown>"}: unexpected root-artifact fields: ${extraRoot.join(", ")}`);
    const extraOfficial = unexpectedKeys(adapter.official_source, OFFICIAL_SOURCE_KEYS);
    if (extraOfficial.length) failures.push(`${adapter.id ?? "<unknown>"}: unexpected official-source fields: ${extraOfficial.join(", ")}`);
    if (!boundedString(adapter.id, 80) || !/^[a-z0-9][a-z0-9-]*$/.test(adapter.id)
      || !boundedString(adapter.root_symbol, 128) || !oidParts(adapter.root_oid)
      || !Number.isSafeInteger(adapter.enterprise_number) || adapter.enterprise_number < 1) failures.push(`${adapter.id ?? "<unknown>"}: invalid adapter identity`);
  }
  const sourceById = new Map();
  for (const source of dataset.sources) {
    const extraSource = unexpectedKeys(source, SOURCE_KEYS);
    if (extraSource.length) failures.push(`${source.id ?? "<unknown>"}: unexpected source fields: ${extraSource.join(", ")}`);
    if (sourceById.has(source.id)) failures.push(`Duplicate source id: ${source.id}`);
    sourceById.set(source.id, source);
    const adapter = adapterById.get(source.id);
    if (!adapter) {
      failures.push(`Unknown source id: ${source.id}`);
      continue;
    }
    if (source.source_repository_commit !== manifest.source_repository.commit
      || source.source_path !== adapter.definition_artifact.path
      || source.git_blob_oid !== adapter.definition_artifact.git_blob_oid
      || source.sha256 !== adapter.definition_artifact.sha256) failures.push(`${source.id}: immutable source provenance drift`);
    if (typeof source.source_url !== "string" || !source.source_url.includes(`/${manifest.source_repository.commit}/${source.source_path}`)) failures.push(`${source.id}: source URL is not pinned`);
    if (source.evidence_url !== source.source_url) failures.push(`${source.id}: immutable evidence URL drift`);
    if (!/^https:\/\/github\.com\/librenms\/librenms\/blob\/[0-9a-f]{40}\//.test(source.evidence_url)) failures.push(`${source.id}: evidence URL is not pinned HTTPS`);
    if (source.enterprise_number !== adapter.enterprise_number || source.pen !== adapter.enterprise_number) failures.push(`${source.id}: direct PEN drift`);
    const reviewedLink = manifest.organization_link_snapshot.links.find((link) => link.pen === source.pen)?.organization_key ?? null;
    if (source.organization_key !== reviewedLink) failures.push(`${source.id}: organization key is not the reviewed PEN link`);
    if (source.publication_mode !== "metadata-only" || source.raw_distribution !== "denied") failures.push(`${source.id}: raw publication boundary drift`);
    if (source.source_license_signal !== manifest.source_repository.license_signal.spdx) failures.push(`${source.id}: source license signal drift`);
    if (source.official_source?.status === "not-reviewed" && source.official_source.url !== null) failures.push(`${source.id}: unreviewed URL cannot be official`);
    if (source.official_source_url !== (source.official_source?.url ?? null)
      || source.official_source_status !== source.official_source?.status) failures.push(`${source.id}: official-source fields drift`);
    const extraOfficial = unexpectedKeys(source.official_source, OFFICIAL_SOURCE_KEYS);
    if (extraOfficial.length) failures.push(`${source.id}: unexpected published official-source fields: ${extraOfficial.join(", ")}`);
    if (source.official_source_url !== null && (!source.official_source_url.startsWith("https://")
      || !source.official_source_url.includes(source.official_source.commit ?? "<missing>"))) failures.push(`${source.id}: official source URL is not immutable HTTPS`);
    if (!boundedString(source.vendor, 128) || !boundedString(source.organization_name, 256)
      || (source.organization_key !== null && !ORGANIZATION_KEY.test(source.organization_key))) failures.push(`${source.id}: source identity string bounds drift`);
  }
  if (sourceById.size !== adapterById.size) failures.push("Source/adapter count drift");

  const recordIds = new Set();
  const sourceSymbols = new Set();
  const oidSetBySource = new Map();
  for (const record of dataset.records) {
    const extraRecord = unexpectedKeys(record, RECORD_KEYS);
    if (extraRecord.length) failures.push(`${record.id ?? "<unknown>"}: unexpected record fields: ${extraRecord.join(", ")}`);
    if (recordIds.has(record.id)) failures.push(`Duplicate identity record id: ${record.id}`);
    recordIds.add(record.id);
    const symbolKey = `${record.source_id}\0${record.source_symbol}`;
    if (sourceSymbols.has(symbolKey)) failures.push(`Duplicate source symbol: ${record.source_id}/${record.source_symbol}`);
    sourceSymbols.add(symbolKey);
    const source = sourceById.get(record.source_id);
    const adapter = adapterById.get(record.source_id);
    const arcs = oidParts(record.sys_object_id);
    if (!source || !adapter) {
      failures.push(`${record.id}: unknown source`);
      continue;
    }
    if (!arcs || !record.sys_object_id.startsWith(`${adapter.root_oid}.`)) failures.push(`${record.id}: OID escaped the reviewed sysObjectID root`);
    if (arcs && arcs[6] !== adapter.enterprise_number) failures.push(`${record.id}: OID/PEN mismatch`);
    if (record.enterprise_number !== source.enterprise_number || record.pen !== source.pen) failures.push(`${record.id}: direct PEN drift`);
    if (record.organization_key !== source.organization_key || record.organization_name !== source.organization_name || record.vendor !== source.vendor) {
      failures.push(`${record.id}: organization provenance drift`);
    }
    if (record.match_type !== "exact" || record.publication_mode !== "metadata-only" || record.confidence !== "high") failures.push(`${record.id}: match/confidence/publication mode drift`);
    if (record.field_provenance !== "vendor-mib-assignment-v1") failures.push(`${record.id}: field provenance drift`);
    if (!Number.isSafeInteger(record.declaration_line) || record.declaration_line < 1) failures.push(`${record.id}: invalid declaration line`);
    if (typeof record.source_symbol !== "string" || !/^[A-Za-z][A-Za-z0-9-]*$/.test(record.source_symbol)) failures.push(`${record.id}: invalid source symbol`);
    if (!boundedString(record.id, 512) || record.id !== `${record.source_id}:${record.sys_object_id}:${record.source_symbol}`
      || !boundedString(record.parent_symbol, 128) || !boundedString(record.vendor, 128)
      || !boundedString(record.organization_name, 256)
      || (record.organization_key !== null && !ORGANIZATION_KEY.test(record.organization_key))
      || (record.model !== null && !boundedString(record.model, 256))
      || (record.model_identifier !== null && !boundedString(record.model_identifier, 256))
      || (record.product_family !== null && !boundedString(record.product_family, 256))) failures.push(`${record.id}: record string bounds or identity drift`);
    if (record.claim_strength === "exact_model") {
      if (record.model_identifier !== record.source_symbol) failures.push(`${record.id}: raw model identifier drift`);
      if (record.model_normalization === "reviewed-source-symbol-model-v1") {
        if (record.model !== record.source_symbol || !(manifest.policy.exact_model_symbol_allowlist ?? []).includes(record.source_symbol)) {
          failures.push(`${record.id}: reviewed source-symbol model escaped its exact allowlist`);
        }
      }
      else if (record.model_normalization === "cisco-catalyst-9300-sku-v1") {
        const cat = record.source_symbol.match(/^ciscoCat9300(L?)([0-9][A-Za-z0-9]*)$/);
        const catX = record.source_symbol.match(/^ciscoC9300X([0-9][A-Za-z0-9]*)$/);
        const expected = cat ? `C9300${cat[1]}-${cat[2]}` : catX ? `C9300X-${catX[1]}` : null;
        if (record.source_id !== "cisco-products" || !expected || record.model !== expected || record.product_family !== "Catalyst 9300") {
          failures.push(`${record.id}: Cisco Catalyst 9300 normalization escaped its reviewed rule`);
        }
      } else if (!Object.hasOwn(dataset.normalization_rules ?? {}, record.model_normalization)) failures.push(`${record.id}: unknown model normalization rule`);
    } else if (record.claim_strength === "product_family") {
      if (record.model !== null || record.model_identifier !== null || record.model_normalization !== null || !record.product_family) {
        failures.push(`${record.id}: product-family boundary drift`);
      }
    } else if (record.claim_strength === "vendor_identifier") {
      if (record.model !== null || record.model_identifier !== null || record.model_normalization !== null) {
        failures.push(`${record.id}: vendor-identifier boundary drift`);
      }
    } else failures.push(`${record.id}: invalid claim strength`);
    const oids = oidSetBySource.get(record.source_id) ?? new Set();
    oids.add(record.sys_object_id);
    oidSetBySource.set(record.source_id, oids);
  }

  const hasDescendants = new Set();
  for (const [sourceId, oids] of oidSetBySource) {
    for (const oid of oids) {
      const parts = oid.split(".");
      while (parts.length > 1) {
        parts.pop();
        const ancestor = parts.join(".");
        if (oids.has(ancestor)) hasDescendants.add(`${sourceId}\0${ancestor}`);
      }
    }
  }
  const markers = manifest.policy.family_symbol_markers.map((marker) => marker.toLowerCase());
  if (!sameJson(Object.keys(dataset.normalization_rules ?? {}), manifest.policy.normalization_rule_ids)) failures.push("Normalization rule contract drift");
  const exactModelAllowlist = new Set(manifest.policy.exact_model_symbol_allowlist ?? []);
  for (const record of dataset.records) {
    if (record.claim_strength !== "exact_model") continue;
    if (hasDescendants.has(`${record.source_id}\0${record.sys_object_id}`)) failures.push(`${record.id}: internal grouping node is labeled exact_model`);
    if (markers.some((marker) => record.source_symbol.toLowerCase().includes(marker))) failures.push(`${record.id}: generic/family marker is labeled exact_model`);
    if (record.model_normalization !== "cisco-catalyst-9300-sku-v1" && !exactModelAllowlist.has(record.source_symbol)) {
      failures.push(`${record.id}: exact model is not backed by a reviewed normalization or allowlist`);
    }
    if (adapterById.get(record.source_id)?.force_claim_strength === "product_family") failures.push(`${record.id}: adapter requires product-family claims`);
  }

  if (dataset.records.some((record, index) => index > 0 && recordCompare(dataset.records[index - 1], record) > 0)) {
    failures.push("Identity records are not deterministically sorted");
  }
  const calculatedConflicts = conflictGroups(dataset.records);
  const recordIdSet = new Set(dataset.records.map((record) => record.id));
  for (const conflict of dataset.conflicts) {
    const extraConflict = unexpectedKeys(conflict, CONFLICT_KEYS);
    if (extraConflict.length) failures.push(`Unexpected conflict fields: ${extraConflict.join(", ")}`);
    if (!oidParts(conflict.sys_object_id) || !Array.isArray(conflict.record_ids) || conflict.record_ids.length < 2
      || conflict.record_ids.some((id) => !recordIdSet.has(id))) failures.push(`Invalid conflict group: ${conflict.sys_object_id ?? "<unknown>"}`);
  }
  if (!sameJson(dataset.conflicts, calculatedConflicts)) failures.push("Conflict preservation drift");
  const extraCounts = unexpectedKeys(dataset.counts, COUNT_KEYS);
  if (extraCounts.length) failures.push(`Unexpected count fields: ${extraCounts.join(", ")}`);
  const counts = expectedCounts(dataset);
  if (!sameJson(dataset.counts, counts)) failures.push("Identity count drift");
  if (counts.vendor_families < 10) failures.push("Vendor-family coverage is below 10");
  if (counts.exact_models < 30) failures.push("Reviewed exact-model coverage is below 30");
  if (counts.vendor_identifiers < 1_000) failures.push("Non-model vendor-identifier coverage is below 1000");
  return failures;
}

async function main() {
  const manifest = JSON.parse(await readFile(path.join(projectRoot, "data", "device-identities", "vendor-mib-sources.json"), "utf8"));
  const dataset = JSON.parse(await readFile(path.join(projectRoot, "data", "device-identities", "vendor-mib.json"), "utf8"));
  const failures = validateDeviceIdentities(manifest, dataset);
  if (failures.length) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  } else process.stdout.write(`${JSON.stringify(dataset.counts)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
