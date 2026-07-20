import assert from "node:assert/strict";
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

test("identity release is immutable, source-bound, and exposes deterministic counts", () => {
  assert.equal(IDENTITY_RELEASE, "device-identity-2026-07-20.1");
  assert.deepEqual(validateIdentityReleaseManifest(), []);
  assert.equal(IDENTITY_STATISTICS.sys_object_id_mappings, 6218);
  assert.equal(IDENTITY_STATISTICS.claims, 6218);
  assert.equal(IDENTITY_STATISTICS.exact_models, 36);
  assert.equal(IDENTITY_STATISTICS.product_families, 1491);
  assert.equal(IDENTITY_STATISTICS.vendor_identifiers, 4672);
  assert.equal(IDENTITY_STATISTICS.exact_models + IDENTITY_STATISTICS.product_families
    + IDENTITY_STATISTICS.vendor_identifiers + IDENTITY_STATISTICS.platforms, IDENTITY_STATISTICS.claims);
  assert.equal(IDENTITY_STATISTICS.platforms, 19);
  assert.equal(IDENTITY_STATISTICS.vendor_families, 12);
  assert.equal(IDENTITY_STATISTICS.project_observation_oids, 713);
  assert.equal(IDENTITY_STATISTICS.conflicting_observation_oids, 72);
  assert.equal(IDENTITY_STATISTICS.reviewed_organization_keys, 7);
  assert.equal(IDENTITY_STATISTICS.disabled_sources, 0);
  assert.equal(Object.hasOwn(IDENTITY_STATISTICS, "effective_sources"), false);
  assert.equal(IDENTITY_SOURCES.length, 14);
  assert.equal(IDENTITY_SOURCES.every((source) => source.enabled), true);
  assert.match(IDENTITY_STATISTICS.identity_release_sha256, /^[0-9a-f]{64}$/);
  assert.match(IDENTITY_STATISTICS.runtime_index_sha256, /^[0-9a-f]{64}$/);
  assert.match(IDENTITY_STATISTICS.identity_view, /^device-identity-2026-07-20\.1\./);
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
  assert.equal(disabled.statistics.sys_object_id_mappings, 3357);
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
