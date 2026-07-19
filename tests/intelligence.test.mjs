import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ENTERPRISE_COUNT,
  IANA_PEN_SOURCE,
  SYS_OBJECT_ID_COUNT,
  lookupEnterprise,
  lookupSysObjectId,
  moduleDependencies,
  resolveObject,
  searchObjects
} from "../src/intelligence.mjs";

test("IANA PEN snapshot is large, source-addressed, and strips contact data", () => {
  assert.ok(ENTERPRISE_COUNT > 60_000);
  assert.match(IANA_PEN_SOURCE.sha256, /^[0-9a-f]{64}$/);
  assert.equal(IANA_PEN_SOURCE.rights, "CC0-1.0");
  const enterprise = lookupEnterprise(9);
  assert.equal(enterprise.organization, "ciscoSystems");
  assert.equal("email" in enterprise, false);
  assert.equal("contact" in enterprise, false);
});

test("sysObjectID lookup never upgrades an enterprise-only match to a product guess", () => {
  const exact = lookupSysObjectId("1.3.6.1.4.1.8072.3.2.16");
  assert.equal(exact.status, "resolved");
  assert.equal(exact.match.platform, "macOS");
  assert.equal(exact.match.model, null);
  assert.equal(exact.match.claim_strength, "platform");

  const enterpriseOnly = lookupSysObjectId("1.3.6.1.4.1.2.1.999999");
  assert.equal(enterpriseOnly.status, "enterprise_only");
  assert.equal(enterpriseOnly.enterprise.number, 2);
  assert.equal(enterpriseOnly.match, null);

  const rightsRestricted = lookupSysObjectId("1.3.6.1.4.1.9.1.999999");
  assert.equal(rightsRestricted.status, "unavailable_due_to_rights");
  assert.equal(rightsRestricted.rights.api_output, "denied");
  assert.equal(rightsRestricted.match, null);

  assert.equal(lookupSysObjectId("not-an-oid").status, "invalid");
  assert.equal(lookupSysObjectId("1.3.6.1.2.1.1.2").status, "not_found");
});

test("SigScale OCS is an exact platform claim with artifact-level provenance, never a model guess", () => {
  assert.equal(SYS_OBJECT_ID_COUNT, 19);

  const exact = lookupSysObjectId("1.3.6.1.4.1.50386.1.1");
  assert.equal(exact.status, "resolved");
  assert.equal(exact.enterprise.number, 50386);
  assert.equal(exact.match.organization, "SigScale Global Inc.");
  assert.equal(exact.match.product_family, "SigScale OCS");
  assert.equal(exact.match.platform, "SigScale OCS");
  assert.equal(exact.match.model, null);
  assert.equal(exact.match.match_type, "exact");
  assert.equal(exact.match.claim_strength, "platform");
  assert.equal(exact.match.provenance.source_revision, "14259b9e52a5cd7ff0fd60b33728da616792887d");
  assert.equal(exact.match.provenance.source_path, "mibs/SIGSCALE-PRODUCTS-MIB.mib");
  assert.match(exact.match.provenance.git_blob_oid, /^[0-9a-f]{40}$/);
  assert.match(exact.match.provenance.sha256, /^[0-9a-f]{64}$/);
  assert.equal(exact.match.provenance.source_license, "Apache-2.0");
  assert.equal(exact.match.provenance.license_basis, "repository-license-signal");
  assert.deepEqual(
    exact.match.provenance.field_evidence.map((evidence) => evidence.fields),
    [["oid", "product_family", "platform", "claim_strength"], ["oid", "organization", "enterprise_number"]]
  );

  const samePenUnknownProduct = lookupSysObjectId("1.3.6.1.4.1.50386.1.999");
  assert.equal(samePenUnknownProduct.status, "enterprise_only");
  assert.equal(samePenUnknownProduct.match, null);

  const ibmGeneric = lookupSysObjectId("1.3.6.1.4.1.2.1.999999");
  assert.equal(ibmGeneric.status, "enterprise_only");
  assert.equal(ibmGeneric.match, null);

  const unknownEnterprise = lookupSysObjectId("1.3.6.1.4.1.4294967295.1");
  assert.equal(unknownEnterprise.status, "not_found");
  assert.equal(unknownEnterprise.match, null);
});

test("SigScale identity provenance resolves to the approved pinned intake bytes", () => {
  const match = lookupSysObjectId("1.3.6.1.4.1.50386.1.1").match;
  const intake = JSON.parse(readFileSync(new URL("../data/license-derived-intake.json", import.meta.url), "utf8"));
  const source = intake.sources.find((candidate) => candidate.id === match.provenance.source_id);
  assert.ok(source);
  assert.equal(source.commit, match.provenance.source_revision);
  assert.equal(source.license.spdx, match.provenance.source_license);
  assert.equal(source.license.basis, match.provenance.license_basis);

  for (const evidence of match.provenance.field_evidence) {
    const artifact = intake.artifacts.find((candidate) =>
      candidate.source_id === match.provenance.source_id && candidate.source_path === evidence.source_path
    );
    assert.ok(artifact, evidence.source_path);
    assert.equal(artifact.source_revision, match.provenance.source_revision);
    assert.equal(artifact.pinned_url, evidence.source_url);
    assert.equal(artifact.git_blob_oid, evidence.git_blob_oid);
    assert.equal(artifact.artifact_sha256, evidence.sha256);

    const bytes = readFileSync(new URL(`../data/${artifact.staged_path}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), evidence.sha256);
    assert.equal(
      createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
      evidence.git_blob_oid
    );
  }

  const license = source.license.files.find((candidate) => candidate.source_path === match.provenance.license.source_path);
  assert.ok(license);
  assert.equal(license.pinned_url, match.provenance.license.source_url);
  assert.equal(license.git_blob_oid, match.provenance.license.git_blob_oid);
  assert.equal(license.sha256, match.provenance.license.sha256);
  const licenseBytes = readFileSync(new URL(`../data/${license.staged_path}`, import.meta.url));
  assert.equal(createHash("sha256").update(licenseBytes).digest("hex"), match.provenance.license.sha256);
  assert.equal(
    createHash("sha1").update(`blob ${licenseBytes.length}\0`).update(licenseBytes).digest("hex"),
    match.provenance.license.git_blob_oid
  );
});

test("catalog records supersede duplicate synthetic records in search and resolution", () => {
  const search = searchObjects("interface status");
  const matches = search.filter((record) => record.id === "if-mib--ifoperstatus");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].module, "IF-MIB");
  assert.equal(matches[0].provenance.rights_tier, "A");
  assert.equal(matches[0].provenance.publication_mode, "redistributable");
  assert.equal(matches[0].provenance.raw_download, true);
  assert.match(matches[0].provenance.source_revision, /^[0-9a-f]{40}$/);

  const resolved = resolveObject("1.3.6.1.2.1.2.2.1.8.7");
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.object.id, "if-mib--ifoperstatus");
  assert.equal(resolved.object.kind, "column");
  assert.deepEqual(resolved.object.relationships, {
    parent: "ifEntry",
    table: "ifTable",
    row: "ifEntry",
    indexes: ["ifIndex"],
    augments: null,
    notification_objects: []
  });
  assert.deepEqual(resolved.instance_suffix, [7]);
});

test("scalar instances resolve to the catalog record while structural descendants stay unknown", () => {
  const scalar = resolveObject("1.3.6.1.2.1.1.3.0");
  assert.equal(scalar.status, "resolved");
  assert.equal(scalar.object.id, "snmpv2-mib--sysuptime");
  assert.equal(scalar.object.module, "SNMPv2-MIB");
  assert.equal(scalar.object.kind, "scalar");
  assert.equal(scalar.object.provenance.rights_tier, "A");
  assert.deepEqual(scalar.instance_suffix, [0]);

  for (const oid of [
    "1.3.6.1.2.1.2.2.999999",
    "1.3.6.1.2.1.2.2.1.999999"
  ]) {
    assert.deepEqual(resolveObject(oid), { input: oid, status: "not_found" });
  }
});

test("dependency closure exposes the complete active IF-MIB graph", () => {
  const result = moduleDependencies("if-mib");
  assert.equal(result.module, "IF-MIB");
  assert.equal(result.status, "complete");
  assert.deepEqual(result.direct, ["IANAifType-MIB", "SNMPv2-CONF", "SNMPv2-MIB", "SNMPv2-SMI", "SNMPv2-TC"]);
  assert.deepEqual(result.transitive, []);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.cyclic, []);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(moduleDependencies("NO-SUCH-MIB"), null);
});
