import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FoundationValidationError,
  loadFoundation,
  validateFoundation,
} from "../scripts/validate-foundation-contracts.mjs";

function clone(bundle) {
  return structuredClone(bundle);
}

function rejectsWith(bundle, fragment) {
  assert.throws(
    () => validateFoundation(bundle),
    (error) => error instanceof FoundationValidationError && error.issues.some((issue) => issue.includes(fragment)),
  );
}

const baseline = await loadFoundation();

test("foundation schemas, examples, semantics, and golden tasks pass", () => {
  assert.deepEqual(validateFoundation(clone(baseline)), {
    schemas: 5,
    examples: 5,
    objects: 2,
    goldenTasks: 20,
  });
});

test("canonical OID text and arcs cannot drift", () => {
  const bundle = clone(baseline);
  bundle.examples.canonical.module.objects[1].oid_arcs[8] = 2;
  rejectsWith(bundle, "oid does not match oid_arcs");
});

test("provisional and quarantine sources cannot approve public output", () => {
  const bundle = clone(baseline);
  bundle.examples.source.rights.scopes.api_output = "approved";
  rejectsWith(bundle, "tier P cannot approve public output scopes");
});

test("release counts must match immutable contents", () => {
  const bundle = clone(baseline);
  bundle.examples.release.counts.objects = 3;
  rejectsWith(bundle, "release.counts.objects");
});

test("failed parser adapters cannot publish partial canonical output", () => {
  const bundle = clone(baseline);
  bundle.examples.adapterFailure.canonical_module = bundle.examples.canonical;
  rejectsWith(bundle, "failed adapter result must not carry");
});

test("golden tasks remain an exact ordered set of twenty", () => {
  const bundle = clone(baseline);
  bundle.golden.tasks[19].id = "G19";
  rejectsWith(bundle, "G01 through G20");
});
