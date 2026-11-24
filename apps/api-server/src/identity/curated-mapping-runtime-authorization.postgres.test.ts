import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { inArray } from "drizzle-orm";
import {
  companies,
  createDatabase,
  createRepositories,
  dataSources,
  fundamentalFacts,
  instruments,
  secFilings,
} from "@ump/db";
import {
  CURATED_STOCK_MAPPING_REGISTRY_VERSION,
  type CuratedStockMappingRegistry,
} from "./curated-stock-mapping-registry";
import { createTrustedFinancialQueryRuntime } from "../query-services/trusted-financial-query-runtime";

const FLAG = "UMP_POSTGRES_INTEGRATION";
const DATABASE = "ump_v2_test";
const PORT = "55432";
const USER = "ump_test";
class Rollback extends Error {}

function connectionString(): string {
  if (process.env[FLAG] !== "1")
    throw new Error(`${FLAG}=1 is required for PostgreSQL integration tests.`);
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required for PostgreSQL integration tests.");
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" ||
    url.port !== PORT ||
    url.pathname !== `/${DATABASE}` ||
    url.username !== USER
  )
    throw new Error(`PostgreSQL integration tests require local ${DATABASE} on port ${PORT}.`);
  return value;
}

function registry(symbol: string, cik: string, legalName: string): CuratedStockMappingRegistry {
  return {
    version: CURATED_STOCK_MAPPING_REGISTRY_VERSION,
    revisions: [{
      mappingId: "fictional-runtime-authorization",
      revision: 1,
      revisionId: "fictional-runtime-authorization@1",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      changeReason: "PostgreSQL runtime authorization fixture",
      lifecycle: "active",
      instrument: { symbol, exchange: "XNAS", name: "Fictional Runtime Issuer", assetType: "stock", currency: "USD", listingCountry: "US" },
      company: { cik, legalName },
      exchangeListingEvidence: { source: "fictional-exchange", reference: "listing-record", retrievedAt: "2026-01-01T00:00:00.000Z" },
      secCompanyEvidence: { source: "fictional-sec", reference: "cik-record", retrievedAt: "2026-01-01T00:00:00.000Z" },
      approval: { status: "approved", approvedBy: "fictional-reviewer", approvedAt: "2026-01-02T00:00:00.000Z" },
    }],
    lifecycleEvents: [],
  };
}

test("PostgreSQL: runtime authorization gates persisted SEC reads and rolls back", async () => {
  const database = createDatabase({ connectionString: connectionString() });
  const fixtureCiks: string[] = [];
  try {
    assert.equal(
      (await database.pool.query<{ current_database: string }>("SELECT current_database() AS current_database")).rows[0]?.current_database,
      DATABASE,
    );
    try {
      await database.db.transaction(async (transaction) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
        const symbol = `R${suffix}`.slice(0, 10);
        const cik = `9${String(Date.now() % 1_000_000_000).padStart(9, "0")}`;
        fixtureCiks.push(cik);
        const legalName = "Fictional Runtime Issuer";
        const source = (await transaction.insert(dataSources).values({
          provider: `runtime-auth-${suffix}`, name: "Runtime authorization fixture", baseUrl: "https://data.sec.gov", isDelayed: false,
        }).returning({ id: dataSources.id }))[0]!;
        const company = (await transaction.insert(companies).values({ cik, legalName, country: "US" }).returning({ id: companies.id }))[0]!;
        await transaction.insert(instruments).values({
          companyId: company.id, symbol, name: "Fictional Runtime Issuer", assetType: "stock",
          exchange: "XNAS", currency: "USD", country: "US", active: false,
        });
        await transaction.insert(secFilings).values({
          companyId: company.id, sourceId: source.id, accessionNumber: `${cik}-26-000001`, form: "10-K",
          filingDate: "2026-02-01", reportDate: "2025-12-31", primaryDocument: "runtime.htm",
          sourceUrl: "https://www.sec.gov/Archives/runtime.htm", fetchedAt: new Date("2026-02-02T00:00:00.000Z"),
        });
        await transaction.insert(secFilings).values({
          companyId: company.id, sourceId: source.id, accessionNumber: `${cik}-25-000002`, form: "10-K",
          filingDate: "2025-02-01", reportDate: "2024-12-31", primaryDocument: "runtime-prior.htm",
          sourceUrl: "https://www.sec.gov/Archives/runtime-prior.htm", fetchedAt: new Date("2025-02-02T00:00:00.000Z"),
        });
        await transaction.insert(fundamentalFacts).values({
          companyId: company.id, sourceId: source.id, taxonomy: "us-gaap", tag: "Assets", unit: "USD",
          value: "123.45", accessionNumber: `${cik}-26-000001`, form: "10-K", filingDate: "2026-02-01",
          reportingStart: null, reportingEnd: "2025-12-31", fiscalYear: 2025, fiscalPeriod: "FY", frame: null,
          sourceAsOf: null, fetchedAt: new Date("2026-02-02T00:00:00.000Z"),
        });
        await transaction.insert(fundamentalFacts).values({
          companyId: company.id, sourceId: source.id, taxonomy: "us-gaap", tag: "Assets", unit: "USD",
          value: "900719925474099312345.6789", accessionNumber: `${cik}-25-000002`, form: "10-K",
          filingDate: "2025-02-01", reportingStart: "2024-01-01", reportingEnd: "2024-12-31",
          fiscalYear: 2024, fiscalPeriod: "FY", frame: null, sourceAsOf: null,
          fetchedAt: new Date("2025-02-02T00:00:00.000Z"),
        });

        const repositories = createRepositories(transaction);
        const runtime = createTrustedFinancialQueryRuntime({
          repositories,
          registry: registry(symbol, cik, legalName),
          clock: () => new Date("2026-06-01T00:00:00.000Z"),
        });
        const resolution = await runtime.authorization.resolve({ symbol, exchange: "XNAS" });
        assert.equal(resolution.status, "available");
        if (resolution.status !== "available") throw new Error("Expected authorized runtime resolution.");
        assert.equal(resolution.authorization.company.cik, cik);
        assert.equal(resolution.authorization.mapping.listingEvidence.source, "fictional-exchange");

        const filings = await runtime.queries.getFilingsByInstrument({ symbol, exchange: "XNAS" });
        assert.equal(filings.status, "available");
        if (filings.status !== "available") throw new Error("Expected authorized stored filings.");
        assert.equal(filings.company.cik, cik);
        assert.equal(filings.items[0]?.source.provider, `runtime-auth-${suffix}`);
        assert.equal(filings.mapping.revisionId, "fictional-runtime-authorization@1");
        assert.deepEqual(filings.items.map((item) => item.accessionNumber), [
          `${cik}-26-000001`, `${cik}-25-000002`,
        ]);

        const facts = await runtime.queries.getFundamentalFactsByInstrument({ symbol, exchange: "XNAS" });
        assert.equal(facts.status, "available");
        if (facts.status !== "available") throw new Error("Expected authorized stored facts.");
        assert.equal(facts.items[0]?.value, "123.45");
        assert.deepEqual(facts.items.map((item) => item.value), [
          "123.45", "900719925474099312345.6789",
        ]);
        assert.equal(facts.items[0]?.source.provider, `runtime-auth-${suffix}`);

        const readiness = await runtime.queries.assessFinancialDataReadinessByInstrument(
          { symbol, exchange: "XNAS" },
          {
            filingLimit: 1,
            factFilter: {
              taxonomy: "us-gaap", tag: "Assets", reportingStart: "2024-01-01",
              reportingEnd: "2024-12-31", limit: 1,
            },
          },
        );
        assert.equal(readiness.status, "available");
        if (readiness.status !== "available") throw new Error("Expected authorized data readiness.");
        assert.equal(readiness.filings.returnedCount, 1);
        assert.equal(readiness.filings.items[0]?.filingDate, "2026-02-01");
        assert.equal(readiness.filings.provenance, "complete");
        assert.equal(readiness.fundamentals.availability, "available");
        assert.equal(readiness.fundamentals.items[0]?.reportingStart, "2024-01-01");
        assert.equal(readiness.fundamentals.items[0]?.value, "900719925474099312345.6789");
        assert.equal(readiness.fundamentals.provenance, "complete");
        assert.equal(readiness.freshness.status, "unknown");

        const instantFact = await runtime.queries.assessFinancialDataReadinessByInstrument(
          { symbol, exchange: "XNAS" },
          {
            factFilter: {
              taxonomy: "us-gaap", tag: "Assets", reportingStart: null,
              reportingEnd: "2025-12-31", limit: 1,
            },
          },
        );
        assert.equal(instantFact.status, "available");
        if (instantFact.status === "available")
          assert.equal(instantFact.fundamentals.items[0]?.reportingStart, null);

        const missingPeriod = await runtime.queries.assessFinancialDataReadinessByInstrument(
          { symbol, exchange: "XNAS" },
          { factFilter: { taxonomy: "us-gaap", tag: "Assets", reportingEnd: "2023-12-31" } },
        );
        assert.equal(missingPeriod.status, "available");
        if (missingPeriod.status === "available")
          assert.equal(missingPeriod.fundamentals.availability, "requested-data-missing");

        const missingConcept = await runtime.queries.assessFinancialDataReadinessByInstrument(
          { symbol, exchange: "XNAS" },
          { factFilter: { taxonomy: "ifrs-full", tag: "Revenue" } },
        );
        assert.equal(missingConcept.status, "available");
        if (missingConcept.status === "available")
          assert.equal(missingConcept.fundamentals.availability, "requested-data-missing");

        const emptyCik = `8${cik.slice(1)}`;
        fixtureCiks.push(emptyCik);
        const emptySymbol = `E${suffix}`.slice(0, 10);
        const emptyCompany = (await transaction.insert(companies).values({
          cik: emptyCik, legalName: "Fictional Empty Issuer", country: "US",
        }).returning({ id: companies.id }))[0]!;
        await transaction.insert(instruments).values({
          companyId: emptyCompany.id, symbol: emptySymbol, name: "Fictional Empty Issuer",
          assetType: "stock", exchange: "XNAS", currency: "USD", country: "US", active: false,
        });
        const emptyRuntime = createTrustedFinancialQueryRuntime({
          repositories,
          registry: registry(emptySymbol, emptyCik, "Fictional Empty Issuer"),
          clock: () => new Date("2026-06-01T00:00:00.000Z"),
        });
        const emptyReadiness = await emptyRuntime.queries.assessFinancialDataReadinessByInstrument({
          symbol: emptySymbol, exchange: "XNAS",
        });
        assert.equal(emptyReadiness.status, "available");
        if (emptyReadiness.status === "available") {
          assert.equal(emptyReadiness.filings.availability, "empty");
          assert.equal(emptyReadiness.fundamentals.availability, "empty");
          assert.equal(emptyReadiness.freshness.status, "not-applicable");
        }

        const disagreeing = createTrustedFinancialQueryRuntime({
          repositories,
          registry: registry(symbol, cik, "Different Fictional Issuer"),
          clock: () => new Date("2026-06-01T00:00:00.000Z"),
        });
        assert.deepEqual(await disagreeing.authorization.resolve({ symbol, exchange: "XNAS" }), {
          status: "unauthorized-mapping", reason: "PERSISTED_MAPPING_MISMATCH",
        });
        assert.deepEqual(await disagreeing.queries.getFundamentalFactsByInstrument({ symbol, exchange: "XNAS" }), {
          status: "unauthorized-mapping", reason: "PERSISTED_MAPPING_MISMATCH",
        });
        throw new Rollback();
      });
    } catch (reason) {
      if (!(reason instanceof Rollback)) throw reason;
    }
    assert.notEqual(fixtureCiks.length, 0);
    assert.equal(
      (await database.db.select({ id: companies.id }).from(companies).where(inArray(companies.cik, fixtureCiks))).length,
      0,
      "fixture transaction must roll back",
    );
  } finally {
    await database.close();
  }
});
