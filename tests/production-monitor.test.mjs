import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const resolver = fileURLToPath(new URL("../scripts/resolve-production-commit.sh", import.meta.url));
const workflow = fileURLToPath(new URL("../.github/workflows/production-monitor.yml", import.meta.url));

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
  assert.doesNotMatch(contents, /EXPECTED_DATA_RELEASE:\s*\S/);
});

test("production monitor fails closed when the release tag is absent", async (context) => {
  const fixture = await repositoryFixture();
  context.after(() => rm(fixture.directory, { recursive: true, force: true }));
  git(fixture.directory, "tag", "-d", "v0.2.0-alpha.1");
  const result = spawnSync(resolver, { cwd: fixture.directory, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not resolve to a commit/);
});
