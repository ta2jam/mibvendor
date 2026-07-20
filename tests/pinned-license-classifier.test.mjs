import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { classifyPinnedLicense } from "../scripts/lib/pinned-license-classifier.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlobOid(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function fixture() {
  const license = Buffer.from("Redistribution is permitted under this license.\nLicense marker two.\n");
  const notice = Buffer.from("Copyright notice retained for recipients.\nNotice marker two.\n");
  return {
    bytes: new Map([["LICENSE", license], ["NOTICE", notice]]),
    source: {
      repository: "example/project",
      revision: "a".repeat(40),
      license_classifier: {
        scope: "derived/platform-prefixes",
        expected_spdx: "BSD-3-Clause",
        files: [
          { path: "LICENSE", git_blob_oid: gitBlobOid(license), sha256: sha256(license), required_markers: ["Redistribution is permitted", "License marker two"] },
          { path: "NOTICE", git_blob_oid: gitBlobOid(notice), sha256: sha256(notice), required_markers: ["Copyright notice retained", "Notice marker two"] },
        ],
      },
    },
  };
}

test("manual license approval is bound to repository, revision, scope, bytes, and markers", () => {
  const { source, bytes } = fixture();
  const result = classifyPinnedLicense(source, bytes);
  assert.equal(result.status, "approved");
  assert.equal(result.spdx, "BSD-3-Clause");
  assert.equal(result.evidence.length, 2);

  for (const mutate of [
    (copy) => { copy.repository = "invalid"; },
    (copy) => { copy.revision = "b".repeat(39); },
    (copy) => { copy.license_classifier.scope = "../wide"; },
    (copy) => { copy.license_classifier.scope = "derived/../wide"; },
    (copy) => { copy.license_classifier.scope = "derived//wide"; },
    (copy) => { copy.license_classifier.scope = "derived/./wide"; },
    (copy) => { copy.license_classifier.files[0].path = "../LICENSE"; },
    (copy) => { copy.license_classifier.files[0].git_blob_oid = "0".repeat(40); },
    (copy) => { copy.license_classifier.files[0].sha256 = "0".repeat(64); },
    (copy) => { copy.license_classifier.files[0].required_markers = []; },
    (copy) => { copy.license_classifier.expected_spdx = "NOASSERTION"; },
    (copy) => { copy.license_classifier.files[1].path = "LICENSE"; },
  ]) {
    const copy = structuredClone(source);
    mutate(copy);
    const rejected = classifyPinnedLicense(copy, bytes);
    assert.equal(rejected.status, "quarantine");
    assert.equal(rejected.spdx, "NOASSERTION");
    assert.ok(rejected.failures.length > 0);
  }
});

test("manual license classifier quarantines missing or changed content", () => {
  const { source, bytes } = fixture();
  const missing = new Map(bytes);
  missing.delete("NOTICE");
  assert.equal(classifyPinnedLicense(source, missing).status, "quarantine");

  const changed = new Map(bytes);
  changed.set("LICENSE", Buffer.from("Redistribution is prohibited.\nLicense marker two.\n"));
  const result = classifyPinnedLicense(source, changed);
  assert.equal(result.status, "quarantine");
  assert.ok(result.failures.some((failure) => failure.startsWith("sha256:")));
  assert.ok(result.failures.some((failure) => failure.startsWith("marker:")));
});
