import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CanonicalJsonError,
  canonicalizeJson,
  canonicalJsonSha256,
  canonicalModuleDigest,
  dataReleaseDigest,
  sourceSnapshotDigest,
} from "../scripts/canonical-json.mjs";
import { loadFoundation } from "../scripts/validate-foundation-contracts.mjs";

test("RFC 8785 property ordering uses raw UTF-16 code units", () => {
  const value = {
    "\u20ac": "Euro Sign",
    "\r": "Carriage Return",
    "\ufb33": "Hebrew Letter Dalet With Dagesh",
    "1": "One",
    "\ud83d\ude00": "Emoji: Grinning Face",
    "\u0080": "Control",
    "\u00f6": "Latin Small Letter O With Diaeresis",
  };
  assert.equal(
    canonicalizeJson(value),
    "{\"\\r\":\"Carriage Return\",\"1\":\"One\",\"\":\"Control\",\"ö\":\"Latin Small Letter O With Diaeresis\",\"€\":\"Euro Sign\",\"😀\":\"Emoji: Grinning Face\",\"דּ\":\"Hebrew Letter Dalet With Dagesh\"}",
  );
});

test("ECMAScript primitive serialization and array order are preserved", () => {
  assert.equal(
    canonicalizeJson({ numbers: [333333333.33333329, 1e30, 4.50, 2e-3, 1e-27], literals: [null, true, false] }),
    "{\"literals\":[null,true,false],\"numbers\":[333333333.3333333,1e+30,4.5,0.002,1e-27]}",
  );
});

test("property insertion order does not change the digest", () => {
  assert.equal(canonicalJsonSha256({ b: 2, a: { d: 4, c: 3 } }), canonicalJsonSha256({ a: { c: 3, d: 4 }, b: 2 }));
});

test("invalid I-JSON and non-JSON JavaScript values fail closed", () => {
  const accessor = {};
  Object.defineProperty(accessor, "value", { enumerable: true, get: () => 1 });
  const extendedArray = [1];
  extendedArray["4294967295"] = 2;
  for (const value of [NaN, Infinity, undefined, 1n, "\ud800", [, 1], new Date(0), accessor, extendedArray]) {
    assert.throws(() => canonicalizeJson(value), CanonicalJsonError);
  }
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalizeJson(cyclic), /cyclic structures/);
});

test("JCS preserves Unicode without normalization", () => {
  assert.notEqual(canonicalJsonSha256("é"), canonicalJsonSha256("e\u0301"));
});

test("foundation fixtures carry reproducible content addresses", async () => {
  const { examples } = await loadFoundation();
  assert.equal(examples.source.snapshot_id, `src_${sourceSnapshotDigest(examples.source)}`);
  assert.equal(examples.canonical.source.snapshot_id, `src_${sourceSnapshotDigest(examples.canonical.source)}`);
  assert.equal(examples.canonical.canonical_sha256, canonicalModuleDigest(examples.canonical));
  assert.equal(examples.release.manifest_sha256, dataReleaseDigest(examples.release));
});
