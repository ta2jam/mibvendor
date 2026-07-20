import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createMibvendorServer } from "../server.mjs";
import { IDENTITY_STATISTICS, PUBLIC_CORPUS_STATISTICS } from "../src/intelligence.mjs";

const specification = JSON.parse(
  await readFile(new URL("../docs/research/demand/phase0-openapi.json", import.meta.url), "utf8")
);

async function withServer(callback) {
  const server = createMibvendorServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("public corpus statistics keep catalog, search, definition, and identity counts distinct", () => {
  const stats = PUBLIC_CORPUS_STATISTICS;
  assert.equal(stats.scope, "active-public-release");

  assert.equal(stats.modules.total, 702);
  assert.equal(stats.modules.total, Object.values(stats.modules.publication_modes).reduce((sum, count) => sum + count, 0));
  assert.deepEqual(stats.modules.publication_modes, {
    redistributable: 702,
    "metadata-only": 0,
    "directory-only": 0,
  });

  assert.equal(stats.oid_nodes.catalog_oid_nodes, 76_606);
  assert.equal(stats.oid_nodes.supplemental_legacy_records, 0);
  assert.equal(
    stats.oid_nodes.searchable_records,
    stats.oid_nodes.catalog_oid_nodes + stats.oid_nodes.supplemental_legacy_records
  );

  assert.equal(stats.definitions.textual_conventions.active_module_definitions, 4_138);
  assert.equal(stats.definitions.textual_conventions.searchable_records, 0);
  assert.equal(stats.definitions.notifications.catalog_oid_nodes, 1_273);
  assert.equal(stats.definitions.notifications.supplemental_searchable_records, 0);
  assert.equal(
    stats.definitions.notifications.searchable_records,
    stats.definitions.notifications.catalog_oid_nodes + stats.definitions.notifications.supplemental_searchable_records
  );

  assert.equal(stats.identity.enterprise_records, 66_266);
  assert.equal(stats.identity.sys_object_id_mappings, IDENTITY_STATISTICS.sys_object_id_mappings);
  assert.equal(stats.identity.identity_release, IDENTITY_STATISTICS.identity_release);
  assert.equal(stats.identity.exact_models, IDENTITY_STATISTICS.exact_models);
  assert.equal(stats.identity.product_families, IDENTITY_STATISTICS.product_families);
  assert.equal(stats.identity.platforms, IDENTITY_STATISTICS.platforms);
  assert.equal(stats.identity.project_observation_oids, IDENTITY_STATISTICS.project_observation_oids);
  assert.equal(stats.sources.total, 32);
  assert.deepEqual(stats.sources.publication_modes, {
    redistributable: 12,
    "metadata-only": 0,
    "directory-only": 20,
  });
  assert.equal(stats.sources.total, Object.values(stats.sources.publication_modes).reduce((sum, count) => sum + count, 0));
  assert.equal(stats.publication_controls.event_count, 2);
  assert.equal(stats.publication_controls.disabled_sources, 0);
  assert.equal(stats.publication_controls.disabled_modules, 0);
  assert.match(stats.publication_controls.latest_event_sha256, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(stats), /raw_(?:path|content)|candidate|staged|quarantin/i);
});

test("data-release API publishes canonical nested statistics and compatible flat aliases", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/data-release`);
    assert.equal(response.status, 200);
    const release = await response.json();
    assert.deepEqual(release.statistics, PUBLIC_CORPUS_STATISTICS);
    assert.equal(release.object_count, release.statistics.oid_nodes.searchable_records);
    assert.equal(release.enterprise_count, release.statistics.identity.enterprise_records);
    assert.equal(release.sys_object_id_count, release.statistics.identity.sys_object_id_mappings);
    assert.equal(release.module_count, release.statistics.modules.total);
    assert.equal(release.redistributable_module_count, release.statistics.modules.publication_modes.redistributable);
    assert.equal(release.directory_only_source_count, release.statistics.sources.publication_modes["directory-only"]);
  });
});

test("OpenAPI pins the immutable statistics contract and deprecates ambiguous object_count", () => {
  const schemas = specification.components.schemas;
  const release = schemas.DataRelease;
  assert.ok(release.required.includes("statistics"));
  assert.equal(release.properties.statistics.$ref, "#/components/schemas/CorpusStatistics");
  assert.equal(release.properties.object_count.deprecated, true);
  assert.match(release.properties.object_count.description, /searchable_records/);

  assert.equal(schemas.ModuleStatistics.properties.total.const, PUBLIC_CORPUS_STATISTICS.modules.total);
  assert.equal(schemas.OidNodeStatistics.properties.catalog_oid_nodes.const, PUBLIC_CORPUS_STATISTICS.oid_nodes.catalog_oid_nodes);
  assert.equal(schemas.OidNodeStatistics.properties.searchable_records.const, PUBLIC_CORPUS_STATISTICS.oid_nodes.searchable_records);
  assert.equal(
    schemas.DefinitionStatistics.properties.textual_conventions.properties.active_module_definitions.const,
    PUBLIC_CORPUS_STATISTICS.definitions.textual_conventions.active_module_definitions
  );
  assert.equal(
    schemas.IdentityStatistics.properties.enterprise_records.const,
    PUBLIC_CORPUS_STATISTICS.identity.enterprise_records
  );
  assert.equal(
    schemas.IdentityStatistics.properties.sys_object_id_mappings.maximum,
    PUBLIC_CORPUS_STATISTICS.identity.sys_object_id_mappings
  );
  assert.equal(schemas.SourceStatistics.properties.total.const, PUBLIC_CORPUS_STATISTICS.sources.total);
});

test("catalog UI reads canonical statistics and labels unlike quantities explicitly", async () => {
  const app = await readFile(new URL("../prototype/app.js", import.meta.url), "utf8");
  assert.match(app, /const stats = release\.statistics/);
  assert.match(app, /catalog OID nodes/);
  assert.match(app, /searchable records/);
  assert.match(app, /supplemental legacy records/);
  assert.match(app, /textual convention definitions/);
  assert.match(app, /catalog notifications/);
  assert.match(app, /IANA enterprise records/);
  assert.match(app, /exact sysObjectID mappings/);
  assert.match(app, /published source records/);
  assert.doesNotMatch(app, /release\.object_count\.toLocaleString/);
});
