import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  classifyPinnedLicense,
  extractLibreNmsFixture,
  finalizeProjectFixtureDocument,
  resolveManifestPath,
} from "../scripts/update-project-identity-fixtures.mjs";
import { validateProjectFixtureDocument } from "../scripts/validate-project-identity-fixtures.mjs";

const manifest = JSON.parse(await readFile(
  new URL("../data/device-identities/project-fixtures-manifest.json", import.meta.url),
  "utf8",
));
const document = JSON.parse(await readFile(
  new URL("../data/device-identities/project-fixtures.json", import.meta.url),
  "utf8",
));
const iana = JSON.parse(await readFile(
  new URL("../data/iana-private-enterprise-numbers.json", import.meta.url),
  "utf8",
));

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlobOid(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

test("manifest-controlled filesystem paths cannot escape their intended roots", () => {
  const root = "/srv/pinned-source";
  assert.equal(resolveManifestPath(root, "LICENSE", "license_classifier.files[].path"), `${root}/LICENSE`);
  assert.equal(resolveManifestPath(root, "tests/data", "input_root"), `${root}/tests/data`);

  assert.throws(
    () => resolveManifestPath(root, "/etc/passwd", "license_classifier.files[].path"),
    /license_classifier\.files\[\]\.path must be a relative path/,
  );
  assert.throws(
    () => resolveManifestPath(root, "../../outside", "input_root"),
    /input_root must stay within its root/,
  );
  assert.throws(
    () => resolveManifestPath(root, "/tmp/pen.json", "enterprise_registry_snapshot.path"),
    /enterprise_registry_snapshot\.path must be a relative path/,
  );
  assert.throws(
    () => resolveManifestPath(root, "C:\\outside\\pen.json", "enterprise_registry_snapshot.path"),
    /enterprise_registry_snapshot\.path must be a relative path/,
  );
});

test("project-authored fixture intake is valid and reports exact measured coverage", () => {
  assert.deepEqual(validateProjectFixtureDocument(manifest, document, iana), []);
  assert.deepEqual(document.counts, manifest.expected_measurements);
  assert.equal(document.counts.observations, 1_023);
  assert.equal(document.counts.exact_oids, 713);
  assert.equal(document.counts.conflicting_exact_oids, 72);
  assert.equal(document.sources.find((source) => source.id === "librenms-project-tests").license.spdx, "GPL-3.0-or-later");
  assert.equal(document.sources.find((source) => source.id === "snmp-info-project-tests").license.spdx, "BSD-3-Clause");
});

test("C9300 evidence is model-observation corroboration, not a universal exact-model claim", () => {
  const identity = document.identities.find((item) => item.sys_object_id === ".1.3.6.1.4.1.9.1.2494");
  const candidate = identity.candidates.find((item) => item.model === "C9300-48P");
  assert.equal(identity.enterprise_number, 9);
  assert.equal(identity.organization_key, "Q173395");
  assert.equal(candidate.claim_scope, "observation-only");
  assert.equal(candidate.usable_for, "corroboration");
  assert.equal(candidate.claim_strength, "entity-corroborated-fixture-observation");
  assert.equal(candidate.observations[0].ent_physical_model_match_count, 2);
  assert.ok(candidate.observations[0].json_pointers.includes(
    "/entity-physical/discovery/entPhysical/0/entPhysicalModelName",
  ));

  const overclaim = structuredClone(document);
  overclaim.identities.find((item) => item.sys_object_id === identity.sys_object_id)
    .candidates.find((item) => item.model === candidate.model).claim_scope = "exact-model";
  assert.ok(validateProjectFixtureDocument(manifest, overclaim, iana)
    .some((failure) => failure.includes("overstates its claim")));
});

test("conflicting fixture evidence remains explicit candidate arrays", () => {
  const conflict = document.identities.find((identity) => identity.evidence_state === "conflicting_observations");
  assert.ok(conflict.candidates.length >= 2);
  assert.ok(new Set(conflict.candidates.map((candidate) => candidate.model.toLowerCase())).size >= 2);

  const hiddenConflict = structuredClone(document);
  hiddenConflict.identities.find((identity) => identity.sys_object_id === conflict.sys_object_id).evidence_state = "single_observation";
  assert.ok(validateProjectFixtureDocument(manifest, hiddenConflict, iana)
    .some((failure) => failure.includes("Conflict state drift")));
});

test("LibreNMS extraction retains only allowlisted identity fields and rejects private models", () => {
  const source = {
    os: {
      discovery: {
        devices: [{
          sysObjectID: ".1.3.6.1.4.1.9.1.2494",
          hardware: "C9300-48P",
          os: "iosxe",
          type: "network",
          sysName: "private-host",
          sysDescr: "private description",
          sysContact: "person@example.test",
          location: "private location",
          serial: "PRIVATE-SERIAL",
        }],
      },
    },
    "entity-physical": {
      discovery: {
        entPhysical: [{
          entPhysicalClass: "chassis",
          entPhysicalModelName: "C9300-48P",
          entPhysicalSerialNum: "PRIVATE-ENTITY-SERIAL",
        }],
      },
    },
  };
  const context = {
    sourceId: "librenms-project-tests",
    sourcePath: "tests/data/synthetic.json",
    gitBlobOid: "a".repeat(40),
    sourceSha256: "b".repeat(64),
  };
  const extracted = extractLibreNmsFixture(source, context);
  assert.equal(extracted.observations.length, 1);
  const serialized = JSON.stringify(extracted);
  for (const secret of ["private-host", "private description", "person@example.test", "private location", "PRIVATE-SERIAL", "PRIVATE-ENTITY-SERIAL"]) {
    assert.ok(!serialized.includes(secret));
  }

  for (const unsafeModel of [
    "<private> V1.1",
    "Web management card SN: 5A1274T28648",
    "Hostname: core-switch-01",
    "Contact: person@example.test",
    "Location: rack-22",
    "https://inventory.example.test/device/42",
    "00:11:22:33:44:55",
    "HL-5370DW [001ba90ba752]",
    "HL-5370DW [00-1b-a9-0b-a7-52]",
    "HL-5370DW [001b.a90b.a752]",
    "192.0.2.10",
    "550e8400-e29b-41d4-a716-446655440000",
    "amd64 Intel CPU @ 3.10GHz running at 3095",
    "X".repeat(81),
  ]) {
    source.os.discovery.devices[0].hardware = unsafeModel;
    assert.equal(extractLibreNmsFixture(source, context).observations.length, 0, unsafeModel);
  }
});

test("manual pinned license classification quarantines any content or marker mismatch", () => {
  const bytes = Buffer.from("Redistribution approved\nmarker two\n", "utf8");
  const sourceConfig = {
    repository: "example/project",
    revision: "a".repeat(40),
    license_classifier: {
      scope: "tests/normalized-observations",
      expected_spdx: "BSD-3-Clause",
      files: [{
        path: "LICENSE",
        git_blob_oid: gitBlobOid(bytes),
        sha256: sha256(bytes),
        required_markers: ["Redistribution approved", "marker two"],
      }],
    },
  };
  assert.equal(classifyPinnedLicense(sourceConfig, new Map([["LICENSE", bytes]])).status, "approved");

  const changed = Buffer.from("Redistribution denied\nmarker two\n", "utf8");
  const quarantine = classifyPinnedLicense(sourceConfig, new Map([["LICENSE", changed]]));
  assert.equal(quarantine.status, "quarantine");
  assert.equal(quarantine.spdx, "NOASSERTION");
  assert.ok(quarantine.failures.some((failure) => failure.startsWith("sha256:")));
  assert.ok(quarantine.failures.some((failure) => failure.startsWith("marker:")));
});

test("license evidence, organization links, PII fields, and measured counts fail closed on drift", () => {
  const licenseDrift = structuredClone(document);
  licenseDrift.sources[0].license.evidence[0].sha256 = "0".repeat(64);
  assert.ok(validateProjectFixtureDocument(manifest, licenseDrift, iana)
    .some((failure) => failure.includes("license evidence drift")));

  const organizationDrift = structuredClone(document);
  organizationDrift.identities.find((identity) => identity.enterprise_number === 9).organization_key = "invented-key";
  assert.ok(validateProjectFixtureDocument(manifest, organizationDrift, iana)
    .some((failure) => failure.includes("not an exact reviewed PEN link")));

  const countDrift = structuredClone(document);
  countDrift.counts.observations -= 1;
  assert.ok(validateProjectFixtureDocument(manifest, countDrift, iana)
    .some((failure) => failure.includes("counts drift")));

  const pii = structuredClone(document);
  pii.identities[0].candidates[0].sysDescr = "private description";
  const piiFailures = validateProjectFixtureDocument(manifest, pii, iana);
  assert.ok(piiFailures.some((failure) => failure.includes("Unexpected candidate field sysDescr")));
  assert.ok(piiFailures.some((failure) => failure.includes("prohibited field sysDescr")));

  const inventedRange = structuredClone(document);
  inventedRange.identities[0].firmware_range = "all";
  assert.ok(validateProjectFixtureDocument(manifest, inventedRange, iana)
    .some((failure) => failure.includes("prohibited field firmware_range")));
});

test("normalization is deterministic even when source observations arrive in reverse order", () => {
  const observations = [];
  for (const identity of document.identities) {
    for (const candidate of identity.candidates) {
      for (const evidence of candidate.observations) {
        observations.push({
          sys_object_id: identity.sys_object_id,
          enterprise_number: identity.enterprise_number,
          model: candidate.model,
          family: candidate.family,
          platform: candidate.platform,
          device_class: candidate.device_class,
          vendor_label: candidate.vendor_label,
          source_id: candidate.source_id,
          match_method: candidate.match_method,
          claim_scope: candidate.claim_scope,
          usable_for: candidate.usable_for,
          claim_strength: candidate.claim_strength,
          confidence: candidate.confidence,
          evidence,
        });
      }
    }
  }
  const rebuilt = finalizeProjectFixtureDocument({
    manifest,
    observations: observations.reverse(),
    sourceSummaries: [...document.sources].reverse(),
    penNames: new Map(iana.records),
    organizationKeys: new Map(manifest.organization_mapping_snapshot.reviewed_pen_links
      .map((link) => [link.enterprise_number, link.organization_key])),
  });
  assert.deepEqual(rebuilt, document);
});
