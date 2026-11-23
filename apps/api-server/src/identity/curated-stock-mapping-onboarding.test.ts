import assert from "node:assert/strict";
import test from "node:test";
import type { Repositories } from "@ump/db";
import { CuratedStockMappingOnboardingError, CuratedStockMappingOnboardingService } from "./curated-stock-mapping-onboarding";
import { CURATED_STOCK_MAPPING_REGISTRY_VERSION, type CuratedStockMappingLifecycleEvent, type CuratedStockMappingRegistry, type CuratedUsStockMappingRevision } from "./curated-stock-mapping-registry";

function revision(overrides: Partial<CuratedUsStockMappingRevision> = {}): CuratedUsStockMappingRevision {
  return { mappingId: "fictional-acme-common", revision: 1, revisionId: "fictional-acme-common@1", effectiveFrom: "2026-01-01T00:00:00.000Z", changeReason: "fixture", lifecycle: "active",
    instrument: { symbol: "ACME", exchange: "XNAS", name: "Fictional Acme", assetType: "stock", currency: "USD", listingCountry: "US" },
    company: { cik: "123456", legalName: "Fictional Acme Corporation" },
    exchangeListingEvidence: { source: "fictional-listing", reference: "listing", retrievedAt: "2026-01-01T00:00:00.000Z" },
    secCompanyEvidence: { source: "fictional-sec", reference: "cik", retrievedAt: "2026-01-01T00:00:00.000Z" },
    approval: { status: "approved", approvedBy: "reviewer", approvedAt: "2026-01-02T00:00:00.000Z" }, ...overrides };
}
function registry(revisions: CuratedUsStockMappingRevision[] = [revision()], lifecycleEvents: CuratedStockMappingLifecycleEvent[] = []): CuratedStockMappingRegistry {
  return { version: CURATED_STOCK_MAPPING_REGISTRY_VERSION, revisions, lifecycleEvents };
}
function harness(options: { instrumentConflict?: boolean; revisionConflict?: boolean; failEvent?: boolean } = {}) {
  const calls: string[] = []; const revisionIds = new Set<string>(); const eventKeys = new Set<string>();
  const bound = {
    dataSources: { persist: async () => ({ status: "duplicate" as const, id: "source" }) },
    mappingOnboarding: {
      persistCompany: async () => ({ status: "duplicate" as const, id: "company" }),
      persistInstrument: async () => options.instrumentConflict ? { status: "conflict" as const, conflict: "instrument-identity" as const } : { status: "duplicate" as const, id: "instrument" },
      persistRevision: async (input: { revisionId: string }) => {
        if (options.revisionConflict) return { status: "conflict" as const, conflict: "mapping-revision" as const };
        const duplicate = revisionIds.has(input.revisionId); revisionIds.add(input.revisionId);
        return { status: duplicate ? "duplicate" as const : "inserted" as const };
      },
      persistLifecycleEvent: async (input: { revisionId: string; lifecycle: string; successorRevisionId: string | null; effectiveFrom: Date; recordedAt: Date }) => {
        if (options.failEvent) return { status: "conflict" as const, conflict: "lifecycle-event" as const };
        const key = JSON.stringify(input); const duplicate = eventKeys.has(key); eventKeys.add(key);
        return { status: duplicate ? "duplicate" as const : "inserted" as const };
      },
    },
  } as unknown as Repositories;
  const repositories = { withTransaction: async <T>(operation: (value: Repositories) => Promise<T>) => { calls.push("begin"); try { const value = await operation(bound); calls.push("commit"); return value; } catch (reason) { calls.push("rollback"); throw reason; } } } as Repositories;
  return { service: new CuratedStockMappingOnboardingService({ repositories }), calls, eventKeys };
}
test("initial onboarding persists immutable revision and initial lifecycle event transactionally", async () => {
  const h = harness();
  assert.deepEqual(await h.service.onboard(registry()), { inserted: 1, duplicate: 0 });
  assert.deepEqual(h.calls, ["begin", "commit"]);
  assert.equal(h.eventKeys.size, 1);
});
test("revision one to revision two persists a later supersession with its own record timestamp", async () => {
  const h = harness(); const second = revision({ revision: 2, revisionId: "fictional-acme-common@2", effectiveFrom: "2026-02-01T00:00:00.000Z", changeReason: "successor" });
  const event: CuratedStockMappingLifecycleEvent = { revisionId: "fictional-acme-common@1", lifecycle: "superseded", successorRevisionId: second.revisionId, effectiveFrom: second.effectiveFrom, recordedAt: "2026-02-05T00:00:00.000Z" };
  assert.deepEqual(await h.service.onboard(registry([revision(), second], [event])), { inserted: 2, duplicate: 0 });
  assert.ok([...h.eventKeys].some((key) => key.includes("2026-02-05")));
});
test("retirement without successor remains historical and records a terminal event", async () => {
  const h = harness(); const retired: CuratedStockMappingLifecycleEvent = { revisionId: "fictional-acme-common@1", lifecycle: "retired", effectiveFrom: "2026-03-01T00:00:00.000Z", recordedAt: "2026-03-02T00:00:00.000Z" };
  await h.service.onboard(registry([revision()], [retired]));
  assert.equal(h.eventKeys.size, 2);
});
test("repeated onboarding is idempotent for revisions and events", async () => {
  const h = harness(); const value = registry();
  await h.service.onboard(value);
  assert.deepEqual(await h.service.onboard(value), { inserted: 0, duplicate: 1 });
  assert.equal(h.eventKeys.size, 1);
});
test("conflicts and mid-batch event failures roll back the entire onboarding transaction", async () => {
  for (const options of [{ instrumentConflict: true }, { failEvent: true }, { revisionConflict: true }]) {
    const h = harness(options);
    await assert.rejects(h.service.onboard(registry()), CuratedStockMappingOnboardingError);
    assert.deepEqual(h.calls, ["begin", "rollback"]);
  }
});
