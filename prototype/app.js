import { records } from "./data.mjs";
import { parseOid, parseWalk, searchRecords } from "./core.mjs";

const queryInput = document.querySelector("#query");
const searchForm = document.querySelector("#search");
const detail = document.querySelector("#object-detail");
const objectPath = document.querySelector("#object-path");
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

function renderDetail(record, resultCount) {
  renderPath(record);
  const tableContext = record.table
    ? `<p><strong>${escapeHtml(record.table)}</strong> uses <strong>${escapeHtml(record.index)}</strong>. Append an actual index to the column OID for a scalar instance, or walk the base column.</p>`
    : record.kind === "scalar"
      ? `<p>This is a scalar. Query its single instance by appending <strong>.0</strong>.</p>`
      : `<p>This is a notification, not a pollable object. Inspect its related varbind objects.</p>`;

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
      <div class="fact"><dt>Access</dt><dd>${escapeHtml(record.access)}</dd></div>
      <div class="fact"><dt>Revision</dt><dd>${escapeHtml(record.revision)}</dd></div>
      <div class="fact"><dt>Source</dt><dd><a href="${escapeHtml(record.sourceUrl)}">${escapeHtml(record.source)}</a></dd></div>
    </dl>
    <div class="detail-columns">
      <section class="context-card">
        <h3>What it means</h3>
        <p>${escapeHtml(record.description)}</p>
        <p><strong>Syntax:</strong> ${escapeHtml(record.syntax)}</p>
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
    </div>
  `;
}

function runSearch(query) {
  const matches = searchRecords(query, records);
  if (!matches.length) {
    objectPath.innerHTML = "";
    detail.innerHTML = `
      <div class="detail-header">
        <div><p class="eyebrow">No mock match</p><h2>${escapeHtml(query)}</h2></div>
      </div>
      <p>This public alpha contains six standards-derived mock records. Production results must also show module revision, source, parse status, and rights scope.</p>
    `;
    return;
  }
  renderDetail(matches[0], matches.length);
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
