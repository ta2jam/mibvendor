import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  deriveProjectPrefixes,
  normalizePrefix,
  parseStaticYaml,
} from "../scripts/update-project-identity-prefixes.mjs";
import { validateProjectIdentityPrefixes } from "../scripts/validate-project-identity-prefixes.mjs";

const manifest = JSON.parse(await readFile(new URL("../data/device-identities/project-prefixes-manifest.json", import.meta.url)));
const dataset = JSON.parse(await readFile(new URL("../data/device-identities/project-prefixes.json", import.meta.url)));

test("committed project prefix inventory is valid and keeps coverage separate", () => {
  assert.deepEqual(validateProjectIdentityPrefixes(manifest, dataset), []);
  assert.deepEqual(dataset.counts, {
    prefixes: 655,
    platforms: 406,
    enterprises: 266,
    quarantined_literals: 358,
    quarantine_reasons: {
      "conditional-clause": 222,
      "multi-platform-prefix": 3,
      "outside-enterprise-tree": 6,
      "pen-root-only": 124,
      "shared-net-snmp-agent": 3,
    },
  });
  assert.equal(dataset.prefixes.some((row) => row.model !== undefined || row.product_family !== undefined), false);
  assert.ok(dataset.prefixes.every((row) => row.claim_strength === "platform" && row.match_method === "prefix"));
});

test("static YAML parser rejects duplicate keys, aliases, and explicit tags", () => {
  assert.throws(() => parseStaticYaml(Buffer.from("os: one\nos: two\n"), "duplicate.yaml"), /Map keys must be unique/);
  assert.throws(() => parseStaticYaml(Buffer.from("os: &name one\ncopy: *name\n"), "alias.yaml"), /aliases are not allowed/);
  assert.throws(() => parseStaticYaml(Buffer.from("os: !custom one\n"), "tag.yaml"), /explicit YAML tags are not allowed/);
});

test("prefix normalization is numeric, bounded, and canonical", () => {
  assert.equal(normalizePrefix(".1.3.6.1.4.1.42.1.").oid, "1.3.6.1.4.1.42.1");
  assert.equal(normalizePrefix("1.3.6.1.4.1.042.1"), null);
  assert.equal(normalizePrefix("1.3.6.1.4.1.4294967296.1"), null);
  assert.equal(normalizePrefix("1.3.6.1.4.1.42.*"), null);
});

test("derivation accepts only unconditional non-root enterprise prefixes and quarantines global ambiguity", () => {
  const documents = [
    ["base.yaml", `os: base\ndiscovery:\n  - sysObjectID: .1.3.6.1.4.1.42.1\n  - sysObjectID: 1.3.6.1.4.1.42.1.2.\n  - sysObjectID: .1.3.6.1.4.1.42\n  - sysObjectID: .1.3.6.1.4.1.8072.3.2.15\n  - sysObjectID: .1.3.6.1.2.1.1\n  - sysObjectID: .1.3.6.1.4.1.42.9\n    sysDescr: bounded-condition\n`],
    ["alternate.yaml", `os: alternate\ndiscovery:\n  - sysObjectID: .1.3.6.1.4.1.42.1\n    sysDescr: bounded-condition\n`],
  ];
  const inputs = documents.map(([name], index) => ({
    path: `resources/definitions/os_detection/${name}`,
    mode: "100644",
    git_blob_oid: String(index + 1).repeat(40),
    sha256: String(index + 1).repeat(64),
    bytes: 100,
  }));
  const parsedFiles = documents.map(([name, yaml], index) => ({
    input: inputs[index],
    document: parseStaticYaml(Buffer.from(yaml), name),
  }));
  const expectedMeasurements = {
    input_files: 2,
    files_with_discovery: 2,
    discovery_clauses: 7,
    sys_object_id_clauses: 7,
    sys_object_id_literals: 7,
    conditional_literals: 2,
    unconditional_literals: 5,
    quarantined_non_enterprise_literals: 1,
    quarantined_pen_root_literals: 1,
    quarantined_shared_agent_prefixes: 1,
    quarantined_multi_platform_prefixes: 1,
    published_prefixes: 1,
    platforms: 1,
    enterprises: 1,
  };
  const { dataset: derived } = deriveProjectPrefixes({
    inputs,
    parsedFiles,
    totalBytes: 200,
    license: { status: "approved", spdx: "GPL-3.0-or-later", classifier: "manual-pinned-content-v1", evidence: [], failures: [] },
  }, { expectedMeasurements });
  assert.deepEqual(derived.prefixes.map((row) => row.oid_prefix), ["1.3.6.1.4.1.42.1.2"]);
  assert.ok(derived.quarantine.some((row) => row.normalized_oid === "1.3.6.1.4.1.42.1" && row.reason === "multi-platform-prefix"));
  assert.equal(JSON.stringify(derived).includes("bounded-condition"), false);
});

test("digest, source evidence, counts, and conflict quarantine fail closed on drift", () => {
  const mutations = [
    (copy) => { copy.dataset_sha256 = "0".repeat(64); },
    (copy) => { copy.prefixes[0].source_sha256 = "0".repeat(64); },
    (copy) => { copy.counts.prefixes -= 1; },
    (copy) => { copy.quarantine.find((row) => row.reason === "multi-platform-prefix").reason = "conditional-clause"; },
    (copy) => { copy.prefixes[0].model = "invented"; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(dataset);
    mutate(copy);
    assert.ok(validateProjectIdentityPrefixes(manifest, copy).length > 0);
  }
});
