import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canonicalJsonSha256 } from "../scripts/canonical-json.mjs";
import { conflictGroups, parseObjectIdentifierAssignments } from "../scripts/update-device-identities.mjs";
import { classifyIdentityClaims, validateDeviceIdentities } from "../scripts/validate-device-identities.mjs";

const manifest = JSON.parse(await readFile(new URL("../data/device-identities/vendor-mib-sources.json", import.meta.url), "utf8"));
const dataset = JSON.parse(await readFile(new URL("../data/device-identities/vendor-mib.json", import.meta.url), "utf8"));

function refreshDigest(document) {
  document.dataset_sha256 = canonicalJsonSha256(Object.fromEntries(Object.entries(document).filter(([key]) => key !== "dataset_sha256")));
}

test("offline validator accepts the pinned vendor-MIB metadata snapshot", () => {
  assert.deepEqual(validateDeviceIdentities(manifest, dataset), []);
  assert.equal(dataset.layer, "vendor-mib-factual-metadata");
  assert.equal(dataset.rights_boundary.raw_mib_included, false);
  assert.equal(dataset.rights_boundary.descriptions_included, false);
  assert.ok(dataset.sources.every((source) => source.publication_mode === "metadata-only" && source.raw_distribution === "denied"));
  assert.ok(dataset.records.every((record) => !Object.hasOwn(record, "description") && !Object.hasOwn(record, "raw_mib")));
});

test("coverage reports exact OID keys separately from defensible exact-model claims", () => {
  assert.equal(dataset.counts.sources, 10);
  assert.equal(dataset.counts.vendor_families, 10);
  assert.ok(dataset.counts.exact_oid_keys >= 6_000);
  assert.equal(dataset.counts.exact_models, 36);
  assert.equal(dataset.counts.product_families, 1_491);
  assert.equal(dataset.counts.vendor_identifiers, 4_672);
  assert.equal(dataset.counts.exact_models + dataset.counts.product_families + dataset.counts.vendor_identifiers, dataset.counts.records);
  assert.equal(dataset.counts.organization_keys, 1);
});

test("immutable source, rights-conflict, PEN, and reviewed organization-link provenance stay explicit", () => {
  for (const source of dataset.sources) {
    assert.match(source.source_repository_commit, /^[0-9a-f]{40}$/);
    assert.match(source.git_blob_oid, /^[0-9a-f]{40}$/);
    assert.match(source.sha256, /^[0-9a-f]{64}$/);
    assert.ok(source.source_url.includes(source.source_repository_commit));
    assert.equal(source.pen, source.enterprise_number);
    assert.equal(source.source_license_signal, "GPL-3.0-or-later");
    assert.ok(["restrictive-notice", "copyright-no-redistribution-grant", "no-redistribution-grant-found"].includes(source.artifact_rights));
  }
  const cisco = dataset.sources.find((source) => source.id === "cisco-products");
  assert.equal(cisco.organization_key, "Q173395");
  assert.equal(cisco.official_source.status, "official-source-reference-not-byte-verified-by-build");
  assert.ok(dataset.sources.filter((source) => source.id !== "cisco-products").every((source) => source.organization_key === null));
});

test("Catalyst 9300 SKU normalization is narrow and family/stack claims are not upgraded", () => {
  const c930024t = dataset.records.find((record) => record.sys_object_id === "1.3.6.1.4.1.9.1.2435");
  assert.deepEqual({
    strength: c930024t.claim_strength,
    model: c930024t.model,
    identifier: c930024t.model_identifier,
    family: c930024t.product_family,
    rule: c930024t.model_normalization,
    organizationKey: c930024t.organization_key,
    pen: c930024t.pen
  }, {
    strength: "exact_model",
    model: "C9300-24T",
    identifier: "ciscoCat930024T",
    family: "Catalyst 9300",
    rule: "cisco-catalyst-9300-sku-v1",
    organizationKey: "Q173395",
    pen: 9
  });
  const stack = dataset.records.find((record) => record.sys_object_id === "1.3.6.1.4.1.9.1.2494");
  assert.equal(stack.claim_strength, "product_family");
  assert.equal(stack.model, null);
  assert.equal(stack.product_family, "Catalyst 9300");
  const ciscoIgs = dataset.records.find((record) => record.sys_object_id === "1.3.6.1.4.1.9.1.5");
  assert.equal(ciscoIgs.source_symbol, "ciscoIGS");
  assert.equal(ciscoIgs.claim_strength, "vendor_identifier");
  const linecard = dataset.records.find((record) => record.sys_object_id === "1.3.6.1.4.1.9.1.738");
  assert.equal(linecard.claim_strength, "vendor_identifier");
  assert.equal(linecard.model, null);
  assert.equal(linecard.product_family, null);
  assert.equal(dataset.records.some((record) => record.sys_object_id === "1.3.6.1.4.1.9.1.999999"), false);
});

test("materially different claims for one exact OID are preserved as conflicting evidence", () => {
  const mibClaim = dataset.records.find((record) => record.sys_object_id === "1.3.6.1.4.1.9.1.2494");
  const projectClaim = {
    ...mibClaim,
    id: "project-fixture:c9300-48p",
    source_id: "librenms-project-tests",
    claim_strength: "exact_model",
    model: "C9300-48P",
    model_identifier: "C9300-48P",
    product_family: "Catalyst 9300"
  };
  const classified = classifyIdentityClaims([mibClaim, projectClaim]);
  assert.equal(classified.state, "conflicting_evidence");
  assert.equal(classified.claims.length, 2);
  assert.deepEqual(conflictGroups([mibClaim, projectClaim]), [{
    sys_object_id: "1.3.6.1.4.1.9.1.2494",
    record_ids: [mibClaim.id, projectClaim.id].sort()
  }]);
});

test("duplicate records and ambiguous source-symbol reuse fail closed", () => {
  const duplicated = structuredClone(dataset);
  duplicated.records.push(structuredClone(duplicated.records[0]));
  assert.ok(validateDeviceIdentities(manifest, duplicated).some((failure) => failure.startsWith("Duplicate identity record id:")));

  const ambiguous = structuredClone(dataset);
  ambiguous.records.push({ ...structuredClone(ambiguous.records[0]), id: `${ambiguous.records[0].id}:shadow` });
  assert.ok(validateDeviceIdentities(manifest, ambiguous).some((failure) => failure.startsWith("Duplicate source symbol:")));
});

test("a resealed arbitrary prose field cannot bypass the metadata-only schema", () => {
  const mutated = structuredClone(dataset);
  mutated.records[0].copied_vendor_text = "unreviewed source prose";
  refreshDigest(mutated);
  assert.ok(validateDeviceIdentities(manifest, mutated).some((failure) => failure.includes("unexpected record fields: copied_vendor_text")));
});

test("source checksums, aggregate counts, and dataset digest are independently gated", () => {
  const sourceDrift = structuredClone(manifest);
  sourceDrift.adapters[0].definition_artifact.sha256 = "0".repeat(64);
  assert.ok(validateDeviceIdentities(sourceDrift, dataset).some((failure) => failure.includes("Source manifest checksum drift")));

  const countDrift = structuredClone(dataset);
  countDrift.counts.exact_models -= 1;
  refreshDigest(countDrift);
  assert.ok(validateDeviceIdentities(manifest, countDrift).includes("Identity count drift"));

  const checksumDrift = structuredClone(dataset);
  checksumDrift.records[0].confidence = "unreviewed";
  assert.ok(validateDeviceIdentities(manifest, checksumDrift).includes("Dataset checksum drift"));
});

test("internal OID nodes cannot be relabeled as exact models", () => {
  const mutated = structuredClone(dataset);
  const internal = mutated.records.find((candidate) => mutated.records.some((other) => (
    other.source_id === candidate.source_id && other.sys_object_id.startsWith(`${candidate.sys_object_id}.`)
  )));
  assert.ok(internal);
  internal.claim_strength = "exact_model";
  internal.model = internal.source_symbol;
  internal.model_identifier = internal.source_symbol;
  internal.model_normalization = "source-symbol-identity";
  refreshDigest(mutated);
  assert.ok(validateDeviceIdentities(manifest, mutated).some((failure) => failure.includes("internal grouping node is labeled exact_model")));
});

test("parser ignores comments and quoted prose while retaining declaration lines", () => {
  const fixture = `EXAMPLE DEFINITIONS ::= BEGIN
-- fakeModel OBJECT IDENTIFIER ::= { products 1 }
note OBJECT-TYPE
  SYNTAX OCTET STRING
  DESCRIPTION "quotedModel OBJECT IDENTIFIER ::= { products 2 }"
  ::= { products 3 }
realModel42 OBJECT IDENTIFIER
  ::= { products 42 }
END
`;
  assert.deepEqual(parseObjectIdentifierAssignments(fixture), [{
    symbol: "realModel42",
    parent: "products",
    arcs: [42],
    declaration_line: 7
  }]);
});
