import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateSourceDiscovery } from "../scripts/validate-source-discovery.mjs";

const registry = JSON.parse(await readFile(new URL("../data/source-discovery-registry.json", import.meta.url), "utf8"));
const discovery = JSON.parse(await readFile(new URL("../data/source-discovery.json", import.meta.url), "utf8"));

test("source discovery records a large provenance-only candidate universe", () => {
  assert.deepEqual(validateSourceDiscovery(registry, discovery), []);
  assert.ok(discovery.counts.candidates >= 9_700);
  assert.ok(discovery.counts.by_type["mib-file"] >= 7_450);
  assert.ok(discovery.counts.by_type["compiled-mib-module"] >= 270);
  assert.ok(discovery.counts.by_type["device-identity-definition"] >= 1_000);
  assert.ok(discovery.counts.publication_modes.redistributable > 0);
  assert.ok(discovery.counts.publication_modes.quarantine > 8_000);
  assert.ok(discovery.candidates.every((candidate) => candidate.content_intake === "not-fetched"));
});

test("a source without a repository license stays NOASSERTION", () => {
  const source = discovery.sources.find((candidate) => candidate.id === "netdisco-mibs");
  assert.equal(source.repository_license.spdx, "NOASSERTION");
  assert.deepEqual(source.repository_license.files, []);
  assert.equal(source.repository_license.status, "signal-only");
  assert.ok(discovery.candidates
    .filter((candidate) => candidate.source_id === "netdisco-mibs")
    .every((candidate) => candidate.publication_mode === "quarantine"));

  const mutated = structuredClone(discovery);
  mutated.sources.find((candidate) => candidate.id === "netdisco-mibs").repository_license.spdx = "MIT";
  const failures = validateSourceDiscovery(registry, mutated);
  assert.ok(failures.some((failure) => failure.includes("no license file but claims an SPDX license")));
});

test("scope-bound LibreNMS prefix approval does not publish bundled MIBs or os_discovery definitions", () => {
  const source = discovery.sources.find((candidate) => candidate.id === "librenms");
  const candidates = discovery.candidates.filter((candidate) => candidate.source_id === "librenms");
  const byRoot = {
    mibs: candidates.filter((candidate) => candidate.path.startsWith("mibs/")).length,
    os_detection: candidates.filter((candidate) => candidate.path.startsWith("resources/definitions/os_detection/")).length,
    os_discovery: candidates.filter((candidate) => candidate.path.startsWith("resources/definitions/os_discovery/")).length,
  };
  assert.deepEqual(byRoot, { mibs: 4_822, os_detection: 806, os_discovery: 694 });
  assert.equal(source.repository_license.spdx, "NOASSERTION");
  assert.equal(source.repository_license.status, "signal-only");
  assert.ok(candidates.every((candidate) => candidate.publication_mode === "quarantine"));
});

test("a recognized repository license promotes candidates under the selected policy", () => {
  const source = discovery.sources.find((candidate) => candidate.id === "erlang-otp-snmp");
  assert.equal(source.repository_license.spdx, "Apache-2.0");
  assert.equal(source.repository_license.status, "license-derived-approval");
  assert.ok(discovery.candidates
    .filter((candidate) => candidate.source_id === "erlang-otp-snmp")
    .every((candidate) => candidate.publication_mode === "redistributable"));

  const mutated = structuredClone(discovery);
  const candidate = mutated.candidates.find((item) => item.source_id === "netdisco-mibs");
  candidate.publication_mode = "redistributable";
  candidate.rights_review = "approved-by-repository-license-signal";
  const failures = validateSourceDiscovery(registry, mutated);
  assert.ok(failures.some((failure) => failure.includes("publication mode drifted")));
  assert.ok(failures.some((failure) => failure.includes("rights review drifted")));
});

test("default-branch SPDX fallback is accepted only for the identical pinned license blob", () => {
  const source = discovery.sources.find((candidate) => candidate.id === "kmalinich-snmp-mibs");
  assert.equal(source.repository_license.spdx, "MIT");
  assert.equal(source.repository_license.recognition_basis, "default-branch-classification-matching-pinned-blob");
  assert.ok(source.repository_license.files.some((file) => (
    file.path === source.repository_license.classification_path
    && file.git_blob_oid === source.repository_license.classification_git_blob_oid
  )));
  assert.ok(source.repository_license.files.some((file) => source.repository_license.api_url.includes(`/${source.commit}/${file.path}`)));
  assert.ok(discovery.candidates
    .filter((candidate) => candidate.source_id === source.id)
    .every((candidate) => candidate.publication_mode === "redistributable"));

  const mutated = structuredClone(discovery);
  mutated.sources.find((candidate) => candidate.id === source.id).repository_license.api_url = "https://github.com/kmalinich/snmp-mibs/blob/master/LICENSE";
  assert.ok(validateSourceDiscovery(registry, mutated).some((failure) => failure.includes("pinned license URL")));
});

test("unpinned URLs, truncated trees, and count drift fail closed", () => {
  const mutated = structuredClone(discovery);
  mutated.sources[0].tree_complete = false;
  mutated.candidates[0].pinned_url = "https://raw.githubusercontent.com/example/repo/main/file.mib";
  mutated.counts.candidates -= 1;
  const failures = validateSourceDiscovery(registry, mutated);
  assert.ok(failures.some((failure) => failure.includes("incomplete tree")));
  assert.ok(failures.some((failure) => failure.includes("URL is not pinned")));
  assert.ok(failures.includes("Candidate count drift"));
});

test("MIB names may contain authorization while credential fields still fail", () => {
  const named = structuredClone(discovery);
  named.candidates[0].path = "AUTHORIZATION-MIB.mib";
  named.candidates[0].id = `${named.candidates[0].source_id}:AUTHORIZATION-MIB.mib`;
  named.candidates[0].pinned_url = named.candidates[0].pinned_url.replace(/[^/]+$/, "AUTHORIZATION-MIB.mib");
  assert.ok(!validateSourceDiscovery(registry, named).includes("Discovery snapshot contains a credential marker"));

  const credential = structuredClone(discovery);
  credential.authorization = "Bearer secret";
  assert.ok(validateSourceDiscovery(registry, credential).includes("Discovery snapshot contains a credential marker"));
});
