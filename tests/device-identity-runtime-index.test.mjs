import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalJsonSha256 } from "../scripts/canonical-json.mjs";
import { writeDeviceIdentityArtifacts } from "../scripts/update-device-identity-runtime-index.mjs";

function withoutField(document, field) {
  return Object.fromEntries(Object.entries(document).filter(([key]) => key !== field));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("runtime index and release manifest rebuild byte-for-byte from pinned inputs", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "mibvendor-device-identity-"));
  try {
    const { runtimeIndex, release } = await writeDeviceIdentityArtifacts(outputDirectory);
    const [rebuiltRuntime, rebuiltRelease, committedRuntime, committedRelease] = await Promise.all([
      readFile(path.join(outputDirectory, "runtime-index.json")),
      readFile(path.join(outputDirectory, "release.json")),
      readFile(new URL("../data/device-identities/runtime-index.json", import.meta.url)),
      readFile(new URL("../data/device-identities/release.json", import.meta.url))
    ]);

    assert.deepEqual(rebuiltRuntime, committedRuntime);
    assert.deepEqual(rebuiltRelease, committedRelease);
    assert.equal(
      runtimeIndex.runtime_index_sha256,
      canonicalJsonSha256(withoutField(runtimeIndex, "runtime_index_sha256"))
    );
    assert.equal(release.release_sha256, canonicalJsonSha256(withoutField(release, "release_sha256")));
    const snmpInfoLicense = await readFile(new URL("../data/device-identities/licenses/SNMP-INFO-LICENSE", import.meta.url));
    assert.deepEqual(runtimeIndex.inputs.snmp_info_license, {
      path: "data/device-identities/licenses/SNMP-INFO-LICENSE",
      file_sha256: sha256(snmpInfoLicense)
    });
    assert.equal(release.datasets.license_evidence.snmp_info_license_sha256, sha256(snmpInfoLicense));
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
