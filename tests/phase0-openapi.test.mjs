import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DATA_RELEASE,
  MAX_BATCH_SIZE,
  MAX_BODY_BYTES,
  MAX_OID_LENGTH,
  MAX_QUERY_LENGTH,
  createPhase0ApiMock,
} from "../scripts/phase0-api-mock.mjs";
import {
  IDENTITY_PUBLICATION_STATE,
  IDENTITY_RELEASE,
  IDENTITY_SOURCES,
  IDENTITY_STATISTICS,
  MAX_IDENTITY_BODY_BYTES,
  MAX_IDENTITY_MODEL_LENGTH,
  MAX_IDENTITY_RESULTS,
  MAX_IDENTITY_SYS_DESCR_LENGTH,
  MAX_NAVIGATION_CHILDREN,
  MAX_NAVIGATION_DEPTH,
  MAX_NAVIGATION_SUBTREE_NODES,
} from "../src/api.mjs";

const specification = JSON.parse(
  await readFile(new URL("../docs/research/demand/phase0-openapi.json", import.meta.url), "utf8"),
);
const packageDocument = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

const expectedOperations = {
  "/status": ["get", "head"],
  "/version": ["get", "head"],
  "/v1/data-release": ["get"],
  "/v1/device-identities:assess": ["post"],
  "/v1/resolve:batch": ["post"],
  "/v1/search": ["get"],
  "/v1/objects/{objectId}": ["get"],
  "/v1/objects/{objectId}/navigation": ["get"],
  "/v1/modules": ["get"],
  "/v1/modules/{moduleId}": ["get"],
  "/v1/modules/{moduleId}/raw": ["get"],
  "/v1/sources": ["get"],
  "/v1/sources/{sourceId}": ["get"],
  "/v1/enterprises/{enterpriseNumber}": ["get"],
  "/v1/sys-object-ids/{oid}": ["get"],
  "/v1/modules/{moduleId}/dependencies": ["get"],
};

async function withServer(callback) {
  const server = createPhase0ApiMock();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function schemaValueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function resolveSchema(schema) {
  if (!schema?.$ref) return schema;
  const prefix = "#/components/schemas/";
  assert.ok(schema.$ref.startsWith(prefix), `unsupported schema reference ${schema.$ref}`);
  return specification.components.schemas[schema.$ref.slice(prefix.length)];
}

function schemaErrors(value, inputSchema, path = "$") {
  const schema = resolveSchema(inputSchema);
  const errors = [];
  if (!schema) return [`${path}: schema is missing`];

  if (Object.hasOwn(schema, "const") && !Object.is(value, schema.const)) {
    errors.push(`${path}: expected constant ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) {
    errors.push(`${path}: value is outside the documented enum`);
  }

  if (schema.type) {
    const actual = schemaValueType(value);
    const accepted = Array.isArray(schema.type) ? schema.type : [schema.type];
    const typeMatches = accepted.includes(actual)
      || (actual === "integer" && accepted.includes("number"));
    if (!typeMatches) return [...errors, `${path}: expected ${accepted.join("|")}, received ${actual}`];
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: shorter than minLength`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: longer than maxLength`);
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) errors.push(`${path}: does not match pattern`);
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above maximum`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: shorter than minItems`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: longer than maxItems`);
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) {
      errors.push(`${path}: items are not unique`);
    }
    if (schema.items) value.forEach((item, index) => errors.push(...schemaErrors(item, schema.items, `${path}[${index}]`)));
  }

  if (value !== null && !Array.isArray(value) && typeof value === "object") {
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) errors.push(`${path}.${required}: required property is missing`);
    }
    const properties = schema.properties ?? {};
    for (const [key, item] of Object.entries(value)) {
      if (properties[key]) errors.push(...schemaErrors(item, properties[key], `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: undocumented additional property`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        errors.push(...schemaErrors(item, schema.additionalProperties, `${path}.${key}`));
      }
    }
  }

  for (const keyword of ["anyOf", "oneOf"]) {
    if (!schema[keyword]) continue;
    const alternatives = schema[keyword].map((candidate) => schemaErrors(value, candidate, path));
    const matches = alternatives.filter((candidateErrors) => candidateErrors.length === 0).length;
    if ((keyword === "anyOf" && matches === 0) || (keyword === "oneOf" && matches !== 1)) {
      errors.push(`${path}: does not satisfy ${keyword}`);
      errors.push(...alternatives.sort((left, right) => left.length - right.length)[0]);
    }
  }

  return errors;
}

function assertConformsToOpenApi(value, schemaName) {
  assert.deepEqual(
    schemaErrors(value, specification.components.schemas[schemaName]),
    [],
    `${schemaName} response drifted from OpenAPI`,
  );
}

test("OpenAPI surface is exact and explicitly public alpha", () => {
  assert.equal(specification.openapi, "3.1.0");
  assert.equal(packageDocument.version, "0.4.0-alpha.3");
  assert.equal(specification.info.version, packageDocument.version);
  assert.equal(specification.info.title, "mibvendor Permanently Free Public API");
  assert.match(specification.info.description, /Permanently free/);
  assert.match(specification.info.description, /fair-use bounded, not unlimited use or an availability SLA/);
  assert.equal(specification["x-mibvendor-status"], "public-alpha");
  assert.deepEqual(specification.security, []);
  assert.deepEqual(Object.keys(specification.paths), Object.keys(expectedOperations));
  assert.equal(specification.servers[0].url, "https://mibvendor.io");
  assert.deepEqual(specification["x-service-links"], {
    health: "https://mibvendor.io/healthz",
    status: "https://mibvendor.io/status",
    version: "https://mibvendor.io/version",
    openapi: "https://mibvendor.io/openapi.json",
    production_monitor: "https://github.com/ta2jam/mibvendor/actions/workflows/production-monitor.yml",
  });
  assert.equal(specification.paths["/status"].get.responses["200"].headers["Cache-Control"].$ref, "#/components/headers/NoStore");
  assert.equal(specification.paths["/version"].head.responses["200"].headers["Cache-Control"].$ref, "#/components/headers/NoStore");

  const operationIds = new Set();
  for (const [path, methods] of Object.entries(expectedOperations)) {
    assert.deepEqual(Object.keys(specification.paths[path]), methods);
    for (const method of methods) {
      const operation = specification.paths[path][method];
      assert.ok(operation.operationId);
      assert.equal(operationIds.has(operation.operationId), false);
      operationIds.add(operation.operationId);
      assert.ok(operation.responses["200"]);
    }
  }
});

test("real success and cursor examples stay synchronized with executable responses", async () => {
  const enterpriseExample = specification.paths["/v1/enterprises/{enterpriseNumber}"]
    .get.responses["200"].content["application/json"].examples.netSnmp.value;
  const moduleExamples = specification.paths["/v1/modules"]
    .get.responses["200"].content["application/json"].examples;
  const identityExample = specification.paths["/v1/device-identities:assess"]
    .post.responses["200"].content["application/json"].examples.c9300.value;
  const identityRequestExample = specification.paths["/v1/device-identities:assess"]
    .post.requestBody.content["application/json"].examples.c9300.value;
  const cursorParameter = specification.paths["/v1/modules"].get.parameters
    .find((parameter) => parameter.name === "cursor");
  assert.match(cursorParameter.description, /pass .*next_cursor unchanged/i);
  assert.match(specification.components.schemas.ModuleListResponse.properties.next_cursor.description, /unchanged/);
  assert.match(readme, /A real `200` response from `GET \/v1\/enterprises\/8072` is/);
  assert.ok(
    readme.includes(`\`\`\`json\n${JSON.stringify(enterpriseExample, null, 2)}\n\`\`\``),
    "README enterprise success JSON drifted from the executable OpenAPI example",
  );
  assert.match(readme, /send the returned `next_cursor` unchanged/);
  assert.ok(readme.includes("https://mibvendor.io/v1/modules?q=IANA&limit=1&cursor=0"));
  assert.ok(readme.includes("https://mibvendor.io/v1/modules?q=IANA&limit=1&cursor=1"));
  assert.match(readme, /https:\/\/mibvendor\.io\/status/);

  await withServer(async (base) => {
    const enterprise = await (await fetch(`${base}/v1/enterprises/8072`)).json();
    assert.deepEqual(enterprise, enterpriseExample);

    const firstPage = await (await fetch(`${base}/v1/modules?q=IANA&limit=1&cursor=0`)).json();
    assert.deepEqual(firstPage, moduleExamples.firstPage.value);
    assert.equal(firstPage.cursor, 0);
    assert.equal(firstPage.next_cursor, 1);

    const nextPage = await (await fetch(
      `${base}/v1/modules?q=IANA&limit=1&cursor=${firstPage.next_cursor}`,
    )).json();
    assert.deepEqual(nextPage, moduleExamples.nextPage.value);
    assert.equal(nextPage.cursor, firstPage.next_cursor);
    assert.notEqual(nextPage.results[0].id, firstPage.results[0].id);

    const assessed = await (await fetch(`${base}/v1/device-identities:assess`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(identityRequestExample),
    })).json();
    assert.deepEqual(assessed, identityExample);
    assertConformsToOpenApi(identityExample, "DeviceIdentityAssessmentResponse");
  });
});

test("identity examples and runtime responses reject undocumented properties", async () => {
  const identityExample = specification.paths["/v1/device-identities:assess"]
    .post.responses["200"].content["application/json"].examples.c9300.value;
  const invalidExample = structuredClone(identityExample);
  invalidExample.assessment.candidates[0].undocumented_field = true;
  assert.match(
    schemaErrors(invalidExample, specification.components.schemas.DeviceIdentityAssessmentResponse).join("\n"),
    /undocumented additional property/,
    "contract canary did not detect an undocumented nested response property",
  );

  await withServer(async (base) => {
    const release = await (await fetch(`${base}/v1/data-release`)).json();
    assertConformsToOpenApi(release, "DataRelease");

    const assessment = await (await fetch(`${base}/v1/device-identities:assess`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signals: { sys_object_id: "1.3.6.1.4.1.9.1.2435" } }),
    })).json();
    assertConformsToOpenApi(assessment, "DeviceIdentityAssessmentResponse");

    const projectDefinitionAssessment = await (await fetch(`${base}/v1/device-identities:assess`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signals: { sys_object_id: "1.3.6.1.4.1.9.6.1.83.10.1" } })
    })).json();
    assertConformsToOpenApi(projectDefinitionAssessment, "DeviceIdentityAssessmentResponse");

    for (const oid of [
      "1.3.6.1.4.1.9.1.2435",
      "1.3.6.1.4.1.9.6.1.83.10.1",
      "1.3.6.1.4.1.30065.1.99",
      "1.3.6.1.4.1.1004849.3.2.7",
      "1.3.6.1.4.1.8072.3.2.10"
    ]) {
      const lookup = await (await fetch(`${base}/v1/sys-object-ids/${oid}`)).json();
      assertConformsToOpenApi(lookup, "SysObjectIdResponse");
    }
  });
});

test("OpenAPI makes the permanently-free fair-use boundary machine-readable", () => {
  const policy = specification["x-mibvendor-access-policy"];
  assert.equal(policy.access, "permanently-free");
  assert.equal(policy.paid_tiers, false);
  assert.equal(policy.billing, false);
  assert.equal(policy.unlimited_use, false);
  assert.equal(policy.availability_sla, false);
  assert.deepEqual(policy.authentication, {
    required: false,
    optional_keys: "free-abuse-control-only",
  });
  assert.deepEqual(policy.fair_use, {
    rate_limit_units_per_client: 120,
    default_request_units: 1,
    window_seconds: 60,
    limits_may_change: true,
    operation_costs: { "POST /v1/device-identities:assess": 4 },
    response_headers: ["RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After"],
    cors_exposed_response_headers: ["Content-Disposition", "ETag", "Link", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After", "X-Content-SHA256", "X-MIB-SHA256"],
  });
  assert.deepEqual(policy.caching, {
    cache_control: true,
    etag: true,
    conditional_get: true,
    cursor_pagination: true,
    immutable_release_artifacts: true,
    post_responses_no_store: true,
    active_raw_revalidation: true,
  });
  for (const header of [
    "CacheControl", "NoCache", "ETag", "RateLimitLimit", "RateLimitRemaining", "RateLimitReset", "RetryAfter",
  ]) assert.ok(specification.components.headers[header], `missing reusable header ${header}`);
  const releaseHeaders = specification.paths["/v1/data-release"].get.responses["200"].headers;
  assert.equal(releaseHeaders.ETag.$ref, "#/components/headers/ETag");
  assert.equal(releaseHeaders["Cache-Control"].$ref, "#/components/headers/NoCache");
  assert.equal(releaseHeaders["RateLimit-Limit"].$ref, "#/components/headers/RateLimitLimit");
  const sysObjectIdHeaders = specification.paths["/v1/sys-object-ids/{oid}"].get.responses["200"].headers;
  assert.equal(sysObjectIdHeaders.ETag.$ref, "#/components/headers/ETag");
  assert.equal(sysObjectIdHeaders["Cache-Control"].$ref, "#/components/headers/NoCache");
  const rawHeaders = specification.paths["/v1/modules/{moduleId}/raw"].get.responses["200"].headers;
  assert.equal(rawHeaders.ETag.$ref, "#/components/headers/ETag");
  assert.equal(rawHeaders["Cache-Control"].$ref, "#/components/headers/CacheControl");
  assert.match(rawHeaders["X-MIB-SHA256"].schema.pattern, /a-f/);
  assert.equal(specification.components.responses.Problem.headers["Retry-After"].$ref, "#/components/headers/RetryAfter");
});

test("OpenAPI bounds and trust fields match the executable probe", () => {
  const schemas = specification.components.schemas;
  assert.equal(schemas.DataReleaseId.const, DATA_RELEASE);
  assert.equal(schemas.DataReleaseId.const, "license-signaled-2026-07-20.2");
  assert.equal(schemas.BatchRequest.properties.oids.maxItems, MAX_BATCH_SIZE);
  assert.equal(schemas.Oid.maxLength, MAX_OID_LENGTH);
  assert.equal(
    specification.paths["/v1/resolve:batch"].post["x-max-body-bytes"],
    MAX_BODY_BYTES,
  );
  const assessmentOperation = specification.paths["/v1/device-identities:assess"].post;
  assert.equal(assessmentOperation["x-max-body-bytes"], MAX_IDENTITY_BODY_BYTES);
  assert.equal(assessmentOperation["x-rate-limit-units"], 4);
  assert.equal(schemas.DeviceIdentitySignals.properties.sys_object_id.maxLength, MAX_OID_LENGTH);
  assert.equal(schemas.DeviceIdentitySignals.properties.ent_physical_vendor_type.maxLength, MAX_OID_LENGTH);
  assert.equal(schemas.DeviceIdentitySignals.properties.ent_physical_model_name.maxLength, MAX_IDENTITY_MODEL_LENGTH);
  assert.equal(schemas.DeviceIdentitySignals.properties.sys_descr.maxLength, MAX_IDENTITY_SYS_DESCR_LENGTH);
  assert.equal(schemas.DeviceIdentityAssessment.properties.candidates.maxItems, MAX_IDENTITY_RESULTS);
  assert.equal(schemas.DeviceIdentityAssessment.properties.conflicts.maxItems, MAX_IDENTITY_RESULTS);
  assert.match(assessmentOperation.description, /neither echoed nor part of the response evidence/);
  assert.equal(
    specification.paths["/v1/search"].get.parameters[0].schema.maxLength,
    MAX_QUERY_LENGTH,
  );
  assert.equal(schemas.BatchResponse.properties.results.maxItems, MAX_BATCH_SIZE);
  assert.deepEqual(schemas.Provenance.properties.publication_mode.enum, ["redistributable", "metadata-only"]);
  assert.deepEqual(schemas.Provenance.properties.rights_tier.enum, ["A", "B"]);
  assert.equal(schemas.RegistrySource.properties.rights.const, "CC0-1.0");
  assert.ok(schemas.SysObjectIdMatch.required.includes("claim_strength"));
  assert.deepEqual(schemas.SysObjectIdMatch.properties.claim_strength.enum, ["exact_model", "product_family", "vendor_identifier", "platform", "vendor_only"]);
  assert.equal(schemas.FirmwareScope.const, "not_established");
  assert.ok(schemas.DeviceIdentityCandidate.required.includes("firmware_scope"));
  assert.ok(schemas.DeviceIdentityAssessment.required.includes("firmware_scope"));
  assert.ok(schemas.SysObjectIdMatch.required.includes("firmware_scope"));
  assert.ok(schemas.ProjectObservationCandidate.required.includes("firmware_scope"));
  assert.ok(schemas.SysObjectIdResult.required.includes("firmware_scope"));
  assert.equal(schemas.SysObjectIdMatch.properties.provenance.$ref, "#/components/schemas/IdentityProvenance");
  assert.deepEqual(schemas.IdentityArtifactEvidence.required, ["fields", "symbols", "source_path", "source_url", "git_blob_oid", "sha256"]);
  assert.ok(schemas.MibObject.required.includes("description"));
  assert.ok(schemas.MibObject.required.includes("relationships"));
  assert.deepEqual(schemas.DependenciesResponse.required, ["data_release", "module", "status", "direct", "transitive", "missing", "cyclic", "diagnostics"]);
  assert.equal(schemas.ModuleStatistics.properties.total.const, 702);
  assert.equal(schemas.OidNodeStatistics.properties.catalog_oid_nodes.const, 76_606);
  assert.equal(schemas.OidNodeStatistics.properties.supplemental_legacy_records.const, 0);
  assert.equal(schemas.OidNodeStatistics.properties.searchable_records.const, 76_606);
  assert.equal(schemas.DefinitionStatistics.properties.textual_conventions.properties.active_module_definitions.const, 4_138);
  assert.equal(schemas.DefinitionStatistics.properties.notifications.properties.searchable_records.const, 1_273);
  assert.equal(schemas.IdentityStatistics.properties.sys_object_id_mappings.maximum, IDENTITY_STATISTICS.sys_object_id_mappings);
  assert.equal(schemas.IdentityStatistics.properties.product_families.maximum, IDENTITY_STATISTICS.product_families);
  assert.equal(schemas.DeviceIdentityStatistics.properties.sys_object_id_mappings.maximum, IDENTITY_STATISTICS.sys_object_id_mappings);
  assert.equal(schemas.DeviceIdentityStatistics.properties.exact_models.maximum, IDENTITY_STATISTICS.exact_models);
  assert.equal(schemas.DeviceIdentityStatistics.properties.product_families.maximum, IDENTITY_STATISTICS.product_families);
  assert.equal(schemas.DeviceIdentityStatistics.properties.vendor_identifiers.maximum, IDENTITY_STATISTICS.vendor_identifiers);
  assert.equal(schemas.DeviceIdentityStatistics.properties.project_observation_oids.maximum, IDENTITY_STATISTICS.project_observation_oids);
  assert.equal(schemas.DeviceIdentityStatistics.properties.project_definition_oids.maximum, IDENTITY_STATISTICS.project_definition_oids);
  assert.equal(schemas.DeviceIdentityStatistics.properties.project_identity_oid_coverage.maximum, IDENTITY_STATISTICS.project_identity_oid_coverage);
  assert.equal(schemas.DeviceIdentityStatistics.properties.disabled_sources.maximum, IDENTITY_SOURCES.length);
  assert.equal(schemas.DataRelease.properties.identity_sources.minItems, IDENTITY_SOURCES.length);
  assert.equal(schemas.DataRelease.properties.identity_sources.maxItems, IDENTITY_SOURCES.length);
  assert.equal(schemas.IdentityReleaseId.const, IDENTITY_RELEASE);
  assert.deepEqual(Object.keys(IDENTITY_PUBLICATION_STATE), schemas.IdentityPublication.required);
  assert.equal(schemas.SourceStatistics.properties.total.const, 32);
  assert.equal(schemas.SourceStatistics.properties.publication_modes.properties.redistributable.const, 12);
  assert.equal(schemas.SourceStatistics.properties.publication_modes.properties["directory-only"].const, 20);
  assert.equal(schemas.PublicationControlStatistics.properties.event_count.const, 2);
  assert.equal(schemas.PublicationControlStatistics.properties.disabled_sources.const, 0);
  assert.equal(schemas.PublicationControlStatistics.properties.disabled_modules.const, 0);
  const navigationParameters = specification.paths["/v1/objects/{objectId}/navigation"].get.parameters;
  assert.equal(navigationParameters.find((parameter) => parameter.name === "child_limit").schema.maximum, MAX_NAVIGATION_CHILDREN);
  assert.equal(navigationParameters.find((parameter) => parameter.name === "subtree_depth").schema.maximum, MAX_NAVIGATION_DEPTH);
  assert.equal(navigationParameters.find((parameter) => parameter.name === "subtree_limit").schema.maximum, MAX_NAVIGATION_SUBTREE_NODES);

  for (const [name, schema] of Object.entries(schemas)) {
    if (!schema.required) continue;
    for (const property of schema.required) {
      assert.ok(schema.properties[property], `${name}.${property} is required but undefined`);
    }
  }
});

test("every documented operation is reachable with its documented media type", async () => {
  await withServer(async (base) => {
    const requests = [
      ["/v1/data-release", {}, "application/json"],
      ["/v1/device-identities:assess", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signals: { sys_object_id: "1.3.6.1.4.1.9.1.2435" } }),
      }, "application/json"],
      ["/v1/resolve:batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data_release: DATA_RELEASE, oids: ["1.3.6.1.2.1.1.3.0"] }),
      }, "application/json"],
      ["/v1/search?q=uptime", {}, "application/json"],
      ["/v1/objects/snmpv2-mib--sysuptime", {}, "application/json"],
      ["/v1/objects/ipv6-tcp-mib--tcp/navigation", {}, "application/json"],
      ["/v1/modules?q=BFD", {}, "application/json"],
      ["/v1/modules/BFD-STD-MIB", {}, "application/json"],
      ["/v1/modules/BFD-STD-MIB/raw", {}, "application/x-tar"],
      ["/v1/sources", {}, "application/json"],
      ["/v1/sources/cisco", {}, "application/json"],
      ["/v1/enterprises/8072", {}, "application/json"],
      ["/v1/sys-object-ids/1.3.6.1.4.1.8072.3.2.10", {}, "application/json"],
      ["/v1/modules/IF-MIB/dependencies", {}, "application/json"],
    ];
    for (const [path, options, contentType] of requests) {
      const response = await fetch(`${base}${path}`, options);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get("content-type"), contentType, path);
      if (contentType === "application/json") await response.json();
      else await response.text();
    }
  });
});

test("documented problem responses use RFC 9457-compatible media and fields", async () => {
  const problemSchema = specification.components.schemas.Problem;
  assert.deepEqual(problemSchema.required, ["type", "title", "status", "detail"]);
  assert.ok(specification.components.responses.Problem.content["application/problem+json"]);

  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/objects/not-a-real-object`);
    const body = await response.json();
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("content-type"), "application/problem+json");
    assert.deepEqual(Object.keys(body), problemSchema.required);
  });
});

test("release, item, and query bounds fail explicitly", async () => {
  await withServer(async (base) => {
    const wrongRelease = await fetch(`${base}/v1/resolve:batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data_release: "unknown", oids: ["1.3.6.1"] }),
    });
    assert.equal(wrongRelease.status, 409);
    assert.equal((await wrongRelease.json()).type, "https://mibvendor.io/problems/data-release-unavailable");

    const wrongType = await fetch(`${base}/v1/resolve:batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oids: [123] }),
    });
    assert.equal(wrongType.status, 422);

    const longQuery = await fetch(`${base}/v1/search?q=${"x".repeat(MAX_QUERY_LENGTH + 1)}`);
    assert.equal(longQuery.status, 422);
    assert.equal((await longQuery.json()).type, "https://mibvendor.io/problems/query-too-long");
  });
});
