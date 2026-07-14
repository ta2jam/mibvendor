import assert from "node:assert/strict";
import test from "node:test";

import {
  ENTERPRISE_COUNT,
  IANA_PEN_SOURCE,
  lookupEnterprise,
  lookupSysObjectId,
  moduleDependencies
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

test("dependency closure exposes stable machine-readable state", () => {
  const result = moduleDependencies("if-mib");
  assert.equal(result.module, "IF-MIB");
  assert.equal(result.status, "partial");
  assert.deepEqual(result.cyclic, []);
  assert.ok(result.missing.includes("SNMPv2-SMI"));
  assert.equal(moduleDependencies("NO-SUCH-MIB"), null);
});
