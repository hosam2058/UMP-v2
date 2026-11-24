# Trusted financial query runtime

This is an internal Phase 2 composition boundary. It does not activate HTTP
routes, OpenAPI success responses, ingestion, or provider access.

## Construction

`createTrustedFinancialQueryRuntime` in
`apps/api-server/src/query-services/trusted-financial-query-runtime.ts` accepts
repositories, an optional registry override for controlled tests, and an
injected clock. In normal use it loads
`curatedStockMappingRegistry` from the source-controlled registry data module.
The registry is snapshotted at construction, and its version and complete
revision/lifecycle history are validated once. The resulting authorization
service is injected into `StoredSecQueryService`.

`createDatabaseBackedTrustedFinancialQueryRuntime` additionally validates the
explicit persistence capability, creates one owned database pool, and returns
`close()` for the caller's shutdown path. It does not read environment variables
or create a module-global client. The API entry point remains health-only and
does not call this factory yet.

## Authority and read behavior

An instrument query needs all of the following: a valid normalized symbol and
exchange; a supported, historically valid registry; an approved revision whose
lifecycle and effective interval allow access at the supplied/injected time;
and exact agreement with the persisted instrument and company identity. The
persisted `active` flag is not an authorization input. A ticker never resolves
a CIK. Filings and facts are queried by the persisted company ID only after
authorization, and retain their source and retrieval/reporting provenance.

A valid empty registry is usable authority with zero approved instruments, so
instrument lookups return `unsupported-instrument`. Missing authority and an
invalid version/history return `authority-unavailable` with distinct reasons.
Pending, rejected, retired, superseded, future, expired, missing, conflicting,
or mismatched mappings fail closed before any stored financial query. Direct
CIK queries remain available independently of curated instrument authority.

For authorized companies, no stored filings/facts is represented internally as
an available bounded collection with zero items; a missing company is
`not-found`. Public response semantics remain unapproved and unavailable-only
until a separate OpenAPI and route activation milestone reviews those cases.
Invalid filters and limits are rejected before repository reads. Collections
are bounded to 1–100 rows and ordered by source dates/identity plus stable
database tie-breakers. Database unique constraints continue to govern duplicate
filings and fact identities.

The runtime is read-only: it does not contact SEC or another provider, persist
or onboard mappings, start ingestion, or write query results. PostgreSQL
integration fixtures are synthetic, use only the isolated test database, and
roll back their writes.

## Remaining before public API activation

- Source-backed, human-approved registry entries and corresponding explicitly
  onboarded persisted identities; no entries are included by this milestone.
- Reviewed public response/error semantics and OpenAPI-first success schemas,
  followed by generated client schema review.
- Explicit API application startup/shutdown ownership if persistence is later
  composed into the server.
- A separate review of data availability, freshness, pagination, and route
  behavior before public activation.
