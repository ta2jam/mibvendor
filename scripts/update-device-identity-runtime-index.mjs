import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { canonicalJsonSha256 } from "./canonical-json.mjs";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const identityRoot = path.join(projectRoot, "data", "device-identities");
const IDENTITY_RELEASE = "device-identity-2026-07-20.3";
const BUILTIN_CLAIMS = Object.freeze({
  "net-snmp": Object.freeze({
    record_count: 18,
    source_revision: "319bbd0bb36547992c0e1302fef278c6f49d0c80",
    artifact_sha256: "bf111deffcc7c36262d2e47ff8fd7d49eee8a3f1bdad6236367660da6854a233"
  }),
  "sigscale-mibs": Object.freeze({
    record_count: 1,
    source_revision: "14259b9e52a5cd7ff0fd60b33728da616792887d",
    artifact_sha256: "53f5cb591c5af28c2c9783b8f7e0b897059202771cf6b931b72e639f25d793a1"
  })
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readInput(relativePath) {
  const bytes = await readFile(path.join(projectRoot, relativePath));
  return { bytes, document: JSON.parse(bytes), file_sha256: sha256(bytes) };
}

function withoutField(document, field) {
  return Object.fromEntries(Object.entries(document).filter(([key]) => key !== field));
}

export async function buildDeviceIdentityRuntimeIndex() {
  const vendor = await readInput("data/device-identities/vendor-mib.json");
  const vendorManifest = await readInput("data/device-identities/vendor-mib-sources.json");
  const fixtures = await readInput("data/device-identities/project-fixtures.json");
  const fixtureManifest = await readInput("data/device-identities/project-fixtures-manifest.json");
  const definitions = await readInput("data/device-identities/project-definitions.json");
  const definitionManifest = await readInput("data/device-identities/project-definitions-manifest.json");
  const prefixes = await readInput("data/device-identities/project-prefixes.json");
  const prefixManifest = await readInput("data/device-identities/project-prefixes-manifest.json");
  const licenseBytes = await readFile(path.join(identityRoot, "licenses/librenms/LICENSE.txt"));
  const readmeBytes = await readFile(path.join(identityRoot, "licenses/librenms/README.md"));
  const snmpInfoLicenseBytes = await readFile(path.join(identityRoot, "licenses/SNMP-INFO-LICENSE"));
  const rackTablesCopyingBytes = await readFile(path.join(identityRoot, "licenses/racktables/COPYING"));
  const rackTablesLicenseBytes = await readFile(path.join(identityRoot, "licenses/racktables/LICENSE"));

  const vendorCanonicalSha256 = canonicalJsonSha256(withoutField(vendor.document, "dataset_sha256"));
  const fixtureCanonicalSha256 = canonicalJsonSha256(withoutField(fixtures.document, "document_sha256"));
  const vendorManifestCanonicalSha256 = canonicalJsonSha256(vendorManifest.document);
  const fixtureManifestCanonicalSha256 = canonicalJsonSha256(fixtureManifest.document);
  const definitionCanonicalSha256 = canonicalJsonSha256(withoutField(definitions.document, "dataset_sha256"));
  const definitionManifestCanonicalSha256 = canonicalJsonSha256(definitionManifest.document);
  const prefixCanonicalSha256 = canonicalJsonSha256(withoutField(prefixes.document, "dataset_sha256"));
  const prefixManifestCanonicalSha256 = canonicalJsonSha256(withoutField(prefixManifest.document, "manifest_sha256"));
  if (vendor.document.dataset_sha256 !== vendorCanonicalSha256) throw new Error("Vendor identity dataset digest drift");
  if (vendor.document.source_manifest_sha256 !== vendorManifestCanonicalSha256) throw new Error("Vendor identity source manifest digest drift");
  if (fixtures.document.document_sha256 !== fixtureCanonicalSha256) throw new Error("Project fixture digest drift");
  if (definitions.document.dataset_sha256 !== definitionCanonicalSha256) throw new Error("Project definition dataset digest drift");
  if (definitions.document.source_manifest_sha256 !== definitionManifestCanonicalSha256) throw new Error("Project definition source manifest digest drift");
  if (prefixes.document.dataset_sha256 !== prefixCanonicalSha256) throw new Error("Project prefix dataset digest drift");
  if (prefixes.document.source_manifest_sha256 !== prefixManifest.document.manifest_sha256
    || prefixManifest.document.manifest_sha256 !== prefixManifestCanonicalSha256) throw new Error("Project prefix source manifest digest drift");

  const sourceIndex = new Map(vendor.document.sources.map((source, index) => [source.id, index]));
  const vendorClaims = vendor.document.records.map((record) => {
    const normalizedDeviceModel = record.model_normalization === "cisco-catalyst-9300-sku-v1";
    const identifierOnly = record.claim_strength === "vendor_identifier";
    return [
      record.sys_object_id,
      sourceIndex.get(record.source_id),
      record.source_symbol,
      normalizedDeviceModel ? "exact_model" : identifierOnly ? "vendor_identifier" : "product_family",
      normalizedDeviceModel ? record.model : null,
      record.product_family,
      identifierOnly
    ];
  });
  const projectFixtures = fixtures.document.identities.map((identity) => [
    identity.sys_object_id.replace(/^\./, ""),
    identity.enterprise_number,
    identity.evidence_state,
    identity.confidence,
    identity.candidates.map((candidate) => [
      candidate.model,
      candidate.family,
      candidate.platform,
      candidate.device_class,
      candidate.source_id,
      candidate.confidence,
      candidate.claim_strength === "entity-corroborated-fixture-observation"
    ])
  ]);
  const projectSources = fixtures.document.sources.map((source) => ({
    id: source.id,
    repository: source.repository,
    revision: source.revision,
    repository_license_signal: source.license.spdx
  }));
  const definitionSources = definitions.document.sources;
  const projectDefinitions = definitions.document.definitions.map((definition) => [
    definition.sys_object_id,
    definition.enterprise_number,
    definition.model,
    definitionSources.findIndex((source) => source.id === definition.source_id),
    definition.declaration_line,
    definition.confidence,
    definition.claim_scope
  ]);
  if (projectDefinitions.some((definition) => definition[3] < 0)) throw new Error("Project definition source index drift");
  const prefixSources = prefixes.document.sources;
  const projectPrefixes = prefixes.document.prefixes.map((prefix) => [
    prefix.oid_prefix,
    prefix.enterprise_number,
    prefix.platform,
    prefixSources.findIndex((source) => source.id === prefix.source_id),
    prefix.source_path,
    prefix.git_blob_oid,
    prefix.source_sha256
  ]);
  if (projectPrefixes.some((prefix) => prefix[3] < 0)) throw new Error("Project prefix source index drift");
  const vendorOids = new Set(vendorClaims.map((claim) => claim[0]));
  const fixtureOids = new Set(projectFixtures.map((fixture) => fixture[0]));
  const definitionOids = new Set(projectDefinitions.map((definition) => definition[0]));
  const sourceCandidateOids = new Set([
    ...definitions.document.definitions.map((definition) => definition.sys_object_id),
    ...definitions.document.quarantine.map((record) => record.sys_object_id)
  ]);
  const fixtureOverlapOids = [...definitionOids].filter((oid) => fixtureOids.has(oid)).sort();
  const fixtureOverlapDispositions = definitionManifest.document.fixture_overlap_dispositions;
  const dispositionByOid = new Map(fixtureOverlapDispositions.map((item) => [item.sys_object_id, item.disposition]));
  if (dispositionByOid.size !== fixtureOverlapDispositions.length
    || fixtureOverlapOids.length !== fixtureOverlapDispositions.length
    || fixtureOverlapOids.some((oid) => !dispositionByOid.has(oid))
    || fixtureOverlapDispositions.some((item) => !definitionOids.has(item.sys_object_id) || !fixtureOids.has(item.sys_object_id))) {
    throw new Error("Project-definition fixture-overlap dispositions drift");
  }
  const vendorFixtureUnion = new Set([...vendorOids, ...fixtureOids]);
  const integrationMeasurements = {
    source_exact_oid_candidates: sourceCandidateOids.size,
    source_candidate_fixture_overlap_oids: [...sourceCandidateOids].filter((oid) => fixtureOids.has(oid)).length,
    source_candidate_vendor_overlap_oids: [...sourceCandidateOids].filter((oid) => vendorOids.has(oid)).length,
    source_candidate_new_vs_fixture_oids: [...sourceCandidateOids].filter((oid) => !fixtureOids.has(oid)).length,
    source_candidate_new_vs_vendor_fixture_union_oids: [...sourceCandidateOids].filter((oid) => !vendorFixtureUnion.has(oid)).length,
    model_definition_oids: definitionOids.size,
    model_definition_fixture_overlap_oids: [...definitionOids].filter((oid) => fixtureOids.has(oid)).length,
    model_definition_vendor_overlap_oids: [...definitionOids].filter((oid) => vendorOids.has(oid)).length,
    model_definition_new_vs_fixture_oids: [...definitionOids].filter((oid) => !fixtureOids.has(oid)).length,
    model_definition_new_vs_vendor_fixture_union_oids: [...definitionOids].filter((oid) => !vendorFixtureUnion.has(oid)).length,
    project_model_oid_coverage: new Set([...fixtureOids, ...definitionOids]).size,
    project_exact_oid_candidate_inventory: new Set([...fixtureOids, ...sourceCandidateOids]).size,
    project_platform_prefixes: projectPrefixes.length,
    project_prefix_platforms: new Set(projectPrefixes.map((prefix) => prefix[2])).size,
    project_prefix_enterprises: new Set(projectPrefixes.map((prefix) => prefix[1])).size
  };

  const document = {
    schema_version: 1,
    identity_release: IDENTITY_RELEASE,
    inputs: {
      vendor_mib: {
        path: "data/device-identities/vendor-mib.json",
        file_sha256: vendor.file_sha256,
        canonical_sha256: vendorCanonicalSha256,
        snapshot_id: vendor.document.snapshot_id,
        record_count: vendor.document.counts.records
      },
      vendor_manifest: {
        path: "data/device-identities/vendor-mib-sources.json",
        file_sha256: vendorManifest.file_sha256,
        canonical_sha256: vendorManifestCanonicalSha256
      },
      project_fixtures: {
        path: "data/device-identities/project-fixtures.json",
        file_sha256: fixtures.file_sha256,
        canonical_sha256: fixtureCanonicalSha256,
        dataset_id: fixtures.document.dataset_id,
        observation_count: fixtures.document.counts.observations
      },
      project_manifest: {
        path: "data/device-identities/project-fixtures-manifest.json",
        file_sha256: fixtureManifest.file_sha256,
        canonical_sha256: fixtureManifestCanonicalSha256
      },
      project_definitions: {
        path: "data/device-identities/project-definitions.json",
        file_sha256: definitions.file_sha256,
        canonical_sha256: definitionCanonicalSha256,
        dataset_id: definitions.document.dataset_id,
        dataset_license: definitions.document.dataset_license,
        definition_count: definitions.document.counts.exact_model_definitions,
        exact_oid_candidate_count: definitions.document.counts.exact_oid_candidates,
        quarantined_entry_count: definitions.document.counts.quarantined_entries
      },
      project_definition_manifest: {
        path: "data/device-identities/project-definitions-manifest.json",
        file_sha256: definitionManifest.file_sha256,
        canonical_sha256: definitionManifestCanonicalSha256
      },
      project_prefixes: {
        path: "data/device-identities/project-prefixes.json",
        file_sha256: prefixes.file_sha256,
        canonical_sha256: prefixCanonicalSha256,
        dataset_id: prefixes.document.dataset_id,
        dataset_license: prefixes.document.dataset_license,
        prefix_count: prefixes.document.counts.prefixes,
        platform_count: prefixes.document.counts.platforms,
        enterprise_count: prefixes.document.counts.enterprises,
        quarantined_literal_count: prefixes.document.counts.quarantined_literals
      },
      project_prefix_manifest: {
        path: "data/device-identities/project-prefixes-manifest.json",
        file_sha256: prefixManifest.file_sha256,
        canonical_sha256: prefixManifestCanonicalSha256,
        manifest_sha256: prefixManifest.document.manifest_sha256
      },
      librenms_license: {
        path: "data/device-identities/licenses/librenms/LICENSE.txt",
        file_sha256: sha256(licenseBytes)
      },
      librenms_readme: {
        path: "data/device-identities/licenses/librenms/README.md",
        file_sha256: sha256(readmeBytes)
      },
      snmp_info_license: {
        path: "data/device-identities/licenses/SNMP-INFO-LICENSE",
        file_sha256: sha256(snmpInfoLicenseBytes)
      },
      racktables_copying: {
        path: "data/device-identities/licenses/racktables/COPYING",
        file_sha256: sha256(rackTablesCopyingBytes)
      },
      racktables_license: {
        path: "data/device-identities/licenses/racktables/LICENSE",
        file_sha256: sha256(rackTablesLicenseBytes)
      }
    },
    vendor_sources: vendor.document.sources,
    vendor_claims: vendorClaims,
    project_sources: projectSources,
    project_fixtures: projectFixtures,
    definition_sources: definitionSources,
    project_definitions: projectDefinitions,
    prefix_sources: prefixSources,
    project_prefixes: projectPrefixes,
    project_definition_fixture_dispositions: fixtureOverlapDispositions.map((item) => [item.sys_object_id, item.disposition]),
    integration_measurements: integrationMeasurements,
    reviewed_pen_links: fixtureManifest.document.organization_mapping_snapshot.reviewed_pen_links,
    runtime_index_sha256: null
  };
  document.runtime_index_sha256 = canonicalJsonSha256(withoutField(document, "runtime_index_sha256"));
  return document;
}

export function buildDeviceIdentityRelease(runtimeIndex, runtimeIndexBytes) {
  const document = {
    schema_version: 1,
    identity_release: IDENTITY_RELEASE,
    release_sha256: null,
    datasets: {
      builtin_claims: BUILTIN_CLAIMS,
      license_evidence: {
        librenms_license_sha256: runtimeIndex.inputs.librenms_license.file_sha256,
        librenms_readme_sha256: runtimeIndex.inputs.librenms_readme.file_sha256,
        snmp_info_license_sha256: runtimeIndex.inputs.snmp_info_license.file_sha256,
        racktables_copying_sha256: runtimeIndex.inputs.racktables_copying.file_sha256,
        racktables_license_sha256: runtimeIndex.inputs.racktables_license.file_sha256
      },
      vendor_mib: {
        snapshot_id: runtimeIndex.inputs.vendor_mib.snapshot_id,
        dataset_sha256: runtimeIndex.inputs.vendor_mib.canonical_sha256,
        file_sha256: runtimeIndex.inputs.vendor_mib.file_sha256,
        source_manifest_sha256: runtimeIndex.inputs.vendor_manifest.canonical_sha256,
        source_manifest_file_sha256: runtimeIndex.inputs.vendor_manifest.file_sha256,
        record_count: runtimeIndex.inputs.vendor_mib.record_count
      },
      project_fixtures: {
        dataset_id: runtimeIndex.inputs.project_fixtures.dataset_id,
        document_sha256: runtimeIndex.inputs.project_fixtures.canonical_sha256,
        file_sha256: runtimeIndex.inputs.project_fixtures.file_sha256,
        manifest_sha256: runtimeIndex.inputs.project_manifest.canonical_sha256,
        manifest_file_sha256: runtimeIndex.inputs.project_manifest.file_sha256,
        observation_count: runtimeIndex.inputs.project_fixtures.observation_count
      },
      project_definitions: {
        dataset_id: runtimeIndex.inputs.project_definitions.dataset_id,
        dataset_license: runtimeIndex.inputs.project_definitions.dataset_license,
        dataset_sha256: runtimeIndex.inputs.project_definitions.canonical_sha256,
        file_sha256: runtimeIndex.inputs.project_definitions.file_sha256,
        manifest_sha256: runtimeIndex.inputs.project_definition_manifest.canonical_sha256,
        manifest_file_sha256: runtimeIndex.inputs.project_definition_manifest.file_sha256,
        definition_count: runtimeIndex.inputs.project_definitions.definition_count,
        exact_oid_candidate_count: runtimeIndex.inputs.project_definitions.exact_oid_candidate_count,
        quarantined_entry_count: runtimeIndex.inputs.project_definitions.quarantined_entry_count
      },
      project_prefixes: {
        dataset_id: runtimeIndex.inputs.project_prefixes.dataset_id,
        dataset_license: runtimeIndex.inputs.project_prefixes.dataset_license,
        dataset_sha256: runtimeIndex.inputs.project_prefixes.canonical_sha256,
        file_sha256: runtimeIndex.inputs.project_prefixes.file_sha256,
        manifest_sha256: runtimeIndex.inputs.project_prefix_manifest.manifest_sha256,
        manifest_file_sha256: runtimeIndex.inputs.project_prefix_manifest.file_sha256,
        prefix_count: runtimeIndex.inputs.project_prefixes.prefix_count,
        platform_count: runtimeIndex.inputs.project_prefixes.platform_count,
        enterprise_count: runtimeIndex.inputs.project_prefixes.enterprise_count,
        quarantined_literal_count: runtimeIndex.inputs.project_prefixes.quarantined_literal_count
      },
      integration_measurements: runtimeIndex.integration_measurements,
      runtime_index: {
        schema_version: runtimeIndex.schema_version,
        runtime_index_sha256: runtimeIndex.runtime_index_sha256,
        file_sha256: sha256(runtimeIndexBytes),
        vendor_claim_count: runtimeIndex.vendor_claims.length,
        project_fixture_oid_count: runtimeIndex.project_fixtures.length,
        project_definition_count: runtimeIndex.project_definitions.length,
        project_prefix_count: runtimeIndex.project_prefixes.length
      }
    },
    source_ids: [...new Set([
      ...runtimeIndex.vendor_sources.map((source) => source.id),
      ...runtimeIndex.project_sources.map((source) => source.id),
      ...runtimeIndex.definition_sources.map((source) => source.id),
      ...runtimeIndex.prefix_sources.map((source) => source.id),
      ...Object.keys(BUILTIN_CLAIMS)
    ])].sort()
  };
  document.release_sha256 = canonicalJsonSha256(withoutField(document, "release_sha256"));
  return document;
}

export async function buildDeviceIdentityArtifacts() {
  const runtimeIndex = await buildDeviceIdentityRuntimeIndex();
  const runtimeIndexBytes = Buffer.from(`${JSON.stringify(runtimeIndex)}\n`);
  const release = buildDeviceIdentityRelease(runtimeIndex, runtimeIndexBytes);
  const releaseBytes = Buffer.from(`${JSON.stringify(release, null, 2)}\n`);
  return { runtimeIndex, runtimeIndexBytes, release, releaseBytes };
}

export async function writeDeviceIdentityArtifacts(outputDirectory = identityRoot) {
  const artifacts = await buildDeviceIdentityArtifacts();
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, "runtime-index.json"), artifacts.runtimeIndexBytes);
  await writeFile(path.join(outputDirectory, "release.json"), artifacts.releaseBytes);
  return artifacts;
}

function outputDirectoryFromArguments(argumentsList) {
  if (!argumentsList.length) return identityRoot;
  if (argumentsList.length !== 2 || argumentsList[0] !== "--output-dir" || !argumentsList[1]) {
    throw new Error("Usage: node scripts/update-device-identity-runtime-index.mjs [--output-dir PATH]");
  }
  return path.resolve(argumentsList[1]);
}

async function main() {
  const { runtimeIndex: document, runtimeIndexBytes, release } = await writeDeviceIdentityArtifacts(
    outputDirectoryFromArguments(process.argv.slice(2))
  );
  process.stdout.write(`${JSON.stringify({
    runtime_index_sha256: document.runtime_index_sha256,
    runtime_index_file_sha256: sha256(runtimeIndexBytes),
    release_sha256: release.release_sha256,
    vendor_claims: document.vendor_claims.length,
    project_fixtures: document.project_fixtures.length,
    project_definitions: document.project_definitions.length,
    project_prefixes: document.project_prefixes.length
  })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
