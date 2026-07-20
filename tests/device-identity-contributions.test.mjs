import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { canonicalJsonSha256 } from "../scripts/canonical-json.mjs";
import {
  DeviceIdentityContributionError,
  MAX_CONTRIBUTION_DOCUMENT_BYTES,
  MAX_CONTRIBUTION_EVENTS,
  MAX_CONTRIBUTION_REVIEWS,
  buildDeviceIdentityContributionReport,
  emptyContributionEventsDocument,
  emptyContributionReviewsDocument,
  parseDeterministicContributionJson,
  validateDeviceIdentityContributionAppendOnlyTransition,
  validateDeviceIdentityContributionBundle,
  validateDeviceIdentityContributionLedgers,
} from "../scripts/lib/device-identity-contributions.mjs";
import {
  validateDeviceIdentityContributionGitTransition,
} from "../scripts/validate-device-identity-contribution-diff.mjs";

const execFile = promisify(execFileCallback);
const MODEL_OID = "1.3.6.1.4.1.424242.7.1";
const PREFIX_OID = "1.3.6.1.4.1.424242.8";
const SOURCE_SHA256 = "1".repeat(64);

function evidence(overrides = {}) {
  return {
    source_url: "https://example.invalid/evidence/device-definition.json",
    source_revision: "rev-2026-07-20",
    artifact_sha256: SOURCE_SHA256,
    source_date: "2026-07-20",
    evidence_type: "open-source-definition",
    publication_scope: "definition-only",
    ...overrides,
  };
}

function expectedClaimFields(claim) {
  return [
    "sys_object_id",
    "enterprise_number",
    "match_method",
    "claim_strength",
    "firmware_scope",
    ...["model", "product_family", "mib_identifier", "platform"]
      .filter((field) => claim[field] !== null),
  ].sort();
}

function provenanceFor(fields, row = evidence()) {
  return Object.fromEntries(fields.map((field) => [field, [{ ...row }]]));
}

function exactModelClaim(overrides = {}) {
  return {
    sys_object_id: MODEL_OID,
    enterprise_number: 424242,
    match_method: "exact",
    claim_strength: "exact_model",
    model: "ExampleSwitch 48",
    product_family: null,
    mib_identifier: null,
    platform: null,
    firmware_scope: {
      status: "not_established",
      observed_versions: [],
    },
    ...overrides,
  };
}

function authority() {
  return {
    relationship: "independent-researcher",
    attests_right_to_submit: true,
    attests_no_sensitive_data: true,
    attests_public_contribution: true,
  };
}

function proposal({
  eventId = "contrib-20260720T100000Z-aaaaaaaaaaaa",
  occurredAt = "2026-07-20T10:00:00Z",
  mappingId = "mapping-example-switch",
  claim = exactModelClaim(),
  observation = null,
  observationProvenance = {},
} = {}) {
  return {
    schema_version: 1,
    event_id: eventId,
    event_type: "propose",
    occurred_at: occurredAt,
    mapping_id: mappingId,
    supersedes_event_id: null,
    authority: authority(),
    claim,
    field_provenance: provenanceFor(expectedClaimFields(claim)),
    sanitized_observation: observation,
    observation_provenance: observationProvenance,
    reason: "new-public-evidence",
  };
}

function correction(previous, {
  eventId = "contrib-20260720T110000Z-bbbbbbbbbbbb",
  occurredAt = "2026-07-20T11:00:00Z",
  claim = exactModelClaim({ model: "ExampleSwitch 48 Revision B" }),
} = {}) {
  return {
    ...proposal({
      eventId,
      occurredAt,
      mappingId: previous.mapping_id,
      claim,
    }),
    event_type: "correct",
    supersedes_event_id: previous.event_id,
    reason: "corrected-public-evidence",
  };
}

function withdrawal(previous, {
  eventId = "contrib-20260720T120000Z-cccccccccccc",
  occurredAt = "2026-07-20T12:00:00Z",
} = {}) {
  return {
    schema_version: 1,
    event_id: eventId,
    event_type: "withdraw",
    occurred_at: occurredAt,
    mapping_id: previous.mapping_id,
    supersedes_event_id: previous.event_id,
    authority: authority(),
    claim: null,
    field_provenance: {},
    sanitized_observation: null,
    observation_provenance: {},
    reason: "accuracy-withdrawal",
  };
}

function eventDocument(...events) {
  return { ...emptyContributionEventsDocument(), events };
}

function reviewDocument(...reviews) {
  return { ...emptyContributionReviewsDocument(), reviews };
}

function approvedReview(event, overrides = {}) {
  return {
    schema_version: 1,
    review_id: "review-20260720T130000Z-dddddddddddd",
    occurred_at: "2026-07-20T13:00:00Z",
    contribution_event_id: event.event_id,
    contribution_event_sha256: canonicalJsonSha256(event),
    mapping_id: event.mapping_id,
    decision: "approved-evidence",
    reviewed_fields: expectedClaimFields(event.claim),
    approved_publication_scope: "definition-only",
    reason: "evidence-approved-for-scope",
    reviewer_attestation: {
      role: "repository-maintainer",
      evidence_reviewed: true,
      rights_scope_reviewed: true,
      sensitive_data_reviewed: true,
    },
    publication_state: "quarantine",
    promotion_required: true,
    ...overrides,
  };
}

function validObservation() {
  return {
    sys_object_id: MODEL_OID,
    ent_physical_vendor_type: null,
    ent_physical_model_name: "ExampleSwitch 48",
    firmware_version: null,
    observed_at: "2026-07-20",
    sanitization: {
      raw_walk_included: false,
      sys_descr_included: false,
      credentials_included: false,
      device_identifiers_included: false,
      customer_identifiers_included: false,
    },
  };
}

function observationProvenance(observation) {
  const fields = [
    "sys_object_id",
    "ent_physical_vendor_type",
    "ent_physical_model_name",
    "firmware_version",
    "observed_at",
  ].filter((field) => observation[field] !== null);
  return provenanceFor(fields, evidence({
    evidence_type: "authorized-observation",
    publication_scope: "observation-only",
  }));
}

function issueText(events, reviews = reviewDocument()) {
  return validateDeviceIdentityContributionLedgers(events, reviews).issues.join("\n");
}

function expectTransitionFailure(input, pattern) {
  assert.throws(
    () => validateDeviceIdentityContributionAppendOnlyTransition(input),
    (error) => {
      assert.ok(error instanceof DeviceIdentityContributionError);
      assert.match(error.issues.join("\n"), pattern);
      return true;
    },
  );
}

test("contribution JSON rejects duplicate keys and byte-format drift", async (t) => {
  const valid = `${JSON.stringify(emptyContributionEventsDocument(), null, 2)}\n`;
  assert.deepEqual(parseDeterministicContributionJson(valid), emptyContributionEventsDocument());
  await t.test("duplicate key", () => {
    assert.throws(
      () => parseDeterministicContributionJson('{\n  "schema_version": 1,\n  "schema_version": 1\n}\n'),
      /deterministic two-space JSON/u,
    );
  });
  await t.test("format drift", () => {
    assert.throws(
      () => parseDeterministicContributionJson(JSON.stringify(emptyContributionEventsDocument())),
      /deterministic two-space JSON/u,
    );
  });
});

test("a valid pending proposal produces a deterministic quarantine report", () => {
  const event = proposal();
  const events = eventDocument(event);
  const reviews = reviewDocument();
  assert.deepEqual(validateDeviceIdentityContributionLedgers(events, reviews).issues, []);

  const first = buildDeviceIdentityContributionReport(events, reviews);
  const second = buildDeviceIdentityContributionReport(structuredClone(events), structuredClone(reviews));
  assert.deepEqual(second, first);
  assert.equal(first.counts.pending_review_events, 1);
  assert.equal(first.counts.active_mapping_tips, 1);
  assert.deepEqual(first.pending_review_event_ids, [event.event_id]);
  assert.equal(first.publication_boundary.contribution_state, "quarantine");
  assert.equal(first.publication_boundary.automatic_publication_count, 0);
  assert.equal(first.report_sha256.length, 64);

  assert.deepEqual(validateDeviceIdentityContributionBundle({ events, reviews, report: first }), {
    events: 1,
    reviews: 0,
    pending: 1,
    conflicts: 0,
    automatic_publication: 0,
  });
});

test("an accepted evidence review remains quarantined with zero automatic publication", () => {
  const event = proposal();
  const events = eventDocument(event);
  const reviews = reviewDocument(approvedReview(event));
  const report = buildDeviceIdentityContributionReport(events, reviews);

  assert.equal(report.counts.approved_evidence_events, 1);
  assert.deepEqual(report.approved_evidence_event_ids, [event.event_id]);
  assert.equal(report.publication_boundary.contribution_state, "quarantine");
  assert.equal(report.publication_boundary.separate_release_promotion_required, true);
  assert.equal(report.publication_boundary.automatic_publication_count, 0);
});

test("an evidence review scope must be supported for every reviewed claim field", () => {
  const event = proposal();
  const incompatible = approvedReview(event, { approved_publication_scope: "metadata-only" });
  assert.match(
    issueText(eventDocument(event), reviewDocument(incompatible)),
    /approved_publication_scope has no compatible evidence for/,
  );
});

test("every normalized claim field requires its own provenance", () => {
  const event = proposal();
  delete event.field_provenance.model;
  assert.match(issueText(eventDocument(event)), /field_provenance fields must exactly match normalized fields/);
});

test("raw walks, sysDescr, and unknown observation fields are rejected", async (t) => {
  for (const forbiddenField of ["raw_walk", "sysDescr", "arbitrary_field"]) {
    await t.test(forbiddenField, () => {
      const observation = { ...validObservation(), [forbiddenField]: "forbidden" };
      const event = proposal({
        observation,
        observationProvenance: observationProvenance(observation),
      });
      assert.match(issueText(eventDocument(event)), /sanitized_observation has unknown fields/);
    });
  }
});

test("sensitive model values containing IP, email, or MAC data are rejected", async (t) => {
  const unsafeModels = {
    ip: "ExampleSwitch 192.0.2.10",
    email: "ExampleSwitch admin@example.invalid",
    mac: "ExampleSwitch 00:11:22:33:44:55",
  };
  for (const [name, model] of Object.entries(unsafeModels)) {
    await t.test(name, () => {
      const event = proposal({ claim: exactModelClaim({ model }) });
      assert.match(issueText(eventDocument(event)), /claim\.model is unsafe or unbounded/);
    });
  }
});

test("the declared PEN must equal the sysObjectID enterprise arc", () => {
  const event = proposal({ claim: exactModelClaim({ enterprise_number: 424243 }) });
  assert.match(issueText(eventDocument(event)), /enterprise_number must match the sysObjectID PEN arc/);
});

test("prefix contributions are accepted only as platform claims", () => {
  const validClaim = exactModelClaim({
    sys_object_id: PREFIX_OID,
    match_method: "prefix",
    claim_strength: "platform",
    model: null,
    platform: "example-platform",
  });
  assert.deepEqual(
    validateDeviceIdentityContributionLedgers(eventDocument(proposal({ claim: validClaim })), reviewDocument()).issues,
    [],
  );

  const invalidClaim = { ...validClaim, model: "ExampleSwitch 48" };
  assert.match(issueText(eventDocument(proposal({ claim: invalidClaim }))), /prefix claims must be platform-only/);
});

test("identical claims under different mapping ids are reported as duplicates", () => {
  const first = proposal();
  const second = proposal({
    eventId: "contrib-20260720T100100Z-eeeeeeeeeeee",
    occurredAt: "2026-07-20T10:01:00Z",
    mappingId: "mapping-example-switch-copy",
  });
  const report = buildDeviceIdentityContributionReport(eventDocument(first, second), reviewDocument());
  assert.equal(report.counts.duplicate_claim_groups, 1);
  assert.equal(report.counts.conflict_groups, 0);
  assert.deepEqual(report.duplicate_claim_groups[0].mapping_ids, [first.mapping_id, second.mapping_id]);
});

test("competing claims on the same exact match key remain an explicit conflict", () => {
  const first = proposal();
  const second = proposal({
    eventId: "contrib-20260720T100100Z-ffffffffffff",
    occurredAt: "2026-07-20T10:01:00Z",
    mappingId: "mapping-competing-switch",
    claim: exactModelClaim({ model: "Different ExampleSwitch" }),
  });
  const report = buildDeviceIdentityContributionReport(eventDocument(first, second), reviewDocument());
  assert.equal(report.counts.duplicate_claim_groups, 0);
  assert.equal(report.counts.conflict_groups, 1);
  assert.deepEqual(report.conflict_groups[0].mapping_ids, [second.mapping_id, first.mapping_id].sort());
  assert.equal(report.conflict_groups[0].claim_sha256s.length, 2);
});

test("report mapping order uses deterministic code-point comparison", () => {
  const laterByCodePoint = proposal({ mappingId: "mapping-0-az" });
  const earlierByCodePoint = proposal({
    eventId: "contrib-20260720T100100Z-101010101010",
    occurredAt: "2026-07-20T10:01:00Z",
    mappingId: "mapping-0-aa",
  });
  const report = buildDeviceIdentityContributionReport(
    eventDocument(laterByCodePoint, earlierByCodePoint),
    reviewDocument(),
  );
  assert.deepEqual(report.mapping_tips.map((row) => row.mapping_id), ["mapping-0-aa", "mapping-0-az"]);
});

test("impossible calendar dates and UTC timestamps are controlled validation failures", async (t) => {
  await t.test("event UTC timestamp", () => {
    const event = proposal({
      eventId: "contrib-20261340T256161Z-121212121212",
      occurredAt: "2026-13-40T25:61:61Z",
    });
    let issues;
    assert.doesNotThrow(() => {
      issues = issueText(eventDocument(event));
    });
    assert.match(issues, /occurred_at must use canonical UTC seconds/);
  });
  await t.test("evidence source date", () => {
    const event = proposal();
    event.field_provenance.model[0].source_date = "2026-13-40";
    let issues;
    assert.doesNotThrow(() => {
      issues = issueText(eventDocument(event));
    });
    assert.match(issues, /source_date must be a real YYYY-MM-DD date/);
  });
  await t.test("observation date", () => {
    const observation = { ...validObservation(), observed_at: "2026-02-30" };
    const event = proposal({
      observation,
      observationProvenance: observationProvenance(observation),
    });
    let issues;
    assert.doesNotThrow(() => {
      issues = issueText(eventDocument(event));
    });
    assert.match(issues, /observed_at must be a real YYYY-MM-DD date/);
  });
  await t.test("review UTC timestamp", () => {
    const event = proposal();
    const review = approvedReview(event, {
      review_id: "review-20261340T256161Z-343434343434",
      occurred_at: "2026-13-40T25:61:61Z",
    });
    let issues;
    assert.doesNotThrow(() => {
      issues = issueText(eventDocument(event), reviewDocument(review));
    });
    assert.match(issues, /occurred_at must use canonical UTC seconds/);
  });
});

test("evidence and observations cannot postdate their contribution event", async (t) => {
  await t.test("evidence source date", () => {
    const event = proposal();
    event.field_provenance.model[0].source_date = "2026-07-21";
    assert.match(issueText(eventDocument(event)), /source_date cannot postdate its contribution event/);
  });
  await t.test("observation date", () => {
    const observation = { ...validObservation(), observed_at: "2026-07-21" };
    const event = proposal({
      observation,
      observationProvenance: observationProvenance(observation),
    });
    assert.match(issueText(eventDocument(event)), /observed_at cannot postdate the contribution event/);
  });
});

test("controlled reason codes reject free text and sensitive-value payloads", async (t) => {
  const unsafeReasons = {
    secret: "Evidence includes password=synthetic-secret and must be rejected.",
    ip: "Evidence was collected from synthetic host 192.0.2.10 and must be rejected.",
    mac: "Evidence was collected from device 00:11:22:33:44:55 and must be rejected.",
    url: "Evidence is repeated inline from https://example.invalid/private and must be rejected.",
  };
  for (const [name, reason] of Object.entries(unsafeReasons)) {
    await t.test(name, () => {
      const event = proposal();
      event.reason = reason;
      assert.match(issueText(eventDocument(event)), /reason is not allowed/);
    });
  }
});

test("source evidence URLs longer than 2048 characters are rejected", () => {
  const event = proposal();
  event.field_provenance.model[0].source_url = `https://example.invalid/${"a".repeat(2049)}`;
  assert.match(issueText(eventDocument(event)), /source_url/);
});

test("source URL paths and revisions reject credential-like signals", async (t) => {
  await t.test("URL path", () => {
    const event = proposal();
    event.field_provenance.model[0].source_url = "https://example.invalid/download/password=TOP_SECRET_123";
    assert.match(issueText(eventDocument(event)), /source_url contains a forbidden sensitive-data signal/);
  });
  await t.test("percent-encoded URL path", () => {
    const event = proposal();
    event.field_provenance.model[0].source_url = "https://example.invalid/download/pass%77ord=TOP_VALUE";
    assert.match(issueText(eventDocument(event)), /source_url contains a forbidden sensitive-data signal/);
  });
  await t.test("source revision", () => {
    const event = proposal();
    event.field_provenance.model[0].source_revision = "token:TOPVALUE";
    assert.match(issueText(eventDocument(event)), /source_revision contains a forbidden sensitive-data signal/);
  });
});

test("PEN zero cannot be submitted as an enterprise identity mapping", () => {
  const event = proposal({
    claim: exactModelClaim({
      sys_object_id: "1.3.6.1.4.1.0.7.1",
      enterprise_number: 0,
    }),
  });
  assert.match(issueText(eventDocument(event)), /non-root enterprise OID|PEN|enterprise_number/i);
});

test("a product-family claim cannot also assert a platform", () => {
  const event = proposal({
    claim: exactModelClaim({
      claim_strength: "product_family",
      model: null,
      product_family: "ExampleSwitch Family",
      platform: "example-platform",
    }),
  });
  assert.match(issueText(eventDocument(event)), /product_family requires only an exact family claim/);
});

test("a malformed deterministic report raises the controlled contribution error", () => {
  const event = proposal();
  assert.throws(
    () => validateDeviceIdentityContributionBundle({
      events: eventDocument(event),
      reviews: reviewDocument(),
      report: { schema_version: 1, unexpected: true },
    }),
    (error) => {
      assert.ok(error instanceof DeviceIdentityContributionError);
      assert.match(error.issues.join("\n"), /review report does not match the deterministic ledger projection/);
      return true;
    },
  );
  assert.throws(
    () => validateDeviceIdentityContributionBundle({
      events: eventDocument(event),
      reviews: reviewDocument(),
      report: undefined,
    }),
    (error) => {
      assert.ok(error instanceof DeviceIdentityContributionError);
      assert.match(error.issues.join("\n"), /review report must be a canonicalizable JSON value/);
      return true;
    },
  );
});

test("deep invalid provenance is a controlled issue, not a stack crash", () => {
  let bomb = { leaf: true };
  for (let index = 0; index < 8_000; index += 1) bomb = { x: bomb };
  const event = proposal();
  event.field_provenance.model[0].bomb = bomb;
  let issues;
  assert.doesNotThrow(() => {
    issues = issueText(eventDocument(event));
  });
  assert.match(issues, /has unknown fields: bomb/);
});

test("contribution raw documents fail closed above the byte budget", () => {
  assert.throws(
    () => parseDeterministicContributionJson("x".repeat(MAX_CONTRIBUTION_DOCUMENT_BYTES + 1)),
    new RegExp(`${MAX_CONTRIBUTION_DOCUMENT_BYTES}-byte contribution document limit`),
  );
});

test("correction and withdrawal form an append-only mapping chain", () => {
  const proposed = proposal();
  const corrected = correction(proposed);
  const withdrawn = withdrawal(corrected);
  const beforeEvents = eventDocument(proposed);
  const afterEvents = eventDocument(proposed, corrected, withdrawn);
  const reviews = reviewDocument();

  assert.deepEqual(validateDeviceIdentityContributionLedgers(afterEvents, reviews).issues, []);
  assert.deepEqual(validateDeviceIdentityContributionAppendOnlyTransition({
    beforeEvents,
    afterEvents,
    beforeReviews: reviews,
    afterReviews: reviews,
    actor: "external-contributor",
    repositoryOwner: "repository-owner",
  }), { appended_events: 2, appended_reviews: 0 });
  const report = buildDeviceIdentityContributionReport(afterEvents, reviews);
  assert.equal(report.counts.corrections, 1);
  assert.equal(report.counts.withdrawals, 1);
  assert.equal(report.counts.active_mapping_tips, 0);
  assert.equal(report.mapping_tips[0].event_type, "withdraw");
});

test("append-only validation rejects event mutation, deletion, and reordering", async (t) => {
  const proposed = proposal();
  const corrected = correction(proposed);
  const base = eventDocument(proposed, corrected);
  const reviews = reviewDocument();
  const common = {
    beforeEvents: base,
    beforeReviews: reviews,
    afterReviews: reviews,
    actor: "repository-owner",
    repositoryOwner: "repository-owner",
  };

  await t.test("mutation", () => {
    const mutated = structuredClone(base);
    mutated.events[0].authority.relationship = "device-owner";
    expectTransitionFailure({ ...common, afterEvents: mutated }, /contribution events\[0\] cannot be modified or reordered/);
  });
  await t.test("deletion", () => {
    expectTransitionFailure(
      { ...common, afterEvents: eventDocument(proposed) },
      /contribution events entries cannot be removed/,
    );
  });
  await t.test("reordering", () => {
    expectTransitionFailure(
      { ...common, afterEvents: eventDocument(corrected, proposed) },
      /contribution events\[0\] cannot be modified or reordered/,
    );
  });
});

test("only the repository owner can append maintainer review events", () => {
  const event = proposal();
  const events = eventDocument(event);
  const beforeReviews = reviewDocument();
  const afterReviews = reviewDocument(approvedReview(event));
  const transition = {
    beforeEvents: events,
    afterEvents: events,
    beforeReviews,
    afterReviews,
    repositoryOwner: "repository-owner",
  };

  expectTransitionFailure(
    { ...transition, actor: "external-contributor" },
    /only the repository owner may append maintainer review events/,
  );
  assert.deepEqual(
    validateDeviceIdentityContributionAppendOnlyTransition({ ...transition, actor: "Repository-Owner" }),
    { appended_events: 0, appended_reviews: 1 },
  );
});

test("a maintainer review must bind the exact contribution event SHA-256", () => {
  const event = proposal();
  const review = approvedReview(event, { contribution_event_sha256: "f".repeat(64) });
  assert.match(
    issueText(eventDocument(event), reviewDocument(review)),
    /contribution_event_sha256 does not bind the exact event/,
  );
});

test("event, review, evidence, and label bounds fail closed", async (t) => {
  await t.test("event count", () => {
    const events = emptyContributionEventsDocument();
    events.events = Array.from({ length: MAX_CONTRIBUTION_EVENTS + 1 }, () => null);
    assert.match(issueText(events), new RegExp(`at most ${MAX_CONTRIBUTION_EVENTS} entries`));
  });
  await t.test("review count", () => {
    const reviews = emptyContributionReviewsDocument();
    reviews.reviews = Array.from({ length: MAX_CONTRIBUTION_REVIEWS + 1 }, () => null);
    assert.match(issueText(emptyContributionEventsDocument(), reviews), new RegExp(`at most ${MAX_CONTRIBUTION_REVIEWS} entries`));
  });
  await t.test("evidence rows per field", () => {
    const event = proposal();
    event.field_provenance.model = Array.from({ length: 9 }, (_, index) => evidence({
      artifact_sha256: String(index + 1).repeat(64).slice(0, 64),
    }));
    assert.match(issueText(eventDocument(event)), /must contain 1-8 evidence rows/);
  });
  await t.test("model label", () => {
    const event = proposal({ claim: exactModelClaim({ model: `X${"a".repeat(128)}` }) });
    assert.match(issueText(eventDocument(event)), /claim\.model is unsafe or unbounded/);
  });
});

test("production Docker inputs exclude the quarantined contribution ledger", async () => {
  const [dockerfile, dockerignore] = await Promise.all([
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../.dockerignore", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(dockerfile, /data\/device-identity-contributions/u);
  assert.doesNotMatch(dockerfile, /^COPY\s+(?:--\S+\s+)*(?:\.\s|data\/\s)/mu);
  assert.match(dockerignore, /^\*$/mu);
  assert.doesNotMatch(dockerignore, /^!data\/device-identity-contributions(?:\/|$)/mu);
});

test("the Git base/head helper validates an appended proposal in a temporary repository", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mibvendor-contribution-git-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, "data", "device-identity-contributions");
  await mkdir(dataRoot, { recursive: true });
  await Promise.all([
    writeFile(path.join(dataRoot, "events.json"), `${JSON.stringify(eventDocument(), null, 2)}\n`),
    writeFile(path.join(dataRoot, "reviews.json"), `${JSON.stringify(reviewDocument(), null, 2)}\n`),
  ]);
  await execFile("git", ["init", "--quiet"], { cwd: root });
  await execFile("git", ["config", "user.name", "Synthetic Test"], { cwd: root });
  await execFile("git", ["config", "user.email", "synthetic@example.invalid"], { cwd: root });
  await execFile("git", ["add", "data/device-identity-contributions"], { cwd: root });
  await execFile("git", ["commit", "--quiet", "-m", "base"], { cwd: root });
  const { stdout: baseOutput } = await execFile("git", ["rev-parse", "HEAD"], { cwd: root });

  await writeFile(
    path.join(dataRoot, "events.json"),
    `${JSON.stringify(eventDocument(proposal()), null, 2)}\n`,
  );
  await execFile("git", ["add", "data/device-identity-contributions/events.json"], { cwd: root });
  await execFile("git", ["commit", "--quiet", "-m", "append proposal"], { cwd: root });
  const { stdout: headOutput } = await execFile("git", ["rev-parse", "HEAD"], { cwd: root });

  assert.deepEqual(await validateDeviceIdentityContributionGitTransition({
    base: baseOutput.trim(),
    head: headOutput.trim(),
    actor: "external-contributor",
    repositoryOwner: "repository-owner",
    root,
  }), { appended_events: 1, appended_reviews: 0 });
});

test("the Git helper treats ledgers absent from the base commit as empty", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mibvendor-contribution-git-introduction-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await execFile("git", ["init", "--quiet"], { cwd: root });
  await execFile("git", ["config", "user.name", "Synthetic Test"], { cwd: root });
  await execFile("git", ["config", "user.email", "synthetic@example.invalid"], { cwd: root });
  await execFile("git", ["commit", "--quiet", "--allow-empty", "-m", "base without ledgers"], { cwd: root });
  const { stdout: baseOutput } = await execFile("git", ["rev-parse", "HEAD"], { cwd: root });

  const dataRoot = path.join(root, "data", "device-identity-contributions");
  await mkdir(dataRoot, { recursive: true });
  await Promise.all([
    writeFile(path.join(dataRoot, "events.json"), `${JSON.stringify(eventDocument(proposal()), null, 2)}\n`),
    writeFile(path.join(dataRoot, "reviews.json"), `${JSON.stringify(reviewDocument(), null, 2)}\n`),
  ]);
  await execFile("git", ["add", "data/device-identity-contributions"], { cwd: root });
  await execFile("git", ["commit", "--quiet", "-m", "introduce ledgers"], { cwd: root });
  const { stdout: headOutput } = await execFile("git", ["rev-parse", "HEAD"], { cwd: root });

  assert.deepEqual(await validateDeviceIdentityContributionGitTransition({
    base: baseOutput.trim(),
    head: headOutput.trim(),
    actor: "external-contributor",
    repositoryOwner: "repository-owner",
    root,
  }), { appended_events: 1, appended_reviews: 0 });
});
