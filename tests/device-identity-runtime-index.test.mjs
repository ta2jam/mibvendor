import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalJsonSha256 } from "../scripts/canonical-json.mjs";
import { writeDeviceIdentityArtifacts } from "../scripts/update-device-identity-runtime-index.mjs";

function withoutField(document, field) {
  return Object.fromEntries(Object.entries(document).filter(([key]) => key !== field));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("runtime index and release manifest rebuild byte-for-byte from pinned inputs", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "mibvendor-device-identity-"));
  try {
    const { runtimeIndex, release } = await writeDeviceIdentityArtifacts(outputDirectory);
    const [rebuiltRuntime, rebuiltRelease, committedRuntime, committedRelease] = await Promise.all([
      readFile(path.join(outputDirectory, "runtime-index.json")),
      readFile(path.join(outputDirectory, "release.json")),
      readFile(new URL("../data/device-identities/runtime-index.json", import.meta.url)),
      readFile(new URL("../data/device-identities/release.json", import.meta.url))
    ]);

    assert.deepEqual(rebuiltRuntime, committedRuntime);
    assert.deepEqual(rebuiltRelease, committedRelease);
    assert.equal(
      runtimeIndex.runtime_index_sha256,
      canonicalJsonSha256(withoutField(runtimeIndex, "runtime_index_sha256"))
    );
    assert.equal(release.release_sha256, canonicalJsonSha256(withoutField(release, "release_sha256")));
    const snmpInfoLicense = await readFile(new URL("../data/device-identities/licenses/SNMP-INFO-LICENSE", import.meta.url));
    assert.deepEqual(runtimeIndex.inputs.snmp_info_license, {
      path: "data/device-identities/licenses/SNMP-INFO-LICENSE",
      file_sha256: sha256(snmpInfoLicense)
    });
    assert.equal(release.datasets.license_evidence.snmp_info_license_sha256, sha256(snmpInfoLicense));
    const rackTablesCopying = await readFile(new URL("../data/device-identities/licenses/racktables/COPYING", import.meta.url));
    const rackTablesLicense = await readFile(new URL("../data/device-identities/licenses/racktables/LICENSE", import.meta.url));
    assert.equal(sha256(rackTablesCopying), "380d0eb15d2fcb04f55ea2f8ac5e1769264ca92e531b72094e24eb5569207b75");
    assert.equal(sha256(rackTablesLicense), "ab15fd526bd8dd18a9e77ebc139656bf4d33e97fc7238cd11bf60e2b9b8666c6");
    assert.equal(release.datasets.license_evidence.racktables_copying_sha256, sha256(rackTablesCopying));
    assert.equal(release.datasets.license_evidence.racktables_license_sha256, sha256(rackTablesLicense));
    assert.equal(runtimeIndex.inputs.project_definitions.dataset_license.spdx, "GPL-2.0-only");
    assert.match(runtimeIndex.inputs.project_definitions.dataset_license.scope, /runtime-index\.json, and API responses/);
    assert.deepEqual(release.datasets.project_definitions.dataset_license, runtimeIndex.inputs.project_definitions.dataset_license);
    assert.equal(runtimeIndex.inputs.project_prefixes.dataset_license.spdx, "GPL-3.0-or-later");
    assert.equal(runtimeIndex.inputs.project_prefixes.prefix_count, 655);
    assert.equal(runtimeIndex.inputs.project_prefixes.platform_count, 406);
    assert.equal(runtimeIndex.inputs.project_prefixes.enterprise_count, 266);
    assert.equal(runtimeIndex.inputs.project_prefixes.quarantined_literal_count, 358);
    assert.deepEqual(release.datasets.project_prefixes.dataset_license, runtimeIndex.inputs.project_prefixes.dataset_license);
    assert.equal(release.datasets.runtime_index.project_prefix_count, 655);
    assert.equal(runtimeIndex.project_prefixes.length, 655);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("project integration measurements are independently recomputed and overlap dispositions are exhaustive", async () => {
  const [runtimeIndex, release, vendor, fixtures, definitions, manifest, prefixes] = await Promise.all([
    readFile(new URL("../data/device-identities/runtime-index.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../data/device-identities/release.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../data/device-identities/vendor-mib.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../data/device-identities/project-fixtures.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../data/device-identities/project-definitions.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../data/device-identities/project-definitions-manifest.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../data/device-identities/project-prefixes.json", import.meta.url), "utf8").then(JSON.parse)
  ]);
  const vendorOids = new Set(vendor.records.map((record) => record.sys_object_id));
  const fixtureOids = new Set(fixtures.identities.map((record) => record.sys_object_id.replace(/^\./, "")));
  const definitionOids = new Set(definitions.definitions.map((record) => record.sys_object_id));
  const sourceCandidateOids = new Set([
    ...definitions.definitions.map((record) => record.sys_object_id),
    ...definitions.quarantine.map((record) => record.sys_object_id)
  ]);
  const vendorFixtureUnion = new Set([...vendorOids, ...fixtureOids]);
  const independentlyMeasured = {
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
    project_platform_prefixes: prefixes.prefixes.length,
    project_prefix_platforms: new Set(prefixes.prefixes.map((prefix) => prefix.platform)).size,
    project_prefix_enterprises: new Set(prefixes.prefixes.map((prefix) => prefix.enterprise_number)).size
  };
  assert.deepEqual(independentlyMeasured, {
    source_exact_oid_candidates: 303,
    source_candidate_fixture_overlap_oids: 22,
    source_candidate_vendor_overlap_oids: 108,
    source_candidate_new_vs_fixture_oids: 281,
    source_candidate_new_vs_vendor_fixture_union_oids: 180,
    model_definition_oids: 270,
    model_definition_fixture_overlap_oids: 19,
    model_definition_vendor_overlap_oids: 97,
    model_definition_new_vs_fixture_oids: 251,
    model_definition_new_vs_vendor_fixture_union_oids: 160,
    project_model_oid_coverage: 964,
    project_exact_oid_candidate_inventory: 994,
    project_platform_prefixes: 655,
    project_prefix_platforms: 406,
    project_prefix_enterprises: 266
  });
  assert.deepEqual(runtimeIndex.integration_measurements, independentlyMeasured);
  assert.deepEqual(release.datasets.integration_measurements, independentlyMeasured);

  const overlapOids = [...definitionOids].filter((oid) => fixtureOids.has(oid)).sort();
  const dispositions = manifest.fixture_overlap_dispositions;
  assert.equal(dispositions.length, 19);
  assert.deepEqual(dispositions.map((item) => item.sys_object_id).sort(), overlapOids);
  assert.equal(dispositions.filter((item) => item.disposition === "material-disagreement").length, 4);
  assert.equal(dispositions.filter((item) => item.disposition !== "material-disagreement").length, 15);
});
