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
const enterpriseResult = document.querySelector("#enterprise-result");
const sysObjectIdForm = document.querySelector("#sysobjectid-form");
const sysObjectIdResult = document.querySelector("#sysobjectid-result");
const dependencyForm = document.querySelector("#dependency-form");
const dependencyResult = document.querySelector("#dependency-result");
const catalogForm = document.querySelector("#catalog-search");
const catalogQuery = document.querySelector("#catalog-query");
const catalogResults = document.querySelector("#catalog-results");
const catalogStats = document.querySelector("#catalog-stats");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

async function requestJson(path, output) {
  output.innerHTML = '<span class="lookup-loading">Loading…</span>';
  try {
    const response = await fetch(path, { headers: { accept: "application/json" } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail ?? `Request failed with HTTP ${response.status}`);
    return body;
  } catch (error) {
    output.innerHTML = `<span class="unresolved">${escapeHtml(error.message)}</span>`;
    return null;
  }
}

enterpriseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const number = document.querySelector("#enterprise-number").value.trim();
  const body = await requestJson(`/v1/enterprises/${encodeURIComponent(number)}`, enterpriseResult);
  if (!body) return;
  const enterprise = body.enterprise;
  enterpriseResult.innerHTML = `
    <strong>${escapeHtml(enterprise.organization)}</strong>
    <code>${escapeHtml(enterprise.oid)}</code>
    <span>PEN ${escapeHtml(enterprise.number)} · ${escapeHtml(enterprise.registry_status)}</span>
    <small>${escapeHtml(enterprise.caveat)}</small>`;
});

sysObjectIdForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const oid = document.querySelector("#sysobjectid").value.trim();
  const body = await requestJson(`/v1/sys-object-ids/${encodeURIComponent(oid)}`, sysObjectIdResult);
  if (!body) return;
  const result = body.result;
  const identity = result.match
    ? `<strong>${escapeHtml(result.match.product_family)} · ${escapeHtml(result.match.platform)}</strong><span>Exact match · ${escapeHtml(result.match.confidence)} confidence</span>`
    : result.status === "unavailable_due_to_rights"
      ? `<strong>${escapeHtml(result.enterprise.organization)}</strong><span>Exact mapping unavailable due to source rights</span>`
    : result.enterprise
      ? `<strong>${escapeHtml(result.enterprise.organization)}</strong><span>Enterprise boundary only · no product match</span>`
      : `<strong>No identity match</strong><span>The OID is valid but unsupported in this release.</span>`;
  sysObjectIdResult.innerHTML = `${identity}<code>${escapeHtml(result.normalized_oid)}</code>${result.caveat ? `<small>${escapeHtml(result.caveat)}</small>` : ""}`;
});

dependencyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const moduleName = document.querySelector("#module-name").value.trim();
  const body = await requestJson(`/v1/modules/${encodeURIComponent(moduleName)}/dependencies`, dependencyResult);
  if (!body) return;
  const row = (label, values) => `<span><strong>${label}</strong> ${values.length ? values.map(escapeHtml).join(", ") : "none"}</span>`;
  dependencyResult.innerHTML = `
    <strong>${escapeHtml(body.module)} · ${escapeHtml(body.status)}</strong>
    ${row("Direct", body.direct)}
    ${row("Transitive", body.transitive)}
    ${row("Missing", body.missing)}
    ${row("Cyclic", body.cyclic)}`;
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
        <a href="/v1/modules/${encodeURIComponent(module.id)}">Metadata</a>
        <a href="${escapeHtml(module.source_url)}">Official source</a>
        ${module.raw_download ? `<a href="${escapeHtml(module.raw_url)}">Download licensed MIB</a>` : ""}
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
    catalogStats.innerHTML = `
      <span><strong>${release.redistributable_module_count.toLocaleString()}</strong>redistributable MIB modules</span>
      <span><strong>${release.object_count.toLocaleString()}</strong>searchable OID records</span>
      <span><strong>${release.directory_only_source_count.toLocaleString()}</strong>directory-only sources</span>
      <span><strong>${escapeHtml(release.data_release)}</strong>immutable data release</span>`;
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

function selectMatch(view, activeIndex) {
  searchResults.querySelectorAll("[data-result-index]").forEach((button) => {
    const active = Number(button.dataset.resultIndex) === activeIndex;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", String(active));
  });
  renderDetail(view.matches[activeIndex].record, view.matches.length, activeIndex === 0 ? view.resolved : null);
}

function renderMatches(view) {
  searchResults.innerHTML = `<ol class="result-list">${view.matches.map(({ record, matchKind }, index) => `
    <li>
      <button type="button" class="result-button${index === 0 ? " is-active" : ""}" data-result-index="${index}" aria-current="${index === 0 ? "true" : "false"}">
        <span class="result-reason">${escapeHtml(matchLabels[matchKind] ?? "Related context")}</span>
        <strong>${escapeHtml(record.symbol)}</strong>
        <span>${escapeHtml(record.module)} · ${escapeHtml(record.kind)}</span>
        <code>${escapeHtml(record.oid)}</code>
      </button>
    </li>`).join("")}</ol>`;

  searchResults.querySelectorAll("[data-result-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.resultIndex);
      selectMatch(view, index);
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

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch(queryInput.value);
});

document.querySelectorAll("[data-query]").forEach((button) => {
  button.addEventListener("click", () => {
    queryInput.value = button.dataset.query;
    runSearch(queryInput.value);
    queryInput.focus();
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

runSearch(queryInput.value);
loadCatalog(catalogQuery.value);
