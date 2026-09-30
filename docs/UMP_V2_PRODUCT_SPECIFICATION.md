# UMP v2 Product Specification

## Document purpose and status

This document defines intended user-facing product requirements for UMP v2. It is not an implementation plan or authority to begin a later phase. **CURRENT** means the published foundation, **PLANNED** means intended functionality, and **TBD** means an unresolved product decision.

## 1. Product vision

**UMP — Halal Investment Intelligence** is intended to be a trustworthy investment research platform for discovering, screening, analyzing, comparing, monitoring, and understanding real stocks and ETFs. It brings sourced market and company information, Shariah screening, and understandable analysis into one research experience. The user makes the final investment decision.

UMP does not execute trades, hold brokerage accounts, or provide trade-execution workflows.

## 2. Product principles

- **Source-backed financial truth:** important factual information comes from identified sources.
- **Transparent provenance:** material information exposes origin, relevant date/period, and retrieval time.
- **No fabricated financial data:** unavailable information is never replaced with invented values.
- **No fabricated Shariah rulings:** an invented or AI-generated ruling is not a screening result.
- **Explainability:** important conclusions expose applicable method, evidence, inputs, and uncertainty.
- **Fail closed:** unavailable, incomplete, stale, or unsuitable required data must not yield an apparently acceptable result.
- **Methodology-specific Shariah classification:** a status is meaningful only in the context of its named, versioned methodology.
- **Separated layers:** factual data, deterministic analysis, methodology rules, and AI explanation remain distinct.
- **Shared Core/API:** future clients consume it as the source of investment and Shariah business logic.

## 3. Target users

UMP is intended for individual investors seeking Shariah-aware research; investors researching stocks or ETFs before making decisions; users wanting consolidated fundamentals, filings, risk, technical context, news, and screening; and users who want transparent evidence behind results. The project does not establish demographic, geographic, or commercial claims beyond these research needs.

## 4. Core user problems

UMP addresses fragmented investment information, difficulty verifying source provenance, difficulty understanding company fundamentals and filings, difficulty consistently applying a Shariah methodology, difficulty comparing assets through one framework, and the risk that AI-generated content makes unsupported claims appear credible.

## 5. Core user journeys

| Journey | Intended outcome | Status |
| --- | --- | --- |
| Search/discovery | Find a supported stock or ETF and see whether research is available. | **PLANNED** |
| Asset research page | Review a dated, evidence-backed view of one asset. | **PLANNED** |
| Shariah screening | See a methodology-specific result, inputs, and limitations. | **PLANNED** |
| Fundamentals review | Inspect sourced facts in fiscal/reporting context. | **PLANNED** |
| SEC filing review | Find filings and open official source material. | **PLANNED**; an SEC adapter exists, but no data is ingested or served. |
| Price/technical context | Inspect observed prices and labelled derived indicators. | **PLANNED**; contracts exist, no market provider. |
| Risk analysis | Inspect evidence-backed risks and uncertainty. | **PLANNED** |
| News/context review | Review sourced news separately from analysis. | **PLANNED**; contracts exist, no news provider. |
| Compare assets | Compare consistent fields and methods. | **PLANNED** |
| Monitor/watchlists | Follow selected assets. | **PLANNED** |
| Alerts | Receive evidence-linked change notices. | **PLANNED** |
| AI explanations | Understand already sourced or deterministic results. | **PLANNED** |

**CURRENT foundation:** health plus typed instrument, filing, and fundamentals endpoint shapes exist. Data-dependent endpoints return `503 DATA_UNAVAILABLE` until real provider data has been ingested. No research UI or end-user research journey exists.

## 6. Asset research experience

For a supported asset with available data, the intended research experience includes identity/profile (symbol, name, type, exchange, currency, and available company context); price context (observed data, timing, delay, source, retrieval time); fundamentals (sourced facts, units, fiscal period, reporting context); filings (type, dates, official link); Shariah status (method/version, state, inputs, limitations); risk; technical context; sourced news; and trust details (source/provider, reference, as-of/reporting period, retrieval time, calculation provenance where derived).

It must display clear data states for unavailable, incomplete, stale, provider-limited, and unsupported information. It must not imply that every field, metric, market, or asset is supported.

## 7. Shariah screening product requirements

Shariah screening is **PLANNED**, not implemented. Its methodology must be explicit, identifiable, and versioned; every result must identify the methodology/version; relevant underlying sourced inputs must be visible where appropriate with period/source/availability; and the calculation/result must be reproducible from recorded methodology/version, sourced inputs, and deterministic logic.

Ambiguous, missing, unavailable, or unsuitable required data must not silently become halal, acceptable, or passing. Methodology disagreement must be represented transparently. Deterministic rules produce the result; AI is not the authority for a ruling and cannot override it. An explanation may summarize the sourced deterministic result while retaining its method, state, and limitations.

**TBD:** exact methodology or methodologies, authoritative basis, numerical thresholds, supported-asset treatment, edge cases, and disagreement presentation. This specification selects no scholar board, fatwa, methodology provider, or numerical threshold.

## 8. Fundamentals and filings

Each displayed fundamental must identify, where applicable, metric/value/unit/taxonomy, fiscal year and period, filing or reporting date, source/provider, source-as-of context, retrieval time, and source record or official filing reference. SEC filing views must include filing type, filing date, report date when available, and a link to the official filing/source.

Unavailable facts, periods, filings, source links, or complete data sets must be shown as unavailable or incomplete. UMP must not infer a missing fact or present a non-equivalent period as complete.

**CURRENT:** domain/schema definitions accommodate facts and SEC filing provenance; the SEC EDGAR adapter obtains company facts and recent filings. No persistence/query service, migration, ingested data, or populated API response exists.

## 9. Market and technical analysis

Market and technical content is research context, not a promise or execution instruction. **Observed market data** is sourced price/volume information tied to interval, timestamp, provider, and retrieval context. **Derived indicators** identify their observed inputs, method, and timeframe. **Analytical interpretation** is clearly separate from data and calculation. **Prediction and uncertainty** are uncertain analysis, never a guaranteed outcome, trading signal, or profit claim.

**CURRENT:** market-data and price-bar contracts exist, but no market-data provider, price history, technical engine, or technical UI exists.

## 10. Risk analysis

The intended risk experience is transparent rather than an opaque score. Where data and methodology support it, it may cover volatility/market risk, business/fundamental risk, liquidity or data-quality limitations, concentration/exposure, and identifiable filing/news risks. Every material conclusion exposes evidence, period/context, derived method where relevant, and uncertainty or limitations. It is not a safety guarantee or trading recommendation.

**CURRENT:** no risk-analysis engine or experience exists.

## 11. News and context

News displayed by UMP must be sourced. Each item should identify publication/source, published time, retrieved time, and source URL/reference where available. Factual event reporting is distinct from UMP analysis or AI explanation. UMP must not invent headlines, articles, summaries, publication details, or links. Duplicate reporting must not be portrayed as independent events; unavailable, removed, inaccessible, or incomplete sources must be labelled rather than replaced.

**CURRENT:** a provenance-aware news contract exists; no provider, ingestion, or user experience exists.

## 12. AI role

AI may explain sourced facts and deterministic outputs, summarize material available to UMP, compare consistently defined sourced information, translate complex material into understandable language, and help users navigate research.

AI must not become financial truth; fabricate values, filings, news, citations, or provenance; fabricate Shariah rulings; silently override deterministic calculations/rules; execute trades; or claim guaranteed outcomes, returns, or profits. Explanations retain applicable source, methodology, result state, and uncertainty.

**CURRENT:** no AI capability exists.

## 13. Watchlists and alerts

Watchlists and alerts are **PLANNED**. Users should be able to follow supported assets and, subject to data availability and settings, receive notices of material filing changes, meaningful sourced news, Shariah-status changes, and material data or risk changes. Every alert identifies triggering evidence, source, relevant time, and nature of change. It cannot invent a trigger or act as a trade-execution signal.

**CURRENT:** no authentication, watchlist, alert evaluation, delivery, or alert client exists.

## 14. Comparison experience

UMP should compare multiple supported stocks and ETFs through consistent field definitions, periods, units, source context, methodology versions, and freshness. If an asset, field, period, result, or source is unavailable, the comparison shows that state instead of inventing, treating stale data as current, or substituting a non-equivalent value. It must not silently mix methodologies or incompatible periods.

**CURRENT:** no comparison capability exists.

## 15. Client strategy

- **Web** is the primary full research experience.
- **Bot** is secondary for alerts and quick lookup.
- **Mobile** is later.

All clients consume the shared Core/API. Investment research, screening, methodology, and Shariah logic cannot be duplicated in clients. Clients may vary in presentation, but material results and provenance remain consistent with the Core/API.

**CURRENT:** the repository has the shared API foundation only; no Web, Bot, or Mobile client exists.

## 16. Data trust and provenance

Every important financial output must be traceable. Subject to its source and nature, UMP identifies source/provider, source URL/reference where applicable, fetched/retrieved time, source-as-of/reporting period, and transformation/calculation provenance where derived. Original source data, normalized data, deterministic calculation, and explanatory text remain distinguishable. Provenance remains available in comparisons, summaries, and alerts.

**CURRENT:** provider results include provider, retrieval time, as-of time, delay status, and optional source URL. The planned database schema carries source attribution and applicable filing, publication, as-of, and fetched times. It is neither migrated nor populated/served as research data.

## 17. Failure and unavailable-data experience

UMP fails closed where a result requires unavailable or insufficient data. It distinguishes **data unavailable** (no usable data); **provider unavailable** (relevant source cannot provide data); **stale data** (data exceeds the applicable freshness expectation); **incomplete data** (required facts, periods, fields, or evidence are absent); and **unsupported asset/metric** (asset, exchange, geography, metric, or analytical capability is outside coverage).

The state must be understandable and preserve known provenance. An old result, if visible, shows its date and cannot be represented as current. No state may substitute invented values or a positive screening result.

**CURRENT:** data-dependent endpoints return typed `503 DATA_UNAVAILABLE` until ingestion/query services exist.

## 18. Functional scope

### A. Foundation already implemented

- Standalone TypeScript Core/API foundation and OpenAPI contract.
- Provider contracts for market data, fundamentals, filings, and news with provenance and typed errors.
- A registry with no fabricated fallback.
- SEC EDGAR adapter for company resolution, company facts, and recent official filings.
- Un-applied Drizzle schema for sources, companies, instruments, price bars, fundamentals, SEC filings, news, and ingestion records.
- Health endpoint and typed unavailable instrument, filing, and fundamentals endpoints.

This is an engineering foundation, not a populated end-user research product.

### B. Next product capabilities

After the required planning and approval sequence, intended next capabilities include supported-asset discovery and retrieval; ingestion and persistence-backed sourced fundamentals and filings; market/news coverage; a Web research experience; deterministic methodology-specific Shariah screening; provenance presentation; and unavailable-data states. This is direction, not an approved engineering-phase order.

### C. Later capabilities

Later capability may include comparison, risk and technical context, evidence-constrained AI explanations, watchlists, evidence-linked alerts, Bot quick lookup/alerts, and Mobile. Scope depends on later decisions and planning.

## 19. Explicit non-goals

UMP does not provide brokerage, trade execution, CFD/MT5 integration, leverage execution, short-selling execution, options/futures execution, automated trading signals, guaranteed return/profit prediction, fabricated/synthetic financial truth, or AI-generated religious rulings.

## 20. Product quality requirements

- **Correctness:** facts/results accurately reflect available sources, inputs, and stated method.
- **Provenance:** material outputs retain source and timing context.
- **Consistency:** equivalent results are consistent across clients through the shared Core/API.
- **Explainability:** users can understand meaning, method, evidence, and limitations.
- **Reproducibility:** important screening/derived outputs can be reproduced from retained inputs and versioned method.
- **Availability/error transparency:** unavailability, source limits, staleness, incompleteness, and unsupported scope are visible.
- **Security/privacy:** future account and preference data receives appropriate protection; UMP does not request trading-execution credentials.
- **Accessibility:** labels and data states work with common accessibility needs and do not rely on color alone.
- **Responsiveness/usability:** time-sensitive source context, loading, and unavailable states are understandable without obscuring evidence.
- **Auditability:** material outputs retain a reviewable source-input, method/version, calculation-context, and result-state trail.

## 21. Product success criteria

Readiness uses measurable properties, not invented revenue or user-count targets:

- Supported coverage is clear about expected available versus unavailable data.
- Material facts/results have applicable source, time, period, and reference information.
- Methodology-specific screening results are reproducible from retained versioned method and sourced inputs.
- Users can identify freshness, as-of/reporting time, retrieval time, delay, and stale-data condition.
- Unavailable, incomplete, unsupported, and provider-failure conditions are distinguishable and never appear as normal fabricated data.
- The same supported request and methodology result are consistent across clients consuming the Core/API.
- Released user workflows have testable acceptance behavior appropriate to discovery, research, filings, fundamentals, screening, comparison, monitoring, alerts, and AI explanation scope.

## 22. Release and capability staging

1. **Trusted data foundation:** supported coverage, ingestion, persistence, retrieval, and transparent unavailable-data behavior.
2. **Core research:** Web discovery and evidence-backed asset research for actually supported data categories.
3. **Methodology-backed intelligence:** reviewed deterministic screening and appropriately scoped fundamentals, filings, market, technical, risk, and news context.
4. **Research continuity:** consistent comparison, watchlists, and evidence-linked alerts.
5. **Additional clients and assistance:** shared-Core/API Bot, later Mobile, and constrained AI assistance.

These are product capability stages only. They do not overwrite or map to engineering Phase numbering and do not authorize implementation.

## 23. Open product decisions / TBDs

- Exact Shariah methodology/methodologies, authoritative basis, governance, thresholds, edge-case treatment, and disagreement presentation.
- Supported exchanges, geographies, asset universe, and stock/ETF coverage.
- Market-data providers, coverage, delay/freshness expectations, and supported market metrics.
- News providers, coverage, source-access policy, de-duplication policy, and definition of meaningful news.
- Risk framework, supported categories, and boundary between observation and derived conclusion.
- Supported technical indicators and uncertainty language.
- Authentication/account model for saved research, watchlists, and alerts.
- Alert triggers, channels, frequency, controls, and material-change policy.
- Commercialization/pricing.
- Localization, languages, and regional presentation.
- AI scope, safeguards, interaction design, and source-citation behavior.

## 24. Acceptance boundary

This Product Specification defines product intent and requirements. It does **NOT** authorize Phase 2 implementation.

The Technical Master Plan must be produced and reviewed next before Phase 2 receives explicit approval.
