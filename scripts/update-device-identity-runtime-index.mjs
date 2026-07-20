import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { canonicalJsonSha256 } from "./canonical-json.mjs";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const identityRoot = path.join(projectRoot, "data", "device-identities");
const IDENTITY_RELEASE = "device-identity-2026-07-20.1";
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
  const licenseBytes = await readFile(path.join(identityRoot, "licenses/librenms/LICENSE.txt"));
  const readmeBytes = await readFile(path.join(identityRoot, "licenses/librenms/README.md"));
  const snmpInfoLicenseBytes = await readFile(path.join(identityRoot, "licenses/SNMP-INFO-LICENSE"));

  const vendorCanonicalSha256 = canonicalJsonSha256(withoutField(vendor.document, "dataset_sha256"));
  const fixtureCanonicalSha256 = canonicalJsonSha256(withoutField(fixtures.document, "document_sha256"));
  const vendorManifestCanonicalSha256 = canonicalJsonSha256(vendorManifest.document);
  const fixtureManifestCanonicalSha256 = canonicalJsonSha256(fixtureManifest.document);
  if (vendor.document.dataset_sha256 !== vendorCanonicalSha256) throw new Error("Vendor identity dataset digest drift");
  if (vendor.document.source_manifest_sha256 !== vendorManifestCanonicalSha256) throw new Error("Vendor identity source manifest digest drift");
  if (fixtures.document.document_sha256 !== fixtureCanonicalSha256) throw new Error("Project fixture digest drift");

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
      }
    },
    vendor_sources: vendor.document.sources,
    vendor_claims: vendorClaims,
    project_sources: projectSources,
    project_fixtures: projectFixtures,
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
        snmp_info_license_sha256: runtimeIndex.inputs.snmp_info_license.file_sha256
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
      runtime_index: {
        schema_version: runtimeIndex.schema_version,
        runtime_index_sha256: runtimeIndex.runtime_index_sha256,
        file_sha256: sha256(runtimeIndexBytes),
        vendor_claim_count: runtimeIndex.vendor_claims.length,
        project_fixture_oid_count: runtimeIndex.project_fixtures.length
      }
    },
    source_ids: [...new Set([
      ...runtimeIndex.vendor_sources.map((source) => source.id),
      ...runtimeIndex.project_sources.map((source) => source.id),
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
    project_fixtures: document.project_fixtures.length
  })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
