import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, app, styles] = await Promise.all([
  readFile(new URL("../prototype/index.html", import.meta.url), "utf8"),
  readFile(new URL("../prototype/app.js", import.meta.url), "utf8"),
  readFile(new URL("../prototype/styles.css", import.meta.url), "utf8")
]);

test("device identity workbench collects only bounded individual signals", () => {
  assert.match(html, /id="device-identity"/);
  assert.match(html, /id="device-identity-form"[^>]*action="\/v1\/device-identities:assess"[^>]*method="post"/);
  assert.match(html, /name="sys_object_id"[^>]*maxlength="512"/);
  assert.match(html, /name="ent_physical_vendor_type"[^>]*maxlength="512"/);
  assert.match(html, /name="ent_physical_model_name"[^>]*maxlength="256"/);
  assert.match(html, /name="sys_descr"[^>]*maxlength="2048"/);
  assert.match(html, /Optional corroborating signals/);
  assert.match(html, /No SNMP walk upload/);
  assert.match(html, /processed for this request and is not stored or echoed/);
  assert.match(html, /Remove hostnames, serial numbers, addresses, and customer identifiers/);
  assert.doesNotMatch(html.slice(html.indexOf('id="device-identity"'), html.indexOf('<div class="intelligence-grid">')), /type="file"|community string|credential/i);
  assert.match(html, /<code>identity_release<\/code>/);
  assert.match(html, /<strong>16 KiB<\/strong> identity request/);
  assert.match(html, /<strong>32 \+ 32<\/strong> candidates \/ conflicts/);
  assert.match(html, /<strong>4 units<\/strong> identity assessment/);
  assert.match(html, /<strong>120<\/strong> fair-use units \/ minute/);
  assert.match(html, /id="api-identity-example"/);
  assert.match(html, /Copy identity request/);
  assert.match(html, /documented, bounded OID and identity fields/);
  assert.doesNotMatch(html, /Safe input:<\/strong> send bounded numeric OIDs only/);
});

test("workbench exposes honest outcomes, evidence layers, and direct organization fields", () => {
  for (const copy of [
    "exact model",
    "product family",
    "generic vendor identifier",
    "platform",
    "vendor-only",
    "conflicting evidence",
    "unknown outcomes",
    "Registry assignment",
    "vendor-MIB assignments",
    "project observation"
  ]) assert.ok(html.toLowerCase().includes(copy.toLowerCase()), `missing workbench copy: ${copy}`);

  for (const copy of [
    "Registry",
    "Vendor-MIB factual metadata",
    "Open-source device definitions",
    "Open-source platform-prefix definitions",
    "Device-reported signal",
    "Project fixture observation",
    "Not reviewed / unavailable",
    "Organization key",
    "PEN"
  ]) assert.ok(app.includes(copy), `missing rendered evidence field: ${copy}`);

  assert.match(app, /organization_key_status/);
  assert.match(app, /vendor_identifier: "Vendor MIB identifier"/);
  assert.match(app, /assessment\.mib_identifier/);
  assert.match(app, /"Vendor MIB identifier", assessment\.mib_identifier/);
  assert.match(app, /Identity release SHA-256/);
  assert.match(app, /Identity view/);
  assert.match(app, /Control revision/);
  assert.match(app, /publication_control\?\.control_revision/);
  assert.doesNotMatch(app, /organization_key\s*\?\?\s*`?pen:/i);
  assert.match(app, /Observed means a project fixture corroborates one device observation; it is not a universal mapping/);
  assert.match(app, /A longest, arc-bound sysObjectID prefix identifies an agent platform only/);
  assert.match(app, /an exact OID claim takes precedence/);
  assert.match(app, /entry\?\.publication_mode === "definition-only"/);
  assert.match(app, /entry\?\.match_type === "prefix"/);
  assert.ok(app.indexOf('return "prefix"') < app.indexOf('return "definition"'), "prefix evidence must remain a distinct layer even when publication is definition-only");
  assert.ok(app.indexOf('return "definition"') < app.indexOf('return "vendor"'), "definition-only evidence must be classified before vendor fallback");
});

test("workbench submits the documented same-origin request and never renders raw signal values", () => {
  assert.match(app, /fetch\("\/v1\/device-identities:assess"/);
  assert.match(app, /body: JSON\.stringify\(\{ signals \}\)/);
  assert.match(app, /headers: \{ accept: "application\/json", "content-type": "application\/json" \}/);
  assert.match(app, /if \(!Object\.keys\(signals\)\.length\)/);
  assert.match(app, /deviceIdentityResult\.setAttribute\("aria-busy", "true"\)/);
  assert.match(app, /deviceIdentityResult\.focus\(\)/);
  assert.match(app, /const MAX_IDENTITY_CANDIDATES = 32/);
  assert.match(app, /const MAX_IDENTITY_EVIDENCE = 128/);
  assert.match(app, /return url\.protocol === "https:" \? url\.href : null/);
  assert.match(app, /raw MIB: unavailable/);
  assert.match(app, /matched prefix/);
  assert.match(app, /source date/);
  assert.match(app, /source revision/);

  const safeSummary = app.slice(app.indexOf("function safeIdentitySummary"), app.indexOf("function renderIdentityAssessment"));
  assert.doesNotMatch(safeSummary, /sys_descr|ent_physical_model_name|ent_physical_vendor_type/);
  assert.match(safeSummary, /mib_identifier/);
  assert.match(safeSummary, /identity_release_sha256/);
  assert.match(safeSummary, /identity_view/);
  assert.match(safeSummary, /publication_control_revision/);
  assert.match(safeSummary, /firmware_scope/);
  const renderer = app.slice(app.indexOf("function renderIdentityAssessment"), app.indexOf("function renderIdentityFailure"));
  assert.match(renderer, /replaceChildren\(\)/);
  assert.match(renderer, /textContent/);
  assert.doesNotMatch(renderer, /innerHTML|insertAdjacentHTML|\.raw\b|sys_descr/);
  assert.match(renderer, /Firmware scope/);
  assert.match(renderer, /Not established/);
  assert.match(renderer, /Matched prefix/);
  assert.match(renderer, /Source revision/);
  assert.match(renderer, /Source date/);
});

test("workbench keeps quick examples, copying, the legacy exact route, and mobile navigation", () => {
  for (const example of ["arista-eos-prefix", "racktables-sg300", "c9300-24t", "c9300-observed", "cisco-unknown"]) {
    assert.ok(html.includes(`data-identity-example="${example}"`));
    assert.ok(app.includes(`"${example}"`));
  }
  assert.match(app, /1\.3\.6\.1\.4\.1\.9\.1\.2435/);
  assert.match(app, /1\.3\.6\.1\.4\.1\.9\.1\.2494/);
  assert.match(app, /1\.3\.6\.1\.4\.1\.9\.6\.1\.83\.10\.1/);
  assert.match(app, /1\.3\.6\.1\.4\.1\.30065\.1\.99/);
  assert.match(app, /C9300-48P/);
  assert.match(app, /navigator\.clipboard\.writeText\(JSON\.stringify\(safeSummary/);
  assert.match(html, /id="sysobjectid-form"/);
  assert.match(app, /loadSysObjectIdRoute/);
  assert.match(app, /\/sys-object-ids\//);
  assert.match(html, /RackTables-derived SG 300-10 exact definition/);
  assert.match(app, /result\.assessment\?\.candidates/);
  assert.match(app, /result\.assessment\?\.conflicts/);
  assert.match(app, /result\.assessment\?\.corroboration/);
  assert.match(app, /Candidate and conflict claims/);
  assert.match(app, /Project fixture observations/);
  assert.match(app, /candidate\.source_id/);
  assert.match(html, /Arista EOS descendant prefix/);
  assert.match(html, /href="\/#device-identity">Device identity/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.site-header nav[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.identity-evidence-grid[\s\S]*grid-template-columns: 1fr/);
  assert.match(styles, /@media \(max-width: 820px\)[\s\S]*\.workspace\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /\.sidebar-stack\s*\{[^}]*min-width: 0/s);
  assert.match(styles, /\.result-button strong\s*\{[^}]*overflow-wrap: anywhere/s);
  assert.match(styles, /\.example-panel\s*\{[^}]*overflow: hidden/s);
  assert.doesNotMatch(styles, /\.site-header nav a:not\(:first-child\)[^{]*\{[^}]*display:\s*none/s);
});

test("public identity counts distinguish claims, definitions, quarantines, and coverage", () => {
  assert.match(html, /6,391 distinct exact mapping keys/);
  assert.match(html, /36 reviewed vendor-MIB model normalizations/);
  assert.match(html, /270 medium-confidence open-source project model claims/);
  assert.match(html, /964 distinct OIDs/);
  assert.match(html, /Thirty-three source candidates remain quarantined/);
  assert.match(html, /four reviewed definition-observation overlaps remain explicit conflicts/);
  assert.match(html, /655 platform prefixes covering 406 platform labels and 266 PENs/);
  assert.match(html, /exact OID mapping always takes precedence/);
  assert.match(html, /never asserts a hardware model or product family/);
  assert.match(html, /358 prefix candidates remain quarantined/);
  assert.match(app, /Exact-model claims/);
  assert.match(app, /Open-source definition claims/);
  assert.doesNotMatch(app, /Reviewed exact models/);
});

test("prefix provenance is explicit and all dynamic route values stay escaped", () => {
  const collector = app.slice(app.indexOf("function collectIdentityEvidence"), app.indexOf("function appendEvidenceItem"));
  assert.match(collector, /match_type: item\.match_type \?\? candidate\.match_type/);
  assert.match(collector, /claim_scope: item\.claim_scope \?\? candidate\.claim_scope/);
  assert.match(collector, /platform: item\.platform \?\? candidate\.platform/);

  const evidenceRenderer = app.slice(app.indexOf("function appendEvidenceItem"), app.indexOf("function safeIdentitySummary"));
  assert.match(evidenceRenderer, /entry\.matched_oid/);
  assert.match(evidenceRenderer, /entry\.source_revision/);
  assert.match(evidenceRenderer, /entry\.source_date/);
  assert.match(evidenceRenderer, /safeHttpUrl/);
  assert.match(evidenceRenderer, /textContent|appendTextElement/);
  assert.doesNotMatch(evidenceRenderer, /innerHTML|insertAdjacentHTML/);

  const route = app.slice(app.indexOf("async function loadSysObjectIdRoute"), app.indexOf("async function loadReleaseRoute"));
  for (const field of ["Match type", "Matched prefix", "Claim scope", "Source revision", "Source date", "Publication basis"]) {
    assert.ok(route.includes(field), `missing route provenance field: ${field}`);
  }
  assert.match(route, /escapeHtml\(candidate\.oid\)/);
  assert.match(route, /escapeHtml\(provenance\.source_date\)/);
  assert.match(route, /escapeHtml\(provenance\.publication_basis\)/);
});

test("identity result is an accessible live region with explicit focus target", () => {
  assert.match(html, /id="device-identity-result"[^>]*aria-live="polite"[^>]*aria-atomic="true"[^>]*tabindex="-1"/);
  assert.match(html, /data-identity-example="c9300-24t"[^>]*aria-controls="device-identity-result"/);
  assert.match(styles, /\.identity-result:focus-visible/);
  assert.match(styles, /button:focus-visible,[\s\S]*input:focus-visible,[\s\S]*textarea:focus-visible/);
});
