# UMP v2 — Halal Investment Intelligence

## Repository boundary and provenance

UMP v2 is a standalone repository established from Phase 1 source commit
`801c8893e53f2083a94fbe872e42b3e07e39c57b`. The legacy UMP repository and its
Python/XAUUSD trading system remain separate and unchanged.

Phase 1 provides the shared UMP Core API foundation. It does not execute trades,
send Telegram messages, or generate trading signals.

```text
Future Web client ─┐
Future bot ────────┼──> Shared UMP Core API
Future mobile app ─┘          │
                               ├── provider contracts and SEC EDGAR adapter
                               ├── typed API contracts
                               └── future PostgreSQL persistence
```

Future clients consume the same Core API. Investment and Shariah business logic
belongs in the shared API and must not be duplicated in client applications.

## Phase 1 constraints

`SEC_USER_AGENT` is required only when the SEC EDGAR adapter is instantiated.
The adapter uses official `data.sec.gov` endpoints, normalizes CIKs, rate-limits
requests, and surfaces typed upstream failures.

Phase 1 has no concrete market-data adapter and no persistence-backed API routes.
`/api/healthz` is available; data-dependent routes return typed
`503 DATA_UNAVAILABLE` until real provider data is ingested.

Data must remain traceable: raw/source data, normalized persistence when added,
deterministic analysis, and then API responses. AI must not fabricate financial
