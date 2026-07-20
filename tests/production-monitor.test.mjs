import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const resolver = fileURLToPath(new URL("../scripts/resolve-production-commit.sh", import.meta.url));
const workflow = fileURLToPath(new URL("../.github/workflows/production-monitor.yml", import.meta.url));
const verifier = fileURLToPath(new URL("../scripts/verify-production.sh", import.meta.url));

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function repositoryFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "mibvendor-monitor-"));
  git(directory, "init", "--quiet");
  git(directory, "config", "user.name", "mibvendor test");
  git(directory, "config", "user.email", "test@mibvendor.invalid");
  await mkdir(path.join(directory, "scripts"));
  await writeFile(path.join(directory, "VERSION"), "0.2.0-alpha.1\n");
  await writeFile(path.join(directory, "scripts", "verify-production.sh"), "#!/bin/sh\nprintf 'tagged verifier\\n'\n");
  await chmod(path.join(directory, "scripts", "verify-production.sh"), 0o755);
  git(directory, "add", "VERSION", "scripts/verify-production.sh");
  git(directory, "commit", "--quiet", "-m", "release fixture");
  const releaseCommit = git(directory, "rev-parse", "HEAD");
  git(directory, "tag", "-a", "v0.2.0-alpha.1", "-m", "release fixture");
  await writeFile(path.join(directory, "scripts", "verify-production.sh"), "#!/bin/sh\nprintf 'main verifier must not run\\n' >&2\nexit 99\n");
  await writeFile(path.join(directory, "staging.txt"), "not deployed\n");
  git(directory, "add", "staging.txt", "scripts/verify-production.sh");
  git(directory, "commit", "--quiet", "-m", "staging work");
  return { directory, releaseCommit };
}

test("production monitor resolves the immutable VERSION tag while main is ahead", async (context) => {
  const fixture = await repositoryFixture();
  context.after(() => rm(fixture.directory, { recursive: true, force: true }));
  const head = git(fixture.directory, "rev-parse", "HEAD");
  assert.notEqual(head, fixture.releaseCommit);
  assert.equal(execFileSync(resolver, { cwd: fixture.directory, encoding: "utf8" }).trim(), fixture.releaseCommit);
});

test("production monitor executes the verifier from the immutable tag", async (context) => {
  const fixture = await repositoryFixture();
  context.after(() => rm(fixture.directory, { recursive: true, force: true }));
  const expectedCommit = execFileSync(resolver, { cwd: fixture.directory, encoding: "utf8" }).trim();

  git(fixture.directory, "checkout", "--quiet", "--detach", expectedCommit);
  const result = execFileSync("./scripts/verify-production.sh", { cwd: fixture.directory, encoding: "utf8" });

  assert.equal(result, "tagged verifier\n");
  assert.equal(git(fixture.directory, "rev-parse", "HEAD"), fixture.releaseCommit);
});

test("production monitor workflow pins code and data expectations to the release tag", async () => {
  const contents = await readFile(workflow, "utf8");
  const checkoutIndex = contents.indexOf("git checkout --quiet --detach \"$EXPECTED_COMMIT\"");
  const verifyIndex = contents.indexOf("./scripts/verify-production.sh");

  assert.ok(checkoutIndex >= 0 && checkoutIndex < verifyIndex);
  assert.match(contents, /EXPECTED_DATA_RELEASE=\$\(node -e/);
  assert.match(contents, /EXPECTED_IDENTITY_RELEASE=\$\(node -e/);
  assert.match(contents, /data\/device-identities\/release\.json/);
  assert.doesNotMatch(contents, /EXPECTED_DATA_RELEASE:\s*\S/);
  assert.doesNotMatch(contents, /EXPECTED_IDENTITY_RELEASE:\s*\S/);
});

test("production verifier pins identity requests and validates the effective publication view", async () => {
  const contents = await readFile(verifier, "utf8");

  assert.match(contents, /identity_release_for_request=.*EXPECTED_IDENTITY_RELEASE/s);
  assert.match(contents, /--data "\$identity_payload"/);
  assert.match(contents, /--data "\$identity_conflict_payload"/);
  assert.doesNotMatch(contents, /--data '\{"identity_release":"device-identity-/);
  assert.match(contents, /identity_release_sha256/);
  assert.match(contents, /control_revision/);
  assert.match(contents, /control_sha256/);
  assert.match(contents, /identity_view/);
  assert.match(contents, /disabled_sources != sorted\(set\(disabled_sources\)\)/);
  assert.doesNotMatch(contents, /identity\.get\("disabled_sources"\)\s*!=\s*0/);
  assert.doesNotMatch(contents, /identity\.get\("exact_models"\)\s*!=\s*\d+/);
  assert.match(contents, /vendor_identifier/);
});

test("production verifier exercises RackTables resolution and conflict behavior", async () => {
  const contents = await readFile(verifier, "utf8");

  assert.match(contents, /\/v1\/sys-object-ids\/1\.3\.6\.1\.4\.1\.9\.6\.1\.83\.10\.1/);
  assert.match(contents, /\/v1\/sys-object-ids\/1\.3\.6\.1\.4\.1\.9\.1\.615/);
  assert.match(contents, /racktables_match\["model"\] == "SG 300-10"/);
  assert.match(contents, /racktables_match\["claim_scope"\] == "open-source-project-device-definition"/);
  assert.match(contents, /racktables_match\["confidence"\] == "medium"/);
  assert.match(contents, /racktables_match\["source_assignment_confidence"\] == "high"/);
  assert.match(contents, /racktables_match\["firmware_scope"\] == "not_established"/);
  assert.match(contents, /provenance\["source_id"\] == "racktables-known-switches"/);
  assert.match(contents, /provenance\["publication_mode"\] == "definition-only" and provenance\["raw_download"\] is False/);
  assert.match(contents, /"source_text" not in json\.dumps\(racktables_sg300\)/);
  assert.match(contents, /racktables_conflict\["status"\] == "ambiguous"/);
  assert.match(contents, /racktables_conflict\["match"\] is None/);
  assert.match(contents, /if "racktables-known-switches" not in disabled_sources/);
});

test("production verifier gates the project platform-prefix inventory and stable probe", async () => {
  const contents = await readFile(verifier, "utf8");

  assert.match(contents, /project_platform_prefixes/);
  assert.match(contents, /project_prefix_platforms/);
  assert.match(contents, /project_prefix_enterprises/);
  assert.match(contents, /\(655, 406, 266\)/);
  assert.match(contents, /\/v1\/sys-object-ids\/1\.3\.6\.1\.4\.1\.30065\.1\.99/);
  assert.match(contents, /arista_match\["oid"\] == "1\.3\.6\.1\.4\.1\.30065\.1"/);
  assert.match(contents, /arista_match\["match_type"\] == "prefix"/);
  assert.match(contents, /arista_match\["model"\] is None and arista_match\["product_family"\] is None/);
  assert.match(contents, /arista_provenance\["source_id"\] == "librenms-os-detection"/);
  assert.match(contents, /if "librenms-os-detection" not in disabled_sources/);
});

test("production monitor fails closed when the release tag is absent", async (context) => {
  const fixture = await repositoryFixture();
  context.after(() => rm(fixture.directory, { recursive: true, force: true }));
  git(fixture.directory, "tag", "-d", "v0.2.0-alpha.1");
  const result = spawnSync(resolver, { cwd: fixture.directory, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not resolve to a commit/);
});
