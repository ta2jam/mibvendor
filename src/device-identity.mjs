import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MAX_PUBLIC_ITEMS = 32;
const ENTERPRISE_PREFIX = [1, 3, 6, 1, 4, 1];
const IDENTITY_STATUSES = new Set([
  "exact_model", "product_family", "vendor_identifier", "platform", "vendor_only", "conflicting_evidence", "unknown"
]);
const IDENTITY_RESULT_STATUSES = new Set([
  "exact_model", "product_family", "vendor_identifier", "platform", "vendor_only"
]);
const FIRMWARE_SCOPE_NOT_ESTABLISHED = "not_established";
const STRENGTH_RANK = Object.freeze({ exact_model: 5, product_family: 4, platform: 3, vendor_identifier: 2, vendor_only: 1 });
const MATCH_RANK = Object.freeze({ exact: 4, prefix: 3, signature: 2, registry: 1 });

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

const identityReleaseDocument = readJson("data/device-identities/release.json");
const identityControlDocument = readJson("data/device-identities/publication-controls.json");
let vendorMibSourceList = null;
let vendorMibSnapshot = null;
let projectFixtureSnapshot = null;
let projectFixtureSourceList = null;
let projectDefinitionSnapshot = null;
let projectDefinitionSourceList = null;
let runtimeIndexSnapshot = null;
let identityLicenseEvidence = null;
let baseVendorClaimByOid = null;
let baseProjectFixturesByOid = null;
let baseProjectDefinitionByOid = null;
let baseProjectDefinitionFixtureDispositionByOid = null;
let identitySourcesInitialized = false;

export const IDENTITY_RELEASE = "device-identity-2026-07-20.2";
export const IDENTITY_PUBLICATION_CONTROL_REVISION = identityControlDocument.control_revision;

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function publicationStateFor(disabledSources) {
  const disabled = sortedUnique([...disabledSources]);
  const controlProjection = {
    schema_version: identityControlDocument.schema_version,
    active_identity_release: identityControlDocument.active_identity_release,
    control_revision: identityControlDocument.control_revision,
    disabled_sources: disabled
  };
  const controlSha256 = createHash("sha256").update(JSON.stringify(canonicalize(controlProjection))).digest("hex");
  return Object.freeze({
    identity_release: IDENTITY_RELEASE,
    identity_release_sha256: identityReleaseDocument.release_sha256,
    control_revision: identityControlDocument.control_revision,
    control_sha256: controlSha256,
    disabled_sources: Object.freeze(disabled),
    identity_view: `${IDENTITY_RELEASE}.${identityReleaseDocument.release_sha256.slice(0, 12)}.c${identityControlDocument.control_revision}.${controlSha256.slice(0, 12)}`
  });
}

export const IDENTITY_PUBLICATION_STATE = publicationStateFor(identityControlDocument.disabled_sources);

function unexpectedKeys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["<not-an-object>"];
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function validateIdentityReleaseManifestCore(document) {
  const failures = [];
  const allowedTop = ["datasets", "identity_release", "release_sha256", "schema_version", "source_ids"];
  const unexpectedTop = unexpectedKeys(document, allowedTop);
  if (unexpectedTop.length) failures.push(`unexpected top-level keys: ${unexpectedTop.join(", ")}`);
  const unexpectedDatasets = unexpectedKeys(document?.datasets, ["builtin_claims", "integration_measurements", "license_evidence", "project_definitions", "project_fixtures", "runtime_index", "vendor_mib"]);
  if (unexpectedDatasets.length) failures.push(`unexpected datasets keys: ${unexpectedDatasets.join(", ")}`);
  const unexpectedBuiltins = unexpectedKeys(document?.datasets?.builtin_claims, ["net-snmp", "sigscale-mibs"]);
  if (unexpectedBuiltins.length) failures.push(`unexpected builtin_claims keys: ${unexpectedBuiltins.join(", ")}`);
  for (const sourceId of ["net-snmp", "sigscale-mibs"]) {
    const unexpectedBuiltin = unexpectedKeys(document?.datasets?.builtin_claims?.[sourceId], ["artifact_sha256", "record_count", "source_revision"]);
    if (unexpectedBuiltin.length) failures.push(`unexpected ${sourceId} builtin keys: ${unexpectedBuiltin.join(", ")}`);
  }
  const unexpectedVendor = unexpectedKeys(document?.datasets?.vendor_mib, ["dataset_sha256", "file_sha256", "record_count", "snapshot_id", "source_manifest_file_sha256", "source_manifest_sha256"]);
  if (unexpectedVendor.length) failures.push(`unexpected vendor_mib keys: ${unexpectedVendor.join(", ")}`);
  const unexpectedFixtures = unexpectedKeys(document?.datasets?.project_fixtures, ["dataset_id", "document_sha256", "file_sha256", "manifest_file_sha256", "manifest_sha256", "observation_count"]);
  if (unexpectedFixtures.length) failures.push(`unexpected project_fixtures keys: ${unexpectedFixtures.join(", ")}`);
  const unexpectedDefinitions = unexpectedKeys(document?.datasets?.project_definitions, [
    "dataset_id", "dataset_license", "dataset_sha256", "definition_count", "exact_oid_candidate_count", "file_sha256",
    "manifest_file_sha256", "manifest_sha256", "quarantined_entry_count"
  ]);
  if (unexpectedDefinitions.length) failures.push(`unexpected project_definitions keys: ${unexpectedDefinitions.join(", ")}`);
  const unexpectedRuntime = unexpectedKeys(document?.datasets?.runtime_index, ["file_sha256", "project_definition_count", "project_fixture_oid_count", "runtime_index_sha256", "schema_version", "vendor_claim_count"]);
  if (unexpectedRuntime.length) failures.push(`unexpected runtime_index keys: ${unexpectedRuntime.join(", ")}`);
  const measurementKeys = [
    "source_exact_oid_candidates", "source_candidate_fixture_overlap_oids", "source_candidate_new_vs_fixture_oids",
    "source_candidate_new_vs_vendor_fixture_union_oids", "source_candidate_vendor_overlap_oids",
    "model_definition_fixture_overlap_oids", "model_definition_new_vs_fixture_oids",
    "model_definition_new_vs_vendor_fixture_union_oids", "model_definition_oids", "model_definition_vendor_overlap_oids",
    "project_exact_oid_candidate_inventory", "project_model_oid_coverage"
  ];
  const unexpectedMeasurements = unexpectedKeys(document?.datasets?.integration_measurements, measurementKeys);
  if (unexpectedMeasurements.length) failures.push(`unexpected integration_measurements keys: ${unexpectedMeasurements.join(", ")}`);
  const unexpectedLicenses = unexpectedKeys(document?.datasets?.license_evidence, [
    "librenms_license_sha256", "librenms_readme_sha256", "racktables_copying_sha256",
    "racktables_license_sha256", "snmp_info_license_sha256"
  ]);
  if (unexpectedLicenses.length) failures.push(`unexpected license_evidence keys: ${unexpectedLicenses.join(", ")}`);
  if (document?.schema_version !== 1) failures.push("schema_version must be 1");
  if (document?.identity_release !== IDENTITY_RELEASE) failures.push(`identity_release must be ${IDENTITY_RELEASE}`);
  if (document?.datasets?.vendor_mib?.snapshot_id !== vendorMibSnapshot.snapshot_id) failures.push("vendor MIB snapshot_id drifted");
  if (document?.datasets?.vendor_mib?.dataset_sha256 !== vendorMibSnapshot.actual_dataset_sha256) failures.push("vendor MIB dataset_sha256 drifted");
  if (document?.datasets?.vendor_mib?.file_sha256 !== vendorMibSnapshot.file_sha256) failures.push("vendor MIB file_sha256 drifted");
  if (document?.datasets?.vendor_mib?.source_manifest_sha256 !== vendorMibSnapshot.actual_source_manifest_sha256) failures.push("vendor MIB source_manifest_sha256 drifted");
  if (document?.datasets?.vendor_mib?.source_manifest_file_sha256 !== vendorMibSnapshot.source_manifest_file_sha256) failures.push("vendor MIB source_manifest_file_sha256 drifted");
  if (document?.datasets?.vendor_mib?.record_count !== vendorMibSnapshot.record_count) failures.push("vendor MIB record_count drifted");
  if (document?.datasets?.project_fixtures?.dataset_id !== projectFixtureSnapshot.dataset_id) failures.push("project fixture dataset_id drifted");
  if (document?.datasets?.project_fixtures?.document_sha256 !== projectFixtureSnapshot.actual_document_sha256) failures.push("project fixture document_sha256 drifted");
  if (document?.datasets?.project_fixtures?.file_sha256 !== projectFixtureSnapshot.file_sha256) failures.push("project fixture file_sha256 drifted");
  if (document?.datasets?.project_fixtures?.manifest_sha256 !== projectFixtureSnapshot.actual_manifest_sha256) failures.push("project fixture manifest_sha256 drifted");
  if (document?.datasets?.project_fixtures?.manifest_file_sha256 !== projectFixtureSnapshot.manifest_file_sha256) failures.push("project fixture manifest_file_sha256 drifted");
  if (document?.datasets?.project_fixtures?.observation_count !== projectFixtureSnapshot.observation_count) failures.push("project fixture observation_count drifted");
  if (document?.datasets?.project_definitions?.dataset_id !== projectDefinitionSnapshot.dataset_id
    || document?.datasets?.project_definitions?.dataset_sha256 !== projectDefinitionSnapshot.actual_dataset_sha256
    || document?.datasets?.project_definitions?.file_sha256 !== projectDefinitionSnapshot.file_sha256
    || document?.datasets?.project_definitions?.manifest_sha256 !== projectDefinitionSnapshot.actual_manifest_sha256
    || document?.datasets?.project_definitions?.manifest_file_sha256 !== projectDefinitionSnapshot.manifest_file_sha256
    || JSON.stringify(document?.datasets?.project_definitions?.dataset_license) !== JSON.stringify(projectDefinitionSnapshot.dataset_license)
    || document?.datasets?.project_definitions?.definition_count !== projectDefinitionSnapshot.definition_count
    || document?.datasets?.project_definitions?.exact_oid_candidate_count !== projectDefinitionSnapshot.exact_oid_candidate_count
    || document?.datasets?.project_definitions?.quarantined_entry_count !== projectDefinitionSnapshot.quarantined_entry_count) failures.push("project definition dataset drifted");
  if (JSON.stringify(document?.datasets?.integration_measurements) !== JSON.stringify(runtimeIndexSnapshot.integration_measurements)) failures.push("identity integration measurements drifted");
  if (document?.datasets?.runtime_index?.schema_version !== 1
    || document?.datasets?.runtime_index?.runtime_index_sha256 !== runtimeIndexSnapshot.runtime_index_sha256
    || document?.datasets?.runtime_index?.file_sha256 !== runtimeIndexSnapshot.file_sha256
    || document?.datasets?.runtime_index?.vendor_claim_count !== runtimeIndexSnapshot.vendor_claim_count
    || document?.datasets?.runtime_index?.project_fixture_oid_count !== runtimeIndexSnapshot.project_fixture_oid_count
    || document?.datasets?.runtime_index?.project_definition_count !== runtimeIndexSnapshot.project_definition_count) failures.push("runtime identity index drifted");
  if (document?.datasets?.license_evidence?.librenms_license_sha256 !== identityLicenseEvidence.librenms_license_sha256
    || document?.datasets?.license_evidence?.librenms_readme_sha256 !== identityLicenseEvidence.librenms_readme_sha256
    || document?.datasets?.license_evidence?.snmp_info_license_sha256 !== identityLicenseEvidence.snmp_info_license_sha256
    || document?.datasets?.license_evidence?.racktables_copying_sha256 !== identityLicenseEvidence.racktables_copying_sha256
    || document?.datasets?.license_evidence?.racktables_license_sha256 !== identityLicenseEvidence.racktables_license_sha256) failures.push("identity license evidence drifted");
  const expectedBuiltins = {
    "net-snmp": { record_count: 18, source_revision: "319bbd0bb36547992c0e1302fef278c6f49d0c80", artifact_sha256: "bf111deffcc7c36262d2e47ff8fd7d49eee8a3f1bdad6236367660da6854a233" },
    "sigscale-mibs": { record_count: 1, source_revision: "14259b9e52a5cd7ff0fd60b33728da616792887d", artifact_sha256: "53f5cb591c5af28c2c9783b8f7e0b897059202771cf6b931b72e639f25d793a1" }
  };
  for (const [sourceId, expected] of Object.entries(expectedBuiltins)) {
    const actual = document?.datasets?.builtin_claims?.[sourceId];
    for (const [field, value] of Object.entries(expected)) if (actual?.[field] !== value) failures.push(`${sourceId} ${field} drifted`);
  }

  const expectedSources = sortedUnique([
    ...vendorMibSnapshot.source_ids,
    ...projectFixtureSnapshot.source_ids,
    ...projectDefinitionSnapshot.source_ids,
    "net-snmp",
    "sigscale-mibs"
  ]);
  if (JSON.stringify(document?.source_ids) !== JSON.stringify(expectedSources)) failures.push("source_ids must be sorted and match the pinned datasets");
  const hashInput = { ...document };
  delete hashInput.release_sha256;
  const releaseSha256 = createHash("sha256").update(JSON.stringify(canonicalize(hashInput))).digest("hex");
  if (document?.release_sha256 !== releaseSha256) failures.push("release_sha256 does not bind the complete release manifest");
  return failures;
}

export function validateIdentityReleaseManifest(document = identityReleaseDocument) {
  initializeIdentitySources();
  return validateIdentityReleaseManifestCore(document);
}

function validateIdentityPublicationControlsCore(document) {
  const failures = [];
  const unexpected = unexpectedKeys(document, ["active_identity_release", "control_revision", "disabled_sources", "schema_version"]);
  if (unexpected.length) failures.push(`unexpected publication control keys: ${unexpected.join(", ")}`);
  if (document?.schema_version !== 1) failures.push("publication control schema_version must be 1");
  if (document?.active_identity_release !== IDENTITY_RELEASE) failures.push("active_identity_release does not match the immutable identity release");
  if (!Number.isSafeInteger(document?.control_revision) || document.control_revision < 1) failures.push("control_revision must be a positive integer");
  if (!Array.isArray(document?.disabled_sources)) failures.push("disabled_sources must be an array");
  else {
    if (JSON.stringify(document.disabled_sources) !== JSON.stringify(sortedUnique(document.disabled_sources))) failures.push("disabled_sources must be unique and sorted");
    for (const sourceId of document.disabled_sources) {
      if (!identityReleaseDocument.source_ids.includes(sourceId)) failures.push(`unknown disabled source: ${sourceId}`);
    }
  }
  return failures;
}

export function validateIdentityPublicationControls(document = identityControlDocument) {
  return validateIdentityPublicationControlsCore(document);
}

function normalizeOid(input) {
  const raw = String(input ?? "").trim().replace(/^\./, "");
  if (!/^\d+(?:\.\d+)*$/.test(raw)) return null;
  const values = raw.split(".").map(Number);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)) return null;
  return { oid: values.join("."), arcs: values };
}

function enterpriseNumberFromArcs(arcs) {
  if (arcs.length <= ENTERPRISE_PREFIX.length) return null;
  return ENTERPRISE_PREFIX.every((arc, index) => arcs[index] === arc) ? arcs[ENTERPRISE_PREFIX.length] : null;
}

const reviewedOrganizationKeys = new Map();

function organizationFields(enterpriseNumber, lookupEnterprise) {
  const enterprise = enterpriseNumber === null ? null : lookupEnterprise(enterpriseNumber);
  const organizationKey = enterpriseNumber === null ? null : reviewedOrganizationKeys.get(enterpriseNumber) ?? null;
  return {
    enterprise,
    enterprise_number: enterpriseNumber,
    organization_name: enterprise?.organization ?? null,
    organization_key: organizationKey,
    organization_key_status: organizationKey ? "reviewed" : "not_available"
  };
}

const VENDOR_TUPLE_SOURCE = 0;
const VENDOR_TUPLE_SYMBOL = 1;
const VENDOR_TUPLE_STRENGTH = 2;
const VENDOR_TUPLE_MODEL_OVERRIDE = 3;
const VENDOR_TUPLE_FAMILY = 4;
const VENDOR_TUPLE_IDENTIFIER_ONLY = 5;

function materializeVendorClaim(oid, tuple) {
  const source = vendorMibSourceList[tuple[VENDOR_TUPLE_SOURCE]];
  const claimStrength = tuple[VENDOR_TUPLE_STRENGTH];
  const normalizedDeviceModel = Boolean(tuple[VENDOR_TUPLE_MODEL_OVERRIDE]);
  const identifierOnly = tuple[VENDOR_TUPLE_IDENTIFIER_ONLY];
  const claimScope = normalizedDeviceModel
    ? "device-model"
    : identifierOnly ? "vendor-mib-object-identifier" : "product-family";
  return {
    vendor_mib_claim: true,
    oid,
    enterprise_number: source.enterprise_number,
    organization_key: source.organization_key,
    organization_name: source.organization_name,
    organization: source.vendor,
    vendor: source.vendor,
    product_family: tuple[VENDOR_TUPLE_FAMILY],
    model: normalizedDeviceModel ? tuple[VENDOR_TUPLE_MODEL_OVERRIDE] : null,
    mib_identifier: tuple[VENDOR_TUPLE_SYMBOL],
    platform: null,
    identity_type: normalizedDeviceModel ? "hardware-model" : claimScope,
    claim_scope: claimScope,
    match_type: "exact",
    claim_strength: claimStrength,
    confidence: identifierOnly ? "medium" : "high",
    source_assignment_confidence: "high",
    source_symbol: tuple[VENDOR_TUPLE_SYMBOL],
    field_provenance: "vendor-mib-assignment-v1",
    provenance: vendorSourceProvenance(source)
  };
}

const vendorSourceProvenanceCache = new Map();
function vendorSourceProvenance(source) {
  let provenance = vendorSourceProvenanceCache.get(source.id);
  if (!provenance) {
    provenance = Object.freeze({
      source_id: source.id,
      source: "Vendor MIB assignment metadata",
      source_url: source.source_url,
      source_revision: source.source_repository_commit,
      source_path: source.source_path,
      git_blob_oid: source.git_blob_oid,
      sha256: source.sha256,
      repository_license_signal: source.source_license_signal,
      artifact_rights: source.artifact_rights,
      publication_basis: "independently-authored factual metadata; artifact rights deny raw redistribution",
      publication_mode: "metadata-only",
      raw_download: false,
      raw_distribution: "denied",
      official_source_url: source.official_source?.url ?? null,
      official_source_status: source.official_source?.status ?? "not-reviewed",
      official_source_byte_verified: false
    });
    vendorSourceProvenanceCache.set(source.id, provenance);
  }
  return provenance;
}

const DEFINITION_TUPLE_ENTERPRISE = 0;
const DEFINITION_TUPLE_MODEL = 1;
const DEFINITION_TUPLE_SOURCE = 2;
const DEFINITION_TUPLE_LINE = 3;
const DEFINITION_TUPLE_CONFIDENCE = 4;
const DEFINITION_TUPLE_SCOPE = 5;

const projectDefinitionProvenanceCache = new Map();
function projectDefinitionProvenance(source, declarationLine) {
  const cacheKey = `${source.id}:${declarationLine}`;
  let provenance = projectDefinitionProvenanceCache.get(cacheKey);
  if (!provenance) {
    provenance = Object.freeze({
      source_id: source.id,
      source: "Open-source project exact device definition",
      source_url: `${source.source_url}#L${declarationLine}`,
      source_revision: source.revision,
      source_path: source.source_path,
      git_blob_oid: source.git_blob_oid,
      sha256: source.sha256,
      repository_license_signal: source.repository_license_signal,
      artifact_rights: "GPL-2.0-only source; mibvendor-normalized definition",
      publication_basis: "RackTables static exact key with mibvendor-authored bounded model-label normalization",
      publication_mode: "definition-only",
      raw_download: false,
      raw_distribution: "not-provided",
      official_source_url: null,
      official_source_status: "pinned-project-source",
      official_source_byte_verified: true
    });
    projectDefinitionProvenanceCache.set(cacheKey, provenance);
  }
  return provenance;
}

function materializeProjectDefinitionClaim(oid, tuple, lookupEnterprise) {
  const enterpriseNumber = tuple[DEFINITION_TUPLE_ENTERPRISE];
  const source = projectDefinitionSourceList[tuple[DEFINITION_TUPLE_SOURCE]];
  const organization = lookupEnterprise(enterpriseNumber)?.organization ?? null;
  return {
    project_definition_claim: true,
    oid,
    enterprise_number: enterpriseNumber,
    organization_name: organization,
    organization_key: reviewedOrganizationKeys.get(enterpriseNumber) ?? null,
    organization,
    model: tuple[DEFINITION_TUPLE_MODEL],
    product_family: null,
    platform: null,
    identity_type: "hardware-model",
    claim_scope: tuple[DEFINITION_TUPLE_SCOPE],
    match_type: "exact",
    claim_strength: "exact_model",
    confidence: tuple[DEFINITION_TUPLE_CONFIDENCE],
    source_assignment_confidence: "high",
    provenance: projectDefinitionProvenance(source, tuple[DEFINITION_TUPLE_LINE])
  };
}

function effectiveFixture(fixture, candidates) {
  const distinctModels = new Set(candidates.map((candidate) => candidate.model.trim().toLowerCase()));
  const conflicting = distinctModels.size > 1;
  return Object.freeze({
    ...fixture,
    evidence_state: conflicting ? "conflicting_observations" : "single_observation",
    confidence: conflicting ? "low" : candidates.some((candidate) => candidate.confidence === "high") ? "high" : "medium",
    candidates: Object.freeze(candidates)
  });
}

function initializeIdentitySources() {
  if (identitySourcesInitialized) return;

  const expectedInputPaths = new Map([
    ["vendor_mib", "data/device-identities/vendor-mib.json"],
    ["vendor_manifest", "data/device-identities/vendor-mib-sources.json"],
    ["project_fixtures", "data/device-identities/project-fixtures.json"],
    ["project_manifest", "data/device-identities/project-fixtures-manifest.json"],
    ["project_definitions", "data/device-identities/project-definitions.json"],
    ["project_definition_manifest", "data/device-identities/project-definitions-manifest.json"],
    ["librenms_license", "data/device-identities/licenses/librenms/LICENSE.txt"],
    ["librenms_readme", "data/device-identities/licenses/librenms/README.md"],
    ["snmp_info_license", "data/device-identities/licenses/SNMP-INFO-LICENSE"],
    ["racktables_copying", "data/device-identities/licenses/racktables/COPYING"],
    ["racktables_license", "data/device-identities/licenses/racktables/LICENSE"]
  ]);
  const runtimeIndexPath = path.join(projectRoot, "data/device-identities/runtime-index.json");
  const runtimeIndexBytes = readFileSync(runtimeIndexPath);
  const runtimeIndexFileSha256 = createHash("sha256").update(runtimeIndexBytes).digest("hex");
  if (runtimeIndexFileSha256 !== identityReleaseDocument.datasets.runtime_index.file_sha256) {
    throw new Error("Device identity runtime-index file digest drifted");
  }
  let runtimeDocument = JSON.parse(runtimeIndexBytes);
  if (runtimeDocument.schema_version !== 1 || runtimeDocument.identity_release !== IDENTITY_RELEASE) {
    throw new Error("Device identity runtime-index identity drifted");
  }
  const { runtime_index_sha256: declaredRuntimeDigest, ...runtimeDigestProjection } = runtimeDocument;
  const actualRuntimeDigest = createHash("sha256").update(JSON.stringify(canonicalize(runtimeDigestProjection))).digest("hex");
  if (declaredRuntimeDigest !== actualRuntimeDigest || actualRuntimeDigest !== identityReleaseDocument.datasets.runtime_index.runtime_index_sha256) {
    throw new Error("Device identity runtime-index canonical digest drifted");
  }
  for (const [inputId, expectedPath] of expectedInputPaths) {
    const input = runtimeDocument.inputs?.[inputId];
    if (input?.path !== expectedPath) throw new Error(`Device identity runtime input path drifted: ${inputId}`);
    const bytes = readFileSync(path.join(projectRoot, expectedPath));
    const fileSha256 = createHash("sha256").update(bytes).digest("hex");
    if (fileSha256 !== input.file_sha256) throw new Error(`Device identity runtime input digest drifted: ${inputId}`);
  }

  vendorMibSourceList = Object.freeze(runtimeDocument.vendor_sources.map((source) => Object.freeze(source)));
  baseVendorClaimByOid = new Map();
  for (const row of runtimeDocument.vendor_claims) {
    const [oid, ...tuple] = row;
    if (baseVendorClaimByOid.has(oid)) throw new Error(`Unexpected vendor identity conflict in runtime index: ${oid}`);
    baseVendorClaimByOid.set(oid, Object.freeze(tuple));
  }
  vendorMibSnapshot = Object.freeze({
    snapshot_id: runtimeDocument.inputs.vendor_mib.snapshot_id,
    actual_dataset_sha256: runtimeDocument.inputs.vendor_mib.canonical_sha256,
    actual_source_manifest_sha256: runtimeDocument.inputs.vendor_manifest.canonical_sha256,
    file_sha256: runtimeDocument.inputs.vendor_mib.file_sha256,
    source_manifest_file_sha256: runtimeDocument.inputs.vendor_manifest.file_sha256,
    record_count: runtimeDocument.inputs.vendor_mib.record_count,
    source_ids: Object.freeze(vendorMibSourceList.map((source) => source.id))
  });

  projectFixtureSourceList = Object.freeze(runtimeDocument.project_sources.map((source) => Object.freeze(source)));
  projectFixtureSnapshot = Object.freeze({
    dataset_id: runtimeDocument.inputs.project_fixtures.dataset_id,
    actual_document_sha256: runtimeDocument.inputs.project_fixtures.canonical_sha256,
    actual_manifest_sha256: runtimeDocument.inputs.project_manifest.canonical_sha256,
    file_sha256: runtimeDocument.inputs.project_fixtures.file_sha256,
    manifest_file_sha256: runtimeDocument.inputs.project_manifest.file_sha256,
    observation_count: runtimeDocument.inputs.project_fixtures.observation_count,
    source_ids: Object.freeze(projectFixtureSourceList.map((source) => source.id))
  });
  baseProjectFixturesByOid = new Map();
  for (const row of runtimeDocument.project_fixtures) {
    const [oid, enterpriseNumber, evidenceState, confidence, candidateRows] = row;
    const fixture = Object.freeze({
      sys_object_id: oid,
      enterprise_number: enterpriseNumber,
      evidence_state: evidenceState,
      confidence,
      candidates: Object.freeze(candidateRows.map((candidate) => Object.freeze({
        model: candidate[0],
        product_family: candidate[1],
        platform: candidate[2],
        device_class: candidate[3],
        source_id: candidate[4],
        confidence: candidate[5],
        entity_corroborated: candidate[6]
      })))
    });
    baseProjectFixturesByOid.set(oid, fixture);
  }
  projectDefinitionSourceList = Object.freeze(runtimeDocument.definition_sources.map((source) => Object.freeze(source)));
  projectDefinitionSnapshot = Object.freeze({
    dataset_id: runtimeDocument.inputs.project_definitions.dataset_id,
    dataset_license: Object.freeze(runtimeDocument.inputs.project_definitions.dataset_license),
    actual_dataset_sha256: runtimeDocument.inputs.project_definitions.canonical_sha256,
    actual_manifest_sha256: runtimeDocument.inputs.project_definition_manifest.canonical_sha256,
    file_sha256: runtimeDocument.inputs.project_definitions.file_sha256,
    manifest_file_sha256: runtimeDocument.inputs.project_definition_manifest.file_sha256,
    definition_count: runtimeDocument.inputs.project_definitions.definition_count,
    exact_oid_candidate_count: runtimeDocument.inputs.project_definitions.exact_oid_candidate_count,
    quarantined_entry_count: runtimeDocument.inputs.project_definitions.quarantined_entry_count,
    source_ids: Object.freeze(projectDefinitionSourceList.map((source) => source.id))
  });
  baseProjectDefinitionByOid = new Map();
  for (const row of runtimeDocument.project_definitions) {
    const [oid, ...tuple] = row;
    if (baseProjectDefinitionByOid.has(oid)) throw new Error(`Unexpected project definition conflict in runtime index: ${oid}`);
    baseProjectDefinitionByOid.set(oid, Object.freeze(tuple));
  }
  baseProjectDefinitionFixtureDispositionByOid = new Map(runtimeDocument.project_definition_fixture_dispositions);
  if (baseProjectDefinitionFixtureDispositionByOid.size !== runtimeDocument.project_definition_fixture_dispositions.length) {
    throw new Error("Duplicate project definition fixture-overlap disposition");
  }
  for (const link of runtimeDocument.reviewed_pen_links) {
    const current = reviewedOrganizationKeys.get(link.enterprise_number);
    if (current && current !== link.organization_key) throw new Error(`Conflicting reviewed organization key for PEN ${link.enterprise_number}`);
    reviewedOrganizationKeys.set(link.enterprise_number, link.organization_key);
  }
  for (const source of vendorMibSourceList) {
    if (!source.organization_key) continue;
    const current = reviewedOrganizationKeys.get(source.enterprise_number);
    if (current && current !== source.organization_key) throw new Error(`Conflicting vendor organization key for PEN ${source.enterprise_number}`);
    reviewedOrganizationKeys.set(source.enterprise_number, source.organization_key);
  }
  runtimeIndexSnapshot = Object.freeze({
    runtime_index_sha256: actualRuntimeDigest,
    file_sha256: runtimeIndexFileSha256,
    vendor_claim_count: baseVendorClaimByOid.size,
    project_fixture_oid_count: baseProjectFixturesByOid.size,
    project_definition_count: baseProjectDefinitionByOid.size,
    integration_measurements: Object.freeze(runtimeDocument.integration_measurements)
  });
  identityLicenseEvidence = Object.freeze({
    librenms_license_sha256: runtimeDocument.inputs.librenms_license.file_sha256,
    librenms_readme_sha256: runtimeDocument.inputs.librenms_readme.file_sha256,
    snmp_info_license_sha256: runtimeDocument.inputs.snmp_info_license.file_sha256,
    racktables_copying_sha256: runtimeDocument.inputs.racktables_copying.file_sha256,
    racktables_license_sha256: runtimeDocument.inputs.racktables_license.file_sha256
  });
  runtimeDocument = null;

  const manifestFailures = validateIdentityReleaseManifestCore(identityReleaseDocument);
  if (manifestFailures.length) throw new Error(`Device identity release validation failed: ${manifestFailures.join("; ")}`);
  const controlFailures = validateIdentityPublicationControlsCore(identityControlDocument);
  if (controlFailures.length) throw new Error(`Device identity publication control validation failed: ${controlFailures.join("; ")}`);
  identitySourcesInitialized = true;
}

function publicCandidate(claim, evidenceType = "primary") {
  return {
    identity_status: claim.claim_strength,
    firmware_scope: FIRMWARE_SCOPE_NOT_ESTABLISHED,
    enterprise_number: claim.enterprise_number,
    organization_name: claim.organization_name ?? claim.organization ?? null,
    organization_key: claim.organization_key ?? reviewedOrganizationKeys.get(claim.enterprise_number) ?? null,
    model: claim.model ?? null,
    product_family: claim.product_family ?? null,
    mib_identifier: claim.mib_identifier ?? null,
    platform: claim.platform ?? null,
    confidence: claim.confidence ?? "medium",
    source_assignment_confidence: claim.source_assignment_confidence ?? claim.confidence ?? "medium",
    claim_scope: claim.claim_scope ?? (claim.claim_strength === "platform" ? "agent-platform" : claim.claim_strength),
    match_type: claim.match_type ?? "exact",
    evidence: [{
      type: evidenceType,
      source_id: claim.provenance?.source_id ?? null,
      source_url: claim.provenance?.source_url ?? null,
      publication_mode: claim.provenance?.publication_mode ?? null,
      raw_download: false
    }]
  };
}

function publicMatch(claim) {
  if (!claim) return null;
  if (claim.project_definition_claim) {
    const { project_definition_claim, provenance, ...fields } = claim;
    return { ...fields, firmware_scope: FIRMWARE_SCOPE_NOT_ESTABLISHED, provenance };
  }
  if (!claim.vendor_mib_claim) return { ...claim, firmware_scope: FIRMWARE_SCOPE_NOT_ESTABLISHED };
  const { vendor_mib_claim, source_symbol, field_provenance, provenance, ...fields } = claim;
  return {
    ...fields,
    firmware_scope: FIRMWARE_SCOPE_NOT_ESTABLISHED,
    provenance: {
      ...provenance,
      source_symbol,
      field_provenance
    }
  };
}

function registryCandidate(enterpriseNumber, lookupEnterprise) {
  const fields = organizationFields(enterpriseNumber, lookupEnterprise);
  if (!fields.enterprise) return null;
  return {
    identity_status: "vendor_only",
    firmware_scope: FIRMWARE_SCOPE_NOT_ESTABLISHED,
    enterprise_number: enterpriseNumber,
    organization_name: fields.organization_name,
    organization_key: fields.organization_key,
    model: null,
    product_family: null,
    platform: null,
    confidence: "registry",
    source_assignment_confidence: "registry",
    claim_scope: "pen-registry-assignee",
    match_type: "registry",
    evidence: [{ type: "iana-pen-registry", source_id: "iana-pen", source_url: fields.enterprise.source.url, publication_mode: "registry", raw_download: false }]
  };
}

function candidateKey(candidate) {
  return [candidate.enterprise_number, candidate.identity_status, candidate.model, candidate.product_family, candidate.platform, candidate.mib_identifier].join("\0");
}

function candidateRank(candidate) {
  return [STRENGTH_RANK[candidate.identity_status] ?? 0, MATCH_RANK[candidate.match_type] ?? 0, candidate.confidence === "high" ? 2 : candidate.confidence === "medium" ? 1 : 0];
}

function compareCandidates(left, right) {
  const a = candidateRank(left);
  const b = candidateRank(right);
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return b[index] - a[index];
  return candidateKey(left).localeCompare(candidateKey(right));
}

function deduplicateCandidates(candidates) {
  const byKey = new Map();
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    const current = byKey.get(key);
    if (!current) byKey.set(key, { ...candidate, evidence: [...candidate.evidence] });
    else current.evidence.push(...candidate.evidence);
  }
  for (const candidate of byKey.values()) {
    candidate.evidence = candidate.evidence
      .filter((evidence, index, all) => index === all.findIndex((other) => JSON.stringify(other) === JSON.stringify(evidence)))
      .slice(0, MAX_PUBLIC_ITEMS);
  }
  return [...byKey.values()].sort(compareCandidates).slice(0, MAX_PUBLIC_ITEMS);
}

function conflictSet(candidates) {
  const conflicts = [];
  const enterpriseNumbers = [...new Set(candidates.map((candidate) => candidate.enterprise_number).filter(Number.isSafeInteger))]
    .sort((left, right) => left - right);
  if (enterpriseNumbers.length > 1) conflicts.push({ type: "cross_vendor", enterprise_numbers: enterpriseNumbers });

  const exactModelsByPen = new Map();
  for (const candidate of candidates.filter((item) => item.identity_status === "exact_model" && item.model)) {
    const models = exactModelsByPen.get(candidate.enterprise_number) ?? new Set();
    models.add(candidate.model.toUpperCase());
    exactModelsByPen.set(candidate.enterprise_number, models);
  }
  for (const [enterpriseNumber, models] of exactModelsByPen) {
    if (models.size > 1) conflicts.push({ type: "model_mismatch", enterprise_number: enterpriseNumber, models: [...models].sort() });
  }
  const familiesByPen = new Map();
  for (const candidate of candidates.filter((item) => item.product_family)) {
    const families = familiesByPen.get(candidate.enterprise_number) ?? new Set();
    families.add(candidate.product_family.trim().toUpperCase());
    familiesByPen.set(candidate.enterprise_number, families);
  }
  for (const [enterpriseNumber, families] of familiesByPen) {
    if (families.size > 1) conflicts.push({ type: "family_mismatch", enterprise_number: enterpriseNumber, product_families: [...families].sort() });
  }
  return conflicts.slice(0, MAX_PUBLIC_ITEMS);
}

function definitionFixtureConflicts(claims, fixture) {
  if (!fixture) return [];
  const definitionModels = claims
    .filter((claim) => claim.project_definition_claim && claim.model)
    .map((claim) => claim.model.trim().toUpperCase());
  if (!definitionModels.length) return [];
  const disposition = baseProjectDefinitionFixtureDispositionByOid.get(fixture.sys_object_id);
  if (!disposition) throw new Error(`Missing reviewed project-definition fixture disposition: ${fixture.sys_object_id}`);
  if (disposition !== "material-disagreement") return [];
  const observedModels = fixture.candidates.map((candidate) => candidate.model?.trim().toUpperCase()).filter(Boolean);
  const models = [...new Set([...definitionModels, ...observedModels])].sort();
  return models.length > 1 ? [{ type: "model_mismatch", enterprise_number: fixture.enterprise_number, models }] : [];
}

function c9300ModelCandidate(rawModel, hasIndependentCiscoEvidence, effectiveReviewedModels) {
  const model = String(rawModel ?? "").trim().toUpperCase();
  if (!hasIndependentCiscoEvidence || !effectiveReviewedModels.has(model)) return null;
  return {
    identity_status: "exact_model",
    firmware_scope: FIRMWARE_SCOPE_NOT_ESTABLISHED,
    enterprise_number: 9,
    organization_name: "ciscoSystems",
    organization_key: reviewedOrganizationKeys.get(9) ?? null,
    model,
    product_family: "Catalyst 9300",
    platform: null,
    confidence: "medium",
    source_assignment_confidence: "device-reported-reviewed-model",
    claim_scope: "device-reported-model",
    match_type: "signature",
    evidence: [{ type: "device-reported-model", source_id: null, source_url: null, publication_mode: null, raw_download: false }]
  };
}

const sysDescrSignatures = Object.freeze([
  { pattern: /\bcisco\b[\s\S]{0,80}\bios[ -]?xe\b|\bios[ -]?xe\b[\s\S]{0,80}\bcisco\b/i, pen: 9, platform: "Cisco IOS XE" },
  { pattern: /\bjunos\b/i, pen: 2636, platform: "Junos" },
  { pattern: /\bfortios\b/i, pen: 12356, platform: "FortiOS" },
  { pattern: /\bnet-snmp\b/i, pen: 8072, platform: "Net-SNMP" }
]);

function signatureCandidate(rawDescription, lookupEnterprise) {
  const description = String(rawDescription ?? "").slice(0, 2048);
  const signature = sysDescrSignatures.find((candidate) => candidate.pattern.test(description));
  if (!signature) return null;
  const fields = organizationFields(signature.pen, lookupEnterprise);
  return {
    identity_status: "platform",
    firmware_scope: FIRMWARE_SCOPE_NOT_ESTABLISHED,
    enterprise_number: signature.pen,
    organization_name: fields.organization_name,
    organization_key: fields.organization_key,
    model: null,
    product_family: null,
    platform: signature.platform,
    confidence: "medium",
    source_assignment_confidence: "signature",
    claim_scope: "agent-platform",
    match_type: "signature",
    evidence: [{ type: "sys-descr-signature", source_id: null, source_url: null, publication_mode: null, raw_download: false }]
  };
}

function fixtureSummary(fixture) {
  if (!fixture) return [];
  return [{
    sys_object_id: fixture.sys_object_id,
    evidence_state: fixture.evidence_state,
    confidence: fixture.confidence,
    candidates: fixture.candidates.slice(0, MAX_PUBLIC_ITEMS).map((candidate) => ({
      ...candidate,
      firmware_scope: FIRMWARE_SCOPE_NOT_ESTABLISHED
    }))
  }];
}

function registryEvidence(enterpriseNumber, lookupEnterprise) {
  const enterprise = Number.isSafeInteger(enterpriseNumber) ? lookupEnterprise(enterpriseNumber) : null;
  if (!enterprise) return null;
  return {
    type: "iana-pen-registry",
    enterprise_number: enterpriseNumber,
    registry_status: enterprise.registry_status,
    source_url: enterprise.source.url
  };
}

function assessmentResult(candidates, conflicts, evidence, lookupEnterprise) {
  const deduplicated = deduplicateCandidates(candidates);
  const materialConflicts = conflicts.length ? conflicts : conflictSet(deduplicated);
  const selected = materialConflicts.length ? null : deduplicated[0] ?? null;
  const enterpriseNumber = selected?.enterprise_number ?? null;
  const fields = organizationFields(enterpriseNumber, lookupEnterprise);
  const identityStatus = materialConflicts.length ? "conflicting_evidence" : selected?.identity_status ?? "unknown";
  const penEvidence = registryEvidence(enterpriseNumber, lookupEnterprise);
  const publicEvidence = [...(penEvidence ? [penEvidence] : []), ...evidence].slice(0, MAX_PUBLIC_ITEMS);
  if (!IDENTITY_STATUSES.has(identityStatus)) throw new Error(`Invalid identity status: ${identityStatus}`);
  return {
    status: materialConflicts.length ? "ambiguous" : selected ? (identityStatus === "vendor_only" ? "vendor_only" : "resolved") : "not_found",
    identity_status: identityStatus,
    firmware_scope: IDENTITY_RESULT_STATUSES.has(identityStatus) ? FIRMWARE_SCOPE_NOT_ESTABLISHED : null,
    enterprise_number: enterpriseNumber,
    organization_name: selected?.organization_name ?? fields.organization_name,
    organization_key: selected?.organization_key ?? fields.organization_key,
    organization_key_status: (selected?.organization_key ?? fields.organization_key) ? "reviewed" : "not_available",
    model: selected?.model ?? null,
    product_family: selected?.product_family ?? null,
    mib_identifier: selected?.mib_identifier ?? null,
    platform: selected?.platform ?? null,
    confidence: selected?.confidence ?? null,
    candidates: deduplicated,
    conflicts: materialConflicts.slice(0, MAX_PUBLIC_ITEMS),
    evidence: publicEvidence
  };
}

export function createDeviceIdentityEngine({ lookupEnterprise, builtinClaims = [], disabledSources = null } = {}) {
  if (typeof lookupEnterprise !== "function") throw new TypeError("lookupEnterprise must be a function");
  initializeIdentitySources();
  const disabled = new Set(disabledSources ?? identityControlDocument.disabled_sources);
  const unknownDisabled = [...disabled].filter((sourceId) => !identityReleaseDocument.source_ids.includes(sourceId));
  if (unknownDisabled.length) throw new Error(`Unknown disabled identity source: ${unknownDisabled.join(", ")}`);
  const publicationState = disabledSources === null ? IDENTITY_PUBLICATION_STATE : publicationStateFor(disabled);
  const publicationFields = Object.freeze({
    identity_view: publicationState.identity_view,
    identity_release_sha256: publicationState.identity_release_sha256,
    publication_control: publicationState
  });

  const builtinCounts = new Map();
  for (const claim of builtinClaims) {
    const sourceId = claim.provenance?.source_id;
    const policy = identityReleaseDocument.datasets.builtin_claims[sourceId];
    if (!policy) throw new Error(`Unpinned built-in identity source: ${sourceId ?? "missing"}`);
    if (claim.provenance?.source_revision !== policy.source_revision) throw new Error(`Built-in identity source revision drifted: ${sourceId}`);
    if (claim.provenance?.sha256 !== policy.artifact_sha256) throw new Error(`Built-in identity artifact drifted: ${sourceId}`);
    const count = (builtinCounts.get(sourceId) ?? 0) + 1;
    if (count > policy.record_count) throw new Error(`Built-in identity record count exceeded release bound: ${sourceId}`);
    builtinCounts.set(sourceId, count);
  }

  let vendorClaimByOid = baseVendorClaimByOid;
  if (vendorMibSnapshot.source_ids.some((sourceId) => disabled.has(sourceId))) {
    vendorClaimByOid = new Map();
    for (const [oid, tuple] of baseVendorClaimByOid) {
      const sourceId = vendorMibSourceList[tuple[VENDOR_TUPLE_SOURCE]].id;
      if (!disabled.has(sourceId)) vendorClaimByOid.set(oid, tuple);
    }
  }
  const effectiveReviewedC9300Models = new Set([...vendorClaimByOid.values()]
    .filter((tuple) => vendorMibSourceList[tuple[VENDOR_TUPLE_SOURCE]].id === "cisco-products"
      && tuple[VENDOR_TUPLE_STRENGTH] === "exact_model"
      && tuple[VENDOR_TUPLE_MODEL_OVERRIDE])
    .map((tuple) => tuple[VENDOR_TUPLE_MODEL_OVERRIDE].toUpperCase()));

  const builtinClaimsByOid = new Map();
  for (const claim of builtinClaims) {
    if (disabled.has(claim.provenance.source_id)) continue;
    const claims = builtinClaimsByOid.get(claim.oid) ?? [];
    claims.push(claim);
    builtinClaimsByOid.set(claim.oid, claims);
  }

  let definitionByOid = baseProjectDefinitionByOid;
  if (projectDefinitionSnapshot.source_ids.some((sourceId) => disabled.has(sourceId))) {
    definitionByOid = new Map();
    for (const [oid, tuple] of baseProjectDefinitionByOid) {
      const sourceId = projectDefinitionSourceList[tuple[DEFINITION_TUPLE_SOURCE]].id;
      if (!disabled.has(sourceId)) definitionByOid.set(oid, tuple);
    }
  }

  let fixtureByOid = baseProjectFixturesByOid;
  if (projectFixtureSnapshot.source_ids.some((sourceId) => disabled.has(sourceId))) {
    fixtureByOid = new Map();
    for (const [oid, fixture] of baseProjectFixturesByOid) {
      const candidates = fixture.candidates.filter((candidate) => !disabled.has(candidate.source_id));
      if (!candidates.length) continue;
      fixtureByOid.set(oid, candidates.length === fixture.candidates.length
        ? fixture
        : effectiveFixture(fixture, candidates));
    }
  }

  const strengthCounts = { exact_model: 0, product_family: 0, vendor_identifier: 0, platform: 0 };
  const vendorFamilies = new Set();
  let claimCount = vendorClaimByOid.size;
  for (const tuple of vendorClaimByOid.values()) {
    strengthCounts[tuple[VENDOR_TUPLE_STRENGTH]] += 1;
    vendorFamilies.add(vendorMibSourceList[tuple[VENDOR_TUPLE_SOURCE]].enterprise_number);
  }
  for (const claims of builtinClaimsByOid.values()) {
    claimCount += claims.length;
    for (const claim of claims) {
      if (Object.hasOwn(strengthCounts, claim.claim_strength)) strengthCounts[claim.claim_strength] += 1;
      if (Number.isSafeInteger(claim.enterprise_number)) vendorFamilies.add(claim.enterprise_number);
    }
  }
  claimCount += definitionByOid.size;
  strengthCounts.exact_model += definitionByOid.size;
  for (const tuple of definitionByOid.values()) vendorFamilies.add(tuple[DEFINITION_TUPLE_ENTERPRISE]);
  const exactMappingOids = new Set([...vendorClaimByOid.keys(), ...builtinClaimsByOid.keys(), ...definitionByOid.keys()]);
  const projectIdentityOids = new Set([...fixtureByOid.keys(), ...definitionByOid.keys()]);
  let conflictingObservationOids = 0;
  for (const fixture of fixtureByOid.values()) if (fixture.evidence_state === "conflicting_observations") conflictingObservationOids += 1;
  const vendorSourcesById = new Map(vendorMibSourceList.map((source) => [source.id, source]));
  const projectSourcesById = new Map(projectFixtureSourceList.map((source) => [source.id, source]));
  const definitionSourcesById = new Map(projectDefinitionSourceList.map((source) => [source.id, source]));
  const builtinSourcesById = new Map();
  for (const claim of builtinClaims) if (!builtinSourcesById.has(claim.provenance.source_id)) builtinSourcesById.set(claim.provenance.source_id, claim);
  const effectiveSources = Object.freeze(identityReleaseDocument.source_ids.map((sourceId) => {
    const vendorSource = vendorSourcesById.get(sourceId);
    const projectSource = projectSourcesById.get(sourceId);
    const definitionSource = definitionSourcesById.get(sourceId);
    const builtinSource = builtinSourcesById.get(sourceId);
    const sourceUrl = vendorSource?.source_url
      ?? definitionSource?.source_url
      ?? (projectSource ? `https://github.com/${projectSource.repository}/tree/${projectSource.revision}` : builtinSource?.provenance?.source_url ?? null);
    return Object.freeze({
      source_id: sourceId,
      enabled: !disabled.has(sourceId),
      source_status: disabled.has(sourceId) ? "disabled-by-publication-control" : "active",
      source_type: vendorSource ? "vendor-mib" : definitionSource ? "open-source-project-definition" : projectSource ? "project-fixture" : "builtin",
      evidence_layer: vendorSource ? "vendor-mib-factual-metadata" : definitionSource ? "open-source-project-device-definitions" : projectSource ? "project-fixture-observation" : "rights-cleared-builtin",
      enterprise_number: vendorSource?.enterprise_number ?? builtinSource?.enterprise_number ?? null,
      organization_key: vendorSource?.organization_key ?? null,
      repository_revision: vendorSource?.source_repository_commit ?? definitionSource?.revision ?? projectSource?.revision ?? null,
      repository_license_signal: vendorSource?.source_license_signal
        ?? projectSource?.repository_license_signal
        ?? definitionSource?.repository_license_signal
        ?? builtinSource?.provenance?.source_license
        ?? builtinSource?.provenance?.rights
        ?? null,
      artifact_rights: vendorSource?.artifact_rights ?? (definitionSource ? "GPL-2.0-only source; mibvendor-normalized definition" : projectSource ? "project-authored-observation" : "rights-cleared-source"),
      publication_mode: vendorSource ? "metadata-only" : definitionSource ? "definition-only" : projectSource ? "observation-only" : "release-governed",
      raw_distribution: vendorSource ? "denied" : "not-provided",
      source_url: sourceUrl,
      official_source_status: vendorSource?.official_source_status ?? (definitionSource || builtinSource ? "pinned-source" : "not-reviewed"),
      official_source_url: vendorSource?.official_source_url ?? (builtinSource ? sourceUrl : null)
    });
  }));
  const statistics = Object.freeze({
    identity_release: IDENTITY_RELEASE,
    identity_release_sha256: identityReleaseDocument.release_sha256,
    identity_view: publicationState.identity_view,
    publication_control_revision: publicationState.control_revision,
    publication_control_sha256: publicationState.control_sha256,
    runtime_index_sha256: runtimeIndexSnapshot.runtime_index_sha256,
    sys_object_id_mappings: exactMappingOids.size,
    claims: claimCount,
    exact_models: strengthCounts.exact_model,
    product_families: strengthCounts.product_family,
    vendor_identifiers: strengthCounts.vendor_identifier,
    platforms: strengthCounts.platform,
    vendor_families: vendorFamilies.size,
    project_observation_oids: fixtureByOid.size,
    project_definition_oids: definitionByOid.size,
    project_identity_oid_coverage: projectIdentityOids.size,
    conflicting_observation_oids: conflictingObservationOids,
    reviewed_organization_keys: reviewedOrganizationKeys.size,
    disabled_sources: disabled.size
  });

  function primaryLookup(input) {
    const parsed = normalizeOid(input);
    if (!parsed) return { parsed: null, enterpriseNumber: null, enterprise: null, claims: [], fixture: null };
    const enterpriseNumber = enterpriseNumberFromArcs(parsed.arcs);
    const vendorTupleMatch = vendorClaimByOid.get(parsed.oid);
    const vendorClaim = vendorTupleMatch ? materializeVendorClaim(parsed.oid, vendorTupleMatch) : null;
    const definitionTuple = definitionByOid.get(parsed.oid);
    const definitionClaim = definitionTuple ? materializeProjectDefinitionClaim(parsed.oid, definitionTuple, lookupEnterprise) : null;
    const builtinMatches = builtinClaimsByOid.get(parsed.oid) ?? [];
    const claims = [definitionClaim, vendorClaim, ...builtinMatches].filter(Boolean);
    return {
      parsed,
      enterpriseNumber,
      enterprise: enterpriseNumber === null ? null : lookupEnterprise(enterpriseNumber),
      claims,
      fixture: fixtureByOid.get(parsed.oid) ?? null
    };
  }

  function lookup(input) {
    const found = primaryLookup(input);
    if (!found.parsed) {
      return {
        input,
        status: "invalid",
        enterprise_number: null,
        organization_name: null,
        organization_key: null,
        organization_key_status: "not_available",
        identity_status: "unknown",
        firmware_scope: null,
        identity_release: IDENTITY_RELEASE,
        ...publicationFields,
        enterprise: null,
        match: null,
        assessment: { candidates: [], conflicts: [], corroboration: [], evidence: [] }
      };
    }
    const fields = organizationFields(found.enterpriseNumber, lookupEnterprise);
    if (found.enterpriseNumber === null) {
      return {
        input,
        normalized_oid: found.parsed.oid,
        status: "not_found",
        ...fields,
        identity_status: "unknown",
        firmware_scope: null,
        identity_release: IDENTITY_RELEASE,
        ...publicationFields,
        match: null,
        assessment: { candidates: [], conflicts: [], corroboration: [], evidence: [] }
      };
    }

    const candidates = found.claims.length
      ? found.claims.map((claim) => publicCandidate(claim))
      : found.enterprise ? [registryCandidate(found.enterpriseNumber, lookupEnterprise)] : [];
    const conflicts = [...conflictSet(candidates), ...definitionFixtureConflicts(found.claims, found.fixture)]
      .filter((conflict, index, all) => index === all.findIndex((other) => JSON.stringify(other) === JSON.stringify(conflict)))
      .slice(0, MAX_PUBLIC_ITEMS);
    const selectedClaim = conflicts.length ? null : [...found.claims].sort((left, right) => compareCandidates(publicCandidate(left), publicCandidate(right)))[0] ?? null;
    const identityStatus = conflicts.length ? "conflicting_evidence" : selectedClaim?.claim_strength ?? (found.enterprise ? "vendor_only" : "unknown");
    const status = conflicts.length ? "ambiguous" : selectedClaim ? "resolved" : found.enterprise ? "enterprise_only" : "not_found";
    return {
      input,
      normalized_oid: found.parsed.oid,
      status,
      ...fields,
      identity_status: identityStatus,
      firmware_scope: IDENTITY_RESULT_STATUSES.has(identityStatus) ? FIRMWARE_SCOPE_NOT_ESTABLISHED : null,
      identity_release: IDENTITY_RELEASE,
      ...publicationFields,
      match: publicMatch(selectedClaim),
      assessment: {
        candidates: deduplicateCandidates(candidates),
        conflicts,
        corroboration: fixtureSummary(found.fixture),
        evidence: [registryEvidence(found.enterpriseNumber, lookupEnterprise)].filter(Boolean)
      },
      caveat: conflicts.length
        ? "Exact identity evidence materially conflicts. Candidate claims and conflict details are returned, but no singular model is asserted."
        : selectedClaim
          ? selectedClaim.claim_scope === "vendor-mib-object-identifier"
          ? "This exact OID has a vendor MIB object identifier. It may denote a device, chassis, module, line card, or component; no whole-device model is asserted."
          : selectedClaim.claim_strength === "exact_model"
          ? selectedClaim.claim_scope === "open-source-project-device-definition"
            ? "This exact model label is a bounded normalization of a pinned open-source project definition. It is medium-confidence identification evidence, not device authenticity or firmware evidence."
            : selectedClaim.claim_scope === "device-model"
            ? "This device-model identifier is assigned to the exact OID in reviewed vendor MIB metadata; it does not prove the observed device is authentic or running a specific firmware."
            : "This exact OID is assigned to a vendor MIB model identifier. The identifier may denote a device, chassis, module, or component; it is not proof of a whole-device model or authenticity."
          : "This identifies the product family or agent platform assigned to the exact OID; it does not assert a more specific hardware model."
          : found.enterprise
            ? "Only the PEN registry boundary is known. No product or model identity is asserted for this OID."
            : undefined
    };
  }

  function assess(signals = {}) {
    const candidates = [];
    const evidence = [];
    const fixtures = [];
    const fixtureConflicts = [];
    for (const field of ["sys_object_id", "ent_physical_vendor_type"]) {
      if (signals[field] === undefined) continue;
      const found = primaryLookup(signals[field]);
      evidence.push({ signal: field, match_type: found.claims.length ? "exact" : found.enterprise ? "registry" : "none" });
      for (const claim of found.claims) {
        const candidate = publicCandidate(claim, field);
        candidate.evidence[0].signal = field;
        candidates.push(candidate);
      }
      if (!found.claims.length && found.enterpriseNumber !== null) {
        const registry = registryCandidate(found.enterpriseNumber, lookupEnterprise);
        if (registry) {
          registry.evidence[0].signal = field;
          candidates.push(registry);
        }
      }
      if (found.fixture) fixtures.push(...fixtureSummary(found.fixture));
      fixtureConflicts.push(...definitionFixtureConflicts(found.claims, found.fixture));
    }

    const hasIndependentCiscoEvidence = candidates.some((candidate) => candidate.enterprise_number === 9
      && candidate.product_family === "Catalyst 9300"
      && candidate.match_type === "exact"
      && candidate.evidence.some((item) => item.signal === "sys_object_id" || item.signal === "ent_physical_vendor_type"));
    let modelCandidate = null;
    if (signals.ent_physical_model_name !== undefined) {
      modelCandidate = c9300ModelCandidate(
        signals.ent_physical_model_name,
        hasIndependentCiscoEvidence,
        effectiveReviewedC9300Models
      );
      evidence.push({ signal: "ent_physical_model_name", match_type: modelCandidate ? "corroborated-model" : "none" });
      if (modelCandidate) candidates.push(modelCandidate);
    }
    if (signals.sys_descr !== undefined) {
      const platformCandidate = signatureCandidate(signals.sys_descr, lookupEnterprise);
      evidence.push({ signal: "sys_descr", match_type: platformCandidate ? "signature" : "none" });
      if (platformCandidate) candidates.push(platformCandidate);
    }

    const normalizedReportedModel = modelCandidate?.model ?? null;
    const assessment = assessmentResult(candidates, fixtureConflicts, [...evidence, ...fixtures.map((fixture) => ({
      type: "project-fixture-corroboration",
      sys_object_id: fixture.sys_object_id,
      evidence_state: fixture.evidence_state,
      candidate_count: fixture.candidates.length,
      corroborates_reported_model: normalizedReportedModel
        ? fixture.candidates.some((candidate) => candidate.model?.toUpperCase() === normalizedReportedModel)
        : false
    }))], lookupEnterprise);
    return {
      ...assessment,
      signals_used: evidence.map((item) => item.signal),
      identity_release: IDENTITY_RELEASE,
      ...publicationFields
    };
  }

  return Object.freeze({ lookup, assess, statistics, sources: effectiveSources });
}
