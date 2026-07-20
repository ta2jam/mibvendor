import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  IDENTITY_RELEASE,
  IDENTITY_SOURCES,
  IDENTITY_STATISTICS,
  assessDeviceIdentity,
  lookupEnterprise,
  lookupSysObjectId
} from "../src/intelligence.mjs";
import {
  createDeviceIdentityEngine,
  validateIdentityPublicationControls,
  validateIdentityReleaseManifest
} from "../src/device-identity.mjs";

const projectDefinitionManifest = JSON.parse(await readFile(
  new URL("../data/device-identities/project-definitions-manifest.json", import.meta.url),
  "utf8"
));

test("identity release is immutable, source-bound, and exposes deterministic counts", () => {
  assert.equal(IDENTITY_RELEASE, "device-identity-2026-07-20.3");
  assert.deepEqual(validateIdentityReleaseManifest(), []);
  assert.equal(IDENTITY_STATISTICS.sys_object_id_mappings, 6391);
  assert.equal(IDENTITY_STATISTICS.claims, 7143);
  assert.equal(IDENTITY_STATISTICS.exact_models, 306);
  assert.equal(IDENTITY_STATISTICS.product_families, 1491);
  assert.equal(IDENTITY_STATISTICS.vendor_identifiers, 4672);
  assert.equal(IDENTITY_STATISTICS.exact_models + IDENTITY_STATISTICS.product_families
    + IDENTITY_STATISTICS.vendor_identifiers + IDENTITY_STATISTICS.platforms, IDENTITY_STATISTICS.claims);
  assert.equal(IDENTITY_STATISTICS.platforms, 674);
  assert.equal(IDENTITY_STATISTICS.vendor_families, 279);
  assert.equal(IDENTITY_STATISTICS.project_observation_oids, 713);
  assert.equal(IDENTITY_STATISTICS.project_definition_oids, 270);
  assert.equal(IDENTITY_STATISTICS.project_identity_oid_coverage, 964);
  assert.equal(IDENTITY_STATISTICS.project_platform_prefixes, 655);
  assert.equal(IDENTITY_STATISTICS.project_prefix_platforms, 406);
  assert.equal(IDENTITY_STATISTICS.project_prefix_enterprises, 266);
  assert.equal(IDENTITY_STATISTICS.conflicting_observation_oids, 72);
  assert.equal(IDENTITY_STATISTICS.reviewed_organization_keys, 7);
  assert.equal(IDENTITY_STATISTICS.disabled_sources, 0);
  assert.equal(Object.hasOwn(IDENTITY_STATISTICS, "effective_sources"), false);
  assert.equal(IDENTITY_SOURCES.length, 16);
  assert.equal(IDENTITY_SOURCES.every((source) => source.enabled), true);
  assert.match(IDENTITY_STATISTICS.identity_release_sha256, /^[0-9a-f]{64}$/);
  assert.match(IDENTITY_STATISTICS.runtime_index_sha256, /^[0-9a-f]{64}$/);
  assert.match(IDENTITY_STATISTICS.identity_view, /^device-identity-2026-07-20\.3\./);
  assert.equal(IDENTITY_STATISTICS.publication_control_revision, 1);
  const malformed = {
    schema_version: 1,
    identity_release: IDENTITY_RELEASE,
    release_sha256: "0".repeat(64),
    datasets: { vendor_mib: { injected: true }, project_fixtures: {} },
    source_ids: [],
    prose: "not allowed"
  };
  const failures = validateIdentityReleaseManifest(malformed);
  assert.ok(failures.some((failure) => failure.includes("unexpected top-level")));
  assert.ok(failures.some((failure) => failure.includes("unexpected vendor_mib")));
  assert.ok(failures.some((failure) => failure.includes("snapshot_id drifted")));
  assert.ok(failures.some((failure) => failure.includes("release_sha256")));
  const controlFailures = validateIdentityPublicationControls({
    schema_version: 1,
    active_identity_release: IDENTITY_RELEASE,
    control_revision: 1,
    disabled_sources: ["unknown"]
  });
  assert.ok(controlFailures.some((failure) => failure.includes("unknown disabled source")));
});

test("LibreNMS platform prefixes use longest arc-bound matching, retain parents, and never outrank exact identity", () => {
  const direct = lookupSysObjectId("1.3.6.1.4.1.30065.1");
  assert.equal(direct.status, "resolved");
  assert.equal(direct.identity_status, "platform");
  assert.equal(direct.match.oid, "1.3.6.1.4.1.30065.1");
  assert.equal(direct.match.platform, "arista_eos");
  assert.equal(direct.match.model, null);
  assert.equal(direct.match.product_family, null);
  assert.equal(direct.match.match_type, "prefix");
  assert.equal(direct.match.claim_scope, "open-source-project-platform-prefix");
  assert.equal(direct.match.provenance.source_id, "librenms-os-detection");
  assert.equal(direct.match.provenance.source_revision, "dfba713a2ffd39c2b6619cccdec016e04a06a027");
  assert.equal(direct.match.provenance.source_date, "2026-07-18");
  assert.equal(direct.match.provenance.repository_license_signal, "GPL-3.0-or-later");
  assert.equal(direct.match.provenance.raw_download, false);

  const descendant = lookupSysObjectId("1.3.6.1.4.1.30065.1.99");
  assert.equal(descendant.match.oid, "1.3.6.1.4.1.30065.1");
  assert.equal(descendant.platform, undefined);
  assert.equal(descendant.match.platform, "arista_eos");
  const boundaryMiss = lookupSysObjectId("1.3.6.1.4.1.30065.10");
  assert.equal(boundaryMiss.status, "enterprise_only");
  assert.equal(boundaryMiss.match, null);

  const unregisteredPen = lookupSysObjectId("1.3.6.1.4.1.1004849.3.2.7");
  assert.equal(unregisteredPen.status, "resolved");
  assert.equal(unregisteredPen.enterprise, null);
  assert.equal(unregisteredPen.organization_name, null);
  assert.equal(unregisteredPen.match.organization, null);
  assert.equal(unregisteredPen.match.platform, "dahua-nvr");
  assert.equal(unregisteredPen.match.model, null);

  const nested = lookupSysObjectId("1.3.6.1.4.1.259.10.1.27.101.9");
  assert.equal(nested.match.oid, "1.3.6.1.4.1.259.10.1.27.101");
  assert.deepEqual(nested.assessment.candidates[0].evidence.map((item) => item.matched_oid), [
    "1.3.6.1.4.1.259.10.1.27.101",
    "1.3.6.1.4.1.259.10.1.27"
  ]);

  const exactWins = lookupSysObjectId("1.3.6.1.4.1.9.1.1117");
  assert.equal(exactWins.identity_status, "vendor_identifier");
  assert.equal(exactWins.match.match_type, "exact");
  assert.equal(exactWins.match.mib_identifier, "ciscoSecureAccessControlSystem");
  assert.equal(exactWins.assessment.candidates[0].match_type, "exact");
  assert.ok(exactWins.assessment.candidates.some((candidate) => candidate.match_type === "prefix" && candidate.platform === "acs"));

  const assessment = assessDeviceIdentity({
    sys_object_id: "1.3.6.1.4.1.9.1.1117.999",
    ent_physical_model_name: "C9300-48P"
  });
  assert.equal(assessment.identity_status, "platform");
  assert.equal(assessment.platform, "acs");
  assert.equal(assessment.model, null);
  assert.equal(assessment.product_family, null);
  assert.ok(assessment.evidence.some((item) => item.signal === "sys_object_id" && item.match_type === "prefix"));

  const vendorTypeOnly = assessDeviceIdentity({ ent_physical_vendor_type: "1.3.6.1.4.1.30065.1.99" });
  assert.equal(vendorTypeOnly.identity_status, "vendor_only");
  assert.equal(vendorTypeOnly.platform, null);
});

test("platform-prefix kill switch removes only prefix evidence", () => {
  const baseline = createDeviceIdentityEngine({ lookupEnterprise });
  const disabled = createDeviceIdentityEngine({ lookupEnterprise, disabledSources: ["librenms-os-detection"] });
  const removed = disabled.lookup("1.3.6.1.4.1.30065.1.99");
  assert.equal(removed.status, "enterprise_only");
  assert.equal(removed.match, null);
  assert.equal(disabled.statistics.project_platform_prefixes, 0);
  assert.equal(disabled.statistics.project_prefix_platforms, 0);
  assert.equal(disabled.statistics.project_prefix_enterprises, 0);
  assert.equal(disabled.statistics.platforms, 0);
  assert.equal(disabled.statistics.sys_object_id_mappings, baseline.statistics.sys_object_id_mappings);
  assert.equal(disabled.statistics.claims, baseline.statistics.claims - 655);
  assert.equal(disabled.sources.find((source) => source.source_id === "librenms-os-detection").enabled, false);

  const exactRemains = disabled.lookup("1.3.6.1.4.1.9.1.1117");
  assert.equal(exactRemains.identity_status, "vendor_identifier");
  assert.equal(exactRemains.match.match_type, "exact");
  assert.equal(exactRemains.assessment.candidates.some((candidate) => candidate.match_type === "prefix"), false);
});

test("RackTables exact definitions resolve, corroborate, quarantine conflicts, and obey their kill switch", () => {
  const positive = lookupSysObjectId("1.3.6.1.4.1.9.6.1.83.10.1");
  assert.equal(positive.status, "resolved");
  assert.equal(positive.identity_status, "exact_model");
  assert.equal(positive.match.model, "SG 300-10");
  assert.equal(positive.match.organization, positive.organization_name);
  assert.equal(positive.match.organization, "ciscoSystems");
  assert.equal(positive.match.confidence, "medium");
  assert.equal(positive.match.source_assignment_confidence, "high");
  assert.equal(positive.match.claim_scope, "open-source-project-device-definition");
  assert.equal(positive.match.firmware_scope, "not_established");
  assert.equal(positive.match.provenance.source_id, "racktables-known-switches");
  assert.equal(positive.match.provenance.repository_license_signal, "GPL-2.0-only");
  assert.equal(positive.match.provenance.artifact_rights, "GPL-2.0-only source; mibvendor-normalized definition");
  assert.equal(positive.match.provenance.publication_mode, "definition-only");
  assert.equal(positive.match.provenance.raw_download, false);
  assert.equal(JSON.stringify(positive).includes("8 RJ-45"), false);

  const corroborated = lookupSysObjectId("1.3.6.1.4.1.9.1.659");
  assert.equal(corroborated.match.model, "WS-C4948-10GE");
  assert.equal(corroborated.assessment.corroboration[0].evidence_state, "single_observation");
  assert.equal(corroborated.assessment.conflicts.length, 0);

  const preservedConflict = lookupSysObjectId("1.3.6.1.4.1.9.1.1208");
  assert.equal(preservedConflict.match.model, null);
  assert.equal(preservedConflict.identity_status, "product_family");
  assert.equal(preservedConflict.assessment.corroboration[0].evidence_state, "conflicting_observations");
  assert.equal(preservedConflict.assessment.corroboration[0].candidates.length, 3);
  assert.equal(preservedConflict.assessment.candidates.some((candidate) => candidate.evidence.some((item) => item.source_id === "racktables-known-switches")), false);

  for (const oid of [
    "1.3.6.1.4.1.9.1.1257",
    "1.3.6.1.4.1.11.2.3.7.11.145",
    "1.3.6.1.4.1.25506.11.1.181",
    "1.3.6.1.4.1.10977.11825.11833.97.25451.12800.100.4.4"
  ]) {
    const result = lookupSysObjectId(oid);
    assert.equal(result.assessment.candidates.some((candidate) => candidate.evidence.some((item) => item.source_id === "racktables-known-switches")), false, oid);
  }

  const disabled = createDeviceIdentityEngine({ lookupEnterprise, disabledSources: ["racktables-known-switches"] });
  const removed = disabled.lookup("1.3.6.1.4.1.9.6.1.83.10.1");
  assert.equal(removed.status, "enterprise_only");
  assert.equal(removed.match, null);
  assert.equal(disabled.statistics.project_definition_oids, 0);
  assert.equal(disabled.statistics.project_identity_oid_coverage, 713);
  assert.equal(disabled.statistics.sys_object_id_mappings, 6199);
  assert.equal(disabled.sources.find((source) => source.source_id === "racktables-known-switches").enabled, false);
});

test("all reviewed definition-fixture overlaps follow their explicit materiality disposition", () => {
  assert.equal(projectDefinitionManifest.fixture_overlap_dispositions.length, 19);
  for (const disposition of projectDefinitionManifest.fixture_overlap_dispositions) {
    const result = lookupSysObjectId(disposition.sys_object_id);
    if (disposition.disposition === "material-disagreement") {
      assert.equal(result.status, "ambiguous", disposition.sys_object_id);
      assert.equal(result.identity_status, "conflicting_evidence", disposition.sys_object_id);
      assert.equal(result.match, null, disposition.sys_object_id);
      assert.ok(result.assessment.conflicts.some((conflict) => conflict.type === "model_mismatch"), disposition.sys_object_id);
      assert.match(result.caveat, /materially conflicts/, disposition.sys_object_id);
      assert.doesNotMatch(result.caveat, /Only the PEN registry boundary is known/, disposition.sys_object_id);
    } else {
      assert.equal(result.status, "resolved", disposition.sys_object_id);
      assert.equal(result.identity_status, "exact_model", disposition.sys_object_id);
      assert.equal(result.match.provenance.source_id, "racktables-known-switches", disposition.sys_object_id);
      assert.equal(result.assessment.conflicts.length, 0, disposition.sys_object_id);
    }
  }
});

test("exact Cisco lookups distinguish models, family claims, and registry-only identities", () => {
  const c930024t = lookupSysObjectId(".1.3.6.1.4.1.9.1.2435");
  assert.equal(c930024t.status, "resolved");
  assert.equal(c930024t.identity_status, "exact_model");
  assert.equal(c930024t.firmware_scope, "not_established");
  assert.equal(c930024t.match.model, "C9300-24T");
  assert.equal(c930024t.match.firmware_scope, "not_established");
  assert.equal(c930024t.assessment.candidates[0].firmware_scope, "not_established");
  assert.equal(c930024t.match.product_family, "Catalyst 9300");
  assert.equal(c930024t.match.claim_scope, "device-model");
  assert.equal(c930024t.enterprise_number, 9);
  assert.equal(c930024t.organization_key, "Q173395");
  assert.equal(c930024t.organization_key_status, "reviewed");
  assert.equal(c930024t.identity_release, IDENTITY_RELEASE);
  assert.equal(c930024t.match.provenance.publication_mode, "metadata-only");
  assert.equal(c930024t.match.provenance.raw_download, false);
  assert.equal(c930024t.match.provenance.repository_license_signal, "GPL-3.0-or-later");
  assert.match(c930024t.match.provenance.artifact_rights, /restrictive/);
  assert.match(c930024t.match.provenance.publication_basis, /factual metadata/);
  assert.equal("source_license" in c930024t.match.provenance, false);
  assert.equal(c930024t.match.provenance.official_source_status, "official-source-reference-not-byte-verified-by-build");
  assert.equal(c930024t.match.provenance.official_source_byte_verified, false);
  assert.equal("description" in c930024t.match.provenance, false);
  assert.equal(c930024t.assessment.evidence[0].type, "iana-pen-registry");

  const neighbor = lookupSysObjectId("1.3.6.1.4.1.9.1.2436");
  assert.equal(neighbor.match.model, "C9300-24P");
  assert.notEqual(neighbor.match.model, "C9300-24T");

  const stack = lookupSysObjectId("1.3.6.1.4.1.9.1.2494");
  assert.equal(stack.identity_status, "product_family");
  assert.equal(stack.match.model, null);
  assert.equal(stack.match.product_family, "Catalyst 9300");
  assert.equal(stack.assessment.corroboration[0].candidates[0].model, "C9300-48P");
  assert.equal(stack.assessment.corroboration[0].candidates[0].firmware_scope, "not_established");

  const unknownCisco = lookupSysObjectId("1.3.6.1.4.1.9.999999");
  assert.equal(unknownCisco.status, "enterprise_only");
  assert.equal(unknownCisco.identity_status, "vendor_only");
  assert.equal(unknownCisco.firmware_scope, "not_established");
  assert.equal(unknownCisco.match, null);

  const unknownIdentity = lookupSysObjectId("1.3.6.1.2.1.1.2");
  assert.equal(unknownIdentity.identity_status, "unknown");
  assert.equal(unknownIdentity.firmware_scope, null);

  const genericIdentifier = lookupSysObjectId("1.3.6.1.4.1.9.1.6");
  assert.equal(genericIdentifier.identity_status, "vendor_identifier");
  assert.equal(genericIdentifier.match.model, null);
  assert.equal(genericIdentifier.match.mib_identifier, "cisco3000");
  assert.equal(genericIdentifier.match.claim_scope, "vendor-mib-object-identifier");
  assert.equal(genericIdentifier.match.confidence, "medium");
  assert.equal(genericIdentifier.match.source_assignment_confidence, "high");
  assert.match(genericIdentifier.caveat, /module, line card, or component/);

  const component = lookupSysObjectId("1.3.6.1.4.1.9.1.738");
  assert.equal(component.identity_status, "vendor_identifier");
  assert.equal(component.match.model, null);
  assert.equal(component.match.mib_identifier, "ciscoCrs18Linecard");
  assert.equal(component.match.claim_scope, "vendor-mib-object-identifier");
});

test("all seven reviewed MAC-PEN links are returned without synthesized keys", () => {
  const expected = new Map([
    [9, "Q173395"], [63, "Q312"], [236, "Q20718"], [311, "Q2283"],
    [343, "Q248"], [2011, "Q160120"], [11129, "Q95"]
  ]);
  for (const [pen, organizationKey] of expected) {
    const lookup = lookupSysObjectId(`1.3.6.1.4.1.${pen}.4294967295`);
    assert.equal(lookup.enterprise_number, pen);
    assert.equal(lookup.organization_key, organizationKey);
    assert.equal(lookup.organization_key_status, "reviewed");
  }
  const unmapped = lookupSysObjectId("1.3.6.1.4.1.2.4294967295");
  assert.equal(unmapped.organization_key, null);
  assert.equal(unmapped.organization_key_status, "not_available");
});

test("multi-signal assessment applies deterministic model, platform, and conflict gates", () => {
  const generic = assessDeviceIdentity({ sys_descr: "Cisco IOS XE Software, Version 17" });
  assert.equal(generic.status, "resolved");
  assert.equal(generic.identity_status, "platform");
  assert.equal(generic.firmware_scope, "not_established");
  assert.equal(generic.platform, "Cisco IOS XE");
  assert.equal(generic.model, null);
  assert.equal(generic.product_family, null);
  assert.equal(JSON.stringify(generic).includes("Version 17"), false);
  assert.equal(generic.evidence[0].type, "iana-pen-registry");

  const invented = assessDeviceIdentity({ ent_physical_model_name: "C9300FAKE-XYZ" });
  assert.equal(invented.identity_status, "unknown");
  assert.equal(invented.firmware_scope, null);
  assert.equal(invented.product_family, null);
  assert.equal(invented.model, null);
  assert.equal(JSON.stringify(invented).includes("C9300FAKE-XYZ"), false);

  const uncorroboratedRealModel = assessDeviceIdentity({ ent_physical_model_name: "C9300-48P" });
  assert.equal(uncorroboratedRealModel.identity_status, "unknown");
  assert.equal(uncorroboratedRealModel.enterprise_number, null);
  assert.equal(uncorroboratedRealModel.model, null);

  const registryOnlyRealModel = assessDeviceIdentity({
    sys_object_id: "1.3.6.1.4.1.9.999999",
    ent_physical_model_name: "C9300-48P"
  });
  assert.equal(registryOnlyRealModel.identity_status, "vendor_only");
  assert.equal(registryOnlyRealModel.firmware_scope, "not_established");
  assert.equal(registryOnlyRealModel.candidates[0].firmware_scope, "not_established");
  assert.equal(registryOnlyRealModel.enterprise_number, 9);
  assert.equal(registryOnlyRealModel.model, null);
  assert.equal(registryOnlyRealModel.product_family, null);

  const conflict = assessDeviceIdentity({
    sys_object_id: "1.3.6.1.4.1.9.1.2435",
    ent_physical_model_name: "C9300-24P"
  });
  assert.equal(conflict.status, "ambiguous");
  assert.equal(conflict.identity_status, "conflicting_evidence");
  assert.equal(conflict.firmware_scope, null);
  assert.equal(conflict.enterprise_number, null);
  assert.equal(conflict.organization_key, null);
  assert.equal(conflict.conflicts[0].type, "model_mismatch");

  const corroborated = assessDeviceIdentity({
    sys_object_id: "1.3.6.1.4.1.9.1.2494",
    ent_physical_model_name: "C9300-48P"
  });
  assert.equal(corroborated.status, "resolved");
  assert.equal(corroborated.identity_status, "exact_model");
  assert.equal(corroborated.model, "C9300-48P");
  assert.equal(corroborated.product_family, "Catalyst 9300");
  assert.equal(corroborated.conflicts.length, 0);
  assert.equal(corroborated.evidence.find((item) => item.type === "project-fixture-corroboration").corroborates_reported_model, true);

  const familyConflict = assessDeviceIdentity({
    sys_object_id: "1.3.6.1.4.1.9.1.2494",
    ent_physical_vendor_type: "1.3.6.1.4.1.9.1.11"
  });
  assert.equal(familyConflict.status, "ambiguous");
  assert.equal(familyConflict.conflicts[0].type, "family_mismatch");
  assert.deepEqual(familyConflict.conflicts[0].product_families, ["CATALYST 9300", "CISCOAGSPLUS"]);

  const crossVendor = assessDeviceIdentity({
    sys_object_id: "1.3.6.1.4.1.9.1.2435",
    ent_physical_vendor_type: "1.3.6.1.4.1.8072.3.2.10"
  });
  assert.equal(crossVendor.status, "ambiguous");
  assert.equal(crossVendor.conflicts[0].type, "cross_vendor");
  assert.equal(crossVendor.enterprise_number, null);
  assert.equal(crossVendor.organization_key, null);
});

test("identity source kill switch removes primary claims without inventing replacements", () => {
  const disabled = createDeviceIdentityEngine({ lookupEnterprise, disabledSources: ["cisco-products"] });
  const lookup = disabled.lookup("1.3.6.1.4.1.9.1.2435");
  assert.equal(lookup.status, "enterprise_only");
  assert.equal(lookup.identity_status, "vendor_only");
  assert.equal(lookup.match, null);
  assert.equal(lookup.organization_key, "Q173395");
  assert.equal(disabled.statistics.disabled_sources, 1);
  assert.equal(disabled.statistics.sys_object_id_mappings, 3615);
  assert.notEqual(disabled.statistics.identity_view, IDENTITY_STATISTICS.identity_view);
  assert.equal(disabled.sources.find((source) => source.source_id === "cisco-products").enabled, false);
  for (const sysObjectId of ["1.3.6.1.4.1.9.1.2494", "1.3.6.1.4.1.9.999999"]) {
    const assessment = disabled.assess({
      sys_object_id: sysObjectId,
      ent_physical_model_name: "C9300-48P"
    });
    assert.equal(assessment.status, "vendor_only");
    assert.equal(assessment.identity_status, "vendor_only");
    assert.equal(assessment.enterprise_number, 9);
    assert.equal(assessment.model, null);
    assert.equal(assessment.product_family, null);
  }
  assert.throws(
    () => createDeviceIdentityEngine({ lookupEnterprise, disabledSources: ["not-a-pinned-source"] }),
    /Unknown disabled identity source/
  );
});

test("fixture source kill switches recompute effective conflicts and confidence", () => {
  const withoutSnmpInfo = createDeviceIdentityEngine({
    lookupEnterprise,
    disabledSources: ["snmp-info-project-tests"]
  });
  const librenmsOnly = withoutSnmpInfo.lookup("1.3.6.1.4.1.4874.1.1.1.1.1")
    .assessment.corroboration[0];
  assert.equal(librenmsOnly.evidence_state, "single_observation");
  assert.equal(librenmsOnly.confidence, "medium");
  assert.equal(librenmsOnly.candidates.length, 1);
  assert.equal(librenmsOnly.candidates[0].model, "Juniper ERX-1400");
  assert.equal(withoutSnmpInfo.statistics.project_observation_oids, 674);
  assert.equal(withoutSnmpInfo.statistics.conflicting_observation_oids, 70);

  const withoutLibreNms = createDeviceIdentityEngine({
    lookupEnterprise,
    disabledSources: ["librenms-project-tests"]
  });
  const snmpInfoOnly = withoutLibreNms.lookup("1.3.6.1.4.1.4874.1.1.1.1.1")
    .assessment.corroboration[0];
  assert.equal(snmpInfoOnly.evidence_state, "single_observation");
  assert.equal(snmpInfoOnly.confidence, "medium");
  assert.equal(snmpInfoOnly.candidates.length, 1);
  assert.equal(snmpInfoOnly.candidates[0].model, "ERX-1400");
  assert.equal(withoutLibreNms.statistics.project_observation_oids, 43);
  assert.equal(withoutLibreNms.statistics.conflicting_observation_oids, 0);
});
