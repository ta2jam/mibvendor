import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { records } from "../prototype/data.mjs";
import {
  MAX_WALK_BYTES,
  MAX_WALK_LINES,
  classifySearchQuery,
  createSearchIndex,
  oidStartsWith,
  parseOid,
  parseWalk,
  rankSearchIndex,
  resolveOid,
  searchRecords
} from "../prototype/core.mjs";

test("parseOid accepts canonical numeric OIDs and rejects malformed input", () => {
  assert.deepEqual(parseOid(".1.3.6.1.2.1"), [1, 3, 6, 1, 2, 1]);
  assert.equal(parseOid("1.3.nope"), null);
  assert.equal(parseOid("1..3"), null);
  assert.equal(parseOid("-1.3"), null);
});

test("oidStartsWith compares subidentifiers, not lexical text", () => {
  assert.equal(oidStartsWith([1, 3, 6, 10], [1, 3, 6]), true);
  assert.equal(oidStartsWith([1, 3, 60], [1, 3, 6]), false);
});

test("resolveOid chooses the longest actual ancestor and preserves the instance", () => {
  const resolved = resolveOid("1.3.6.1.2.1.2.2.1.8.17", records);
  assert.equal(resolved.record.symbol, "ifOperStatus");
  assert.deepEqual(resolved.instance, [17]);
});

test("task, symbol, module-qualified, and numeric queries resolve", () => {
  assert.equal(searchRecords("interface status", records)[0].symbol, "ifOperStatus");
  assert.equal(searchRecords("IF-MIB::ifOperStatus", records)[0].symbol, "ifOperStatus");
  assert.equal(searchRecords("1.3.6.1.2.1.1.3.0", records)[0].symbol, "sysUpTime");
  assert.equal(searchRecords("processor load", records)[0].symbol, "hrProcessorLoad");
});

test("a reusable search index preserves ranking without rebuilding normalized text", () => {
  const index = createSearchIndex(records);
  for (const query of ["interface status", "IF-MIB::ifOperStatus", "processor load", "1.3.6.1.2.1.1.3.0"]) {
    assert.deepEqual(
      rankSearchIndex(query, index).map(({ record, score, matchKind }) => ({ id: `${record.module}::${record.symbol}`, score, matchKind })),
      classifySearchQuery(query, records).matches.map(({ record, score, matchKind }) => ({ id: `${record.module}::${record.symbol}`, score, matchKind }))
    );
  }
});

test("search classifications preserve ranking, instances, and explicit failure states", () => {
  const task = classifySearchQuery("interface status", records);
  assert.equal(task.state, "matches");
  assert.equal(task.matches[0].record.symbol, "ifOperStatus");
  assert.equal(task.matches[0].matchKind, "task-intent");
  assert.ok(task.matches.length > 1);

  const instance = classifySearchQuery("1.3.6.1.2.1.2.2.1.8.7", records);
  assert.equal(instance.matches[0].matchKind, "numeric-instance");
  assert.deepEqual(instance.resolved.instance, [7]);

  assert.equal(classifySearchQuery("1.3.nope", records).state, "invalid-oid");
  assert.equal(classifySearchQuery("1.3.6.1.4.1.999999.1.0", records).state, "unknown-oid");
  assert.equal(classifySearchQuery("", records).state, "empty");
});

test("prototype records expose bounded trust and release metadata", () => {
  for (const record of records) {
    assert.equal(record.rightsTier, "A — mibvendor-authored metadata and paraphrase");
    assert.equal(record.dataRelease, "license-signaled-2026-07-20.2");
    assert.match(record.sourceChecked, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(record.parseStatus);
    assert.deepEqual(record.rightsScopes, ["metadata", "rendered text", "API output"]);
    assert.equal(record.publicationStatus, "public-alpha-synthetic");
    assert.equal(record.status, "current");
    assert.ok(record.syntaxDetail.base);
  }
});

test("walk parsing resolves table rows, scalar instances, and unknown OIDs", () => {
  const walk = [
    ".1.3.6.1.2.1.2.2.1.2.1 = STRING: Ethernet0/1",
    ".1.3.6.1.2.1.2.2.1.8.1 = INTEGER: up(1)",
    ".1.3.6.1.2.1.1.3.0 = Timeticks: 123",
    ".1.3.6.1.4.1.99999.1.0 = INTEGER: 7"
  ].join("\n");

  const result = parseWalk(walk, records);
  assert.equal(result.rows.length, 4);
  assert.equal(result.resolvedCount, 3);
  assert.equal(result.unresolvedCount, 1);
  assert.equal(result.rows[0].group, "ifTable");
  assert.equal(result.rows[0].instance, "1");
  assert.equal(result.rows[2].record.symbol, "sysUpTime");
  assert.equal(result.errors.length, 0);
});

test("walk parsing reports unsupported lines without inventing rows", () => {
  const result = parseWalk("IF-MIB::ifOperStatus.1 = up(1)", records);
  assert.equal(result.rows.length, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 1);
});

test("walk parsing enforces byte and line bounds", () => {
  assert.throws(
    () => parseWalk("12345", records, { maxBytes: 4 }),
    (error) => error instanceof RangeError && error.message.includes("bytes")
  );

  assert.throws(
    () => parseWalk("1\n2\n3", records, { maxLines: 2 }),
    (error) => error instanceof RangeError && error.message.includes("lines")
  );
  assert.equal(MAX_WALK_BYTES, 10 * 1024 * 1024);
  assert.equal(MAX_WALK_LINES, 50_000);
});

test("walk decoding remains local while intelligence lookups use same-origin API paths", async () => {
  const sources = await Promise.all([
    readFile(new URL("../prototype/app.js", import.meta.url), "utf8"),
    readFile(new URL("../prototype/core.mjs", import.meta.url), "utf8"),
    readFile(new URL("../prototype/data.mjs", import.meta.url), "utf8")
  ]);
  const [app, core, data] = sources;
  const joined = [app, core, data].join("\n");
  assert.match(app, /fetch\(path/);
  assert.doesNotMatch(app, /fetch\([^)]*walk/i);
  const decoderHandler = app.slice(app.indexOf('document.querySelector("#decode-button")'), app.indexOf('document.querySelector("#clear-button")'));
  assert.doesNotMatch(decoderHandler, /fetch|requestJson/);
  assert.doesNotMatch(joined, /XMLHttpRequest|WebSocket|sendBeacon/);
});

test("public page states safe-use and API availability boundaries", async () => {
  const html = await readFile(new URL("../prototype/index.html", import.meta.url), "utf8");
  assert.match(html, /Local walk parsing/);
  assert.match(html, /No device connections/);
  assert.match(html, /Public API/);
  assert.match(html, /Permanently free/);
  assert.match(html, /https:\/\/mibvendor\.io\/v1/);
  assert.match(html, /open source on GitHub/);
  assert.match(html, /id="search-results"/);
  assert.match(html, /Ranked, not hidden/);
  assert.doesNotMatch(html, /community string[^<]*value|SNMPv3 credential[^<]*value/i);
});

test("developer mini documentation matches the live public alpha", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../prototype/index.html", import.meta.url), "utf8"),
    readFile(new URL("../prototype/app.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="developers"/);
  assert.match(html, /Free · Public alpha/);
  assert.match(html, /permanently free/);
  assert.match(html, /free abuse-control credentials only/);
  assert.match(html, /fair-use bounded, not unlimited use or an availability SLA/);
  assert.match(html, /no availability SLA/);
  assert.match(html, /RateLimit-\*/);
  assert.match(html, /Retry-After/);
  assert.match(html, /Cache-Control/);
  assert.match(html, /ETag/);
  assert.match(html, /Module lists use cursors/);
  for (const endpoint of [
    "/v1/search?q=interface+status",
    "/v1/objects/{objectId}",
    "/v1/objects/{objectId}/navigation",
    "/v1/enterprises/{number}",
    "/v1/sys-object-ids/{oid}",
    "/v1/modules/{module}/dependencies",
    "/v1/resolve:batch",
    "/v1/data-release"
  ]) assert.ok(html.includes(endpoint), `missing developer endpoint ${endpoint}`);
  assert.match(html, /1,000/);
  assert.match(html, /64 KiB/);
  assert.match(html, /200/);
  assert.match(html, /application\/problem\+json/);
  assert.match(html, /OpenAPI 3\.1 specification/);
  assert.match(html, /Copy curl/);
  assert.match(html, /Copy JavaScript/);
  assert.match(html, /Copy Python/);
  assert.match(html, /data-release-unavailable/);
  assert.match(html, /standard library only/);
  assert.match(app, /navigator\.clipboard\?\.writeText/);
  assert.match(html, /120/);
  assert.doesNotMatch(html, /Get (?:an )?API key/i);
  assert.doesNotMatch(html, /(?:buy|purchase|upgrade to) (?:an )?(?:API )?(?:key|plan|quota)/i);
});

test("browser shell exposes canonical history-based routes without shipping a framework", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL("../prototype/index.html", import.meta.url), "utf8"),
    readFile(new URL("../prototype/app.js", import.meta.url), "utf8"),
    readFile(new URL("../prototype/styles.css", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="canonical-url"/);
  assert.match(html, /id="route-view"/);
  assert.match(html, /src="\/app\.js"/);
  assert.match(html, /href="\/styles\.css"/);
  assert.match(app, /history\[replace \? "replaceState" : "pushState"\]/);
  assert.match(app, /addEventListener\("popstate", renderCurrentRoute\)/);
  for (const route of ["/search", "/objects/", "/modules/", "/enterprises/", "/sys-object-ids/", "/releases/"]) {
    assert.ok(app.includes(route), `missing browser route ${route}`);
  }
  assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(styles, /\.site-header nav a:not\(:first-child\)[^{]*\{[^}]*display:\s*none/s);
  assert.doesNotMatch(app, /React|Vue|Svelte|Angular/);
});
