import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  appendPublicationPromotion,
  derivePublicationControlState,
  isPublicationEnabled,
  publicationControlEventDigest,
  validatePublicationControls
} from "../src/publication-controls.mjs";

function event(sequence, action, targetType, targetId, previous, overrides = {}) {
  const value = {
    sequence,
    occurred_at: `2026-07-20T00:0${sequence - 1}:00Z`,
    action,
    target_type: targetType,
    target_id: targetId,
    reason: `${action} drill`,
    evidence_url: "https://example.invalid/drill",
    supersedes_event_sha256: null,
    previous_event_sha256: previous,
    event_sha256: null,
    ...overrides
  };
  value.event_sha256 = publicationControlEventDigest(value);
  return value;
}

function fixture(events) {
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

test("source and module switches are derived from the chained audit log", () => {
  const baseline = event(1, "baseline", "release", "release-1", null);
  const disableSource = event(2, "disable", "source", "source-1", baseline.event_sha256);
  const disableModule = event(3, "disable", "module", "MODULE-1", disableSource.event_sha256);
  const document = fixture([baseline, disableSource, disableModule]);

  assert.deepEqual(validatePublicationControls(document, {
    releaseId: "release-1",
    sourceIds: new Set(["source-1"]),
    moduleIds: new Set(["MODULE-1"])
  }), []);
  const controls = derivePublicationControlState(document.events);
  assert.equal(isPublicationEnabled({ sourceId: "source-1", moduleId: "OTHER" }, controls), false);
  assert.equal(isPublicationEnabled({ sourceId: "other", moduleId: "MODULE-1" }, controls), false);
});

test("a later enable event restores publication without erasing history", () => {
  const baseline = event(1, "baseline", "release", "release-1", null);
  const disabled = event(2, "disable", "module", "MODULE-1", baseline.event_sha256);
  const enabled = event(3, "enable", "module", "MODULE-1", disabled.event_sha256);
  const state = derivePublicationControlState([baseline, disabled, enabled]);

  assert.equal(isPublicationEnabled({ sourceId: "source-1", moduleId: "MODULE-1" }, state), true);
});

test("tampering and a state/log mismatch fail closed", () => {
  const baseline = event(1, "baseline", "release", "release-1", null);
  const disabled = event(2, "disable", "module", "MODULE-1", baseline.event_sha256);
  const document = fixture([baseline, disabled]);
  document.events[1].reason = "tampered";
  document.disabled_modules = [];

  const failures = validatePublicationControls(document, {
    releaseId: "release-1",
    sourceIds: new Set(),
    moduleIds: new Set(["MODULE-1"])
  });
  assert.ok(failures.some((failure) => failure.includes("digest drifted")));
  assert.ok(failures.some((failure) => failure.includes("Disabled module state")));
});

test("reordered events and a stale update timestamp fail closed", () => {
  const baseline = event(1, "baseline", "release", "release-1", null);
  const disabled = event(2, "disable", "module", "MODULE-1", baseline.event_sha256, {
    occurred_at: "2026-07-19T23:59:00Z"
  });
  disabled.event_sha256 = publicationControlEventDigest(disabled);
  const document = fixture([baseline, disabled]);
  document.updated_at = baseline.occurred_at;

  const failures = validatePublicationControls(document, {
    releaseId: "release-1",
    sourceIds: new Set(),
    moduleIds: new Set(["MODULE-1"])
  });
  assert.ok(failures.some((failure) => failure.includes("chronological order")));
  assert.ok(failures.some((failure) => failure.includes("updated_at")));
});

test("rollback is an auditable pointer movement", () => {
  const baseline = event(1, "baseline", "release", "release-1", null);
  const promotion = event(2, "promotion", "release", "release-2", baseline.event_sha256);
  const rollback = event(3, "rollback", "release", "release-1", promotion.event_sha256);
  const document = fixture([baseline, promotion, rollback]);
  const failures = validatePublicationControls(document, {
    releaseId: "release-1",
    sourceIds: new Set(),
    moduleIds: new Set()
  });

  assert.deepEqual(failures, []);
  const state = derivePublicationControlState(document.events);
  assert.equal(state.activeRelease, "release-1");
});

test("promotion moves the active pointer and can retain a historical baseline", () => {
  const baseline = event(1, "baseline", "release", "release-1", null);
  const document = appendPublicationPromotion(fixture([baseline]), {
    releaseId: "release-2.1",
    occurredAt: "2026-07-20T00:01:00Z",
    reason: "Publish the verified corpus expansion.",
    evidenceUrl: "https://example.invalid/releases/release-2.1"
  });

  assert.equal(document.active_data_release, "release-2.1");
  assert.equal(document.events[1].action, "promotion");
  assert.equal(document.events[1].previous_event_sha256, baseline.event_sha256);
  assert.deepEqual(validatePublicationControls(document, {
    releaseId: "release-2.1",
    sourceIds: new Set(),
    moduleIds: new Set()
  }), []);
});

test("release actions reject non-release targets and content actions reject release targets", () => {
  const baseline = event(1, "baseline", "release", "release-1", null);
  const invalidPromotion = event(2, "promotion", "source", "source-1", baseline.event_sha256);
  const invalidDisable = event(3, "disable", "release", "release-2", invalidPromotion.event_sha256);
  const document = fixture([baseline, invalidPromotion, invalidDisable]);
  document.active_data_release = "release-1";

  const failures = validatePublicationControls(document, {
    releaseId: "release-1",
    sourceIds: new Set(["source-1"]),
    moduleIds: new Set()
  });
  assert.equal(failures.filter((failure) => failure.includes("invalid action/target pair")).length, 2);
});

test("unsafe historical release identifiers fail even when the current pointer is safe", () => {
  const baseline = event(1, "baseline", "release", "../release-1", null);
  const promotion = event(2, "promotion", "release", "release-2", baseline.event_sha256);
  const document = fixture([baseline, promotion]);

  const failures = validatePublicationControls(document, {
    releaseId: "release-2",
    sourceIds: new Set(),
    moduleIds: new Set()
  });
  assert.ok(failures.some((failure) => failure.includes("unsafe release target")));
});

test("a promotion with a broken hash chain fails closed", () => {
  const baseline = event(1, "baseline", "release", "release-1", null);
  const promotion = event(2, "promotion", "release", "release-2", "0".repeat(64));
  const document = fixture([baseline, promotion]);

  const failures = validatePublicationControls(document, {
    releaseId: "release-2",
    sourceIds: new Set(),
    moduleIds: new Set()
  });
  assert.ok(failures.some((failure) => failure.includes("broke the hash chain")));
});

test("promotion construction is deterministic and never supplies a timestamp", () => {
  const baseline = event(1, "baseline", "release", "release-1", null);
  const controls = fixture([baseline]);
  const input = {
    releaseId: "release-2",
    occurredAt: "2026-07-20T00:01:00Z",
    reason: "Verified release promotion.",
    evidenceUrl: null
  };

  assert.deepEqual(appendPublicationPromotion(controls, input), appendPublicationPromotion(controls, input));
  assert.throws(() => appendPublicationPromotion(controls, { ...input, occurredAt: undefined }), /timestamp/);
});

test("promotion CLI writes only its explicit output with reproducible bytes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mibvendor-promotion-"));
  try {
    const baseline = event(1, "baseline", "release", "release-1", null);
    const controls = fixture([baseline]);
    const controlsPath = path.join(directory, "controls.json");
    const catalogPath = path.join(directory, "catalog.json");
    const sourcesPath = path.join(directory, "sources.json");
    const firstOutput = path.join(directory, "first.json");
    const secondOutput = path.join(directory, "second.json");
    await Promise.all([
      writeFile(controlsPath, `${JSON.stringify(controls)}\n`),
      writeFile(catalogPath, `${JSON.stringify({ data_release: "release-2", modules: [] })}\n`),
      writeFile(sourcesPath, `${JSON.stringify({ data_release: "release-2", sources: [] })}\n`)
    ]);
    const scriptPath = fileURLToPath(new URL("../scripts/append-publication-promotion.mjs", import.meta.url));
    const baseArguments = [
      scriptPath,
      "--controls", controlsPath,
      "--catalog", catalogPath,
      "--sources", sourcesPath,
      "--release", "release-2",
      "--occurred-at", "2026-07-20T00:01:00Z",
      "--reason", "Verified release promotion.",
      "--evidence-url", "none"
    ];
    const first = spawnSync(process.execPath, [...baseArguments, "--output", firstOutput], { encoding: "utf8" });
    const second = spawnSync(process.execPath, [...baseArguments, "--output", secondOutput], { encoding: "utf8" });

    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(await readFile(firstOutput, "utf8"), await readFile(secondOutput, "utf8"));
    assert.deepEqual(JSON.parse(await readFile(controlsPath, "utf8")), controls);

    const missingTimestamp = spawnSync(process.execPath, baseArguments.filter((value, index) => ![9, 10].includes(index)), { encoding: "utf8" });
    assert.equal(missingTimestamp.status, 2);
    assert.match(missingTimestamp.stderr, /Missing --occurred-at/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
