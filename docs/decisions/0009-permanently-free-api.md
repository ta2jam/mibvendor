# ADR 0009: Keep the public API permanently free and fair-use bounded

Status: Accepted

Date: 2026-07-20

## Decision

The official mibvendor public API is permanently free to use. It has no paid
tier, subscription, billing integration, metered plan, paid quota increase, or
feature reserved for payment. This decision applies to the public API for as
long as mibvendor operates it; it is not a promise that the service will exist
forever.

Anonymous access remains the default. If optional API keys are introduced,
they will be free abuse-control credentials only. A key may help identify,
limit, or revoke abusive clients, but it will not unlock a paid plan, purchased
capacity, preferential availability, or an availability SLA.

Free access does not mean unlimited use. The service retains fair-use controls:

- per-client rate limits and explicit `RateLimit-*` and `Retry-After` headers;
- bounded request bodies, batch sizes, search inputs, and page sizes;
- cursor pagination instead of unbounded list responses;
- cacheable GET reads with `Cache-Control` and `ETag` validators, while
  body-dependent POST responses remain `no-store`;
- deterministic rights-approved download archives containing the exact MIB,
  retained license or notice, and provenance; the active unversioned route
  revalidates withdrawal controls instead of using an immutable client cache;
- rejection or temporary blocking of abusive traffic.

Operational limits may change to protect service availability. Clients must
honor the response headers and back off after `429` responses instead of
assuming a fixed quota. The public API provides no availability, latency,
support, retention, or capacity SLA.

## Consequences

- Pricing, checkout, subscriptions, billing providers, paid plans, and paid
  quota upgrades are outside the product and implementation scope.
- Documentation must state permanent free access and the fair-use boundary
  together; neither may be presented without the other.
- Optional API keys must never be described or implemented as a paid feature.
- Capacity is protected through bounded work, caching, release pinning, and
  abuse controls rather than customer billing.
- Generating a strong response `ETag` is `O(B)` time for a `B`-byte response
  and constant incremental hash memory; the serialized response body remains
  the dominant memory cost.
