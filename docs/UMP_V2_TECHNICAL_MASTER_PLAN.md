# UMP v2 Technical Master Plan

## Status and terminology

This is a technical planning artifact. It translates approved product direction into an engineering path from the published foundation; it does not authorize implementation. **CURRENT** describes the authoritative foundation. **PLANNED** describes work requiring later approval. **TBD** is deliberately unresolved.

## 1. Technical mission

Build a provenance-first, fail-closed research platform:

~~~text
asset -> canonical sourced data -> deterministic research/screening engines
      -> transparent API -> client experiences -> user decision
~~~

UMP supports research, screening, analysis, comparison, monitoring, and explanation. It does not execute trades, hold brokerage credentials, issue guaranteed predictions, or create execution workflows.

## 2. Authoritative baseline

- Repository: /root/UMP-v2-standalone
- Current published HEAD: 02b1aec628eda3838108ea925d725125accfda7f
- Foundation implementation checkpoint: 394a851b704b8153dc9fcc63206e36b6d1700a84
- Legacy provenance commit: 801c8893e53f2083a94fbe872e42b3e07e39c57b

The standalone repository is authoritative for all future UMP v2 work. The legacy repository and commit are historical provenance and reference only; they remain read-only. The Master Handoff, Product Specification, and Architecture documents are the planning baseline. Working code records the CURRENT state; this plan never presents planned behavior as complete.

## 3. Architectural principles

- Modular monolith first: explicit internal boundaries without premature services or distributed deployment.
- Shared Core/API: Web is primary, Bot is secondary for lookup/alerts, and Mobile is later.
- Clients never duplicate investment, Shariah, methodology, or business-state logic.
- OpenAPI is the API contract source of truth; contract-derived files are generated and not hand-edited.
- Preserve source provenance end-to-end: provider/source, reference or URL where available, source-as-of/reporting context, retrieval time, and derived-calculation lineage.
- Deterministic financial and Shariah computation precedes any AI explanation.
- Fail closed: missing, stale, incomplete, unsupported, or unavailable inputs never become an apparently valid result.
- Isolate external systems behind provider abstractions and typed failures; never fabricate fallback data.
- No trading execution, brokerage account, trading credential, or execution-oriented signal.

## 4. Current system map

| Area | CURRENT responsibility | Not current |
| --- | --- | --- |
| apps/api-server | Express foundation, Pino HTTP logging, health route, typed fail-closed data routes, provider contracts/registry, SEC adapter. | Persistence/query services, database-backed responses, auth, clients, or engines. |
| packages/api-spec | OpenAPI 3.1 source: health and three instrument routes, each data route presently defines only typed 503; Orval config. | Success data contracts, pagination, broad API categories. |
| packages/api-zod | Contract-derived source under src/generated/** and manual re-export entry point at src/index.ts. | Hand-authored generated schemas or a resolved response-schema limitation. |
| packages/db | Drizzle PostgreSQL schema and connection/tooling foundation. | Migrations, applied schema, repositories, ingestion, or populated data. |
| docs | Master Handoff, Product Specification, Architecture, and this plan. | Implementation authority. |

### Current API/provider/database boundaries

Current API routes are:

- GET /api/healthz
- GET /api/v1/instruments/{symbol}
- GET /api/v1/instruments/{symbol}/filings
- GET /api/v1/instruments/{symbol}/fundamentals

The three data routes return typed 503 DATA_UNAVAILABLE and neither invoke a provider nor query PostgreSQL. The provider boundary is the typed MarketDataProvider, FundamentalsProvider, FilingsProvider, NewsProvider, ProviderRegistry, ProviderResult<T>, and Provenance interfaces. Registry maps are capability-specific and deliberately have no fallback. SecEdgarProvider is the only concrete adapter; it provides fundamentals and filings but is not connected to persistence or routes.

The database package defines an un-applied schema. Its module-level pool requires DATABASE_URL if imported, and its Drizzle tooling does as well. The API configuration loader currently recognizes optional DATABASE_URL and SEC_USER_AGENT, and permits only MARKET_DATA_PROVIDER=none. This is a foundation constraint, not a completed runtime composition system.

## 5. Target module map

These are PLANNED logical modules within the modular monolith. They do not prescribe folders, microservices, or deployment units.

| Logical module | CURRENT | PLANNED responsibility |
| --- | --- | --- |
| Asset/company identity | Provider models plus companies/instruments schema. | Canonical company/instrument identity and supported coverage. |
| Providers | Contracts, registry, SEC adapter. | Capability policy, configuration, validation, rate-aware access. |
| Ingestion | Schema support only. | Fetch, validate, normalize, record, and persist source data idempotently. |
| Persistence/repositories | Drizzle schema only. | Transactions, repositories, and query services. |
| Fundamentals | SEC mapping only. | Canonical fact selection/query and reporting context. |
| Filings | SEC mapping only. | Filing retrieval, official-reference preservation, incremental updates. |
| Market data | Interfaces and price_bars schema only. | Quotes/bars ingestion and honest market state. |
| News | Interface and news_articles schema only. | Article ingestion, association, de-duplication. |
| Shariah methodology/screening | Absent. | Versioned deterministic methods, inputs, results, audit trail. |
| Analysis/risk/comparison | Absent. | Deterministic fundamentals, technical, risk, comparison calculations. |
| Watchlists/alerts | Absent. | Saved assets and evidence-linked change notifications. |
| AI explanation | Absent. | Constrained explanation of source and deterministic results. |
| Authentication/account | Absent. | Later identity, authorization, preferences, privacy. |
| Web integration | No client exists. | Primary full-research client consuming the API. |

## 6. Data architecture

The existing eight-table foundation is the starting point, not evidence of a migrated or populated database:

1. data_sources
2. companies
3. instruments
4. price_bars
5. fundamental_facts
6. sec_filings
7. news_articles
8. ingestion_records

### Canonical identifiers and provenance

Internal UUIDs identify persisted records and are never provider identifiers. CIK is the current external identity for SEC flows: the adapter normalizes it to ten digits, companies.cik is unique, and instruments can carry a company relation and CIK. Symbol/exchange is the current instrument uniqueness boundary, with null exchanges treated as equal. Future identity resolution must happen before facts or filings are written and must not assume that a symbol alone is globally unique.

data_sources is the normalized source identity. Source-facing records retain the source foreign key and applicable source URLs/references: SEC filings have source_url; provider results can supply sourceUrl; facts and price bars have source_as_of and fetched_at; and news has publication, source-as-of, and fetch timestamps. Provider retrievedAt maps to persisted retrieval/fetch context. API responses must expose relevant provenance instead of presenting facts as unqualified values.

### Raw/external, normalized, and operational boundaries

Provider-domain types are external/normalized boundary shapes, not database entities. The current schema holds normalized canonical records and source metadata; it has no raw-payload table. Phase 2 must not claim durable raw payload retention. If durable raw source storage is later required for audit or replay, it is a separately reviewed schema/design decision.

An attempt is recorded in ingestion_records with started/completed/failed status, resource identity, known source-as-of/fetch times, and safe error/metadata context. A failed write cannot leave a completed record or present a partial set as complete. Timestamps are factual context, not an implicit freshness policy.

### Idempotency, uniqueness, and state

The existing initial de-duplication keys are provider/name for sources; CIK for companies; symbol/exchange for instruments; instrument/interval/timestamp/source for bars; fact identity; accession for SEC filings; and URL/source for news. Ingestion must use these intentionally, be repeat-safe, and define how source corrections update records and updated_at, since the schema intentionally has no update trigger. Related source, identity, fact, filing, and ingestion changes should be transactionally consistent where PostgreSQL can make them so.

Unavailable, stale, incomplete, failed, and unsupported are distinct states. The schema records ingestion failure and timestamps but does not encode every presentation state. Query services must derive or return a safe typed state from persisted evidence and approved policy; they must never invent a value or a positive screening result.

## 7. Database evolution strategy

Future schema changes require explicit reviewed design and version-controlled migration files. Normal development must not use direct DB push. Schema edits, migration generation/application, and any data backfill are separate reviewable actions; the first migration is outside this step.

Migrations should be forward-safe and reversible where practical. When true reversal is unsafe, document recovery/rollback procedures. Destructive or large data transformations require production-data safety review, backup/recovery considerations, staged rollout, and test/staging validation before production. Check compatibility with deployed code and API contracts. Applied database state is operational evidence, not a replacement for version-controlled migrations.

## 8. Provider architecture

**CURRENT:** MarketDataProvider, FundamentalsProvider, FilingsProvider, NewsProvider, ProviderRegistry, ProviderResult<T>, and Provenance are implemented. ProviderResult<T> carries data plus provider, retrieved time, as-of time, delay state, and optional source URL. ProviderError currently categorizes CONFIGURATION, UNAVAILABLE, TIMEOUT, RATE_LIMITED, UPSTREAM, and INVALID_RESPONSE.

**PLANNED policy:** approved configuration selects a registered provider by capability and environment. Each adapter owns safe request construction, timeout, bounded retry/backoff, rate-limit compliance, and boundary validation. Missing or unsuitable providers are visible as unavailable or unsupported; the system must not silently change source. Typed internal errors map to API-safe errors without secrets or unsafe diagnostics. Provenance and freshness context travel with accepted data. No fabricated fallback is permitted.

SEC EDGAR is the first concrete provider. Its descriptive required user agent, timeout, retry of retryable failures, and default 100 ms minimum request interval are CURRENT. Provider selection policy, coverage, credential handling, and data retention beyond the present adapter remain TBD.

## 9. SEC hardening plan

Before SEC data is relied on as canonical persisted data, plan and review work to:

- add stronger runtime SEC JSON validation while retaining typed invalid-response errors;
- define orchestration from company resolution, company facts, and recent filings through normalization and persistence;
- explicitly resolve CIK/company/instrument association and supported instrument creation rules;
- use CIK, fact identity, and accession constraints for duplicate protection, with defined correction/update behavior;
- support incremental refresh from stored records, source timestamps, and provider context without assuming a source cursor;
- synchronize facts and filings at the ingestion-operation level while preserving their separate provenance and failure outcomes;
- record source timestamps and failures safely in ingestion records;
- add provider/persistence fixtures for valid, malformed, empty, no-accession, retryable, and rate-limited cases; and
- preserve/test User-Agent, timeout, retry/backoff, and rate-limit compliance, including concurrency-aware scheduling if needed.

This is a plan only. The current adapter has three injected-fetch tests and no persistence integration.

## 10. Market data plan

The future market-data layer may implement the existing quote and historical-bar interfaces only after provider and coverage approval. It must define supported quotes and bars; existing intervals (1m, 5m, 15m, 1h, 1d, 1wk, 1mo); timestamps and timezone convention; adjusted/unadjusted semantics; currency; source/provider provenance; delayed/live state; source-as-of and retrieval time; rate limits; retries; de-duplication; and freshness.

Concrete provider, coverage, live/delayed status, asset/exchange universe, adjustment policy, retention, and unsupported-asset behavior are TBD. Unsupported asset/interval, stale prices, and provider limits must be explicit and may not be replaced by a different source without approved policy and provenance.

## 11. News data plan

News remains behind NewsProvider. A future adapter must produce source-backed articles with provider identity, URL/reference, publication time, retrieval time, and provenance. Ingestion associates an article with an instrument only when evidence supports that association; the current schema permits no instrument relation. The URL/source unique key is the initial duplicate identity. Cross-source duplicate-story policy is a future explicit decision so repeated reports do not appear as independent events.

Deleted, unavailable, inaccessible, incomplete, or changed sources retain known provenance and a safe unavailable/incomplete state. They are never replaced with invented headline, text, time, or URL. Provider choice, coverage, access policy, retention, and semantic de-duplication are TBD.

## 12. Shariah engine architecture

Shariah screening is PLANNED and cannot begin by inventing thresholds or a methodology. A future module must separate: named/versioned methodology definition; deterministic rule evaluation; selected sourced inputs with period and provenance; reproducible calculations; result state and limitations; and an auditable input/method/calculation/result trail. Missing, ambiguous, stale, incompatible, or unsuitable required input fails closed rather than becoming halal, acceptable, or passing.

The architecture should support multiple methodology implementations only if later approved, without silently mixing rules or results. AI may explain a recorded deterministic outcome, but cannot create a ruling, select missing inputs, or override the engine. Methodology, governance, representation, thresholds, supported-asset treatment, and edge cases are TBD.

## 13. Analysis engine

Planned fundamentals, technical, risk, and comparison modules follow fixed lineage:

~~~text
raw/source data -> normalized data -> deterministic calculation
                -> analytical result -> optional AI explanation
~~~

Fundamentals analysis selects comparably defined facts with fiscal/reporting context. Technical analysis consumes clearly labelled observed prices and versioned inputs. Risk analysis exposes evidence, period, method, and uncertainty rather than an opaque safety score. Comparison aligns definitions, units, periods, source context, freshness, and methodology before rendering assets together. No layer guarantees a prediction, return, or trading signal. Metrics, indicators, risk framework, and comparison policy are TBD.

## 14. API evolution plan

Current endpoints are GET /api/healthz, GET /api/v1/instruments/{symbol}, GET /api/v1/instruments/{symbol}/filings, and GET /api/v1/instruments/{symbol}/fundamentals. Each current data endpoint returns only typed 503 DATA_UNAVAILABLE until data is ingested and queryable.

Phase 2 should change OpenAPI and implementation together: successful responses occur only for real persisted data; absence remains typed unavailable. It should establish consistent typed errors for unavailable, provider failure where appropriate, stale, incomplete, and unsupported states as their meanings are approved. Internal failures must not be exposed as successful empty data.

Future API categories may cover discovery/identity, fundamentals, filings, market data, news, screening, analysis, comparison, accounts/watchlists, alerts, and explanation. Exact routes are not locked. Collection endpoints need pagination, stable ordering, and filtering when introduced. Material responses need provenance/freshness metadata: source/reference, source-as-of/reporting period, retrieval time, and delay/staleness state. Versioning remains under /api/v1 until a reviewed incompatible change merits a later version. Every API change is OpenAPI-first, followed by generated Zod regeneration and contract tests.

## 15. Orval / contract generation plan

Ownership is fixed:

- Manual: packages/api-zod/src/index.ts
- Generated only: packages/api-zod/src/generated/**

For a reviewed API change: edit packages/api-spec/openapi.yaml; review semantic and compatibility effect; run code generation; verify generated output was not hand-edited; typecheck packages/routes against it; and run generation a second time to prove deterministic output. Generated changes are reviewed as generated artifacts, never patched by hand.

The existing generated endpoint response schemas use zod.void() despite DataUnavailable TypeScript models. This is a planned technical follow-up only. Resolve it through a reviewed OpenAPI/Orval-compatible approach with ownership and reproducibility checks, not in this step.

## 16. Validation / test strategy

Validation grows by boundary:

- unit tests for normalization, identity, deterministic calculation, and error/state mapping;
- provider fixture tests for SEC and later providers, including malformed and rate-limited upstream data;
- schema validation tests at provider and API boundaries;
- repository/persistence tests for constraints, transactions, and idempotent writes;
- integration tests from ingestion through query service to routes;
- OpenAPI/API contract tests, generated ownership checks, and deterministic second codegen;
- migration upgrade tests against isolated PostgreSQL;
- provenance assertions and unavailable/failure-path tests;
- deterministic versioned Shariah fixtures after that engine is approved; and
- end-to-end client tests later.

At the foundation checkpoint, frozen install, typecheck, build, codegen ownership, deterministic second codegen, and three SEC tests were recorded as passing. This documentation task does not claim to rerun or expand that validation.

## 17. Observability

CURRENT logging uses Pino HTTP with method, path without query, request ID, and response status. PLANNED observability retains structured safe logging and adds provider request/failure visibility, ingestion lifecycle/status, retry/rate-limit context, typed error category, source, and safe correlation/request IDs across API, query, and ingestion operations.

Logs and diagnostics must not leak secrets, authorization material, unnecessary raw payloads, or personal data. Metrics, dashboards, tracing, alerting, and retention are later choices driven by operational need rather than premature infrastructure.

## 18. Security and privacy

Secrets belong only in environment-specific secret management, never in repository, client bundle, generated output, or logs. Validate input at external and API boundaries; constrain external fetching and headers safely; bound timeout/retry/resource use; maintain dependency hygiene; and use least privilege for database and deployment identities. UMP must never request or store brokerage/trading credentials.

Authentication, authorization, user data, watchlists, alerts, retention, and account privacy are later scope. Their eventual design must minimize collection, separate user and research data, and apply authorization/audit controls before release.

## 19. Configuration / environment strategy

.env.example is placeholder-only. It currently documents PORT, NODE_ENV, LOG_LEVEL, DATABASE_URL, and SEC_USER_AGENT, and states no market provider exists. It must never contain usable credentials.

PLANNED runtime validation makes required configuration explicit for activated capabilities: database connectivity, selected approved providers, provider-specific required settings, and environment-specific limits. Development, test, staging, and production have separate configuration and secrets; production values are never copied into local files. PostgreSQL hosting, provider configuration, deployment environments, and secret-manager mechanism are TBD. Existing Phase 1 loadConfig behavior evolves only with reviewed capabilities.

## 20. Client architecture

Web is the primary full research UI. Bot is secondary for quick lookup and evidence-linked alerts. Mobile is later. No client currently exists.

All clients consume the shared API. They can present and navigate data states but cannot call providers directly, calculate investment results, apply Shariah rules, or decide business state. API responses must therefore convey the provenance and state required for an honest research experience.

## 21. AI integration architecture

AI is an optional constrained explanation layer consuming identified source facts and deterministic outputs. It may explain, summarize, compare consistently defined material, and translate complex research. Inputs/outputs must carry or link to citation/provenance, methodology/version, result state, and uncertainty so explanation is not mistaken for financial truth.

AI must not source financial truth, fabricate values/filings/news/citations, create Shariah rulings, override deterministic calculation, hide missing data, execute trades, or claim a guaranteed outcome. No AI capability exists now. Model/provider, data retention, citation rendering, and safety evaluation are TBD.

## 22. Performance / scalability strategy

Scale the modular monolith pragmatically: use indexes matched to actual queries; batch ingestion where safe; cache only when provenance/freshness remains clear; paginate collections; and schedule providers with rate limits in mind. Add asynchronous ingestion/work queues only when workload, latency, or retry needs justify them. Avoid premature microservices, distributed transactions, or cache infrastructure without measured need and clear ownership.

## 23. Development workflow

~~~text
Plan -> review -> implement -> tests/typecheck/build -> audit -> commit
     -> review -> push
~~~

Use one bounded task at a time, explicit phase boundaries, and no automatic transition. Respect generated ownership, keep legacy read-only, use reviewed migrations rather than production mutations, and never treat a plan or local passing test as authority to mutate production.

## 24. Git / release strategy

main is the current authoritative branch. Use small reviewable commits and documentation checkpoints. Feature branches/worktrees may isolate work. Do not force-push authoritative history without explicit exceptional approval. Review before push and never assume local changes are published. Release/version/tag policy is later work after release objectives and deployment are known.

## 25. Phase 2 detailed plan

Phase 2 is tightly bounded to the first real canonical data path:

~~~text
SEC provider -> validation -> normalization -> PostgreSQL persistence
             -> repository/query service -> current API real sourced response
~~~

It is not a mandate to implement every current table or provider contract. Proposed sequence:

### A. Database migration baseline

Review the existing Drizzle schema against the SEC canonical path and decide whether minimal corrections are required before the first migration. Only after approval create version-controlled migrations; do not use DB push. Define isolated migration verification and rollback/recovery expectations.

### B. Database connectivity/config validation

Design a runtime composition boundary so database-required paths validate DATABASE_URL predictably without accidentally requiring it for a health-only process. Define test/environment connections, pool lifecycle, and failure mapping. Do not select a production host in code.

### C. Repository interfaces

Specify repositories/query services for sources, company/instrument identity, SEC fundamentals, SEC filings, and ingestion records. Keep provider types distinct from database/domain/API types. Define query semantics, ordering, source selection, and unavailable behavior.

### D. SEC persistence/ingestion service

Compose configured SEC access with runtime validation, normalization, source resolution, ingestion records, and safe failure recording. Make it an explicit service/operation rather than an implicit API-read side effect unless a later reviewed design decides otherwise.

### E. Idempotent company/instrument/fundamental/filing writes

Write source, company, instrument association, facts, and filings using current identities/constraints and transactions where appropriate. Repeated successful ingestion must not duplicate records. Define source corrections, partial success, and updated_at handling.

### F. Query services for current API

Read persisted canonical instrument, fundamentals, and filings only through repository/query boundaries. Define lookup behavior, filtering, ordering, and bounded response shape before routes are rewired.

### G. Real responses only when data exists

Evolve OpenAPI-first contracts and current routes so successful provenance-bearing responses occur only when required persisted data exists and meets approved response criteria. Regenerate Zod output under the ownership rules.

### H. Preserve fail-closed behavior

Absent, unsupported, incomplete, stale when a freshness policy exists, or failed data retains a typed honest response. No empty success response pretends coverage; no provider call manufactures a response.

### I. Provenance end-to-end

Expose/test provider/source, SEC URL/reference where applicable, fiscal/reporting/source-as-of context, fetched/retrieved time, and known delay state through ingest, storage, query, and response.

### J. Tests

Add unit, fixture, persistence, migration, integration, contract, and failure-path tests for this path: duplicate ingestion, invalid SEC payload, rate limit/timeout, empty/no-accession result, unavailable query state, and provenance preservation.

### K. Migration verification

Run reviewed migration upgrade verification in isolated PostgreSQL test or staging, confirm repeatable ingestion/query behavior, and document deployment/rollback constraints before production.

### L. Final Phase 2 audit

Audit provenance, fail-closed behavior, contract/generated ownership, migration state, tests/typecheck/build, secret/log safety, no fabrication, and no legacy/trading contamination. Obtain review before declaring completion.

## 26. Phase 2 explicit exclusions

Unless a minimal support change is necessary for the SEC canonical path, Phase 2 excludes full market-data implementation, news provider implementation, Shariah engine, advanced analysis engine, Web frontend, Bot, Mobile, auth, watchlists, alerts, AI explanation, and trading execution.

The inclusion boundary is only configuration, migrations, repositories, ingestion, tests, contract evolution, and API route changes required to persist and serve actual SEC company/fundamental/filing data. An existing interface or table does not justify including an excluded feature.

## 27. Phase 2 entry criteria

- Master Handoff accepted.
- Product Specification accepted.
- Technical Master Plan accepted.
- Repository clean.
- origin/main synchronized and intended baseline confirmed.
- Phase 2 scope explicitly approved.
- Migration strategy approved.
- No unresolved blocker changes Phase 2 architecture.

## 28. Phase 2 exit criteria

- Reviewed migrations exist and create canonical PostgreSQL schema from version-controlled migration history.
- SEC-sourced data can be ingested idempotently.
- Provenance is preserved.
- Persisted data is queryable through repository/service boundaries.
- Existing instrument, fundamentals, and filings APIs return real sourced data when available.
- APIs fail closed when unavailable or unsuitable.
- Tests, typecheck, and build pass.
- No fabricated data, legacy contamination, or trading functionality was introduced.
- Final audit completed and reviewed.

## 29. Later-phase roadmap

After Phase 2, likely later work includes market-data provider/price context; news provider/article context; approved deterministic Shariah screening; fundamentals/technical/risk/comparison engines; Web research UI; authentication, watchlists, and alerts; Bot lookup/alerts; constrained AI explanation; and Mobile. These are roadmap areas, not approved phase numbers or guaranteed ordering.

## 30. Open technical decisions / TBDs

- PostgreSQL hosting, environment topology, backup/recovery, and migration deployment workflow.
- Concrete market-data provider, coverage, delay/freshness, adjustment, and asset policy.
- Concrete news provider, access, retention, and cross-source duplicate policy.
- Shariah methodology/version representation after product and governance decisions.
- Scheduler/job/queue infrastructure and ingestion cadence.
- Cache technology, scope, invalidation, and freshness policy.
- Authentication/account provider and authorization/privacy model.
- Hosting/deployment target and release strategy.
- Observability metrics/tracing/alerting stack and retention.
- AI model/provider, data handling, citation, and evaluation policy.
- Canonical supported asset universe and identity rules beyond SEC/CIK coverage.
- Reviewed resolution of the current Orval zod.void() response-schema limitation.

## 31. Risk register

| Risk | Mitigation |
| --- | --- |
| Provider instability/rate limits | Typed errors, timeout, bounded retry/backoff, rate-aware scheduling, ingestion records, honest unavailable state. |
| Source schema changes | Runtime validation, fixtures, invalid-response failure, adapter review. |
| Stale/partial data | Preserve timing/provenance, approve category policy, distinguish state, fail closed. |
| Duplicate ingestion | Canonical identity, unique constraints, repeatable writes, transactions, idempotency tests. |
| Migration errors | Reviewed migrations, isolated verification, staged rollout, recovery planning, no direct DB push. |
| Provenance loss | Provenance-bearing provider results, schema fields, query/API mapping, end-to-end assertions. |
| Inconsistent methodology versions | Named/versioned deterministic definitions and recorded inputs; never silently mix methods. |
| AI hallucination | AI only explains cited supplied material; no rulings/overrides. |
| Generated-contract drift | OpenAPI-first, generated ownership, typecheck, contract tests, deterministic second codegen. |
| Secret leakage | Environment/secret manager only, redacted logs, least privilege, review. |
| Premature complexity | Modular monolith, explicit modules, measured justification for queues/caches/services. |
| Legacy contamination | Legacy read-only, provenance only, scope/history audit. |

## 32. Technical acceptance boundary

This Technical Master Plan is a planning artifact. Creating or reviewing this document does **NOT** itself authorize Phase 2 implementation.

Phase 2 may begin only after explicit human approval following review of this document.
