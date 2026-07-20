import { createHash } from "node:crypto";
import path from "node:path";

const RECOGNIZED_SPDX = new Set([
  "0BSD", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "CC0-1.0", "GPL-2.0-only",
  "GPL-2.0-or-later", "GPL-3.0-only", "GPL-3.0-or-later", "ISC", "MIT", "MPL-2.0", "Unlicense",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlobOid(bytes) {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

export function classifyPinnedLicense(sourceConfig, fileBytesByPath) {
  const failures = [];
  const evidence = [];
  const classifier = sourceConfig?.license_classifier;
  const validRepository = typeof sourceConfig?.repository === "string"
    && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(sourceConfig.repository);
  const validRevision = typeof sourceConfig?.revision === "string" && /^[0-9a-f]{40}$/.test(sourceConfig.revision);
  const scopeSegments = typeof classifier?.scope === "string" ? classifier.scope.split("/") : [];
  const validScope = typeof classifier?.scope === "string"
    && /^[a-z0-9][a-z0-9._/-]{2,127}$/.test(classifier.scope)
    && scopeSegments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  if (!validRepository) failures.push("configuration:repository");
  if (!validRevision) failures.push("configuration:revision");
  if (!validScope) failures.push("configuration:license_classifier.scope");
  if (!classifier || !RECOGNIZED_SPDX.has(classifier.expected_spdx)
    || !Array.isArray(classifier.files) || classifier.files.length === 0) {
    failures.push("configuration:license_classifier");
    return {
      status: "quarantine",
      spdx: "NOASSERTION",
      classifier: "manual-pinned-content-v1",
      evidence,
      failures: [...new Set(failures)].sort(),
    };
  }

  const seenPaths = new Set();
  for (const expected of classifier.files) {
    const relativePath = expected?.path;
    const safePath = typeof relativePath === "string"
      && relativePath.length > 0
      && !path.posix.isAbsolute(relativePath)
      && !path.win32.isAbsolute(relativePath)
      && !relativePath.split(/[\\/]/).includes("..");
    if (!safePath || seenPaths.has(relativePath)) {
      failures.push(`${seenPaths.has(relativePath) ? "duplicate" : "path"}:${relativePath ?? "<missing>"}`);
      continue;
    }
    seenPaths.add(relativePath);
    if (!/^[0-9a-f]{40}$/.test(expected.git_blob_oid ?? "")) failures.push(`expected-git-blob:${relativePath}`);
    if (!/^[0-9a-f]{64}$/.test(expected.sha256 ?? "")) failures.push(`expected-sha256:${relativePath}`);
    if (!Array.isArray(expected.required_markers) || expected.required_markers.length === 0
      || expected.required_markers.some((marker) => typeof marker !== "string" || marker.length < 8 || marker.length > 256)) {
      failures.push(`markers:${relativePath}`);
    }
    const bytes = fileBytesByPath.get(expected.path);
    if (!bytes) {
      failures.push(`missing:${expected.path}`);
      continue;
    }
    const actualSha256 = sha256(bytes);
    const actualGitBlobOid = gitBlobOid(bytes);
    const content = bytes.toString("utf8");
    if (actualSha256 !== expected.sha256) failures.push(`sha256:${expected.path}`);
    if (actualGitBlobOid !== expected.git_blob_oid) failures.push(`git-blob:${expected.path}`);
    for (const marker of Array.isArray(expected.required_markers) ? expected.required_markers : []) {
      if (!content.includes(marker)) failures.push(`marker:${expected.path}:${marker}`);
    }
    evidence.push({
      path: expected.path,
      git_blob_oid: actualGitBlobOid,
      sha256: actualSha256,
    });
  }

  return {
    status: failures.length === 0 ? "approved" : "quarantine",
    spdx: failures.length === 0 ? classifier.expected_spdx : "NOASSERTION",
    classifier: "manual-pinned-content-v1",
    evidence: evidence.sort((left, right) => left.path.localeCompare(right.path)),
    failures: [...new Set(failures)].sort(),
  };
}
