import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const evidencePath = "docs/operations/evidence/v0.4.0-alpha.2/ui15-browser-results.json";

test("UI-15 production evidence is release-bound and screenshot-addressed", async () => {
  const [evidence, record] = await Promise.all([
    readFile("docs/operations/ui-15-browser-evidence.md", "utf8"),
    readFile(evidencePath, "utf8").then(JSON.parse)
  ]);

  assert.equal(record.schema_version, 1);
  assert.equal(record.origin, "https://mibvendor.io");
  assert.deepEqual(record.release, {
    version: "0.4.0-alpha.2",
    commit: "4b8a89dcddea11ef8b7afdd262daf7e8a6cffbc8",
    data_release: "license-signaled-2026-07-20.2",
    identity_release: "device-identity-2026-07-20.2"
  });
  assert.deepEqual(record.viewports.map((viewport) => [viewport.name, viewport.width, viewport.height]), [
    ["desktop", 1280, 900],
    ["mobile-390", 390, 844]
  ]);
  for (const viewport of record.viewports) {
    assert.ok(viewport.focusable_controls_forward_and_reverse >= 1);
    assert.equal(viewport.copy_examples_enter_activated, 5);
    assert.deepEqual(viewport.cursor_pages_enter_activated, [0, 1]);
    assert.equal(viewport.details_enter_toggled, true);
    assert.equal(viewport.secondary_links_enter_activated, 3);
    assert.equal(viewport.clipboard_cleared, true);
    assert.equal(viewport.horizontal_overflow, false);
    assert.equal(viewport.console_errors, 0);
    assert.equal(viewport.page_errors, 0);
    assert.equal(viewport.failed_requests, 0);
    assert.equal(viewport.cloudflare_beacon_injected, false);
  }

  assert.equal(record.screenshots.length, 4);
  for (const screenshot of record.screenshots) {
    const bytes = await readFile(screenshot.path);
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(bytes.readUInt32BE(16), screenshot.width);
    assert.equal(bytes.readUInt32BE(20), screenshot.height);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), screenshot.sha256);
    assert.match(evidence, new RegExp(screenshot.path.split("/").at(-1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
