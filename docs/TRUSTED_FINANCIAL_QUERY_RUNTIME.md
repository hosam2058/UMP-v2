# Trusted financial query runtime and data readiness

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

## Internal readiness contract

`assessFinancialDataReadinessByCik` and
`assessFinancialDataReadinessByInstrument` summarize the existing stored
collections through the same query service and authorization boundary. They do
not add another repository or ingestion path. The result is `available` when
the company exists and, for instrument calls, is authorized. Each dataset then
reports `availability` as `empty`, `available`, or
`requested-data-missing`; it also reports the bounded `items`, returned count,
limit, and whether the returned rows have complete source provenance.

For example, an authorized issuer with no stored SEC rows returns:

```ts
{
  status: "available",
  company: { cik: "0000123456", legalName: "Fictional Example Corporation" },
  filings: { availability: "empty", provenance: "not-applicable", items: [], returnedCount: 0, limit: 50 },
  fundamentals: { availability: "empty", provenance: "not-applicable", items: [], returnedCount: 0, limit: 50 },
  freshness: { status: "not-applicable", reason: "NO_STORED_FINANCIAL_DATA" }
}
```

When stored facts exist but a requested concept/reporting interval does not,
the fundamentals dataset is `requested-data-missing`, with the request echoed
so a caller can distinguish it from an issuer with no facts at all. A filter
such as `{ taxonomy: "us-gaap", tag: "Assets", reportingStart: null,
reportingEnd: "2025-12-31" }` selects the instant context ending on that date;
`reportingStart: undefined` leaves duration/instant context unfiltered. A
requested miss is not converted into an estimated value or a successful fact.

For rows returned from PostgreSQL, readiness checks source provider/name,
optional HTTPS source base URL, HTTPS filing source URL, and valid retrieval
timestamps. Facts may have a null `sourceAsOf`; it remains explicit rather than
being invented. `provenance: "incomplete"` identifies stored rows that fail
those checks. Numeric values remain exact strings.

Freshness is deliberately not classified as fresh or stale. When any stored
rows exist, the result reports `freshness: { status: "unknown", reason:
"FRESHNESS_POLICY_NOT_CONFIGURED" }`. Source-as-of and retrieval timestamps
are preserved, but no age threshold or freshness policy is approved. Invalid
filters return `invalid-input` before company, authorization, or data reads;
unknown CIKs return `not-found`; unsupported/unauthorized instruments retain
the existing authorization result union.

Callers can distinguish result layers directly:

- `{ status: "not-found", reason: "COMPANY_NOT_FOUND" }` means the CIK has no
  persisted company.
- `unsupported-instrument`, `unauthorized-mapping`,
  `authority-unavailable`, and `ambiguous` remain authorization outcomes; no
  readiness repository queries follow a denied instrument.
- `{ status: "invalid-input", reason: ... }` means the request was rejected
  before repository reads.
- Top-level `status: "available"` means the company identity was resolved (and
  instrument authority passed, when applicable). Dataset availability then
  distinguishes stored rows, no stored rows, and a requested subset that is
  missing.

Fact identity includes `sourceId` by the approved persistence contract. Thus
same-context records from different sources remain separately attributed; the
readiness layer does not choose a winning provider or merge them. Filing and
fact duplicates within their canonical source identity remain prevented by
database uniqueness constraints. Source precedence and cross-source
reconciliation require a separate reviewed policy.

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
