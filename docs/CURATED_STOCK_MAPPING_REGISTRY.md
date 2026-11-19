# Curated stock mapping registry

The source-controlled registry at `apps/api-server/src/identity/curated-stock-mapping-registry-data.ts` is intentionally empty. It is a future input to identity work only; it does not create database rows, contact SEC, or activate an API capability.

Each record is an immutable historical revision with a stable `mappingId`, contiguous positive `revision`, and matching `revisionId` (`<mappingId>@<revision>`). The registry supports `active`, `retired`, and `superseded` lifecycle states. A superseded revision names exactly its next revision; the final revision is active or retired. Active identities are unique by normalized symbol and MIC. Initial coverage is US-listed USD stocks on `XNAS` or `XNYS` only.

Historical validation checks the complete record and revision graph, including evidence and chain consistency. Runtime eligibility is separate: only an `active` record with explicit `approved` status is projected into the existing Task 4C-A validator. That validator remains the final fail-closed check for SEC-supported mappings.

## Manual evidence and approval checklist

- Confirm the listing's symbol, canonical MIC (`XNAS` or `XNYS`), security name, USD currency, and US listing from exchange listing evidence. Record stable source, reference, and retrieval time.
- Confirm the company legal name and normalized SEC CIK from SEC evidence. Record stable source, reference, and retrieval time. Do not infer a CIK from a ticker.
- Create a new immutable revision with an effective date and specific change reason. For a replacement, mark the prior revision `superseded` and point it only to the next revision; otherwise use `retired`.
- Have a named human reviewer explicitly set `approval.status` to `approved` and record approval time. Pending or rejected records stay historical only.
- Run the repository tests, typecheck, build, and diff check before merging. No record may be added from scraping or automatic ingestion.
