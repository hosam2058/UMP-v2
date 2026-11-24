import assert from "node:assert/strict";
import test from "node:test";
import type { Repositories, StoredInstrumentCompany } from "@ump/db";
import {
  CURATED_STOCK_MAPPING_REGISTRY_VERSION,
  type CuratedStockMappingLifecycleEvent,
  type CuratedStockMappingRegistry,
  type CuratedUsStockMappingRevision,
} from "./curated-stock-mapping-registry";
import { CuratedMappingRuntimeAuthorizationService } from "./curated-mapping-runtime-authorization";

const asOf = new Date("2026-06-01T00:00:00.000Z");
const stored: StoredInstrumentCompany = {
  instrumentId: "instrument-1", symbol: "ACME", exchange: "XNAS", assetType: "stock",
  currency: "USD", country: "US", active: false,
  company: { id: "company-1", cik: "0000123456", legalName: "Fictional Acme Corporation" },
};

function revision(overrides: Partial<CuratedUsStockMappingRevision> = {}): CuratedUsStockMappingRevision {
  return {
    mappingId: "fictional-acme-common", revision: 1, revisionId: "fictional-acme-common@1",
    effectiveFrom: "2026-01-01T00:00:00.000Z", changeReason: "fixture", lifecycle: "active",
    instrument: { symbol: "ACME", exchange: "XNAS", name: "Fictional Acme", assetType: "stock", currency: "USD", listingCountry: "US" },
    company: { cik: "123456", legalName: "Fictional Acme Corporation" },
    exchangeListingEvidence: { source: "fictional-exchange", reference: "listing", retrievedAt: "2026-01-01T00:00:00.000Z" },
    secCompanyEvidence: { source: "fictional-sec", reference: "cik", retrievedAt: "2026-01-01T00:00:00.000Z" },
    approval: { status: "approved", approvedBy: "fictional-reviewer", approvedAt: "2026-01-02T00:00:00.000Z" },
    ...overrides,
  };
}

function registry(
  revisions: readonly CuratedUsStockMappingRevision[] = [revision()],
  lifecycleEvents: readonly CuratedStockMappingLifecycleEvent[] = [],
): CuratedStockMappingRegistry {
  return { version: CURATED_STOCK_MAPPING_REGISTRY_VERSION, revisions, lifecycleEvents };
}

function harness(options: {
  registry?: CuratedStockMappingRegistry;
  persisted?: StoredInstrumentCompany | undefined;
} = {}) {
  const calls: string[] = [];
  const repositories = {
    runtimeAuthorizations: {
      findInstrumentCompanyByIdentity: async (identity: { symbol: string; exchange: string }) => {
        calls.push(`${identity.symbol}:${identity.exchange}`);
        return options.persisted === undefined ? stored : options.persisted;
      },
    },
  } as unknown as Repositories;
  return {
    service: new CuratedMappingRuntimeAuthorizationService(
      repositories,
      options.registry === undefined ? registry() : options.registry,
      () => asOf,
    ),
    calls,
  };
}

test("authorizes an approved active curated mapping and preserves its provenance", async () => {
  const h = harness();
  const result = await h.service.resolve({ symbol: " acme ", exchange: "xnas" });
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.deepEqual(result.authorization.company, stored.company);
  assert.equal(result.authorization.mapping.revisionId, "fictional-acme-common@1");
  assert.equal(result.authorization.mapping.listingEvidence.source, "fictional-exchange");
  assert.deepEqual(h.calls, ["ACME:XNAS"]);
});

test("fails closed before database access for invalid, unknown, and unavailable authority", async () => {
  const invalid = harness();
  assert.deepEqual(await invalid.service.resolve({ symbol: "?", exchange: "XNAS" }), {
    status: "invalid-input", reason: "INVALID_INSTRUMENT_IDENTITY",
  });
  assert.deepEqual(invalid.calls, []);
  const unknown = harness();
  assert.deepEqual(await unknown.service.resolve({ symbol: "MISS", exchange: "XNAS" }), {
    status: "unsupported-instrument", reason: "INSTRUMENT_NOT_IN_CURATED_REGISTRY",
  });
  assert.deepEqual(unknown.calls, []);
  const empty = harness({ registry: registry([]) });
  assert.deepEqual(await empty.service.resolve({ symbol: "ACME", exchange: "XNAS" }), {
    status: "unsupported-instrument", reason: "INSTRUMENT_NOT_IN_CURATED_REGISTRY",
  });
  assert.deepEqual(empty.calls, []);
  const unavailable = new CuratedMappingRuntimeAuthorizationService({} as Repositories, undefined, () => asOf);
  assert.deepEqual(await unavailable.resolve({ symbol: "ACME", exchange: "XNAS" }), {
    status: "authority-unavailable", reason: "CURATED_REGISTRY_UNAVAILABLE",
  });
});

test("recognizes pending, rejected, retired, superseded, and future-effective mappings", async () => {
  for (const [approval, reason] of [["pending", "PENDING_MAPPING"], ["rejected", "REJECTED_MAPPING"]] as const) {
    const h = harness({ registry: registry([revision({ approval: { status: approval, approvedBy: "reviewer", approvedAt: "2026-01-02T00:00:00.000Z" } })]) });
    assert.deepEqual(await h.service.resolve({ symbol: "ACME", exchange: "XNAS" }), { status: "unauthorized-mapping", reason });
    assert.deepEqual(h.calls, []);
  }
  for (const [event, reason] of [[{ lifecycle: "retired", effectiveFrom: "2026-02-01T00:00:00.000Z", recordedAt: "2026-02-01T00:00:00.000Z" }, "RETIRED_MAPPING"], [{ lifecycle: "superseded", successorRevisionId: "fictional-acme-common@2", effectiveFrom: "2026-02-01T00:00:00.000Z", recordedAt: "2026-02-01T00:00:00.000Z" }, "SUPERSEDED_MAPPING"]] as const) {
    const revisions = event.lifecycle === "superseded" ? [revision(), revision({ revision: 2, revisionId: "fictional-acme-common@2", effectiveFrom: "2026-02-01T00:00:00.000Z", changeReason: "successor", instrument: { symbol: "ACMB", exchange: "XNAS", name: "Fictional Acme B", assetType: "stock", currency: "USD", listingCountry: "US" } })] : [revision()];
    const h = harness({ registry: registry(revisions, [{ revisionId: "fictional-acme-common@1", ...event }]) });
    assert.deepEqual(await h.service.resolve({ symbol: "ACME", exchange: "XNAS" }), { status: "unauthorized-mapping", reason });
  }
  const future = harness({ registry: registry([revision({ effectiveFrom: "2026-07-01T00:00:00.000Z" })]) });
  assert.deepEqual(await future.service.resolve({ symbol: "ACME", exchange: "XNAS" }), { status: "unauthorized-mapping", reason: "FUTURE_EFFECTIVE_MAPPING" });
});

test("uses explicit as-of values and rejects registry/database disagreement", async () => {
  const h = harness({ registry: registry([revision({ effectiveFrom: "2026-07-01T00:00:00.000Z" })]) });
  assert.equal((await h.service.resolve({ symbol: "ACME", exchange: "XNAS" })).status, "unauthorized-mapping");
  assert.equal((await h.service.resolve({ symbol: "ACME", exchange: "XNAS" }, { asOf: new Date("2026-08-01T00:00:00.000Z") })).status, "available");
  const mismatch = harness({ persisted: { ...stored, company: { ...stored.company, legalName: "Other Company" } } });
  assert.deepEqual(await mismatch.service.resolve({ symbol: "ACME", exchange: "XNAS" }), { status: "unauthorized-mapping", reason: "PERSISTED_MAPPING_MISMATCH" });
  const noStored = new CuratedMappingRuntimeAuthorizationService({ runtimeAuthorizations: { findInstrumentCompanyByIdentity: async () => undefined } } as unknown as Repositories, registry(), () => asOf);
  assert.deepEqual(await noStored.resolve({ symbol: "ACME", exchange: "XNAS" }), { status: "unauthorized-mapping", reason: "PERSISTED_MAPPING_NOT_FOUND" });
});

test("does not apply a future lifecycle event before its effective time", async () => {
  const value = registry([revision()], [{
    revisionId: "fictional-acme-common@1", lifecycle: "retired",
    effectiveFrom: "2026-07-01T00:00:00.000Z", recordedAt: "2026-07-01T00:00:00.000Z",
  }]);
  const h = harness({ registry: value });
  assert.equal((await h.service.resolve({ symbol: "ACME", exchange: "XNAS" })).status, "available");
  assert.deepEqual(
    await h.service.resolve({ symbol: "ACME", exchange: "XNAS" }, { asOf: new Date("2026-08-01T00:00:00.000Z") }),
    { status: "unauthorized-mapping", reason: "RETIRED_MAPPING" },
  );
});

test("reports ambiguous or malformed registry authority without writes or provider calls", async () => {
  const conflicting = registry([revision(), revision({ mappingId: "fictional-other", revisionId: "fictional-other@1", company: { cik: "654321", legalName: "Other Fictional Company" } })]);
  const h = harness({ registry: conflicting });
  assert.deepEqual(await h.service.resolve({ symbol: "ACME", exchange: "XNAS" }), { status: "ambiguous", reason: "AMBIGUOUS_CURATED_MAPPING" });
  assert.deepEqual(h.calls, []);
  const malformed = harness({ registry: { ...registry(), version: 999 as never } });
  assert.deepEqual(await malformed.service.resolve({ symbol: "ACME", exchange: "XNAS" }), { status: "authority-unavailable", reason: "INVALID_CURATED_REGISTRY" });
});
