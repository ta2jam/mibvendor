import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canonicalJsonSha256 } from "../scripts/canonical-json.mjs";
import { validateLegacyRfcReview } from "../scripts/validate-legacy-rfc-review.mjs";

async function fixture() {
  return JSON.parse(await readFile("docs/research/rights/legacy-rfc-review.json", "utf8"));
}

async function catalog() {
  return JSON.parse(await readFile("data/mib-catalog.json", "utf8"));
}

function reseal(document) {
  const projection = structuredClone(document);
  delete projection.manifest_sha256;
  document.manifest_sha256 = canonicalJsonSha256(projection);
  return document;
}

test("the fixed 14-RFC universe is file-reviewed without activating content", async () => {
  const document = await fixture();
  const status = validateLegacyRfcReview(document, { catalog: await catalog() });
  assert.deepEqual(status, {
    review_id: "ietf-transition-rfc-file-review-2026-07-20.1",
    candidates: 14,
    module_definitions: 15,
    accepted_for_candidate_build: 14,
    unknown: 0,
    rejected: 0,
    quarantined: 0,
    active_from_this_review: 0,
    active_same_name_alternates: 5,
    baseline_cross_checked: true,
    manifest_sha256: "fd582cecbeb601b64949d7ad3bef04527e1d4818512abe2e114c69c1a125222b",
  });
  assert.equal(document.candidates.filter((candidate) => candidate.notice.document_pre_5378_legend).length, 10);
  assert.deepEqual(document.candidates.find((candidate) => candidate.rfc === 5519).relationships.obsoletes, [2933]);
  assert.deepEqual(document.candidates.find((candidate) => candidate.rfc === 5428).relationships.updated_by, [9141]);
  assert.ok(document.candidates.every((candidate) => candidate.relationships.obsoleted_by.length === 0));
});

test("an unknown decision cannot escape quarantine", async () => {
  const document = await fixture();
  Object.assign(document.candidates[0], {
    decision: "unknown",
    decision_reason: "controlling-notice-unresolved",
    activation_state: "not-active",
  });
  reseal(document);
  assert.throws(() => validateLegacyRfcReview(document), /unknown decision must remain quarantined/);
});

test("an accepted module requires its embedded notice", async () => {
  const document = await fixture();
  document.candidates[0].modules[0].notice_in_module = false;
  reseal(document);
  assert.throws(() => validateLegacyRfcReview(document), /lacks its file-specific notice/);
});

test("an independently licensed same-name artifact is not a successor", async () => {
  const document = await fixture();
  document.candidates[3].modules[0].active_same_name_variant.relationship = "successor";
  reseal(document);
  assert.throws(() => validateLegacyRfcReview(document), /conflates an independent variant with a successor/);
});

test("canonical digest detects evidence mutation", async () => {
  const document = await fixture();
  document.candidates[0].title = "mutated";
  assert.throws(() => validateLegacyRfcReview(document), /manifest_sha256 does not match/);
});
