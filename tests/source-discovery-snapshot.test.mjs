import assert from "node:assert/strict";
import test from "node:test";

import { finalizeDiscoverySnapshot } from "../scripts/source-discovery-snapshot.mjs";

test("preserves the previous generation time when upstream evidence is unchanged", () => {
  const previous = {
    schema_version: 1,
    generated_at: "2026-07-15T00:00:00Z",
    sources: [{ id: "source", commit: "a".repeat(40) }]
  };
  const next = {
    schema_version: 1,
    generated_at: null,
    sources: [{ id: "source", commit: "a".repeat(40) }]
  };

  assert.deepEqual(finalizeDiscoverySnapshot(previous, next, "2026-07-20T00:00:00Z"), previous);
});
test("records a new generation time when pinned upstream evidence changes", () => {
  const previous = {
    schema_version: 1,
    generated_at: "2026-07-15T00:00:00Z",
    sources: [{ id: "source", commit: "a".repeat(40) }]
  };
  const next = {
    schema_version: 1,
    generated_at: null,
    sources: [{ id: "source", commit: "b".repeat(40) }]
  };

  assert.deepEqual(finalizeDiscoverySnapshot(previous, next, "2026-07-20T00:00:00Z"), {
    ...next,
    generated_at: "2026-07-20T00:00:00Z"
  });
});
