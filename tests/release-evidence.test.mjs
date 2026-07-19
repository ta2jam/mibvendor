import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateActiveReleaseEvidence } from "../scripts/lib/release-evidence.mjs";
import { derivePublicationControlState, publicationControlEventDigest } from "../src/publication-controls.mjs";

const RELEASE = "release-2.1";
const PREDECESSOR = "release-1.0";
const GENERATED_AT = "2026-07-19T23:59:00.000Z";
const ACTIVATED_AT = "2026-07-20T00:01:00Z";
const VERSION = "1.2.3";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function event(sequence, action, targetType, targetId, previous, occurredAt = ACTIVATED_AT) {
  const value = {
    sequence,
    occurred_at: occurredAt,
    action,
    target_type: targetType,
    target_id: targetId,
    reason: `${action} evidence fixture`,
    evidence_url: "https://example.invalid/release",
    supersedes_event_sha256: null,
    previous_event_sha256: previous,
    event_sha256: null
  };
  value.event_sha256 = publicationControlEventDigest(value);
  return value;
}

function controls(events) {
  const state = derivePublicationControlState(events);
  return {
    schema_version: 1,
    active_data_release: state.activeRelease,
    updated_at: events.at(-1).occurred_at,
    disabled_sources: [...state.disabledSources].sort(),
    disabled_modules: [...state.disabledModules].sort(),
    events
  };
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(filePath, bytes);
  return bytes;
}

async function buildFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mibvendor-release-evidence-"));
  const data = path.join(root, "data");
  const releaseDirectory = path.join(data, "releases", RELEASE);
  const catalog = {
    schema_version: 1,
    data_release: RELEASE,
    policy: "fail-closed",
    counts: {
      modules: 1,
      resolved_objects: 1,
      textual_conventions: 0,
      notifications: 0,
      stable_object_id_collisions: 0,
      publishers: { Vendor: 1 },
      publication_modes: { redistributable: 1, "metadata-only": 0, "directory-only": 1 }
    },
    modules: [{ id: "VENDOR-MIB", source_id: "source-1", publisher: "Vendor", publication_mode: "redistributable" }]
  };
  const objects = {
    schema_version: 1,
    data_release: RELEASE,
    objects: [{ id: "vendor-mib--root", module: "VENDOR-MIB", symbol: "root", oid: "1.3.6" }]
  };
  const sources = {
    schema_version: 1,
    data_release: RELEASE,
    sources: [
      { id: "source-1", publication_mode: "redistributable" },
      { id: "directory-1", publication_mode: "directory-only" }
    ]
  };
  const baseline = event(1, "baseline", "release", PREDECESSOR, null, "2026-07-20T00:00:00Z");
  const promotion = event(2, "promotion", "release", RELEASE, baseline.event_sha256);
  const activationControls = controls([baseline, promotion]);

  await mkdir(releaseDirectory, { recursive: true });
  await writeFile(path.join(root, "VERSION"), `${VERSION}\n`);
  const catalogBytes = await writeJson(path.join(data, "mib-catalog.json"), catalog);
  const objectBytes = await writeJson(path.join(data, "mib-objects.json"), objects);
  const sourceBytes = await writeJson(path.join(data, "source-catalog.json"), sources);
  const snapshotBytes = await writeJson(path.join(releaseDirectory, "publication-controls-at-activation.json"), activationControls);

  const report = {
    schema_version: 1,
    release_id: RELEASE,
    generated_at: GENERATED_AT,
    baseline_data_release: PREDECESSOR,
    activation_state: "candidate-not-active",
    policy: "fail-closed",
    counts: {
      active_modules_preserved: 0,
      promoted_modules: 1,
      final_modules: 1,
      promoted_objects: 1,
      final_objects: 1,
      textual_conventions: 0,
      notifications: 0,
      stable_object_id_collisions: 0,
      rejected_artifacts: 0
    },
    readiness: {
      minimum_modules: 1,
      final_module_count: 1,
      target_met: true,
      module_gap: 0,
      stable_object_ids_unique: true,
      activation_ready: true
    },
    selected: [{ module: "VENDOR-MIB", source_id: "source-1", resolved_objects: 1 }],
    rejected: [],
    object_id_collisions: [],
    files: {
      "data/mib-catalog.json": sha256(catalogBytes),
      "data/mib-objects.json": sha256(objectBytes),
      "data/source-catalog.json": sha256(sourceBytes)
    }
  };
  const reportBytes = await writeJson(path.join(releaseDirectory, "corpus-release-report.json"), report);
  const activation = {
    schema_version: 1,
    data_release: RELEASE,
    predecessor_data_release: PREDECESSOR,
    candidate_generated_at: GENERATED_AT,
    activated_at: ACTIVATED_AT,
    application_release: VERSION,
    candidate_report_sha256: sha256(reportBytes),
    documents: {
      mib_catalog_sha256: sha256(catalogBytes),
      mib_objects_sha256: sha256(objectBytes),
      source_catalog_sha256: sha256(sourceBytes),
      publication_controls_sha256: sha256(snapshotBytes)
    },
    publication_control_event_sha256: promotion.event_sha256,
    activation_basis: "Synthetic verified activation evidence."
  };
  await writeJson(path.join(releaseDirectory, "activation.json"), activation);

  const disable = event(3, "disable", "module", "VENDOR-MIB", promotion.event_sha256, "2026-07-20T00:02:00Z");
  await writeJson(path.join(data, "publication-controls.json"), controls([baseline, promotion, disable]));
  return { root, data, releaseDirectory, activation, report, activationControls, catalog, objects };
}

test("active release evidence verifies exact bytes and permits appended control events", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));

  const result = await validateActiveReleaseEvidence(fixture.root);

  assert.equal(result.ok, true, result.failures.join("\n"));
  assert.deepEqual(result.summary, {
    release_id: RELEASE,
    predecessor_data_release: PREDECESSOR,
    application_release: VERSION,
    modules: 1,
    objects: 1,
    sources: 2
  });
});

test("active data tampering fails its exact digest and row-count gates", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  fixture.objects.objects.push({ id: "vendor-mib--extra", module: "VENDOR-MIB", symbol: "extra", oid: "1.3.7" });
  await writeJson(path.join(fixture.data, "mib-objects.json"), fixture.objects);

  const result = await validateActiveReleaseEvidence(fixture.root);

  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.includes("mib_objects_sha256")));
  assert.ok(result.failures.some((failure) => failure.includes("object count differs")));
});

test("unsafe active release IDs never select an evidence directory", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  fixture.catalog.data_release = "../escape";
  await writeJson(path.join(fixture.data, "mib-catalog.json"), fixture.catalog);

  const result = await validateActiveReleaseEvidence(fixture.root);

  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.includes("unsafe; release evidence path was not opened")));
});

test("a replaced activation-history prefix fails even when current controls rehash cleanly", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const [baseline, oldPromotion] = fixture.activationControls.events;
  const changedPromotion = { ...oldPromotion, reason: "Replaced after activation", event_sha256: null };
  changedPromotion.event_sha256 = publicationControlEventDigest(changedPromotion);
  await writeJson(path.join(fixture.data, "publication-controls.json"), controls([baseline, changedPromotion]));

  const result = await validateActiveReleaseEvidence(fixture.root);

  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.includes("replaced activation event 2")));
});

test("readiness, collision, predecessor, and application-version drift all fail closed", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  fixture.report.readiness.activation_ready = false;
  fixture.report.counts.stable_object_id_collisions = 1;
  fixture.report.baseline_data_release = "release-0.9";
  await writeJson(path.join(fixture.releaseDirectory, "corpus-release-report.json"), fixture.report);
  await writeFile(path.join(fixture.root, "VERSION"), "9.9.9\n");

  const result = await validateActiveReleaseEvidence(fixture.root);

  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.includes("baseline differs")));
  assert.ok(result.failures.some((failure) => failure.includes("application release differs")));
  assert.ok(result.failures.some((failure) => failure.includes("non-zero stable-ID collision")));
  assert.ok(result.failures.some((failure) => failure.includes("not activation-ready")));
});

test("the activation snapshot itself is byte-bound and promotion-bound", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  fixture.activationControls.events[1].reason = "Tampered activation snapshot";
  await writeJson(path.join(fixture.releaseDirectory, "publication-controls-at-activation.json"), fixture.activationControls);

  const result = await validateActiveReleaseEvidence(fixture.root);

  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.includes("publication_controls_sha256")));
  assert.ok(result.failures.some((failure) => failure.includes("digest drifted")));
});

test("malformed control and catalog shapes return failures instead of throwing", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  await writeJson(path.join(fixture.data, "publication-controls.json"), {
    schema_version: 1,
    active_data_release: RELEASE,
    updated_at: ACTIVATED_AT,
    disabled_sources: [],
    disabled_modules: [],
    events: [null]
  });
  fixture.catalog.modules = null;
  await writeJson(path.join(fixture.data, "mib-catalog.json"), fixture.catalog);

  const result = await validateActiveReleaseEvidence(fixture.root);

  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.includes("modules must be an array")));
  assert.ok(result.failures.some((failure) => failure.includes("array of event objects")));
});

test("a symlinked active release evidence directory is rejected before traversal", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const storedDirectory = `${fixture.releaseDirectory}-stored`;
  await rename(fixture.releaseDirectory, storedDirectory);
  await symlink(storedDirectory, fixture.releaseDirectory, "dir");

  const result = await validateActiveReleaseEvidence(fixture.root);

  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.includes("active release evidence directory must be a regular directory")));
});
