import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  companies,
  createDatabase,
  createRepositories,
  curatedStockMappingLifecycleEvents,
  curatedStockMappingRevisions,
  instruments,
} from "@ump/db";
import { CuratedStockMappingOnboardingService } from "./curated-stock-mapping-onboarding";
import {
  CURATED_STOCK_MAPPING_REGISTRY_VERSION,
  type CuratedStockMappingLifecycleEvent,
  type CuratedStockMappingRegistry,
  type CuratedUsStockMappingRevision,
} from "./curated-stock-mapping-registry";

const FLAG = "UMP_POSTGRES_INTEGRATION";
const DATABASE = "ump_v2_test";
class Rollback extends Error {}
function connectionString(): string {
  if (process.env[FLAG] !== "1") throw new Error(`${FLAG}=1 is required for PostgreSQL integration tests.`);
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required for PostgreSQL integration tests.");
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== `/${DATABASE}` || url.username !== "ump_test") throw new Error("PostgreSQL integration tests require local ump_v2_test on port 55432.");
  return value;
}
function revision(suffix: string, overrides: Partial<CuratedUsStockMappingRevision> = {}): CuratedUsStockMappingRevision {
  return { mappingId: `fictional-acme-${suffix}`, revision: 1, revisionId: `fictional-acme-${suffix}@1`, effectiveFrom: "2026-01-01T00:00:00.000Z", changeReason: "PostgreSQL fixture", lifecycle: "active",
    instrument: { symbol: `A${suffix.toUpperCase()}`.slice(0, 10), exchange: "XNAS", name: "Fictional Acme", assetType: "stock", currency: "USD", listingCountry: "US" },
    company: { cik: "912345678", legalName: "Fictional Acme Corporation" },
    exchangeListingEvidence: { source: `fixture-listing-${suffix}`, reference: "listing", retrievedAt: "2026-01-01T00:00:00.000Z" },
    secCompanyEvidence: { source: `fixture-sec-${suffix}`, reference: "cik", retrievedAt: "2026-01-01T00:00:00.000Z" },
    approval: { status: "approved", approvedBy: "fixture-reviewer", approvedAt: "2026-01-02T00:00:00.000Z" }, ...overrides };
}
function registry(revisions: CuratedUsStockMappingRevision[], lifecycleEvents: CuratedStockMappingLifecycleEvent[] = []): CuratedStockMappingRegistry {
  return { version: CURATED_STOCK_MAPPING_REGISTRY_VERSION, revisions, lifecycleEvents };
}
async function isolated(operation: (transaction: Parameters<Parameters<ReturnType<typeof createDatabase>["db"]["transaction"]>[0]>[0]) => Promise<void>) {
  const database = createDatabase({ connectionString: connectionString() });
  try {
    const tables = await database.pool.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])", [["curated_stock_mapping_revisions", "curated_stock_mapping_lifecycle_events"]]);
    assert.equal(tables.rows.length, 2, "Apply migration 0002 before running this suite.");
    try { await database.db.transaction(async (transaction) => { await operation(transaction); throw new Rollback(); }); } catch (reason) { if (!(reason instanceof Rollback)) throw reason; }
  } finally { await database.close(); }
}

test("PostgreSQL: lifecycle ledger inserts, is idempotent, rejects immutable conflicts, and rolls back", async () => {
  await isolated(async (transaction) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    const first = revision(suffix);
    const repositories = createRepositories(transaction);
    const service = new CuratedStockMappingOnboardingService({ repositories });
    assert.deepEqual(await service.onboard(registry([first])), { inserted: 1, duplicate: 0 });
    assert.deepEqual(await service.onboard(registry([first])), { inserted: 0, duplicate: 1 });
    const revisions = await transaction.select().from(curatedStockMappingRevisions).where(eq(curatedStockMappingRevisions.revisionId, first.revisionId));
    const events = await transaction.select().from(curatedStockMappingLifecycleEvents).where(eq(curatedStockMappingLifecycleEvents.revisionId, first.revisionId));
    assert.equal(revisions.length, 1); assert.equal(events.length, 1);
    assert.equal(events[0]?.effectiveFrom.toISOString(), first.effectiveFrom);
    assert.equal(events[0]?.recordedAt.toISOString(), first.approval.approvedAt);
    const second = { ...first, revision: 2, revisionId: `${first.mappingId}@2`, effectiveFrom: "2026-02-01T00:00:00.000Z", changeReason: "successor" };
    const transition: CuratedStockMappingLifecycleEvent = { revisionId: first.revisionId, lifecycle: "superseded", successorRevisionId: second.revisionId, effectiveFrom: second.effectiveFrom, recordedAt: "2026-02-03T00:00:00.000Z" };
    await service.onboard(registry([first, second], [transition]));
    assert.equal((await transaction.select().from(curatedStockMappingLifecycleEvents).where(eq(curatedStockMappingLifecycleEvents.revisionId, first.revisionId))).length, 2);
    const changedEvidence = { ...first, exchangeListingEvidence: { ...first.exchangeListingEvidence, reference: "changed" } };
    await assert.rejects(service.onboard(registry([changedEvidence])));
    const sameInstrumentOtherCompany = revision(`${suffix}x`, { instrument: first.instrument, company: { cik: "812345678", legalName: "Other Fictional Company" } });
    await assert.rejects(service.onboard(registry([sameInstrumentOtherCompany])));
    assert.equal((await transaction.select().from(companies).where(eq(companies.cik, "000912345678".slice(-10)))).length, 1);
    assert.equal((await transaction.select().from(instruments).where(and(eq(instruments.symbol, first.instrument.symbol), eq(instruments.exchange, "XNAS")))).length, 1);
  });
});
