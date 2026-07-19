import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const updater = path.join(root, "scripts", "update-mib-catalog.mjs");

test("historical seed updater refuses an unqualified active-catalog overwrite", async () => {
  const catalogPath = path.join(root, "data", "mib-catalog.json");
  const before = await readFile(catalogPath);
  const result = spawnSync(process.execPath, [updater], {
    cwd: root,
    encoding: "utf8",
  });
  const after = await readFile(catalogPath);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /historical rights-cleared-2026-07-14\.1 seed/);
  assert.deepEqual(after, before);
});
