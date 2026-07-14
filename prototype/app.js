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
      : `<p>This is a notification, not a pollable object. Inspect its related varbind objects.</p>`;
  const enumContext = record.enumValues.length
    ? `<div class="enum-list" aria-label="Enumerated values">${record.enumValues.map((value) => `<code>${escapeHtml(value)}</code>`).join("")}</div>`
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
        <p><strong>Syntax:</strong> ${escapeHtml(record.syntax)}</p>
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

function runSearch(query) {
  const view = classifySearchQuery(query, records);
  if (view.state !== "matches") {
    objectPath.innerHTML = "";
    if (view.state === "invalid-oid") {
      renderSearchState("Invalid numeric OID", "Use dot-separated non-negative integers, for example 1.3.6.1.2.1.1.3.0.");
    } else if (view.state === "unknown-oid") {
      renderSearchState("Valid OID, unknown in this release", "The syntax is valid, but no known object prefix exists in the six-record prototype dataset.");
    } else if (view.state === "empty") {
      renderSearchState("Enter a task, symbol, module, or OID", "Results will keep module, kind, and numeric OID visible.");
    } else {
      renderSearchState("No match in this release", "Try a precise symbol, module-qualified name, numeric OID, or monitoring task.");
    }
    detail.innerHTML = `
      <div class="detail-header">
        <div><p class="eyebrow">No selected object</p><h2>${escapeHtml(query || "Search required")}</h2></div>
      </div>
      <p>This public alpha contains six standards-derived prototype records. It will not invent a vendor, device identity, or substitute OID.</p>
    `;
    return;
  }
  renderMatches(view);
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
