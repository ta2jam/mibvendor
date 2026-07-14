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

const specification = JSON.parse(
  await readFile(new URL("../docs/research/demand/phase0-openapi.json", import.meta.url), "utf8"),
);
const packageDocument = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

const expectedOperations = {
  "/v1/data-release": ["get"],
  "/v1/resolve:batch": ["post"],
  "/v1/search": ["get"],
  "/v1/objects/{objectId}": ["get"],
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

test("OpenAPI surface is exact and explicitly public alpha", () => {
  assert.equal(specification.openapi, "3.1.0");
  assert.equal(specification.info.version, packageDocument.version);
  assert.equal(specification["x-mibvendor-status"], "public-alpha");
  assert.deepEqual(specification.security, []);
  assert.deepEqual(Object.keys(specification.paths), Object.keys(expectedOperations));
  assert.equal(specification.servers[0].url, "https://mibvendor.io");

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

test("OpenAPI bounds and trust fields match the executable probe", () => {
  const schemas = specification.components.schemas;
  assert.equal(schemas.DataReleaseId.const, DATA_RELEASE);
  assert.equal(schemas.BatchRequest.properties.oids.maxItems, MAX_BATCH_SIZE);
  assert.equal(schemas.Oid.maxLength, MAX_OID_LENGTH);
  assert.equal(
    specification.paths["/v1/resolve:batch"].post["x-max-body-bytes"],
    MAX_BODY_BYTES,
  );
  assert.equal(
    specification.paths["/v1/search"].get.parameters[0].schema.maxLength,
    MAX_QUERY_LENGTH,
  );
  assert.equal(schemas.BatchResponse.properties.results.maxItems, MAX_BATCH_SIZE);
  assert.equal(schemas.Provenance.properties.publication_status.const, "public-alpha-synthetic");
  assert.equal(schemas.Provenance.properties.rights_tier.const, "A");
  assert.equal(schemas.RegistrySource.properties.rights.const, "CC0-1.0");
  assert.ok(schemas.MibObject.required.includes("description"));
  assert.ok(schemas.MibObject.required.includes("relationships"));
  assert.deepEqual(schemas.DependenciesResponse.required, ["data_release", "module", "status", "direct", "transitive", "missing", "cyclic", "diagnostics"]);

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
      ["/v1/data-release", {}],
      ["/v1/resolve:batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data_release: DATA_RELEASE, oids: ["1.3.6.1.2.1.1.3.0"] }),
      }],
      ["/v1/search?q=uptime", {}],
      ["/v1/objects/snmpv2-mib--sysuptime", {}],
      ["/v1/enterprises/8072", {}],
      ["/v1/sys-object-ids/1.3.6.1.4.1.8072.3.2.10", {}],
      ["/v1/modules/IF-MIB/dependencies", {}],
    ];
    for (const [path, options] of requests) {
      const response = await fetch(`${base}${path}`, options);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get("content-type"), "application/json", path);
      await response.json();
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
