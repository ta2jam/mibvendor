import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createMibvendorServer } from "../server.mjs";
import { DATA_RELEASE, IDENTITY_PUBLICATION_STATE, IDENTITY_RELEASE, IDENTITY_STATISTICS } from "../src/intelligence.mjs";

async function withServer(callback, options) {
  const server = createMibvendorServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("production server exposes UI, health, version, OpenAPI, and API on one origin", async () => {
  await withServer(async (base) => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /^text\/html/);
    assert.equal(page.headers.get("cache-control"), "no-cache");
    assert.match(await page.text(), /MIB context without the maze/);

    const stylesheet = await fetch(`${base}/styles.css`);
    assert.equal(stylesheet.status, 200);
    assert.equal(stylesheet.headers.get("cache-control"), "no-cache");
    await stylesheet.arrayBuffer();

    assert.equal(await (await fetch(`${base}/healthz`)).text(), "ok\n");
    const version = await (await fetch(`${base}/version`)).json();
    assert.equal(version.schema_version, 1);
    assert.equal(version.data_release, DATA_RELEASE);
    assert.equal(version.identity_release, IDENTITY_RELEASE);
    assert.deepEqual(version.identity_publication, IDENTITY_PUBLICATION_STATE);
    assert.deepEqual(version.identity_statistics, IDENTITY_STATISTICS);

    const specification = await (await fetch(`${base}/openapi.json`)).json();
    assert.equal(specification["x-mibvendor-status"], "public-alpha");

    const enterprise = await fetch(`${base}/v1/enterprises/8072`);
    assert.equal(enterprise.status, 200);
    assert.equal(enterprise.headers.get("access-control-allow-origin"), "*");
    assert.equal((await enterprise.json()).enterprise.organization, "net-snmp");

    const module = await fetch(`${base}/v1/modules/BFD-STD-MIB`);
    assert.equal(module.status, 200);
    assert.equal((await module.json()).module.raw_download, true);

    const raw = await fetch(`${base}/v1/modules/BFD-STD-MIB/raw`);
    assert.equal(raw.status, 200);
    assert.equal(raw.headers.get("content-type"), "application/x-tar");
    assert.equal(raw.headers.get("cache-control"), "no-cache");
    assert.match(raw.headers.get("content-disposition"), /BFD-STD-MIB-.*\.tar/);
    assert.match(raw.headers.get("x-content-sha256"), /^[0-9a-f]{64}$/);
    assert.match(raw.headers.get("x-mib-sha256"), /^[0-9a-f]{64}$/);
    const rawEtag = raw.headers.get("etag");
    assert.match(rawEtag, /^"sha256-[0-9a-f]{64}"$/);
    await raw.arrayBuffer();

    const cachedRaw = await fetch(`${base}/v1/modules/BFD-STD-MIB/raw`, {
      headers: { "if-none-match": rawEtag },
    });
    assert.equal(cachedRaw.status, 304);
    assert.equal(cachedRaw.headers.get("etag"), rawEtag);
  });
});

test("status is a no-store live-process contract for GET and HEAD", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/status`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const status = await response.json();
    assert.deepEqual(Object.keys(status), [
      "schema_version", "status", "checked_at", "version", "commit", "data_release", "identity_release", "identity_publication", "identity_statistics", "scope", "links",
    ]);
    assert.equal(status.schema_version, 1);
    assert.equal(status.status, "operational");
    assert.equal(Number.isNaN(Date.parse(status.checked_at)), false);
    assert.equal(status.version, process.env.APP_VERSION ?? "development");
    assert.equal(status.commit, process.env.VCS_REF ?? "development");
    assert.equal(status.data_release, process.env.DATA_RELEASE ?? DATA_RELEASE);
    assert.equal(status.identity_release, process.env.IDENTITY_RELEASE ?? IDENTITY_RELEASE);
    assert.deepEqual(status.identity_publication, IDENTITY_PUBLICATION_STATE);
    assert.deepEqual(status.identity_statistics, IDENTITY_STATISTICS);
    assert.equal(status.scope, "Live process self-check only; no uptime SLA or incident history.");
    assert.deepEqual(status.links, {
      health: "/healthz",
      production_monitor: "https://github.com/ta2jam/mibvendor/actions/workflows/production-monitor.yml",
    });

    const head = await fetch(`${base}/status`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(head.headers.get("cache-control"), "no-store");
    assert.match(head.headers.get("content-length"), /^[1-9][0-9]*$/);
    assert.equal(await head.text(), "");

    const rejected = await fetch(`${base}/status`, { method: "POST" });
    assert.equal(rejected.status, 405);
    assert.equal(rejected.headers.get("allow"), "GET, HEAD");
    assert.equal(rejected.headers.get("cache-control"), "no-store");
  });
});

test("version is a no-store GET and HEAD contract", async () => {
  await withServer(async (base) => {
    const get = await fetch(`${base}/version`);
    assert.equal(get.status, 200);
    assert.equal(get.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(get.headers.get("cache-control"), "no-store");
    assert.equal(get.headers.get("etag"), null);
    const version = await get.json();
    assert.deepEqual(Object.keys(version), [
      "schema_version", "version", "commit", "data_release", "identity_release", "identity_publication", "identity_statistics",
    ]);
    assert.equal(version.identity_release, IDENTITY_RELEASE);
    assert.deepEqual(version.identity_publication, IDENTITY_PUBLICATION_STATE);
    assert.deepEqual(version.identity_statistics, IDENTITY_STATISTICS);

    const head = await fetch(`${base}/version`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(head.headers.get("cache-control"), "no-store");
    assert.match(head.headers.get("content-length"), /^[1-9][0-9]*$/);
    assert.equal(await head.text(), "");

    const rejected = await fetch(`${base}/version`, { method: "POST" });
    assert.equal(rejected.status, 405);
    assert.equal(rejected.headers.get("allow"), "GET, HEAD");
  });
});

test("static server rejects traversal and unsupported methods", async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/.release.json`)).status, 404);
    assert.equal((await fetch(`${base}/..%2Fpackage.json`)).status, 404);
    assert.equal((await fetch(`${base}/app.js`, { method: "POST" })).status, 405);
  });
});

test("server serves the SPA shell only for explicit shareable routes", async () => {
  await withServer(async (base) => {
    for (const route of [
      "/search?q=uptime",
      "/objects/ipv6-tcp-mib--tcp",
      "/objects/1.3.6.1.2.1.6",
      "/modules/BFD-STD-MIB",
      "/enterprises/8072",
      "/sys-object-ids/1.3.6.1.4.1.8072.3.2.10",
      `/releases/${DATA_RELEASE}`
    ]) {
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get("content-type"), /^text\/html/, route);
      assert.match(await response.text(), /id="route-view"/, route);
    }

    const head = await fetch(`${base}/modules/BFD-STD-MIB`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.match(head.headers.get("content-type"), /^text\/html/);

    for (const route of [
      "/objects",
      "/objects/not/one-segment",
      "/modules/%2e%2e%2fsecret",
      "/enterprises/not-a-number",
      "/sys-object-ids/not-an-oid",
      "/releases/a/b",
      "/arbitrary-client-route"
    ]) assert.equal((await fetch(`${base}${route}`)).status, 404, route);
  });
});

test("malformed percent-encoded paths fail without terminating the server", async () => {
  await withServer(async (base) => {
    const malformed = await fetch(`${base}/v1/modules/%`);
    assert.equal(malformed.status, 400);
    assert.equal(await malformed.text(), "Bad request\n");

    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "ok\n");
  });
});

test("public API exposes rate limit headers and CORS preflight", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/data-release`);
    assert.equal(response.headers.get("ratelimit-limit"), "120");
    assert.equal(response.headers.get("ratelimit-remaining"), "119");
    assert.equal(
      response.headers.get("access-control-expose-headers"),
      "Content-Disposition, ETag, Link, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After, X-Content-SHA256, X-MIB-SHA256"
    );

    const preflight = await fetch(`${base}/v1/resolve:batch`, { method: "OPTIONS" });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
    assert.match(preflight.headers.get("access-control-expose-headers"), /Retry-After/);
  });
});

test("release-view JSON requires revalidation and honors If-None-Match", async () => {
  await withServer(async (base) => {
    const first = await fetch(`${base}/v1/data-release`);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("cache-control"), "no-cache");
    const etag = first.headers.get("etag");
    assert.match(etag, /^"sha256-[A-Za-z0-9_-]{43}"$/);
    await first.arrayBuffer();

    const cached = await fetch(`${base}/v1/data-release`, {
      headers: { "if-none-match": etag },
    });
    assert.equal(cached.status, 304);
    assert.equal(cached.headers.get("etag"), etag);
    assert.equal(cached.headers.get("cache-control"), "no-cache");
    assert.equal(cached.headers.get("content-type"), null);
    assert.equal(await cached.text(), "");
  });
});

test("body-dependent POST responses are never shared-cacheable", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/resolve:batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oids: ["1.3.6.1.2.1.1.3.0"] })
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("etag"), null);
    await response.arrayBuffer();
  });
});

test("fair-use exhaustion returns 429 with Retry-After instead of a billing path", async () => {
  await withServer(async (base) => {
    for (let requestNumber = 1; requestNumber <= 120; requestNumber += 1) {
      const response = await fetch(`${base}/v1/data-release`);
      assert.equal(response.status, 200, `request ${requestNumber}`);
      await response.arrayBuffer();
    }
    const limited = await fetch(`${base}/v1/data-release`);
    assert.equal(limited.status, 429);
    assert.match(limited.headers.get("retry-after"), /^\d+$/);
    assert.equal(limited.headers.get("ratelimit-remaining"), "0");
    const problem = await limited.json();
    assert.equal(problem.type, "https://mibvendor.io/problems/rate-limit-exceeded");
    assert.doesNotMatch(JSON.stringify(problem), /(?:payment|billing|subscription|paid plan)/i);
  });
});

test("direct X-Real-IP input cannot shard the rate-limit bucket", async () => {
  await withServer(async (base) => {
    const request = (sequence) => fetch(`${base}/v1/device-identities:assess`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": `198.51.100.${sequence}`,
        "x-real-ip": `198.51.100.${sequence}`
      },
      body: JSON.stringify({ signals: { sys_object_id: "1.3.6.1.4.1.9.1.2435" } })
    });
    for (let sequence = 1; sequence <= 30; sequence += 1) {
      const response = await request(sequence);
      assert.equal(response.status, 200, `weighted request ${sequence}`);
      await response.arrayBuffer();
    }
    const limited = await request(31);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("ratelimit-remaining"), "0");
  });
});

test("explicit trusted-proxy mode uses only matching validated Cloudflare client headers", async () => {
  await withServer(async (base) => {
    const request = (client) => fetch(`${base}/v1/device-identities:assess`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": client,
        "x-real-ip": client
      },
      body: JSON.stringify({ signals: { sys_object_id: "1.3.6.1.4.1.9.1.2435" } })
    });

    for (let sequence = 1; sequence <= 30; sequence += 1) {
      const response = await request("198.51.100.10");
      assert.equal(response.status, 200, `trusted weighted request ${sequence}`);
      await response.arrayBuffer();
    }
    assert.equal((await request("198.51.100.10")).status, 429);
    const independentClient = await request("198.51.100.11");
    assert.equal(independentClient.status, 200);
    assert.equal(independentClient.headers.get("ratelimit-remaining"), "116");
    await independentClient.arrayBuffer();
  }, { trustProxyHeaders: true });
});
