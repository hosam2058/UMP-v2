# UMP v2 Master Handoff — 2026-09-30

## Product identity

**UMP — Halal Investment Intelligence** is a research, screening, analysis, and
monitoring platform for stocks and ETFs. It is not a trade-execution product.
There is no CFD, MT5, leverage, options, or futures execution system. Financial
and Shariah data must never be fabricated.

## Authoritative checkpoint

- Standalone repository: `/root/UMP-v2-standalone`
- Branch: `main`
- Official implementation checkpoint:
  `394a851b704b8153dc9fcc63206e36b6d1700a84`
- Commit subject: `feat: establish standalone UMP foundation`
- Remote: `git@github.com:hosam2058/UMP-v2.git`
- `origin/main` points to the same checkpoint.

## Historical provenance

- Legacy repository: `/root/UMP-v2`
- Legacy branch: `feature/ump-halal-intelligence-v2`
- Historical Phase 1 source commit:
  `801c8893e53f2083a94fbe872e42b3e07e39c57b`

The legacy commit is provenance and reference only. The legacy repository
remains **READ ONLY**.

## Current architecture

The foundation is a modular TypeScript core built with Node, TypeScript, and
pnpm. It uses Express, PostgreSQL with Drizzle, and Zod. OpenAPI is the contract
source of truth, with Orval generating the contract-derived Zod package; esbuild
builds the API server.

Core/API logic is shared. The Web client is the primary future client, the Bot
is secondary and alerts-oriented, and Mobile is planned later. Investment and
Shariah logic belongs in the shared Core/API and must not be duplicated in
clients.

## Current repository layout

- `apps/api-server`
- `packages/api-spec`
- `packages/api-zod`
- `packages/db`
- `docs`

## Phase 1 implementation

Phase 1 implements provider contracts for market data, fundamentals, filings,
and news, including consistent provenance and typed provider errors. A provider
registry registers and retrieves providers by capability without a fallback that
could fabricate unavailable data.

The concrete provider is SEC EDGAR. Domain models define the external company,
fundamental, filing, price-bar, and news shapes used at the provider boundary.
Instrument routes exist for the API contract, and the OpenAPI specification
defines health and the Phase 1 instrument endpoints. The database package
contains the Drizzle investment-intelligence schema. The generated Zod package
is produced from the OpenAPI contract.

## Database foundation

The Drizzle schema currently defines these eight tables:

1. `data_sources`
2. `companies`
3. `instruments`
4. `price_bars`
5. `fundamental_facts`
6. `sec_filings`
7. `news_articles`
8. `ingestion_records`

The foundation preserves provenance and source attribution through provider,
source URL/base URL, source-as-of, fetched/retrieved times, and source foreign
keys where applicable. It defines indexes for common instrument, company, CIK,
time, tag, source-resource, and ingestion-status lookups; uniqueness constraints
for source identities, instruments, price bars, facts, SEC accessions, and news;
and foreign keys between companies, instruments, sources, and ingested data.
Created/updated timestamps are present on source, company, and instrument
records; data records include applicable filing, publication, fetched, and
source-as-of timestamps. Ingestion records include started/completed timestamps,
status (`started`, `completed`, or `failed`), error code/message, and metadata.

No migrations have been created or applied. No DB push has occurred. There is no
SEC-to-Postgres persistence service yet, and the API is not wired to persistence.

## SEC provider

`SecEdgarProvider` uses official SEC endpoints:

- `https://data.sec.gov/submissions/CIK{CIK}.json`
- `https://data.sec.gov/api/xbrl/companyfacts/CIK{CIK}.json`
- SEC EDGAR archive URLs under `https://www.sec.gov/Archives/edgar/data`

It normalizes a CIK to ten digits, resolves companies from submissions, maps
company-facts data and recent submissions, and produces filing archive URLs when
a primary document is available. Requests include a descriptive required
User-Agent, timeout protection, retry/backoff for retryable upstream failures,
and a default 100 ms minimum request interval—an approximate 10 requests/second
ceiling. Failures surface as typed provider errors.

Three SEC tests use injected/fake `fetch` implementations; they cover CIK
normalization, submissions/filing mapping with provenance and archive URLs, and
the no-accession case. There is no synthetic, yfinance, LLM, or trading fallback.

## Current API

The mounted API exposes:

- `GET /api/healthz`
- `GET /api/v1/instruments/{symbol}`
- `GET /api/v1/instruments/{symbol}/filings`
- `GET /api/v1/instruments/{symbol}/fundamentals`

The Phase 1 data endpoints fail closed: until real provider data has been
ingested, they return typed `503 DATA_UNAVAILABLE` responses rather than
fabricated data.

## Orval and generated ownership

`packages/api-zod/src/index.ts` is manual. Generated source exists only under
`packages/api-zod/src/generated/**`; it is not hand-edited. Orval `8.20.0`
deterministic generation was verified, including a passing second-codegen
reproducibility check.

## Verified validation state

At the authoritative checkpoint, the recorded validation state is:

- Frozen install: **PASS**
- Typecheck: **PASS**
- SEC tests: **3 passed, 0 failed, 0 skipped**
- Build: **PASS**
- Codegen ownership: **PASS**
- Deterministic second codegen: **PASS**
- `pnpm-lock.yaml`: stable

## Known non-blocking follow-ups

- Generated endpoint response schemas currently use `zod.void()` despite
  `DataUnavailable` TypeScript models.
- SEC upstream JSON is not fully field-by-field runtime validated.

Do not fix either item in this step.

## Phase boundary

**Phase 2 has NOT started.** The following are absent:

- Persistence/query services
- Migrations or DB push
- Market-data provider implementation
- News provider implementation
- Shariah screening engine
- Analysis engine
- Frontend
- Auth
- Watchlists
- Alerts
- Trading execution

## Next approved sequence

1. Review/update Master Handoff
2. Produce and review Product Specification
3. Produce and review Technical Master Plan
4. Only after explicit approval, begin Phase 2

## Safety and development rules

- The legacy repository is **READ ONLY**.
- No trading execution.
- No fabricated financial data.
- Provenance is required.
- Generated files are not hand-edited.
- Migrations require explicit review.
- No automatic phase transition.
- Git push only after review.
