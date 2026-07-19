import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];

async function exists(relativePath) {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function walk(directory, ignored = new Set([".git", "node_modules", ".local", ".tools"])) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute, ignored));
    else files.push(absolute);
  }
  return files;
}

for (const required of [
  "LICENSE",
  "VERSION",
  "README.md",
  "docs/WORK-TRACKER.md",
  "docs/PHASE-0.md",
  "docs/PRODUCT.md",
  "docs/foundation/README.md",
  "docs/foundation/source-governance.md",
  "docs/foundation/release-model.md",
  "docs/foundation/parser-adapter.md",
  "docs/foundation/ux-golden-tasks.json",
  "docs/foundation/prototype-golden-coverage.json",
  "docs/decisions/0005-provisional-foundation-contracts.md",
  "docs/decisions/0006-rfc8785-content-addressing.md",
  "docs/decisions/0007-fail-closed-mib-publication.md",
  "docs/decisions/0008-license-signal-publication-policy.md",
  "docs/decisions/0009-permanently-free-api.md",
  "contracts/source-snapshot.schema.json",
  "contracts/canonical-module.schema.json",
  "contracts/data-release.schema.json",
  "contracts/active-release-pointer.schema.json",
  "contracts/parser-adapter.schema.json",
  "scripts/validate-foundation-contracts.mjs",
  "scripts/canonical-json.mjs",
  "Dockerfile",
  "compose.production.yaml",
  "deploy/Caddyfile",
  "deploy/mibvendor-health",
  "deploy/mibvendor-health.service",
  "deploy/mibvendor-health.timer",
  ".github/workflows/production-monitor.yml",
  ".github/workflows/source-freshness.yml",
  ".github/workflows/parser-arm64.yml",
  "experiments/parser-bakeoff/.dockerignore",
  "experiments/parser-bakeoff/scripts/validate_corpus_intake.py",
  "scripts/verify-production.sh",
  "scripts/resolve-production-commit.sh",
  "docs/research/demand/validation-evidence.json",
  "docs/research/demand/phase0-openapi.json",
  "docs/research/rights/permission-requests.json",
  "docs/research/rights/legacy-rfc-review.json",
  "prototype/index.html",
  "prototype/app.js",
  "prototype/core.mjs",
  "src/api.mjs",
  "src/intelligence.mjs",
  "server.mjs",
  "data/iana-private-enterprise-numbers.json",
  "data/mib-catalog.json",
  "data/mib-objects.json",
  "data/source-catalog.json",
  "data/source-discovery-registry.json",
  "data/source-discovery.json",
  "data/publication-controls.json",
  "data/license-derived-intake.json",
  "data/compiled-mib-intake.json",
  "data/compiled-mib-objects-staging.json",
  "data/corpus-expansion-candidates.json",
  "data/raw-mib-analysis.json",
  "data/raw-mib-objects-staging.json.gz",
  "data/compiled-mib-fidelity.json",
  "scripts/update-mib-catalog.mjs",
  "scripts/validate-mib-catalog.mjs",
  "scripts/update-source-discovery.mjs",
  "scripts/validate-source-discovery.mjs",
  "scripts/source-discovery-snapshot.mjs",
  "scripts/validate-publication-controls.mjs",
  "scripts/validate-release-evidence.mjs",
  "scripts/lib/release-evidence.mjs",
  "scripts/lib/artifact-restrictive-notices.mjs",
  "scripts/update-license-derived-intake.mjs",
  "scripts/validate-license-derived-intake.mjs",
  "scripts/update-compiled-mib-intake.mjs",
  "scripts/validate-compiled-mib-intake.mjs",
  "scripts/update-corpus-expansion-candidates.mjs",
  "scripts/validate-corpus-expansion-candidates.mjs",
  "scripts/update-raw-mib-analysis.mjs",
  "scripts/validate-raw-mib-analysis.mjs",
  "scripts/update-compiled-mib-fidelity.mjs",
  "scripts/validate-compiled-mib-fidelity.mjs",
  "scripts/validate-legacy-rfc-review.mjs",
  "scripts/update-iana-pen.mjs",
  "src/publication-controls.mjs",
  "THIRD_PARTY_NOTICES.md"
]) {
  if (!await exists(required)) failures.push(`Missing required file: ${required}`);
}

const version = (await readFile(path.join(root, "VERSION"), "utf8")).trim();
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (packageJson.version !== version) {
  failures.push(`VERSION (${version}) and package.json (${packageJson.version}) differ`);
}
const prototypeCoverage = JSON.parse(await readFile(path.join(root, "docs", "foundation", "prototype-golden-coverage.json"), "utf8"));
if (prototypeCoverage.prototype_release !== version) {
  failures.push(`Prototype coverage release (${prototypeCoverage.prototype_release}) and VERSION (${version}) differ`);
}

const readme = await readFile(path.join(root, "README.md"), "utf8");
for (const forbidden of [
  /\blocalhost\b/i,
  /\bnpm\s+run\s+(?:serve|dev|build|verify)\b/i,
  /\bdocker\s+compose\b/i,
  /\bgit\s+clone\b/i,
  /\bself[- ]host(?:ed|ing)?\b/i
]) {
  if (forbidden.test(readme)) failures.push(`README contains a self-host/setup instruction matching ${forbidden}`);
}
if (readme.includes("ta2jam.github.io/mibvendor")) {
  failures.push("README must point users to mibvendor.io, not GitHub Pages");
}
for (const requiredCopy of [
  "## Use the web application",
  "## Use it safely",
  "## Permanently free public API",
  "The public API is live at `https://mibvendor.io/v1`",
  "free abuse-control credentials only",
  "Free access is fair-use bounded, not unlimited use or an availability SLA",
  "open source on GitHub"
]) {
  if (!readme.includes(requiredCopy)) failures.push(`README is missing required service copy: ${requiredCopy}`);
}
if (await exists(".github/workflows/pages.yml")) {
  failures.push("GitHub Pages workflow must remain disabled; production runs on the VPS");
}
if (await exists(".openai/hosting.json")) {
  failures.push("OpenAI Sites hosting must remain disabled; production runs on the isolated VPS");
}

const productionMonitor = await readFile(path.join(root, ".github", "workflows", "production-monitor.yml"), "utf8");
for (const requiredMonitorBoundary of [
  "schedule:",
  "workflow_dispatch:",
  "permissions:\n  contents: read",
  "fetch-depth: 0",
  "./scripts/resolve-production-commit.sh",
  "git checkout --quiet --detach \"$EXPECTED_COMMIT\"",
  "data/mib-catalog.json",
  "./scripts/verify-production.sh"
]) {
  if (!productionMonitor.includes(requiredMonitorBoundary)) {
    failures.push(`Production monitor is missing boundary: ${requiredMonitorBoundary}`);
  }
}
if (productionMonitor.includes("EXPECTED_COMMIT: ${{ github.sha }}")) {
  failures.push("Production monitor must resolve the deployed release tag, not assume main is deployed");
}
if (/EXPECTED_DATA_RELEASE:\s*\S/.test(productionMonitor)) {
  failures.push("Production monitor must derive the data release from the immutable tagged catalog");
}

const sourceFreshnessWorkflow = await readFile(path.join(root, ".github", "workflows", "source-freshness.yml"), "utf8");
for (const requiredFreshnessBoundary of [
  "schedule:",
  "workflow_dispatch:",
  "permissions:\n  contents: read",
  "npm run update:sources",
  "npm run check:sources",
  "git diff --exit-code -- data/source-discovery.json"
]) {
  if (!sourceFreshnessWorkflow.includes(requiredFreshnessBoundary)) {
    failures.push(`Source freshness workflow is missing boundary: ${requiredFreshnessBoundary}`);
  }
}

const arm64ParserWorkflow = await readFile(path.join(root, ".github", "workflows", "parser-arm64.yml"), "utf8");
for (const requiredArm64Boundary of [
  "workflow_dispatch:",
  "permissions:\n  contents: read",
  "runs-on: ubuntu-24.04-arm",
  "test \"$(uname -m)\" = aarch64",
  "run_containers.sh",
  "validate_results.py",
  "retention-days: 14"
]) {
  if (!arm64ParserWorkflow.includes(requiredArm64Boundary)) {
    failures.push(`Linux arm64 parser workflow is missing boundary: ${requiredArm64Boundary}`);
  }
}

const gitignore = await readFile(path.join(root, ".gitignore"), "utf8");
const parserDockerignore = await readFile(
  path.join(root, "experiments", "parser-bakeoff", ".dockerignore"),
  "utf8",
);
if (!gitignore.includes("experiments/parser-bakeoff/corpus/private/")) {
  failures.push("Private parser corpus must be ignored by Git");
}
for (const privateBoundary of ["corpus/private/", "corpus/private/**", "results/**"]) {
  if (!parserDockerignore.includes(privateBoundary)) {
    failures.push(`Parser Docker context is missing exclusion: ${privateBoundary}`);
  }
}
const parserContainerRunner = await readFile(
  path.join(root, "experiments", "parser-bakeoff", "scripts", "run_containers.sh"),
  "utf8",
);
for (const canaryBoundary of [
  ".mibvendor-build-context-canary-$$",
  "must never enter a parser image layer",
  "test ! -e /bench/corpus/private/"
]) {
  if (!parserContainerRunner.includes(canaryBoundary)) {
    failures.push(`Parser container runner is missing private-context canary boundary: ${canaryBoundary}`);
  }
}

const hostHealth = await readFile(path.join(root, "deploy", "mibvendor-health"), "utf8");
const healthService = await readFile(path.join(root, "deploy", "mibvendor-health.service"), "utf8");
const healthTimer = await readFile(path.join(root, "deploy", "mibvendor-health.timer"), "utf8");
for (const requiredHealthBoundary of [
  "127.0.0.1:3001",
  "com.docker.compose.project=mibvendor",
  "MIBVENDOR_DISK_LIMIT_PERCENT",
  "EXPECTED_DATA_RELEASE"
]) {
  if (!hostHealth.includes(requiredHealthBoundary)) failures.push(`Host health check is missing boundary: ${requiredHealthBoundary}`);
}
for (const requiredServiceBoundary of [
  "User=deploy",
  "SupplementaryGroups=docker",
  "NoNewPrivileges=true",
  "ProtectSystem=strict"
]) {
  if (!healthService.includes(requiredServiceBoundary)) failures.push(`Health service is missing boundary: ${requiredServiceBoundary}`);
}
if (!healthTimer.includes("OnUnitActiveSec=5min") || !healthTimer.includes("Persistent=true")) {
  failures.push("Health timer must run every five minutes and be persistent");
}

const dockerfile = await readFile(path.join(root, "Dockerfile"), "utf8");
const ciWorkflow = await readFile(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
const productionCompose = await readFile(path.join(root, "compose.production.yaml"), "utf8");
const caddySite = await readFile(path.join(root, "deploy", "Caddyfile"), "utf8");
for (const requiredRuntimeBoundary of [
  "@sha256:",
  "USER 101:101"
]) {
  if (!dockerfile.includes(requiredRuntimeBoundary)) {
    failures.push(`Dockerfile is missing production boundary: ${requiredRuntimeBoundary}`);
  }
}
if (!dockerfile.includes("FROM node:22-") || !ciWorkflow.includes("node-version: 22")) {
  failures.push("CI and the production image must use the same Node 22 major runtime");
}
for (const requiredProxyBoundary of [
  "www.mibvendor.io",
  "mibvendor.io",
  "reverse_proxy 127.0.0.1:3001",
  "Content-Security-Policy",
  "CF-Connecting-IP"
]) {
  if (!caddySite.includes(requiredProxyBoundary)) {
    failures.push(`Caddy site is missing proxy boundary: ${requiredProxyBoundary}`);
  }
}
for (const requiredRuntimeBoundary of [
  "127.0.0.1:3001:8080",
  "DATA_RELEASE: ${DATA_RELEASE:?DATA_RELEASE is required}",
  "read_only: true",
  "no-new-privileges:true",
  "pids: 64",
  "driver: bridge"
]) {
  if (!productionCompose.includes(requiredRuntimeBoundary)) {
    failures.push(`Production Compose is missing runtime boundary: ${requiredRuntimeBoundary}`);
  }
}

const allFiles = await walk(root);
for (const file of allFiles.filter((candidate) => candidate.endsWith(".json"))) {
  try {
    JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    failures.push(`Invalid JSON: ${path.relative(root, file)} (${error.message})`);
  }
}

const markdownFiles = allFiles.filter((file) => file.endsWith(".md"));
const markdownLinkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
for (const file of markdownFiles) {
  const content = await readFile(file, "utf8");
  for (const match of content.matchAll(markdownLinkPattern)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, "");
    if (!rawTarget || rawTarget.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)) continue;
    const relativeTarget = decodeURIComponent(rawTarget.split("#", 1)[0]);
    const resolved = path.resolve(path.dirname(file), relativeTarget);
    if (!await exists(path.relative(root, resolved))) {
      failures.push(`Broken local link in ${path.relative(root, file)}: ${rawTarget}`);
    }
  }
}

const disallowedExtensions = new Set([".mib", ".my", ".smiv1", ".smiv2"]);
for (const file of allFiles) {
  if (!disallowedExtensions.has(path.extname(file).toLowerCase())) continue;
  const relative = path.relative(root, file);
  const allowedFixture = relative.startsWith(path.join("experiments", "parser-bakeoff", "fixtures", "redistributable"))
    || relative.startsWith(path.join("data", "mibs", "redistributable"))
    || relative.startsWith(path.join("data", "staging", "license-derived"))
    || (
      relative.startsWith(path.join("experiments", "parser-bakeoff", "corpus", "MIBVENDOR-"))
      && await exists(path.join("experiments", "parser-bakeoff", "corpus", "LICENSE.md"))
    );
  if (!allowedFixture) failures.push(`Unreviewed MIB-like file outside redistributable fixtures: ${relative}`);
}

const prototypeHtml = await readFile(path.join(root, "prototype", "index.html"), "utf8");
const prototypeApp = await readFile(path.join(root, "prototype", "app.js"), "utf8");
const htmlIds = new Set([...prototypeHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
for (const match of prototypeApp.matchAll(/querySelector\("#([^"]+)"\)/g)) {
  if (!htmlIds.has(match[1])) failures.push(`Prototype selector has no matching HTML id: #${match[1]}`);
}
if (!prototypeHtml.includes('<html lang="en">')) failures.push("Prototype must declare its document language");
if (!prototypeHtml.includes('name="viewport"')) failures.push("Prototype must include a responsive viewport");
for (const requiredCopy of [
  "Local walk parsing",
  "No device connections",
  "Public API",
  "Permanently free",
  "open source on GitHub"
]) {
  if (!prototypeHtml.includes(requiredCopy)) failures.push(`Prototype is missing required trust copy: ${requiredCopy}`);
}
for (const requiredDeveloperCopy of [
  "Developer API",
  "Free · Public alpha",
  "free abuse-control credentials only",
  "fair-use bounded, not unlimited use or an availability SLA",
  "no availability SLA",
  "RateLimit-*",
  "Retry-After",
  "Cache-Control",
  "ETag",
  "/v1/resolve:batch",
  "/v1/enterprises/{number}",
  "/v1/sys-object-ids/{oid}",
  "OpenAPI 3.1 specification",
  "/v1/modules/{module}/raw",
  "/v1/sources"
]) {
  if (!prototypeHtml.includes(requiredDeveloperCopy)) failures.push(`Prototype is missing developer-preview copy: ${requiredDeveloperCopy}`);
}

const freeApiDecision = await readFile(path.join(root, "docs", "decisions", "0009-permanently-free-api.md"), "utf8");
const openApiDocument = JSON.parse(await readFile(path.join(root, "docs", "research", "demand", "phase0-openapi.json"), "utf8"));
const accessPolicy = openApiDocument["x-mibvendor-access-policy"];
if (!freeApiDecision.includes("permanently free") || !freeApiDecision.includes("free abuse-control credentials only")) {
  failures.push("ADR 0009 must preserve the permanently-free and optional-key boundaries");
}
if (accessPolicy?.access !== "permanently-free" || accessPolicy?.paid_tiers !== false || accessPolicy?.billing !== false) {
  failures.push("OpenAPI permanently-free access policy drifted");
}
if (accessPolicy?.unlimited_use !== false || accessPolicy?.availability_sla !== false || accessPolicy?.authentication?.required !== false || accessPolicy?.authentication?.optional_keys !== "free-abuse-control-only") {
  failures.push("OpenAPI fair-use, SLA, or optional-key boundary drifted");
}

if (failures.length) {
  for (const failure of failures) console.error(`ERROR: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Repository checks passed (${allFiles.length} files, ${markdownFiles.length} Markdown documents).`);
}
