import assert from "node:assert/strict";
import test from "node:test";
import type { Repositories } from "@ump/db";
import {
  CuratedStockMappingOnboardingError,
  CuratedStockMappingOnboardingService,
} from "./curated-stock-mapping-onboarding";
import {
  CURATED_STOCK_MAPPING_REGISTRY_VERSION,
  type CuratedStockMappingRegistry,
  type CuratedUsStockMappingRevision,
} from "./curated-stock-mapping-registry";

function revision(): CuratedUsStockMappingRevision {
  return {
    mappingId: "fictional-acme-common",
    revision: 1,
    revisionId: "fictional-acme-common@1",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    changeReason: "fixture",
    lifecycle: "active",
    instrument: {
      symbol: "ACME",
      exchange: "XNAS",
      name: "Fictional Acme",
      assetType: "stock",
      currency: "USD",
      listingCountry: "US",
    },
    company: { cik: "123456", legalName: "Fictional Acme Corporation" },
    exchangeListingEvidence: {
      source: "fictional-listing",
      reference: "listing",
      retrievedAt: "2026-01-01T00:00:00.000Z",
    },
    secCompanyEvidence: {
      source: "fictional-sec",
      reference: "cik",
      retrievedAt: "2026-01-01T00:00:00.000Z",
    },
    approval: {
      status: "approved",
      approvedBy: "reviewer",
      approvedAt: "2026-01-02T00:00:00.000Z",
    },
  };
}
function registry(
  revisions: CuratedUsStockMappingRevision[] = [revision()],
): CuratedStockMappingRegistry {
  return { version: CURATED_STOCK_MAPPING_REGISTRY_VERSION, revisions };
}
function harness(conflict = false) {
  const calls: string[] = [];
  let revisions = 0;
  const bound = {
    dataSources: {
      persist: async () => ({ status: "duplicate" as const, id: "source" }),
    },
    mappingOnboarding: {
      persistCompany: async () => ({
        status: "duplicate" as const,
        id: "company",
      }),
      persistInstrument: async () =>
        conflict
          ? {
              status: "conflict" as const,
              conflict: "instrument-identity" as const,
            }
          : { status: "duplicate" as const, id: "instrument" },
      persistRevision: async () => {
        revisions++;
        return revisions === 1
          ? { status: "inserted" as const }
          : { status: "duplicate" as const };
      },
    },
  } as unknown as Repositories;
  const repositories = {
    withTransaction: async <T>(
      operation: (value: Repositories) => Promise<T>,
    ) => {
      calls.push("begin");
      try {
        const value = await operation(bound);
        calls.push("commit");
        return value;
      } catch (error) {
        calls.push("rollback");
        throw error;
      }
    },
  } as Repositories;
  return {
    service: new CuratedStockMappingOnboardingService({ repositories }),
    calls,
  };
}
test("onboards approved active revisions transactionally and is idempotent", async () => {
  const h = harness();
  assert.deepEqual(await h.service.onboard(registry()), {
    inserted: 1,
    duplicate: 0,
  });
  assert.deepEqual(await h.service.onboard(registry()), {
    inserted: 0,
    duplicate: 1,
  });
  assert.deepEqual(h.calls, ["begin", "commit", "begin", "commit"]);
});
test("accepts an empty registry without provider work", async () => {
  const h = harness();
  assert.deepEqual(await h.service.onboard(registry([])), {
    inserted: 0,
    duplicate: 0,
  });
});
test("rejects invalid and non-runtime historical records before writing", async () => {
  const h = harness();
  const bad = revision();
  bad.instrument.exchange = "ARCX";
  await assert.rejects(
    h.service.onboard(registry([bad])),
    CuratedStockMappingOnboardingError,
  );
  assert.deepEqual(h.calls, []);
});
test("rolls back on existing instrument conflicts", async () => {
  const h = harness(true);
  await assert.rejects(
    h.service.onboard(registry()),
    CuratedStockMappingOnboardingError,
  );
  assert.deepEqual(h.calls, ["begin", "rollback"]);
});
