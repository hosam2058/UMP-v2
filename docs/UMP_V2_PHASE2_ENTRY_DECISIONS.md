# UMP v2 Phase 2 Entry Decisions

## Status and authority

This is a Phase 2 entry-design decision record.  It resolves the architectural
choices needed before the first migration baseline is implemented; it does not
authorize implementation, migration generation or application, database access,
ingestion, code generation, or API changes.

It is reconciled with the Master Handoff, Product Specification, Technical
Master Plan, Architecture document, current Drizzle schema, and current SEC
provider boundary.  Where a source of canonical identity data is needed, this
document deliberately defines policy rather than selecting or inventing an
external provider.

## 1. Canonical identity decision

### Repository evidence

The current schema has a nullable, uniquely indexed `companies.cik`; an
`instruments.companyId` relation; and a second nullable `instruments.cik`.
Facts and SEC filings currently require `instrumentId`.  The SEC provider and
the external provider models, however, identify companies, facts, and filings
with an external `companyIdentifier` using CIK.  They do not return a canonical
instrument identity, exchange, currency, or asset type.  The SEC provider
therefore describes issuer data, not a tradable instrument.

This is consistent with the intended direction below, but the present schema
does not yet express it completely.  In particular, a single issuer can have
more than one instrument/share class, while a SEC filing accession is currently
unique and tied to one instrument.

### Decision

1. A normalized ten-digit SEC CIK is the canonical persisted SEC issuer
   identifier and belongs on `companies.cik`.  It identifies a company/issuer,
   not an instrument.
2. `instruments.cik` will be removed before the first migration baseline.  It
   duplicates issuer identity and can disagree with `companyId`; no strict
   database invariant currently justifies retaining it.
3. An instrument has its own canonical identity: at minimum the approved
   symbol/exchange identity already represented by the instrument uniqueness
   boundary, plus its asset attributes.  A SEC-supported instrument must link
   to its issuer using `companyId`.
4. One company may link to zero, one, or many instruments.  This represents
   multiple share classes or other approved issuer-linked instruments without
   duplicating issuer facts or filings.
5. SEC fundamental facts will belong canonically to a required `companyId`, not
   an arbitrary `instrumentId`.
6. SEC filings will belong canonically to a required `companyId`, not an
   arbitrary `instrumentId`.
7. `sec_filings.cik` will be removed before the first migration baseline.
   A filing's issuer CIK is derived through `sec_filings.companyId` to
   `companies.cik`; preserving a second copy would reintroduce an unconstrained
   inconsistency.
8. Instrument research reaches issuer-level SEC facts and filings through
   `instrument -> company`.  The eventual query service must only do this for
   an approved instrument with a company relation; it must not infer one.

For Phase 2 SEC support, `companyId` is required at the application identity
boundary.  The broader `instruments.companyId` column may remain nullable for
non-SEC future asset classes; a null company relation is simply not eligible for
the SEC canonical path.

### Exact pre-migration schema delta

The intended first schema implementation is limited to the following reviewed
delta; it does not itself authorize a migration:

1. Remove `instruments.cik`.
2. In `fundamental_facts`, remove the canonical `instrumentId` association for
   SEC facts and add/use required `companyId` as the canonical issuer
   association.
3. In `sec_filings`, remove the canonical `instrumentId` association, add/use
   required `companyId`, and remove the duplicated `sec_filings.cik`.
4. Keep `companies.cik` as the single canonical persisted SEC CIK. It may
   remain nullable for companies outside the SEC path, but every company
   eligible for Phase 2 SEC ingestion must have it. When present, it must be
   normalized to exactly ten decimal digits, remain unique, and be protected by
   an appropriate reviewed database-level invariant/check rather than only an
   application convention.
5. An instrument reaches company-level fundamentals and filings only through
   `instrument -> company`; no fact or filing is copied per instrument.

The fundamental-fact identity defined in section 3 remains the proposed Phase 2
canonical identity. Because it includes nullable context fields, its database
uniqueness semantics must treat equivalent NULL context states as equal rather
than permit duplicate rows. The exact PostgreSQL/Drizzle encoding requires
review before migration generation. Focused SEC fixtures must demonstrate that
the chosen identity neither collapses distinct facts nor creates duplicates
before the first migration is authorized.

### Unmapped and ambiguous identities

An SEC company with no approved instrument mapping is not made into a supported
instrument and is not ingested as a canonical, instrument-research data set in
this Phase 2 path.  It remains unsupported/unavailable.  A future operation may
record a safe attempt outcome, but it must not create an arbitrary instrument or
make it queryable as coverage.

If a supplied symbol/exchange mapping is ambiguous, conflicts with the
established company/CIK relation, or lacks required identity attributes, the
operation fails closed.  It does not choose a candidate, merge companies, or
request a different provider.  Resolution requires a reviewed correction to
the trusted canonical identity data.

## 2. Phase 2 supported-universe decision

Phase 2 is limited to an explicitly approved, curated set of SEC
registrant-linked **stock** instruments.  An instrument is eligible only when
trusted canonical identity data has already established all of the following:

- its canonical symbol and exchange identity;
- its instrument attributes required by the schema, including name, stock asset
  type, and currency;
- its company relation; and
- that company's normalized ten-digit CIK.

The SEC adapter may verify and refresh issuer data for such an approved mapping,
but it is not an identity-discovery or ticker-resolution authority.  No global
asset universe, exchange coverage, arbitrary ticker lookup, ETF support,
non-U.S. issuer support, share-class inference, or automatic company/instrument
creation is included in this Phase 2 scope.

An unresolved, unsupported, inactive, or ambiguous identity returns a safe
unavailable/unsupported state.  It never becomes a guessed mapping or a
successful empty response.

No external symbol-mapping provider or initial curated mapping data set exists
in the repository.  Selecting, sourcing, approving, and maintaining that data
is intentionally outside this decision record and must precede operational
ingestion of any instrument.

## 3. Fundamental reporting-context decision

### Current gap

The current `fundamental_facts` table records taxonomy, tag, unit, fiscal year,
fiscal period, filed date, and accession number, but keys facts by
`instrumentId`.  The SEC adapter currently maps only those fields from its
minimal internal `FactUnit` shape.  It does not retain source form, reporting
start, reporting end, or frame.  Its current uniqueness key can therefore
conflate distinct SEC XBRL contexts.

### Decision

The first migration baseline must represent the source context needed to retain
one SEC XBRL fact without collapsing another fact that has the same tag and
unit.  A persisted canonical SEC fact must have:

- `companyId` and `sourceId` for issuer and provider/source identity;
- `taxonomy`, `tag`, and `unit`;
- `value`;
- `form` and `filedDate`;
- `accessionNumber` as the SEC filing reference;
- `reportingEnd` for the reported instant/period end;
- nullable `reportingStart` for duration facts, with null representing an
  instant fact rather than an unknown start;
- nullable `fiscalYear` and `fiscalPeriod`, retained when supplied;
- nullable `frame`, retained when SEC supplies an applicable frame; and
- retrieval/source-as-of provenance already required by the data architecture.

For the narrow Phase 2 canonical path, a fact missing a usable accession number,
form, filed date, or reporting end is incomplete and is not persisted as a
canonical fact.  Nullable fiscal labels, duration start, and frame remain valid
where the source does not provide them.

The minimum idempotency identity is:

`companyId + sourceId + taxonomy + tag + unit + accessionNumber + form + filedDate + reportingStart + reportingEnd + fiscalYear + fiscalPeriod + frame`

Nullable fields in that identity must treat null as an equal explicit state,
not as an unlimited duplicate escape hatch.  `value` is not part of the
identity: a source correction for the same identity updates the canonical value
and retrieval context in a transaction, with the correction behavior tested.
This choice preserves source reporting context and prevents silently treating a
different context as the same fact.

The later SEC boundary-hardening task must validate and map these fields before
any persistence task uses them.  This document does not change the existing
provider model or schema.

## 4. Filing identity decision

A SEC accession number identifies one SEC filing submission.  The canonical
filing key for Phase 2 is `sourceId + accessionNumber`, rather than an
instrument association or a bare cross-provider global key.  This makes the
SEC source namespace explicit while preserving the expected SEC uniqueness.

Each filing has one required issuer `companyId`, plus form, filing date, report
date when supplied, primary document when supplied, official source URL, and
retrieval time.  Its company CIK is obtained through the company relation, not
duplicated in the filing record.  An approved instrument reaches the filing
through its company relation.

Re-ingestion of the same source/accession pair is idempotent: it must not create
a second filing.  It may refresh mutable source-derived fields and retrieval
context according to an explicit repository update policy.  A conflicting
company association for the same source/accession is an invalid identity/source
condition and fails closed; it must not be reassigned silently.

## 5. Database runtime-composition decision

`packages/db/src/index.ts` currently reads `process.env.DATABASE_URL`, creates a
pool, and throws at module import time.  This is unsuitable once a health-only
API imports shared database types or route composition.

The intended correction is:

1. Schema exports remain importable without environment validation or a network
   client.
2. The database package exposes an explicit database/pool factory which accepts
   a supplied, already-validated connection configuration and returns a typed
   database handle plus an explicit close lifecycle.  It does not read process
   environment variables or create a module-global pool at import time.
3. API configuration has a base/server configuration path that permits a
   health-only process with no `DATABASE_URL`, and a persistence-capability
   validation path that requires a non-empty `DATABASE_URL` before it composes
   repositories, ingestion, or database-backed routes.
4. A runtime composition root owns construction and shutdown of the database
   client.  Dependencies flow into repositories/services/routes explicitly;
   they are not imported as hidden global state.
5. Tests inject a database handle, factory, or test double.  Isolated database
   integration tests supply their own test-only connection through the explicit
   boundary.
6. Configuration and provider errors exposed to callers are safe categories;
   connection strings, credentials, and raw driver diagnostics are neither
   returned in API responses nor logged as ordinary error messages.

`packages/db/drizzle.config.ts` is different: it is CLI-only tooling and may
continue to require `DATABASE_URL` when an explicitly authorized Drizzle command
is invoked.  This does not justify import-time validation in the runtime package.
No production database host, connection string, or secret-management mechanism
is selected by this decision.

## 6. First-migration strategy decision

The first migration follows this exact approval workflow:

1. Human review and approval of this entry-decision record.
2. Authorization for the bounded first Phase 2 implementation task; implement
   only the approved schema and runtime-composition corrections.
3. Review the resulting schema diff, focused tests, and the absence of
   out-of-scope changes.
4. Separate human authorization to generate a version-controlled migration.
5. Inspect the generated migration before any application.
6. Apply and verify it only against isolated PostgreSQL, including upgrade,
   repeatability, and documented recovery/rollback expectations.
7. Do not use direct DB push at any stage.
8. Treat production migration application as a separate, explicit approval
   after isolated verification; it is not authorized by generation or testing.

No migration is created, generated, applied, or simulated by this document.

## 7. First implementation task boundary

After human approval, the smallest implementation task is **Phase 2 migration
baseline preparation**.  Its only goals are to implement the approved
company-level SEC schema corrections, remove the redundant CIK fields, establish
the explicit database runtime-composition boundary, and add focused unit tests
for configuration/import/lifecycle behavior.  It ends before migration
generation.

It may modify these existing files:

- `packages/db/src/schema/investment-intelligence.ts`
- `packages/db/src/index.ts`
- `apps/api-server/src/config.ts`

It may create only these focused implementation/test files:

- `apps/api-server/src/composition/persistence.ts`
- `apps/api-server/src/composition/persistence.test.ts`
- `apps/api-server/src/config.test.ts`
- `packages/db/src/index.test.ts`

It must not modify `packages/db/drizzle.config.ts`, provider code, provider
models, routes, OpenAPI, generated Zod files, package/configuration manifests,
or application entry points unless a separate review proves an additional file
is strictly necessary for the stated runtime boundary.

It must not generate or apply migrations; ingest SEC data; rewire routes; add
OpenAPI success schemas; implement market/news, Shariah, analysis, frontend,
auth/watchlists/alerts, AI, or trading functionality.

## 8. Human approvals

### A. Phase 2 implementation start

Required before any source change.  Authorization is limited to the bounded
task in section 7 and does not authorize migration work, ingestion, or API work.

### B. Schema corrections

Required before modifying the Drizzle schema.  Approval covers the company-level
association, removal of duplicate CIK fields, and fact/filing identities defined
here; it does not approve a generated migration by implication.

### C. Migration generation

Required only after implementation and review of the schema diff.  It authorizes
generation of version-controlled migration files for inspection, not DB push or
application.

### D. Migration application and verification

Required separately to use isolated PostgreSQL for migration upgrade and
repeatability verification.  Production application requires its own subsequent
authorization, environment review, and recovery plan.

### E. Later API contract/codegen work

Required later, after persisted query semantics and response criteria are
reviewed.  It must approve the OpenAPI success/error contract change, generated
Zod regeneration, generated-output review, and deterministic second-generation
check.  It is outside the first implementation task.

## 9. Remaining blockers

| Readiness item | Classification | Decision status |
| --- | --- | --- |
| Canonical CIK/company/instrument ownership | RESOLVED_BY_THIS_DECISION | CIK is company-level; instruments link by `companyId`; duplicate instrument CIK is removed. |
| One-company/multiple-instruments representation | RESOLVED_BY_THIS_DECISION | One company has zero-to-many instruments; SEC data is stored once at company level. |
| SEC fact reporting-context and idempotency identity | RESOLVED_BY_THIS_DECISION | Required source context and exact idempotency key are specified. |
| SEC filing identity and duplicate behavior | RESOLVED_BY_THIS_DECISION | Source/accession key, company association, and correction behavior are specified. |
| First-migration schema direction | RESOLVED_BY_THIS_DECISION | Required corrections are specified; implementation and migration still need approval. |
| `DATABASE_URL` import/runtime composition direction | RESOLVED_BY_THIS_DECISION | Explicit factory, capability validation, composition ownership, and lifecycle rules are specified. |
| Explicit authorization to begin Phase 2 implementation | STILL_OPEN | Human approval is required. |
| Trusted canonical mapping data for any actual supported stock | STILL_OPEN | No mapping data set or mapping-provider decision exists in the repository. |
| Isolated PostgreSQL environment and production migration procedure | STILL_OPEN | Must be chosen and approved before migration verification/application. |
| SEC runtime validation and expanded provider fixtures | STILL_OPEN | Required before canonical ingestion, but intentionally outside the first pre-migration task. |
| OpenAPI success contracts and Orval `zod.void()` resolution | STILL_OPEN | Required before real route responses, but not before the first task. |

## 10. Evidence limitations and conclusion

Repository evidence was insufficient to select a trusted symbol/exchange mapping
source, provide an initial approved mapping, select an isolated PostgreSQL
environment, or select a production migration/deployment workflow.  No such
choice is inferred here.  The requested
`apps/api-server/src/providers/models.ts` file is absent; the actual models used
by `sec-edgar.ts` are in `apps/api-server/src/domain/models.ts`.  That absence
does not change the company-level conclusion, but it must be accounted for when
the later provider-model hardening work is planned.

The entry decisions are complete enough for human review.  They intentionally
leave authorization and operational inputs open rather than manufacturing them.

ENTRY_DECISIONS_READY_FOR_HUMAN_REVIEW
