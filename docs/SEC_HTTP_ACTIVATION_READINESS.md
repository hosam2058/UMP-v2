# SEC HTTP activation readiness

## Current boundary

The active Express application is assembled in `apps/api-server/src/app.ts`.
It exposes `GET /api/healthz` and three instrument endpoints that always return
the existing JSON `503 DATA_UNAVAILABLE` response. Those routes do not import
or call PostgreSQL repositories, the trusted financial query runtime, an SEC
provider, or ingestion. `createApp()` builds only this HTTP surface; it does
not inspect `DATABASE_URL` or allocate a pool. The current process entry point
owns only its HTTP listener. There is no database resource to close because the
trusted query runtime is not part of startup.

The internal capability already exists separately: the trusted query runtime
composes curated mapping authorization with company-level stored filings,
facts, and readiness queries. It is read-only and provider-free. Its database
factory owns a pool and returns `close()`, but no server lifecycle currently
constructs that runtime. This separation is deliberate while the instrument
registry is empty and activation has not been approved.

The HTTP request-level regression test exercises the real app using an
ephemeral loopback listener. It verifies health without persistence config,
all three exact unavailable status/code responses, and that an unregistered
company route stays absent. It does not create a database pool.

The HTTP logger records expected unavailable responses as warnings with a safe
error code. It does not serialize the framework-created error or its stack,
so database or filesystem details cannot appear in those request logs.

## OpenAPI and generated validation

`packages/api-spec/openapi.yaml` is canonical. `packages/api-zod/src/generated`
is owned by Orval; `packages/api-zod/src/index.ts` is the hand-maintained
re-export. Do not patch generated files directly. Run `pnpm codegen`, inspect
the generated diff, then run it again and confirm no further changes.

The reported `zod.void()` output was reproducible with Orval's default
successful-response selection: the three instrument operations have only a
documented 503 response and no 2xx response. Inspection of the installed Orval
8.20.0 generator identified its supported `override.zod.generateEachHttpStatus`
option. `packages/api-spec/orval.config.ts` now enables it, so codegen emits
`GetInstrument503Response`, `GetInstrumentFilings503Response`, and
`GetInstrumentFundamentals503Response` as Zod validators directly from the
documented OpenAPI 503 JSON bodies. The active routes parse their response
objects with these generated schemas, and the request-level test validates
the returned bodies against the same schemas. This corrects the issue without
adding any public success response or editing generated output by hand.

The current OpenAPI must continue to describe only the active health and
unavailable behavior until response semantics are approved. No financial
success schema is published by this readiness work.

## Proposed transport semantics for review

These are proposals for a later OpenAPI decision, not active behavior or
approved public commitments:

| Internal outcome                                                                    | Candidate HTTP treatment                                                                                 | Review point                                                                   |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Invalid CIK, symbol/exchange, filter, date, or limit                                | `400` with a stable structured validation code                                                           | Decide whether invalid issuer identity and invalid query filters share a code. |
| Unknown persisted company                                                           | `404`                                                                                                    | Keep distinct from authorized company with an empty collection.                |
| Valid but empty registry / unsupported instrument                                   | Generic `404` or unavailable response                                                                    | Avoid exposing curated-registry coverage details.                              |
| Pending, rejected, retired, expired, superseded, mismatched, or conflicting mapping | Same externally indistinguishable response as unsupported                                                | Preserve fail-closed authorization and avoid mapping-state disclosure.         |
| Missing/invalid registry authority or query persistence unavailable                 | `503` with safe service-unavailable code                                                                 | Do not return database, registry contents, credentials, or stack traces.       |
| Authorized identity with no stored filings/facts                                    | Successful collection/readiness response with an explicit empty state                                    | Do not conflate empty with not-found or unavailable.                           |
| Requested concept/period absent while other facts exist                             | Successful response with an explicit requested-data-missing state or an agreed empty filtered collection | Preserve the distinction from no stored facts.                                 |
| Stored records with incomplete provenance                                           | Return only under an approved policy and mark provenance incomplete                                      | Never silently present as complete sourced data.                               |
| Stored rows with no approved freshness policy                                       | Preserve timestamps and report freshness unknown                                                         | Do not invent fresh/stale thresholds.                                          |
| Available filings/facts                                                             | Bounded deterministic collection with source attribution and retrieval/reporting context                 | Preserve exact decimal strings and nullable reporting intervals.               |

Before choosing between a single readiness envelope and separate collection
responses, review client needs, compatibility, pagination, and how empty versus
filtered-missing collections will be represented. Do not encode database error
details, mapping lifecycle internals, or inferred provider precedence.

## Activation prerequisites

Public success routes remain inactive until a separate reviewed activation
decision completes all of the following:

1. Human-approved, evidence-backed curated instrument mappings and matching
   explicitly onboarded persisted company/instrument identities exist. The
   registry is intentionally empty. No ticker-to-CIK inference is allowed.
2. Public response, validation, error, empty/missing, incomplete provenance,
   freshness, and bounded-pagination semantics are approved.
3. Any approved OpenAPI success schemas are updated first; generated output is
   regenerated and reviewed; generated validation of successful and documented
   error responses is demonstrated without hand-edited output.
4. Startup explicitly validates persistence only when the feature is enabled,
   composes the trusted runtime through dependency injection, and closes the
   owned pool on normal shutdown and startup failure. Health-only startup must
   continue to work without `DATABASE_URL`.
5. Request adapters validate all filters before repository access, translate
   only typed outcomes into safe transport responses, and never call ingestion
   or external providers.
6. Request-level HTTP and isolated PostgreSQL tests cover authorization
   isolation, real stored data, empty/missing states, exact numeric strings,
   provenance, error mapping, and lifecycle cleanup.
7. The activation review confirms that tests passing is evidence of
   implementation correctness, not permission to expose the endpoints.

## Verification commands

From the repository root, run `env -u DATABASE_URL pnpm test`,
`pnpm typecheck`, `env -u DATABASE_URL pnpm build`, `git diff --check`, and
`pnpm codegen:check` sequentially. The opt-in PostgreSQL suite must first
verify the isolated target `127.0.0.1:55432/ump_v2_test` and its test identity,
then run `UMP_POSTGRES_INTEGRATION=1 pnpm --filter @ump/api-server run
test:postgres`. Never print database credentials.
