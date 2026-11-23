import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  companies,
  createDatabase,
  createRepositories,
  dataSources,
  fundamentalFacts,
  secFilings,
} from "@ump/db";
import { StoredSecQueryService } from "./stored-sec-query-service";

const FLAG = "UMP_POSTGRES_INTEGRATION";
const DATABASE = "ump_v2_test";
const PORT = "55432";
const USER = "ump_test";
class Rollback extends Error {}

function connectionString(): string {
  if (process.env[FLAG] !== "1")
    throw new Error(FLAG + "=1 is required for PostgreSQL integration tests.");
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required for PostgreSQL integration tests.");
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" ||
    url.port !== PORT ||
    url.pathname !== "/" + DATABASE ||
    url.username !== USER
  )
    throw new Error("PostgreSQL integration tests require local ump_v2_test on port 55432.");
  return value;
}

test("PostgreSQL: stored SEC company queries retain provenance and are read-only", async () => {
  const database = createDatabase({ connectionString: connectionString() });
  let fixtureCik = "";
  try {
    try {
      await database.db.transaction(async (transaction) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const cik = "9" + suffix.replace(/[^0-9]/g, "").padEnd(9, "0").slice(0, 9);
        fixtureCik = cik;
        const source = (await transaction.insert(dataSources).values({
          provider: "query-test-" + suffix, name: "Query test source", baseUrl: "https://data.sec.gov", isDelayed: false,
        }).returning({ id: dataSources.id }))[0]!;
        const company = (await transaction.insert(companies).values({
          cik, legalName: "Query Test Issuer",
        }).returning({ id: companies.id }))[0]!;
        await transaction.insert(secFilings).values({
          companyId: company.id, sourceId: source.id, accessionNumber: cik + "-26-000001",
          form: "10-K", filingDate: "2026-02-01", reportDate: "2025-12-31",
          primaryDocument: "query.htm", sourceUrl: "https://www.sec.gov/Archives/query.htm",
          fetchedAt: new Date("2026-02-02T00:00:00.000Z"),
        });
        await transaction.insert(fundamentalFacts).values({
          companyId: company.id, sourceId: source.id, taxonomy: "us-gaap", tag: "Assets",
          unit: "USD", value: "123.45", accessionNumber: cik + "-26-000001", form: "10-K",
          filingDate: "2026-02-01", reportingStart: null, reportingEnd: "2025-12-31",
          fiscalYear: 2025, fiscalPeriod: "FY", frame: "CY2025Q4I",
          sourceAsOf: new Date("2026-01-31T00:00:00.000Z"), fetchedAt: new Date("2026-02-02T00:00:00.000Z"),
        });
        const service = new StoredSecQueryService(createRepositories(transaction));
        const filings = await service.getFilingsByCik(cik);
        assert.equal(filings.status, "available");
        assert.equal(filings.items[0]?.source.provider, "query-test-" + suffix);
        const facts = await service.getFundamentalFactsByCik(cik, {
          taxonomy: "us-gaap", tag: "Assets", fiscalYear: 2025,
        });
        assert.equal(facts.status, "available");
        assert.equal(facts.items[0]?.accessionNumber, cik + "-26-000001");
        assert.equal(facts.items[0]?.value, "123.45");
        assert.deepEqual(facts.items[0]?.source, {
          provider: "query-test-" + suffix,
          name: "Query test source",
          baseUrl: "https://data.sec.gov",
        });
        throw new Rollback();
      });
    } catch (reason) {
      if (!(reason instanceof Rollback)) throw reason;
    }
    assert.notEqual(fixtureCik, "");
    assert.equal(
      (
        await database.db
          .select({ id: companies.id })
          .from(companies)
          .where(eq(companies.cik, fixtureCik))
      ).length,
      0,
      "fixture transaction must roll back",
    );
  } finally {
    await database.close();
  }
});
