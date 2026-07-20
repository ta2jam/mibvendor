import { records } from "./data.mjs";
import { classifySearchQuery, parseOid, parseWalk } from "./core.mjs";

const queryInput = document.querySelector("#query");
const searchForm = document.querySelector("#search");
const detail = document.querySelector("#object-detail");
const objectPath = document.querySelector("#object-path");
const searchResults = document.querySelector("#search-results");
const walkInput = document.querySelector("#walk-input");
const walkResults = document.querySelector("#walk-results");
const walkCaption = document.querySelector("#walk-caption");
const decoderSummary = document.querySelector("#decoder-summary");
const enterpriseForm = document.querySelector("#enterprise-form");
const sysObjectIdForm = document.querySelector("#sysobjectid-form");
const deviceIdentityForm = document.querySelector("#device-identity-form");
const deviceIdentityResult = document.querySelector("#device-identity-result");
const deviceIdentitySysObjectId = document.querySelector("#identity-sys-object-id");
const deviceIdentityVendorType = document.querySelector("#identity-vendor-type");
const deviceIdentityModelName = document.querySelector("#identity-model-name");
const deviceIdentitySysDescr = document.querySelector("#identity-sys-descr");
const dependencyForm = document.querySelector("#dependency-form");
const catalogForm = document.querySelector("#catalog-search");
const catalogQuery = document.querySelector("#catalog-query");
const catalogResults = document.querySelector("#catalog-results");
const catalogStats = document.querySelector("#catalog-stats");
const routeView = document.querySelector("#route-view");
const routeContent = document.querySelector("#route-content");
const routeKind = document.querySelector("#route-kind");
const canonicalUrl = document.querySelector("#canonical-url");
const apiLiveFirst = document.querySelector("#api-live-first");
const apiLiveNext = document.querySelector("#api-live-next");
const apiLiveStatus = document.querySelector("#api-live-status");
const apiLiveResponse = document.querySelector("#api-live-response");
let routeGeneration = 0;
let apiLiveNextCursor = null;
const MAX_IDENTITY_CANDIDATES = 32;
const MAX_IDENTITY_EVIDENCE = 128;
const MAX_IDENTITY_EVIDENCE_PER_LAYER = 16;

function stableObjectPath(record) {
  const id = record.id ?? `${record.module.toLowerCase()}--${record.symbol.toLowerCase()}`;
  return `/objects/${encodeURIComponent(id)}`;
}

function canonicalPath(pathname = window.location.pathname, search = window.location.search) {
  return new URL(`${pathname}${search}`, "https://mibvendor.io").href;
}

function setCanonical(pathname, search = "") {
  canonicalUrl.href = canonicalPath(pathname, search);
}

function navigate(path, { replace = false } = {}) {
  const target = new URL(path, window.location.origin);
  if (target.origin !== window.location.origin) return;
  window.history[replace ? "replaceState" : "pushState"]({}, "", `${target.pathname}${target.search}`);
  renderCurrentRoute();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function appendTextElement(parent, tagName, text, className = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = String(text);
  parent.append(element);
  return element;
}

function appendDefinition(list, term, value, { code = false } = {}) {
  if (value === null || value === undefined || value === "") return;
  const item = document.createElement("div");
  appendTextElement(item, "dt", term);
  const definition = appendTextElement(item, "dd", value);
  if (code) definition.classList.add("identity-code");
  list.append(item);
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

const identityOutcomeLabels = {
  exact_model: "Exact model",
  product_family: "Product family",
  vendor_identifier: "Vendor MIB identifier",
  platform: "Platform",
  vendor_only: "Vendor only",
  conflicting_evidence: "Conflicting evidence",
  conflict: "Conflicting evidence",
  ambiguous: "Conflicting evidence",
  unknown: "Unknown"
};

function normalizeIdentityOutcome(assessment) {
  const raw = String(assessment.identity_status ?? assessment.outcome ?? assessment.status ?? "unknown")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_");
  if (identityOutcomeLabels[raw]) return raw;
  if (raw === "resolved") {
    if (assessment.model) return "exact_model";
    if (assessment.product_family) return "product_family";
    if (assessment.mib_identifier) return "vendor_identifier";
    if (assessment.platform) return "platform";
    return "vendor_only";
  }
  if (raw === "enterprise_only") return "vendor_only";
  return "unknown";
}

function identityEvidenceCategory(entry) {
  const discriminator = [
    entry?.category,
    entry?.layer,
    entry?.kind,
    entry?.type,
    entry?.evidence_type,
    entry?.source_type,
    entry?.signal,
    entry?.source,
    entry?.source_id,
    entry?.provenance?.source
  ].filter(Boolean).join(" ").toLowerCase();
  if (/fixture|observation|project/.test(discriminator)) return "project";
  if (/registry|iana|enterprise|\bpen\b/.test(discriminator)) return "registry";
  if (/device|reported|entphysical/.test(discriminator)) return "device";
  if (entry?.source_id || entry?.publication_mode || typeof entry?.raw_download === "boolean" || /vendor|mib|metadata/.test(discriminator)) return "vendor";
  if (typeof entry?.signal === "string" || /device|reported|entphysical|signal/.test(discriminator)) return "device";
  return "vendor";
}

function collectIdentityEvidence(assessment) {
  const evidence = Array.isArray(assessment.evidence) ? assessment.evidence.filter((item) => item && typeof item === "object") : [];
  const candidates = Array.isArray(assessment.candidates) ? assessment.candidates : [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate?.evidence)) {
      for (const item of candidate.evidence) {
        if (item && typeof item === "object") evidence.push(item);
      }
    }
  }
  for (const item of Array.isArray(assessment.project_observations) ? assessment.project_observations : []) {
    if (item && typeof item === "object") evidence.push({ ...item, category: "project-observation" });
  }
  const hasRegistryEvidence = evidence.some((entry) => identityEvidenceCategory(entry) === "registry");
  if (!hasRegistryEvidence && assessment.enterprise && typeof assessment.enterprise === "object") {
    evidence.push({ ...assessment.enterprise, category: "registry" });
  } else if (!hasRegistryEvidence && assessment.enterprise_number !== null && assessment.enterprise_number !== undefined) {
    evidence.push({
      category: "registry",
      label: "IANA enterprise registry",
      enterprise_number: assessment.enterprise_number,
      organization_name: assessment.organization_name,
      organization_key_status: assessment.organization_key_status
    });
  }
  return evidence.slice(0, MAX_IDENTITY_EVIDENCE);
}

function appendEvidenceItem(list, entry) {
  const item = document.createElement("li");
  const signalLabels = {
    sys_object_id: "sysObjectID signal",
    ent_physical_vendor_type: "entPhysicalVendorType signal",
    ent_physical_model_name: "entPhysicalModelName signal",
    sys_descr: "sysDescr classification signal"
  };
  const typeLabels = {
    "iana-pen-registry": "IANA enterprise registry",
    "project-fixture-corroboration": "Project fixture observation",
    "device-reported-model": "Device-reported model"
  };
  const sourceLabels = { "iana-pen": "IANA PEN registry" };
  const title = entry.label ?? entry.source ?? sourceLabels[entry.source_id] ?? entry.source_id ?? entry.provenance?.source ?? signalLabels[entry.signal] ?? typeLabels[entry.type] ?? "Evidence record";
  appendTextElement(item, "strong", title);
  const mibEvidence = entry.publication_mode === "metadata-only" || /mib/i.test(`${entry.type ?? ""} ${entry.source_id ?? ""}`);
  const facts = [
    entry.claim_strength && `claim: ${entry.claim_strength}`,
    entry.identity_status && `scope: ${entry.identity_status}`,
    entry.model && `model: ${entry.model}`,
    entry.product_family && `family: ${entry.product_family}`,
    entry.mib_identifier && `MIB identifier: ${entry.mib_identifier}`,
    entry.platform && `platform: ${entry.platform}`,
    entry.oid && `OID: ${entry.oid}`,
    entry.enterprise_number !== null && entry.enterprise_number !== undefined && `PEN ${entry.enterprise_number}`,
    entry.organization_name && `organization: ${entry.organization_name}`,
    entry.organization_key_status && `organization key: ${entry.organization_key_status}`,
    entry.registry_status && `registry: ${entry.registry_status}`,
    entry.evidence_state && `evidence: ${entry.evidence_state}`,
    Number.isSafeInteger(entry.candidate_count) && `observed candidates: ${entry.candidate_count}`,
    entry.corroborates_reported_model === true && "corroborates reported model",
    entry.match_type && `match: ${entry.match_type}`,
    entry.publication_mode && `publication: ${entry.publication_mode}`,
    mibEvidence && entry.raw_download === false && "raw MIB: unavailable",
    mibEvidence && entry.raw_download === true && "raw MIB: available",
    entry.source_revision && `revision: ${entry.source_revision}`,
    entry.artifact_sha256 && `SHA-256: ${entry.artifact_sha256}`
  ].filter(Boolean);
  appendTextElement(item, "span", facts.length ? facts.join(" · ") : "Returned without an additional public claim.");
  const sourceUrl = safeHttpUrl(entry.source_url ?? entry.provenance?.source_url);
  if (sourceUrl) {
    const link = appendTextElement(item, "a", "Source");
    link.href = sourceUrl;
    link.rel = "noopener noreferrer";
  }
  list.append(item);
}

function appendIdentityCandidate(list, candidate, index, kind = "candidate") {
  const item = document.createElement("li");
  item.className = "identity-candidate";
  const title = candidate.model ?? candidate.product_family ?? candidate.mib_identifier ?? candidate.platform ?? candidate.organization_name ?? candidate.vendor ?? `${kind === "conflict" ? "Conflicting claim" : "Candidate"} ${index + 1}`;
  appendTextElement(item, "strong", title);
  const classification = candidate.identity_status ?? candidate.classification ?? candidate.claim_strength;
  if (classification) appendTextElement(item, "span", identityOutcomeLabels[classification] ?? String(classification).replaceAll("_", " "), "identity-candidate-kind");
  const facts = [
    candidate.enterprise_number !== null && candidate.enterprise_number !== undefined ? `PEN ${candidate.enterprise_number}` : null,
    candidate.organization_key ? `organization key ${candidate.organization_key}` : null,
    candidate.product_family && candidate.product_family !== title ? candidate.product_family : null,
    candidate.mib_identifier && candidate.mib_identifier !== title ? `MIB identifier ${candidate.mib_identifier}` : null,
    candidate.platform && candidate.platform !== title ? candidate.platform : null,
    candidate.firmware_scope === "not_established" ? "firmware scope not established" : null,
    Array.isArray(candidate.enterprise_numbers) ? `PENs ${candidate.enterprise_numbers.join(", ")}` : null,
    Array.isArray(candidate.models) ? `models ${candidate.models.join(", ")}` : null,
    candidate.match_type ? `match ${candidate.match_type}` : null,
    candidate.claim_scope ? `scope ${candidate.claim_scope}` : null,
    candidate.source_assignment_confidence ? `source assignment ${candidate.source_assignment_confidence}` : null,
    candidate.confidence ? `confidence ${candidate.confidence}` : null
  ].filter(Boolean);
  if (facts.length) appendTextElement(item, "small", facts.join(" · "));
  list.append(item);
}

function safeIdentitySummary(body, assessment, outcome) {
  return {
    data_release: body.data_release ?? null,
    identity_release: body.identity_release ?? assessment.identity_release ?? null,
    identity_release_sha256: assessment.identity_release_sha256 ?? body.identity_release_sha256 ?? null,
    identity_view: assessment.identity_view ?? body.identity_view ?? null,
    publication_control_revision: assessment.publication_control?.control_revision ?? body.publication_control?.control_revision ?? null,
    identity_status: outcome,
    enterprise_number: assessment.enterprise_number ?? assessment.enterprise?.number ?? null,
    organization_name: assessment.organization_name ?? assessment.enterprise?.organization ?? null,
    organization_key: assessment.organization_key ?? null,
    organization_key_status: assessment.organization_key_status ?? (assessment.organization_key ? "reviewed" : "unreviewed"),
    model: assessment.model ?? null,
    product_family: assessment.product_family ?? null,
    mib_identifier: assessment.mib_identifier ?? null,
    platform: assessment.platform ?? null,
    firmware_scope: assessment.firmware_scope ?? null,
    confidence: assessment.confidence ?? null
  };
}

function renderIdentityAssessment(body) {
  const assessment = body?.assessment ?? body?.result ?? body ?? {};
  const outcome = normalizeIdentityOutcome(assessment);
  const safeSummary = safeIdentitySummary(body ?? {}, assessment, outcome);
  deviceIdentityResult.replaceChildren();
  deviceIdentityResult.className = `identity-result identity-result-${outcome}`;

  const header = document.createElement("header");
  const headingGroup = document.createElement("div");
  appendTextElement(headingGroup, "p", "Assessment outcome", "eyebrow");
  appendTextElement(headingGroup, "h4", identityOutcomeLabels[outcome]);
  header.append(headingGroup);
  const copyButton = appendTextElement(header, "button", "Copy result", "secondary identity-copy");
  copyButton.type = "button";
  copyButton.addEventListener("click", async () => {
    if (!navigator.clipboard?.writeText) {
      copyButton.textContent = "Copy unavailable";
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(safeSummary, null, 2));
      copyButton.textContent = "Copied";
    } catch {
      copyButton.textContent = "Copy denied";
    }
  });
  deviceIdentityResult.append(header);

  const facts = document.createElement("dl");
  facts.className = "identity-result-facts";
  appendDefinition(facts, "Model", assessment.model ?? (outcome === "exact_model" ? "Exact model not returned" : null));
  appendDefinition(facts, "Product family", assessment.product_family);
  appendDefinition(facts, "Vendor MIB identifier", assessment.mib_identifier, { code: true });
  appendDefinition(facts, "Platform", assessment.platform);
  appendDefinition(
    facts,
    "Firmware scope",
    assessment.firmware_scope === "not_established"
      ? "Not established"
      : "Not applicable — no singular identity result"
  );
  appendDefinition(facts, "PEN", assessment.enterprise_number ?? assessment.enterprise?.number, { code: true });
  appendDefinition(facts, "Organization", assessment.organization_name ?? assessment.enterprise?.organization);
  appendDefinition(facts, "Organization key", assessment.organization_key ?? "Not reviewed / unavailable", { code: Boolean(assessment.organization_key) });
  appendDefinition(facts, "Organization-key status", assessment.organization_key_status ?? (assessment.organization_key ? "reviewed" : "unreviewed"));
  appendDefinition(facts, "Confidence", assessment.confidence);
  appendDefinition(facts, "Identity release", body?.identity_release ?? assessment.identity_release, { code: true });
  appendDefinition(facts, "Identity release SHA-256", assessment.identity_release_sha256 ?? body?.identity_release_sha256, { code: true });
  appendDefinition(facts, "Identity view", assessment.identity_view ?? body?.identity_view, { code: true });
  appendDefinition(facts, "Control revision", assessment.publication_control?.control_revision ?? body?.publication_control?.control_revision, { code: true });
  deviceIdentityResult.append(facts);

  const boundary = document.createElement("p");
  boundary.className = "identity-boundary";
  boundary.textContent = outcome === "conflicting_evidence" || outcome === "conflict" || outcome === "ambiguous"
    ? "Signals disagree. No singular device identity is asserted."
    : outcome === "vendor_only"
      ? "The enterprise is known, but this response does not prove a product family or model."
      : outcome === "vendor_identifier"
        ? "The exact vendor MIB symbol is known, but it may denote a device, chassis, module, line card, or component. No whole-device model or family is asserted."
      : outcome === "unknown"
        ? "No supported identity claim was found. Nothing is inferred from a numeric prefix alone."
        : "Exact means the cited source supports that scope. Observed means a project fixture corroborates one device observation; it is not a universal mapping.";
  deviceIdentityResult.append(boundary);

  const candidates = Array.isArray(assessment.candidates)
    ? assessment.candidates.filter((item) => item && typeof item === "object").slice(0, MAX_IDENTITY_CANDIDATES)
    : [];
  const conflicts = Array.isArray(assessment.conflicts)
    ? assessment.conflicts.filter((item) => item && typeof item === "object").slice(0, MAX_IDENTITY_CANDIDATES)
    : [];
  if (candidates.length || conflicts.length) {
    const candidateSection = document.createElement("section");
    appendTextElement(candidateSection, "h5", conflicts.length ? "Candidate and conflict claims" : "Candidate claims");
    const list = document.createElement("ol");
    list.className = "identity-candidates";
    candidates.forEach((candidate, index) => appendIdentityCandidate(list, candidate, index));
    conflicts.forEach((candidate, index) => appendIdentityCandidate(list, candidate, index, "conflict"));
    candidateSection.append(list);
    deviceIdentityResult.append(candidateSection);
  }

  const evidenceSection = document.createElement("section");
  appendTextElement(evidenceSection, "h5", "Evidence and provenance");
  appendTextElement(evidenceSection, "p", "Registry assignment, vendor-MIB factual metadata, device-reported signals, and project observations remain separate.", "identity-evidence-note");
  const evidenceGrid = document.createElement("div");
  evidenceGrid.className = "identity-evidence-grid";
  const grouped = { registry: [], vendor: [], device: [], project: [] };
  for (const entry of collectIdentityEvidence(assessment)) grouped[identityEvidenceCategory(entry)].push(entry);
  for (const [category, title] of [
    ["registry", "Registry"],
    ["vendor", "Vendor-MIB factual metadata"],
    ["device", "Device-reported signal"],
    ["project", "Project fixture observation"]
  ]) {
    const card = document.createElement("article");
    appendTextElement(card, "h6", title);
    const list = document.createElement("ul");
    if (grouped[category].length) grouped[category].slice(0, MAX_IDENTITY_EVIDENCE_PER_LAYER).forEach((entry) => appendEvidenceItem(list, entry));
    else appendTextElement(list, "li", `No ${title.toLowerCase()} evidence returned.`);
    card.append(list);
    evidenceGrid.append(card);
  }
  evidenceSection.append(evidenceGrid);
  deviceIdentityResult.append(evidenceSection);
}

function renderIdentityFailure(message) {
  deviceIdentityResult.replaceChildren();
  deviceIdentityResult.className = "identity-result identity-result-error";
  const alert = document.createElement("div");
  alert.setAttribute("role", "alert");
  appendTextElement(alert, "strong", "Assessment unavailable");
  appendTextElement(alert, "p", message);
  deviceIdentityResult.append(alert);
}

function renderPath(record) {
  const oid = parseOid(record.oid) ?? [];
  const labels = ["iso(1)", "org(3)", "dod(6)", "internet(1)"];
  const tail = oid.slice(4).map((part, index) => {
    if (index === oid.length - 5) return `${record.symbol}(${part})`;
    return part;
  });
  objectPath.innerHTML = [...labels, ...tail]
    .map((part) => `<li>${escapeHtml(part)}</li>`)
    .join("");
}

const matchLabels = {
  "module-qualified": "Exact module + symbol",
  "exact-symbol": "Exact symbol",
  "numeric-exact": "Exact numeric OID",
  "numeric-instance": "Resolved object instance",
  "task-intent": "Monitoring task match",
  symbol: "Symbol match",
  related: "Related context"
};

function renderDetail(record, resultCount, resolved = null) {
  renderPath(record);
  const instance = resolved?.instance?.length ? resolved.instance.join(".") : null;
  const tableContext = record.table
    ? `<p><strong>Table:</strong> ${escapeHtml(record.table)} · <strong>Row:</strong> ${escapeHtml(record.parent)} · <strong>Index:</strong> ${escapeHtml(record.index)}</p><p>Query one row at <code>${escapeHtml(record.oid)}.&lt;${escapeHtml(record.index)}&gt;</code>, or walk the base column for all rows. Example index 7: <code>${escapeHtml(record.oid)}.7</code>.</p>`
    : record.kind === "scalar"
      ? `<p>This is a scalar. Query its single instance by appending <strong>.0</strong>.</p>`
      : record.kind === "notification" || record.kind === "notification-type"
        ? `<p>This is a notification, not a pollable object. Inspect its related varbind objects.</p>`
        : `<p>This node provides structure or identity in the module OID tree.</p>`;
  const enumContext = record.enumValues.length
    ? `<div class="enum-list" aria-label="Enumerated values">${record.enumValues.map((value) => `<code>${escapeHtml(value)}</code>`).join("")}</div>`
    : "";
  const syntaxFacts = [
    record.syntaxDetail.textualConvention && `<span><strong>TC</strong> ${escapeHtml(record.syntaxDetail.textualConvention)}</span>`,
    record.syntaxDetail.displayHint && `<span><strong>Display hint</strong> ${escapeHtml(record.syntaxDetail.displayHint)}</span>`,
    record.syntaxDetail.units && `<span><strong>Units</strong> ${escapeHtml(record.syntaxDetail.units)}</span>`,
    ...record.syntaxDetail.constraints.map((value) => `<span><strong>Constraint</strong> ${escapeHtml(value)}</span>`)
  ].filter(Boolean).join("");
  const notificationContext = record.notificationObjects.length
    ? `<p><strong>Notification objects:</strong> ${record.notificationObjects.map(escapeHtml).join(", ")}</p>`
    : "";
  const instanceFact = instance
    ? `<div class="fact"><dt>Query instance</dt><dd>${escapeHtml(instance)}${record.kind === "scalar" && instance === "0" ? " · scalar" : ""}</dd></div>`
    : `<div class="fact"><dt>Instance</dt><dd>${record.kind === "scalar" ? ".0 required" : record.table ? `${escapeHtml(record.index)} required` : "Not pollable"}</dd></div>`;

  detail.innerHTML = `
    <div class="detail-header">
      <div>
        <p class="eyebrow">Best match${resultCount > 1 ? ` · ${resultCount - 1} related result(s)` : ""}</p>
        <h2>${escapeHtml(record.symbol)}</h2>
        <p class="module-symbol">${escapeHtml(record.module)}::${escapeHtml(record.symbol)}</p>
      </div>
      <div>
        <span class="status-badge">${escapeHtml(record.kind)}</span>
        <span class="source-badge">Provenance included</span>
      </div>
    </div>
    <dl class="fact-grid">
      <div class="fact"><dt>OID</dt><dd class="oid-value">${escapeHtml(record.oid)}</dd></div>
      ${instanceFact}
      <div class="fact"><dt>Access</dt><dd>${escapeHtml(record.access)}</dd></div>
      <div class="fact"><dt>Status</dt><dd>${escapeHtml(record.status)}</dd></div>
      <div class="fact"><dt>Revision</dt><dd>${escapeHtml(record.revision)}</dd></div>
      <div class="fact"><dt>Source</dt><dd><a href="${escapeHtml(record.sourceUrl)}">${escapeHtml(record.source)}</a></dd></div>
      <div class="fact"><dt>Parse status</dt><dd>${escapeHtml(record.parseStatus)}</dd></div>
      <div class="fact"><dt>Rights</dt><dd>${escapeHtml(record.rightsTier)}</dd></div>
      <div class="fact"><dt>Data release</dt><dd>${escapeHtml(record.dataRelease)}</dd></div>
    </dl>
    <div class="detail-columns">
      <section class="context-card">
        <h3>What it means</h3>
        <p>${escapeHtml(record.description)}</p>
        <p><strong>Syntax:</strong> ${escapeHtml(record.syntaxDetail.base)}</p>
        ${syntaxFacts ? `<div class="syntax-facts">${syntaxFacts}</div>` : ""}
        ${enumContext}
      </section>
      <section class="context-card">
        <h3>Instance and table context</h3>
        ${tableContext}
      </section>
      <section class="context-card">
        <h3>Usable command</h3>
        <pre class="command"><code>${escapeHtml(record.command)}</code></pre>
      </section>
      <section class="context-card">
        <h3>Related objects</h3>
        <ul>${record.related.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        ${notificationContext}
      </section>
      <section class="context-card provenance-card">
        <h3>Why this result is available</h3>
        <p>Source checked ${escapeHtml(record.sourceChecked)}. Rights tier ${escapeHtml(record.rightsTier)} permits: ${record.rightsScopes.map(escapeHtml).join(", ")}.</p>
        <p>Prototype data release: <code>${escapeHtml(record.dataRelease)}</code>.</p>
      </section>
      <section class="context-card verification-card">
        <h3>Before using it</h3>
        <p>A MIB definition does not prove that a device or firmware exposes the object. Test the numeric target against an authorized device and verify the returned type and index.</p>
      </section>
    </div>
  `;
}

function apiObjectToRecord(object, dataRelease) {
  const relationships = object.relationships ?? {};
  const syntax = object.syntax ?? {};
  const provenance = object.provenance ?? {};
  const kind = object.kind === "object-type" && object.access && object.access !== "not-accessible" ? "column" : object.kind;
  const command = kind === "notification" || kind === "notification-type"
    ? "# Notification OID; inspect its varbind objects instead of polling this OID."
    : `snmpget -v2c -c <community> <host> ${object.oid}${kind === "scalar" ? ".0" : ".<instance>"}`;
  return {
    id: object.id,
    module: object.module,
    symbol: object.symbol,
    oid: object.oid,
    kind,
    access: object.access ?? "not applicable",
    status: object.status ?? "not specified",
    syntax: syntax.raw ?? syntax.base ?? "not specified",
    syntaxDetail: {
      base: syntax.base ?? "not specified",
      textualConvention: syntax.textual_convention ?? null,
      displayHint: syntax.display_hint ?? null,
      units: syntax.units ?? null,
      constraints: syntax.constraints ?? [],
      enums: syntax.enums ?? {},
      bits: syntax.bits ?? {}
    },
    revision: object.revision ?? "not specified",
    source: provenance.source ?? "Source catalog",
    sourceUrl: provenance.source_url ?? "#catalog",
    sourceChecked: provenance.source_checked ?? provenance.source_revision ?? "active release",
    parseStatus: provenance.parse_status ?? "normalized",
    publicationStatus: provenance.publication_mode ?? "metadata-only",
    rightsTier: provenance.rights_tier ?? "rights reviewed",
    rightsScopes: provenance.raw_download ? ["metadata", "API output", "raw download"] : ["metadata", "API output"],
    dataRelease,
    parent: relationships.parent ?? null,
    table: relationships.table ?? null,
    row: relationships.row ?? null,
    index: relationships.indexes?.[0] ?? null,
    notificationObjects: relationships.notification_objects ?? [],
    related: [],
    intent: [],
    description: object.description?.text ?? "No description is present in the approved source module.",
    enumValues: Object.entries(syntax.enums ?? {}).map(([number, name]) => `${name}(${number})`),
    command
  };
}

enterpriseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const number = document.querySelector("#enterprise-number").value.trim();
  navigate(`/enterprises/${encodeURIComponent(number)}`);
});

sysObjectIdForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const oid = document.querySelector("#sysobjectid").value.trim();
  navigate(`/sys-object-ids/${encodeURIComponent(oid)}`);
});

const identityExamples = {
  "c9300-24t": {
    sys_object_id: "1.3.6.1.4.1.9.1.2435",
    ent_physical_vendor_type: "",
    ent_physical_model_name: "",
    sys_descr: ""
  },
  "c9300-observed": {
    sys_object_id: "1.3.6.1.4.1.9.1.2494",
    ent_physical_vendor_type: "",
    ent_physical_model_name: "C9300-48P",
    sys_descr: ""
  },
  "cisco-unknown": {
    sys_object_id: "1.3.6.1.4.1.9.999999",
    ent_physical_vendor_type: "",
    ent_physical_model_name: "",
    sys_descr: ""
  }
};

function setIdentitySignals(signals) {
  deviceIdentitySysObjectId.value = signals.sys_object_id;
  deviceIdentityVendorType.value = signals.ent_physical_vendor_type;
  deviceIdentityModelName.value = signals.ent_physical_model_name;
  deviceIdentitySysDescr.value = signals.sys_descr;
  const optional = deviceIdentityForm.querySelector(".identity-signals");
  optional.open = Boolean(signals.ent_physical_vendor_type || signals.ent_physical_model_name || signals.sys_descr);
  deviceIdentitySysObjectId.focus();
}

document.querySelectorAll("[data-identity-example]").forEach((button) => {
  button.addEventListener("click", () => {
    const signals = identityExamples[button.dataset.identityExample];
    if (signals) setIdentitySignals(signals);
  });
});

document.querySelector("#device-identity-clear").addEventListener("click", () => {
  setIdentitySignals({ sys_object_id: "", ent_physical_vendor_type: "", ent_physical_model_name: "", sys_descr: "" });
  deviceIdentityResult.className = "identity-result identity-result-empty";
  deviceIdentityResult.replaceChildren();
  const lead = appendTextElement(deviceIdentityResult, "p", "");
  appendTextElement(lead, "strong", "No assessment yet.");
  appendTextElement(deviceIdentityResult, "p", "Results distinguish exact model, product family, platform, vendor-only, conflicting evidence, and unknown outcomes.");
});

deviceIdentityForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const signals = {
    sys_object_id: deviceIdentitySysObjectId.value.trim(),
    ent_physical_vendor_type: deviceIdentityVendorType.value.trim(),
    ent_physical_model_name: deviceIdentityModelName.value.trim(),
    sys_descr: deviceIdentitySysDescr.value.trim()
  };
  for (const key of Object.keys(signals)) {
    if (!signals[key]) delete signals[key];
  }
  if (!Object.keys(signals).length) {
    renderIdentityFailure("Enter at least one supported identity signal.");
    deviceIdentityResult.focus();
    return;
  }

  const submit = deviceIdentityForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = "Assessing…";
  deviceIdentityResult.setAttribute("aria-busy", "true");
  deviceIdentityResult.replaceChildren();
  appendTextElement(deviceIdentityResult, "p", "Assessing bounded identity signals…", "lookup-loading");
  try {
    const response = await fetch("/v1/device-identities:assess", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ signals })
    });
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error(`The service returned non-JSON data (HTTP ${response.status}).`);
    }
    if (!response.ok) throw new Error(body.detail ?? `Assessment failed with HTTP ${response.status}`);
    renderIdentityAssessment(body);
  } catch (error) {
    renderIdentityFailure(error instanceof Error ? error.message : "The identity assessment failed.");
  } finally {
    submit.disabled = false;
    submit.textContent = "Assess identity";
    deviceIdentityResult.setAttribute("aria-busy", "false");
    deviceIdentityResult.focus();
  }
});

dependencyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const moduleName = document.querySelector("#module-name").value.trim();
  navigate(`/modules/${encodeURIComponent(moduleName)}`);
});

function renderCatalogModules(body) {
  if (!body.results.length) {
    catalogResults.innerHTML = '<div class="search-state"><strong>No rights-cleared module match</strong><span>Try a module fragment such as IANA, BFD, MPLS, or NET-SNMP.</span></div>';
    return;
  }
  catalogResults.innerHTML = body.results.map((module) => `
    <article class="module-card">
      <header>
        <h3>${escapeHtml(module.id)}</h3>
        <span class="rights-badge">${escapeHtml(module.publication_mode)}</span>
      </header>
      <p>${escapeHtml(module.publisher)} · ${module.resolved_oid_count.toLocaleString()} resolved OID nodes · revision ${escapeHtml(module.revision ?? "not specified")}</p>
      <small>Artifact SHA-256 <code>${escapeHtml(module.artifact_sha256.slice(0, 16))}…</code></small>
      <small>${escapeHtml(module.license.name)}</small>
      <div class="module-actions">
        <a href="/modules/${encodeURIComponent(module.id)}" data-route>Module detail</a>
        <a href="${escapeHtml(module.source_url)}">Official source</a>
        ${module.raw_download ? `<a href="${escapeHtml(module.raw_url)}">Download MIB + license bundle</a>` : ""}
      </div>
    </article>`).join("");
}

async function loadCatalog(query = "") {
  catalogResults.innerHTML = '<span class="lookup-loading">Loading rights-cleared modules…</span>';
  try {
    const [releaseResponse, modulesResponse] = await Promise.all([
      fetch("/v1/data-release", { headers: { accept: "application/json" } }),
      fetch(`/v1/modules?q=${encodeURIComponent(query)}&limit=12`, { headers: { accept: "application/json" } })
    ]);
    const release = await releaseResponse.json();
    const body = await modulesResponse.json();
    if (!releaseResponse.ok || !modulesResponse.ok) throw new Error(body.detail ?? "Catalog request failed");
    const stats = release.statistics;
    const moduleModes = stats.modules.publication_modes;
    const sourceModes = stats.sources.publication_modes;
    catalogStats.innerHTML = `
      <span><strong>${stats.modules.total.toLocaleString()}</strong>published MIB modules<small>${moduleModes.redistributable.toLocaleString()} redistributable · ${moduleModes["metadata-only"].toLocaleString()} metadata-only · ${moduleModes["directory-only"].toLocaleString()} directory-only</small></span>
      <span><strong>${stats.oid_nodes.catalog_oid_nodes.toLocaleString()}</strong>catalog OID nodes<small>Parsed from active published modules</small></span>
      <span><strong>${stats.oid_nodes.searchable_records.toLocaleString()}</strong>searchable records<small>${stats.oid_nodes.catalog_oid_nodes.toLocaleString()} catalog + ${stats.oid_nodes.supplemental_legacy_records.toLocaleString()} supplemental legacy records</small></span>
      <span><strong>${stats.definitions.textual_conventions.active_module_definitions.toLocaleString()}</strong>textual convention definitions<small>Present in active modules · ${stats.definitions.textual_conventions.searchable_records.toLocaleString()} searchable records</small></span>
      <span><strong>${stats.definitions.notifications.catalog_oid_nodes.toLocaleString()}</strong>catalog notifications<small>${stats.definitions.notifications.searchable_records.toLocaleString()} searchable including ${stats.definitions.notifications.supplemental_searchable_records.toLocaleString()} supplemental record</small></span>
      <span><strong>${stats.identity.enterprise_records.toLocaleString()}</strong>IANA enterprise records<small>Registry assignments, not device identities</small></span>
      <span><strong>${stats.identity.sys_object_id_mappings.toLocaleString()}</strong>exact sysObjectID mappings<small>Rights-approved identity evidence only</small></span>
      <span><strong>${stats.sources.total.toLocaleString()}</strong>published source records<small>${sourceModes.redistributable.toLocaleString()} redistributable · ${sourceModes["metadata-only"].toLocaleString()} metadata-only · ${sourceModes["directory-only"].toLocaleString()} directory-only</small></span>
      <span><strong><a href="/releases/${encodeURIComponent(release.data_release)}" data-route>${escapeHtml(release.data_release)}</a></strong>immutable data release</span>`;
    renderCatalogModules(body);
  } catch (error) {
    catalogResults.innerHTML = `<span class="unresolved">${escapeHtml(error.message)}</span>`;
  }
}

catalogForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loadCatalog(catalogQuery.value.trim());
});

function renderSearchState(title, copy) {
  searchResults.innerHTML = `<div class="search-state"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span></div>`;
}

function renderMatches(view) {
  searchResults.innerHTML = `<ol class="result-list">${view.matches.map(({ record, matchKind }, index) => `
    <li>
      <a class="result-button${index === 0 ? " is-active" : ""}" data-route href="${stableObjectPath(record)}" data-result-index="${index}" aria-current="${index === 0 ? "true" : "false"}">
        <span class="result-reason">${escapeHtml(matchLabels[matchKind] ?? "Related context")}</span>
        <strong>${escapeHtml(record.symbol)}</strong>
        <span>${escapeHtml(record.module)} · ${escapeHtml(record.kind)}</span>
        <code>${escapeHtml(record.oid)}</code>
      </a>
    </li>`).join("")}</ol>`;

  searchResults.querySelectorAll("[data-result-index]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      navigate(button.getAttribute("href"));
    });
  });
  renderDetail(view.matches[0].record, view.matches.length, view.resolved);
}

async function runSearch(query) {
  const normalized = String(query).trim();
  if (!normalized) {
    objectPath.innerHTML = "";
    renderSearchState("Enter a task, symbol, module, or OID", "Results will keep module, kind, numeric OID, source, and publication mode visible.");
    return;
  }
  if (/^\.?\d/.test(normalized) && !parseOid(normalized)) {
    objectPath.innerHTML = "";
    renderSearchState("Invalid numeric OID", "Use dot-separated non-negative integers, for example 1.3.6.1.2.1.1.3.0.");
    return;
  }
  searchResults.innerHTML = '<span class="lookup-loading">Searching the active OID release…</span>';
  try {
    const response = await fetch(`/v1/search?q=${encodeURIComponent(normalized)}`, { headers: { accept: "application/json" } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail ?? `Search failed with HTTP ${response.status}`);
    if (!body.results.length) {
      objectPath.innerHTML = "";
      renderSearchState("No match in this release", "Try a precise symbol, module-qualified name, numeric OID, or monitoring task. Unknown-rights content is not substituted.");
      detail.innerHTML = `<div class="detail-header"><div><p class="eyebrow">No selected object</p><h2>${escapeHtml(normalized)}</h2></div></div><p>The active release does not invent a vendor, device identity, or substitute OID.</p>`;
      return;
    }
    const matches = body.results.map((object) => ({ record: apiObjectToRecord(object, body.data_release), matchKind: "related" }));
    renderMatches({ matches, resolved: null });
  } catch (error) {
    const fallback = classifySearchQuery(normalized, records);
    if (fallback.state === "matches") renderMatches(fallback);
    else renderSearchState("Search unavailable", error.message);
  }
}

async function fetchApi(path) {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail ?? `Request failed with HTTP ${response.status}`);
  return body;
}

function openRoute(kind, title, copy = "") {
  document.body.classList.add("route-active");
  routeView.hidden = false;
  routeKind.textContent = kind;
  routeContent.innerHTML = `
    <div class="route-heading">
      <p class="eyebrow">${escapeHtml(kind)}</p>
      <h1>${escapeHtml(title)}</h1>
      ${copy ? `<p>${escapeHtml(copy)}</p>` : ""}
    </div>
    <p class="lookup-loading" role="status">Loading from the active release…</p>`;
  document.title = `${title} — mibvendor`;
  routeView.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "auto" });
}

function routeFailure(kind, title, error) {
  routeContent.innerHTML = `
    <div class="route-heading"><p class="eyebrow">${escapeHtml(kind)}</p><h1>${escapeHtml(title)}</h1></div>
    <div class="route-error" role="alert"><strong>View unavailable</strong><p>${escapeHtml(error.message)}</p><a href="/">Return home</a></div>`;
}

function objectLink(object, label = object.symbol) {
  return `<a href="${stableObjectPath(object)}" data-route>${escapeHtml(label)}</a>`;
}

function moduleLink(moduleName) {
  return `<a href="/modules/${encodeURIComponent(moduleName)}" data-route>${escapeHtml(moduleName)}</a>`;
}

function renderObjectRoute(body) {
  const navigation = body.navigation;
  const object = navigation.object;
  const syntax = object.syntax;
  const provenance = object.provenance;
  const ancestors = navigation.ancestors.length
    ? navigation.ancestors.map((ancestor) => `<li>${objectLink(ancestor)}<code>${escapeHtml(ancestor.oid)}</code></li>`).join("")
    : "<li>No represented ancestor exists in this release.</li>";
  const children = navigation.direct_children.results.length
    ? navigation.direct_children.results.map((child) => `<li>${objectLink(child)}<span>${escapeHtml(child.kind)}</span><code>${escapeHtml(child.oid)}</code></li>`).join("")
    : "<li>No represented direct child.</li>";
  const subtree = navigation.subtree.nodes.length
    ? navigation.subtree.nodes.map((node) => `<li style="--tree-depth:${node.depth}">${objectLink(node.object)}<span>${node.direct_child_count.toLocaleString()} direct child(ren)</span></li>`).join("")
    : "<li>No represented descendants.</li>";
  const source = provenance.source_url
    ? `<a href="${escapeHtml(provenance.source_url)}">${escapeHtml(provenance.source ?? "Official source")}</a>`
    : escapeHtml(provenance.source ?? "Not specified");
  const enums = Object.entries(syntax.enums ?? {}).length
    ? `<p><strong>Enums:</strong> ${Object.entries(syntax.enums).map(([number, name]) => `<code>${escapeHtml(name)}(${escapeHtml(number)})</code>`).join(" ")}</p>`
    : "";
  const next = navigation.direct_children.next_cursor;

  routeContent.innerHTML = `
    <div class="route-heading">
      <p class="eyebrow">OID object</p>
      <h1>${escapeHtml(object.symbol)}</h1>
      <p>${moduleLink(object.module)}::${escapeHtml(object.symbol)}</p>
    </div>
    <dl class="route-facts">
      <div><dt>OID</dt><dd><code>${escapeHtml(object.oid)}</code></dd></div>
      <div><dt>Kind</dt><dd>${escapeHtml(object.kind)}</dd></div>
      <div><dt>Syntax</dt><dd>${escapeHtml(syntax.raw ?? syntax.base)}</dd></div>
      <div><dt>Access</dt><dd>${escapeHtml(object.access ?? "not specified")}</dd></div>
      <div><dt>Status</dt><dd>${escapeHtml(object.status ?? "not specified")}</dd></div>
      <div><dt>Revision</dt><dd>${escapeHtml(object.revision ?? "not specified")}</dd></div>
      <div><dt>Publication</dt><dd>${escapeHtml(provenance.publication_mode)}</dd></div>
      <div><dt>Source</dt><dd>${source}</dd></div>
    </dl>
    <div class="route-grid">
      <section class="route-card route-card-wide">
        <h2>Description</h2>
        <p>${escapeHtml(object.description?.text ?? "No description is present in the approved source.")}</p>
        ${enums}
      </section>
      <section class="route-card">
        <h2>Known ancestor path</h2>
        <ol class="route-tree ancestor-tree">${ancestors}</ol>
      </section>
      <section class="route-card">
        <h2>Direct children</h2>
        <p>${navigation.direct_children.total.toLocaleString()} represented direct child(ren); this page returns at most ${navigation.direct_children.limit.toLocaleString()} at a time.</p>
        <ul class="route-tree" data-direct-children>${children}</ul>
        ${next === null ? "" : `<button type="button" data-load-more-children data-next-cursor="${next}" data-object-id="${escapeHtml(object.id)}">Load more direct children</button>`}
      </section>
      <section class="route-card route-card-wide">
        <h2>Bounded subtree preview</h2>
        <p>${navigation.subtree.descendant_count.toLocaleString()} represented descendant(s). Returned ${navigation.subtree.returned_count.toLocaleString()} nodes, bounded to depth ${navigation.subtree.depth} and ${navigation.subtree.limit.toLocaleString()} nodes${navigation.subtree.truncated ? "; more exist" : ""}.</p>
        <ul class="route-tree subtree-tree">${subtree}</ul>
      </section>
    </div>`;

  const loadMore = routeContent.querySelector("[data-load-more-children]");
  loadMore?.addEventListener("click", async () => {
    loadMore.disabled = true;
    loadMore.textContent = "Loading…";
    try {
      const cursor = Number(loadMore.dataset.nextCursor);
      const page = await fetchApi(`/v1/objects/${encodeURIComponent(loadMore.dataset.objectId)}/navigation?child_cursor=${cursor}&child_limit=${navigation.direct_children.limit}&subtree_depth=0&subtree_limit=1`);
      if (!loadMore.isConnected) return;
      routeContent.querySelector("[data-direct-children]").insertAdjacentHTML("beforeend", page.navigation.direct_children.results.map((child) => `<li>${objectLink(child)}<span>${escapeHtml(child.kind)}</span><code>${escapeHtml(child.oid)}</code></li>`).join(""));
      const nextCursor = page.navigation.direct_children.next_cursor;
      if (nextCursor === null) loadMore.remove();
      else {
        loadMore.dataset.nextCursor = String(nextCursor);
        loadMore.disabled = false;
        loadMore.textContent = "Load more direct children";
      }
    } catch (error) {
      loadMore.disabled = false;
      loadMore.textContent = error.message;
    }
  });
}

async function loadObjectRoute(objectId, generation) {
  openRoute("OID object", objectId, "Exact object metadata and bounded tree navigation.");
  try {
    const body = await fetchApi(`/v1/objects/${encodeURIComponent(objectId)}/navigation`);
    if (generation !== routeGeneration) return;
    const canonicalObjectPath = stableObjectPath(body.navigation.object);
    if (window.location.pathname !== canonicalObjectPath) {
      window.history.replaceState({}, "", canonicalObjectPath);
      setCanonical(canonicalObjectPath);
    }
    renderObjectRoute(body);
  } catch (error) {
    if (generation !== routeGeneration) return;
    routeFailure("OID object", objectId, error);
  }
}

async function loadSearchRoute(query, generation) {
  openRoute("OID search", query || "Search the active release", "Search by symbol, module, task, or numeric OID.");
  routeContent.innerHTML = `
    <div class="route-heading"><p class="eyebrow">OID search</p><h1>Search the active release</h1></div>
    <form class="search-form" data-route-search role="search" action="/search" method="get">
      <label for="route-query">OID, symbol, module, or monitoring task</label>
      <div class="search-row"><input name="q" type="search" aria-label="OID, symbol, module, or monitoring task" maxlength="200" value="${escapeHtml(query)}" autofocus><button type="submit">Find</button></div>
    </form>
    <div class="route-search-results" data-route-search-results aria-live="polite">${query ? '<span class="lookup-loading">Searching…</span>' : "Enter a query."}</div>`;
  routeContent.querySelector("[data-route-search]").addEventListener("submit", (event) => {
    event.preventDefault();
    navigate(`/search?q=${encodeURIComponent(new FormData(event.currentTarget).get("q").trim())}`);
  });
  if (!query) return;
  try {
    const body = await fetchApi(`/v1/search?q=${encodeURIComponent(query)}`);
    if (generation !== routeGeneration) return;
    const output = routeContent.querySelector("[data-route-search-results]");
    output.innerHTML = body.results.length ? `<ol class="route-result-list">${body.results.map((object) => `
      <li><a href="${stableObjectPath(object)}" data-route><strong>${escapeHtml(object.symbol)}</strong><span>${escapeHtml(object.module)} · ${escapeHtml(object.kind)}</span><code>${escapeHtml(object.oid)}</code></a></li>`).join("")}</ol>` : '<div class="route-error"><strong>No match in this release</strong><p>No vendor or OID is invented as a substitute.</p></div>';
  } catch (error) {
    if (generation !== routeGeneration) return;
    routeFailure("OID search", query, error);
  }
}

async function loadModuleRoute(moduleId, generation) {
  openRoute("MIB module", moduleId, "Source, rights, roots, imports, and dependency status.");
  try {
    const [moduleBody, dependencies] = await Promise.all([
      fetchApi(`/v1/modules/${encodeURIComponent(moduleId)}`),
      fetchApi(`/v1/modules/${encodeURIComponent(moduleId)}/dependencies`)
    ]);
    if (generation !== routeGeneration) return;
    const module = moduleBody.module;
    const canonicalModulePath = `/modules/${encodeURIComponent(module.id)}`;
    if (window.location.pathname !== canonicalModulePath) {
      window.history.replaceState({}, "", canonicalModulePath);
      setCanonical(canonicalModulePath);
    }
    const roots = module.root_objects.length
      ? module.root_objects.map((root) => `<li>${objectLink(root)}<code>${escapeHtml(root.oid)}</code><span>${escapeHtml(root.kind)}</span></li>`).join("")
      : "<li>No resolved root object in this release.</li>";
    const imports = dependencies.direct.length ? dependencies.direct.map((dependency) => `<li>${moduleLink(dependency)}</li>`).join("") : "<li>No direct imports.</li>";
    const missing = dependencies.missing.length ? dependencies.missing.map((dependency) => `<code>${escapeHtml(dependency)}</code>`).join(" ") : "none";
    const cyclic = dependencies.cyclic.length ? dependencies.cyclic.map((cycle) => `<code>${escapeHtml(cycle)}</code>`).join(" ") : "none";
    routeContent.innerHTML = `
      <div class="route-heading"><p class="eyebrow">MIB module</p><h1>${escapeHtml(module.id)}</h1><p>${escapeHtml(module.publisher)} · ${escapeHtml(module.publication_mode)}</p></div>
      <dl class="route-facts">
        <div><dt>Revision</dt><dd>${escapeHtml(module.revision ?? "not specified")}</dd></div>
        <div><dt>Resolved / declared</dt><dd>${module.resolved_oid_count.toLocaleString()} / ${module.declared_oid_count.toLocaleString()}</dd></div>
        <div><dt>Dependency status</dt><dd>${escapeHtml(dependencies.status)}</dd></div>
        <div><dt>Download</dt><dd>${module.raw_download ? `<a href="${escapeHtml(module.raw_url)}">MIB + license bundle</a>` : "Unavailable"}</dd></div>
        <div><dt>License</dt><dd><a href="${escapeHtml(module.license.url)}">${escapeHtml(module.license.name)}</a></dd></div>
        <div><dt>Source</dt><dd><a href="${escapeHtml(module.source_url)}">Pinned official source</a></dd></div>
        <div><dt>Source revision</dt><dd><code>${escapeHtml(module.source_revision)}</code></dd></div>
        <div><dt>Artifact SHA-256</dt><dd><code>${escapeHtml(module.artifact_sha256)}</code></dd></div>
      </dl>
      <div class="route-grid">
        <section class="route-card"><h2>Module roots</h2><ul class="route-tree">${roots}</ul></section>
        <section class="route-card"><h2>Direct imports</h2><ul class="route-tree">${imports}</ul></section>
        <section class="route-card route-card-wide"><h2>Dependency diagnostics</h2><p><strong>Transitive:</strong> ${dependencies.transitive.length ? dependencies.transitive.map(escapeHtml).join(", ") : "none"}</p><p><strong>Missing:</strong> ${missing}</p><p><strong>Cyclic:</strong> ${cyclic}</p>${dependencies.diagnostics.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</section>
      </div>`;
  } catch (error) {
    if (generation !== routeGeneration) return;
    routeFailure("MIB module", moduleId, error);
  }
}

async function loadEnterpriseRoute(number, generation) {
  openRoute("IANA enterprise", `PEN ${number}`, "Registry assignment only; not a device identity claim.");
  try {
    const body = await fetchApi(`/v1/enterprises/${encodeURIComponent(number)}`);
    if (generation !== routeGeneration) return;
    const enterprise = body.enterprise;
    const canonicalEnterprisePath = `/enterprises/${enterprise.number}`;
    if (window.location.pathname !== canonicalEnterprisePath) {
      window.history.replaceState({}, "", canonicalEnterprisePath);
      setCanonical(canonicalEnterprisePath);
    }
    routeContent.innerHTML = `
      <div class="route-heading"><p class="eyebrow">IANA enterprise number</p><h1>${escapeHtml(enterprise.organization)}</h1><p>PEN ${enterprise.number.toLocaleString()} · ${escapeHtml(enterprise.registry_status)}</p></div>
      <dl class="route-facts"><div><dt>OID prefix</dt><dd><code>${escapeHtml(enterprise.oid)}</code></dd></div><div><dt>Registry snapshot</dt><dd>${escapeHtml(enterprise.source.updated)}</dd></div><div><dt>Rights</dt><dd>${escapeHtml(enterprise.source.rights)}</dd></div><div><dt>Source checksum</dt><dd><code>${escapeHtml(enterprise.source.sha256)}</code></dd></div></dl>
      <div class="route-card"><h2>Evidence boundary</h2><p>${escapeHtml(enterprise.caveat)}</p><p><a href="${escapeHtml(enterprise.source.url)}">IANA registry source</a></p></div>`;
  } catch (error) {
    if (generation !== routeGeneration) return;
    routeFailure("IANA enterprise", `PEN ${number}`, error);
  }
}

async function loadSysObjectIdRoute(oid, generation) {
  openRoute("sysObjectID", oid, "Exact mappings and PEN-only boundaries remain separate.");
  try {
    const body = await fetchApi(`/v1/sys-object-ids/${encodeURIComponent(oid)}`);
    if (generation !== routeGeneration) return;
    const result = body.result;
    const normalizedOid = result.normalized_oid ?? oid;
    const canonicalSysObjectIdPath = `/sys-object-ids/${encodeURIComponent(normalizedOid)}`;
    if (window.location.pathname !== canonicalSysObjectIdPath) {
      window.history.replaceState({}, "", canonicalSysObjectIdPath);
      setCanonical(canonicalSysObjectIdPath);
    }
    const outcome = normalizeIdentityOutcome(result);
    const isConflict = outcome === "conflicting_evidence" || outcome === "conflict" || outcome === "ambiguous";
    const candidate = result.match ?? (!isConflict && Array.isArray(result.candidates) ? result.candidates[0] : null);
    const provenance = candidate?.provenance ?? {};
    const sourceUrl = safeHttpUrl(provenance.source_url);
    const organizationName = result.organization_name ?? result.enterprise?.organization;
    const enterpriseNumber = result.enterprise_number ?? result.enterprise?.number;
    const organizationKey = result.organization_key;
    const facts = candidate || enterpriseNumber !== null && enterpriseNumber !== undefined ? `
      <dl class="route-facts">
        ${candidate?.product_family ? `<div><dt>Product family</dt><dd>${escapeHtml(candidate.product_family)}</dd></div>` : ""}
        ${candidate?.mib_identifier ? `<div><dt>Vendor MIB identifier</dt><dd><code>${escapeHtml(candidate.mib_identifier)}</code></dd></div>` : ""}
        ${candidate?.platform ? `<div><dt>Platform</dt><dd>${escapeHtml(candidate.platform)}</dd></div>` : ""}
        <div><dt>Model</dt><dd>${escapeHtml(candidate?.model ?? "not asserted")}</dd></div>
        ${candidate?.claim_strength ? `<div><dt>Claim strength</dt><dd>${escapeHtml(candidate.claim_strength)}</dd></div>` : ""}
        ${candidate?.confidence ?? result.confidence ? `<div><dt>Confidence</dt><dd>${escapeHtml(candidate?.confidence ?? result.confidence)}</dd></div>` : ""}
        ${enterpriseNumber !== null && enterpriseNumber !== undefined ? `<div><dt>PEN</dt><dd><code>${escapeHtml(enterpriseNumber)}</code></dd></div>` : ""}
        ${organizationName ? `<div><dt>Organization</dt><dd>${escapeHtml(organizationName)}</dd></div>` : ""}
        <div><dt>Organization key</dt><dd>${escapeHtml(organizationKey ?? "Not reviewed / unavailable")}</dd></div>
        ${result.organization_key_status ? `<div><dt>Organization-key status</dt><dd>${escapeHtml(result.organization_key_status)}</dd></div>` : ""}
        ${provenance.source ? `<div><dt>Evidence</dt><dd>${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}">${escapeHtml(provenance.source)}</a>` : escapeHtml(provenance.source)}</dd></div>` : ""}
        ${provenance.source_revision ? `<div><dt>Source revision</dt><dd><code>${escapeHtml(provenance.source_revision)}</code></dd></div>` : ""}
        ${body.identity_release ? `<div><dt>Identity release</dt><dd><code>${escapeHtml(body.identity_release)}</code></dd></div>` : ""}
        ${result.identity_release_sha256 ? `<div><dt>Identity release SHA-256</dt><dd><code>${escapeHtml(result.identity_release_sha256)}</code></dd></div>` : ""}
        ${result.identity_view ? `<div><dt>Identity view</dt><dd><code>${escapeHtml(result.identity_view)}</code></dd></div>` : ""}
        ${result.publication_control?.control_revision ? `<div><dt>Control revision</dt><dd>${escapeHtml(result.publication_control.control_revision)}</dd></div>` : ""}
      </dl>` : "";
    routeContent.innerHTML = `
      <div class="route-heading"><p class="eyebrow">sysObjectID</p><h1>${escapeHtml(normalizedOid)}</h1><p>Outcome: <strong>${escapeHtml(identityOutcomeLabels[outcome] ?? result.status ?? "Unknown")}</strong></p></div>
      ${facts}
      ${result.rights ? `<div class="route-card"><h2>Publication restriction</h2><p>${escapeHtml(result.rights.detail)}</p></div>` : ""}
      ${result.caveat ? `<div class="route-card"><h2>Evidence boundary</h2><p>${escapeHtml(result.caveat)}</p></div>` : ""}
      <div class="route-card"><h2>Need corroboration?</h2><p>Use the <a href="/#device-identity">device identity workbench</a> to add bounded ENTITY-MIB or platform signals. Do not upload a raw SNMP walk.</p></div>`;
  } catch (error) {
    if (generation !== routeGeneration) return;
    routeFailure("sysObjectID", oid, error);
  }
}

async function loadReleaseRoute(releaseId, generation) {
  openRoute("Data release", releaseId, "Active immutable public-corpus identity and counts.");
  try {
    const body = await fetchApi("/v1/data-release");
    if (generation !== routeGeneration) return;
    if (body.data_release !== releaseId) throw new Error("This service exposes only its active immutable data release.");
    const stats = body.statistics;
    routeContent.innerHTML = `
      <div class="route-heading"><p class="eyebrow">Active data release</p><h1>${escapeHtml(body.data_release)}</h1><p>${escapeHtml(body.status)} · production data</p></div>
      <dl class="route-facts"><div><dt>Published modules</dt><dd>${stats.modules.total.toLocaleString()}</dd></div><div><dt>Catalog OID nodes</dt><dd>${stats.oid_nodes.catalog_oid_nodes.toLocaleString()}</dd></div><div><dt>Searchable records</dt><dd>${stats.oid_nodes.searchable_records.toLocaleString()}</dd></div><div><dt>Textual conventions</dt><dd>${stats.definitions.textual_conventions.active_module_definitions.toLocaleString()}</dd></div><div><dt>Catalog notifications</dt><dd>${stats.definitions.notifications.catalog_oid_nodes.toLocaleString()}</dd></div><div><dt>Enterprise records</dt><dd>${stats.identity.enterprise_records.toLocaleString()}</dd></div><div><dt>sysObjectID mappings</dt><dd>${stats.identity.sys_object_id_mappings.toLocaleString()}</dd></div>${Number.isSafeInteger(body.identity_statistics?.exact_models) ? `<div><dt>Reviewed exact models</dt><dd>${body.identity_statistics.exact_models.toLocaleString()}</dd></div>` : ""}${Number.isSafeInteger(body.identity_statistics?.vendor_identifiers) ? `<div><dt>Generic vendor identifiers</dt><dd>${body.identity_statistics.vendor_identifiers.toLocaleString()}</dd></div>` : ""}<div><dt>Published sources</dt><dd>${stats.sources.total.toLocaleString()}</dd></div></dl>
      <div class="route-card"><h2>Count boundary</h2><p>These counts cover only the active public release. Staged and quarantined content is excluded.</p><p><a href="/v1/data-release">Machine-readable release response</a></p></div>`;
  } catch (error) {
    if (generation !== routeGeneration) return;
    routeFailure("Data release", releaseId, error);
  }
}

let homeInitialized = false;
function showHome() {
  document.body.classList.remove("route-active");
  routeView.hidden = true;
  setCanonical("/");
  document.title = "mibvendor — MIB context without the maze";
  if (!homeInitialized) {
    homeInitialized = true;
    runSearch(queryInput.value);
    loadCatalog(catalogQuery.value);
  }
}

function renderCurrentRoute() {
  const generation = ++routeGeneration;
  const path = window.location.pathname;
  const search = window.location.search;
  setCanonical(path, search);
  if (path === "/") {
    showHome();
    return;
  }
  let match;
  if (path === "/search") {
    loadSearchRoute(new URLSearchParams(search).get("q") ?? "", generation);
  } else if ((match = path.match(/^\/objects\/([^/]+)$/))) {
    loadObjectRoute(decodeURIComponent(match[1]), generation);
  } else if ((match = path.match(/^\/modules\/([^/]+)$/))) {
    loadModuleRoute(decodeURIComponent(match[1]), generation);
  } else if ((match = path.match(/^\/enterprises\/(\d+)$/))) {
    loadEnterpriseRoute(match[1], generation);
  } else if ((match = path.match(/^\/sys-object-ids\/([0-9.]+)$/))) {
    loadSysObjectIdRoute(match[1], generation);
  } else if ((match = path.match(/^\/releases\/([^/]+)$/))) {
    loadReleaseRoute(decodeURIComponent(match[1]), generation);
  } else {
    showHome();
  }
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  navigate(`/search?q=${encodeURIComponent(queryInput.value.trim())}`);
});

document.querySelectorAll("[data-query]").forEach((button) => {
  button.addEventListener("click", () => {
    queryInput.value = button.dataset.query;
    navigate(`/search?q=${encodeURIComponent(queryInput.value.trim())}`);
  });
});

document.querySelector("#decode-button").addEventListener("click", () => {
  try {
    const result = parseWalk(walkInput.value, records);
    decoderSummary.innerHTML = `
      <div class="summary-grid">
        <div><strong>${result.resolvedCount}</strong><span>resolved rows</span></div>
        <div><strong>${result.unresolvedCount}</strong><span>unresolved rows</span></div>
        <div><strong>${result.groupCount}</strong><span>object groups</span></div>
        <div><strong>${result.errors.length}</strong><span>unsupported lines</span></div>
      </div>
      <p class="limit-note">${result.byteLength.toLocaleString()} bytes parsed locally. Values were not transmitted.</p>
    `;
    walkCaption.textContent = `${result.rows.length} decoded row(s); showing at most 500`;
    walkResults.innerHTML = result.rows.slice(0, 500).map((row) => `
      <tr>
        <td>${escapeHtml(row.group)} / ${escapeHtml(row.instance)}</td>
        <td>${row.record ? `${escapeHtml(row.record.module)}::<strong>${escapeHtml(row.record.symbol)}</strong>` : '<span class="unresolved">Unresolved</span>'}</td>
        <td><code>${escapeHtml(row.oid)}</code></td>
        <td><code>${escapeHtml(row.value)}</code></td>
      </tr>
    `).join("");
  } catch (error) {
    decoderSummary.innerHTML = `<p class="unresolved">${escapeHtml(error.message)}</p>`;
    walkResults.innerHTML = "";
    walkCaption.textContent = "Walk was not decoded";
  }
});

document.querySelector("#clear-button").addEventListener("click", () => {
  walkInput.value = "";
  walkResults.innerHTML = "";
  walkCaption.textContent = "No decoded rows yet";
  decoderSummary.innerHTML = "<p>Decoded groups and unresolved OIDs will appear here.</p>";
  walkInput.focus();
});

document.querySelectorAll("[data-copy-target]").forEach((button) => {
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copyTarget);
    const status = document.querySelector("#copy-status");
    if (!target || !navigator.clipboard?.writeText) {
      status.textContent = "Copy is unavailable in this browser; select the example manually.";
      return;
    }
    try {
      await navigator.clipboard.writeText(target.textContent);
      status.textContent = `${button.textContent.replace(/^Copy\s+/, "")} example copied.`;
    } catch {
      status.textContent = "Copy permission was denied; select the example manually.";
    }
  });
});

async function loadLiveModulePage(cursor) {
  if (!Number.isSafeInteger(cursor) || cursor < 0) return;
  apiLiveFirst.disabled = true;
  apiLiveNext.disabled = true;
  apiLiveStatus.textContent = `Loading cursor ${cursor} from the active release…`;
  apiLiveResponse.closest("pre").setAttribute("aria-busy", "true");
  try {
    const response = await fetch(`/v1/modules?q=IANA&limit=1&cursor=${cursor}`, {
      headers: { accept: "application/json" }
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail ?? `Request failed with HTTP ${response.status}`);
    if (
      body?.query !== "IANA"
      || body.cursor !== cursor
      || body.limit !== 1
      || typeof body.data_release !== "string"
      || !Array.isArray(body.results)
      || !(body.next_cursor === null || (Number.isSafeInteger(body.next_cursor) && body.next_cursor >= 0))
    ) throw new Error("The module page did not match the documented cursor contract.");
    apiLiveNextCursor = body.next_cursor;
    apiLiveResponse.textContent = JSON.stringify(body, null, 2);
    apiLiveStatus.textContent = body.next_cursor === null
      ? `Cursor ${body.cursor} loaded from ${body.data_release}; this is the final page.`
      : `Cursor ${body.cursor} loaded from ${body.data_release}; next_cursor is ${body.next_cursor}.`;
  } catch (error) {
    apiLiveNextCursor = null;
    apiLiveResponse.textContent = JSON.stringify({
      error: error instanceof Error ? error.message : "The live example failed."
    }, null, 2);
    apiLiveStatus.textContent = "The live example failed; no cursor was accepted.";
  } finally {
    apiLiveFirst.disabled = false;
    apiLiveNext.disabled = apiLiveNextCursor === null;
    apiLiveResponse.closest("pre").setAttribute("aria-busy", "false");
  }
}

apiLiveFirst.addEventListener("click", () => loadLiveModulePage(0));
apiLiveNext.addEventListener("click", () => {
  if (apiLiveNextCursor !== null) loadLiveModulePage(apiLiveNextCursor);
});

document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest("a[data-route]");
  if (!link) return;
  const target = new URL(link.href, window.location.origin);
  if (target.origin !== window.location.origin) return;
  event.preventDefault();
  navigate(`${target.pathname}${target.search}`);
});

window.addEventListener("popstate", renderCurrentRoute);
renderCurrentRoute();
