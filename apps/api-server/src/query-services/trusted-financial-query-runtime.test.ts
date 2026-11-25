import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, type Repositories } from "@ump/db";
import { loadConfig } from "../config";
import {
  CURATED_STOCK_MAPPING_REGISTRY_VERSION,
  type CuratedStockMappingRegistry,
} from "../identity/curated-stock-mapping-registry";
import {
  createDatabaseBackedTrustedFinancialQueryRuntime,
  createTrustedFinancialQueryRuntime,
} from "./trusted-financial-query-runtime";

const asOf = new Date("2026-06-01T00:00:00.000Z");
const company = {
  id: "company-fixture",
  cik: "0000123456",
  legalName: "Fictional Acme Corporation",
};
const registry: CuratedStockMappingRegistry = {
  version: CURATED_STOCK_MAPPING_REGISTRY_VERSION,
  revisions: [
    {
      mappingId: "fictional-acme",
      revision: 1,
      revisionId: "fictional-acme@1",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      changeReason: "synthetic test fixture",
      lifecycle: "active",
      instrument: {
        symbol: "ACME",
        exchange: "XNAS",
        name: "Fictional Acme",
        assetType: "stock",
        currency: "USD",
        listingCountry: "US",
      },
      company,
      exchangeListingEvidence: {
        source: "fixture-exchange",
        reference: "listing-1",
        retrievedAt: "2026-01-01T00:00:00.000Z",
      },
      secCompanyEvidence: {
        source: "fixture-sec",
        reference: "company-1",
        retrievedAt: "2026-01-01T00:00:00.000Z",
      },
      approval: {
        status: "approved",
        approvedBy: "fixture-reviewer",
        approvedAt: "2026-01-02T00:00:00.000Z",
      },
    },
  ],
  lifecycleEvents: [],
};

function repositories(calls: string[] = []): Repositories {
  return {
    runtimeAuthorizations: {
      findInstrumentCompanyByIdentity: async (identity: {
        symbol: string;
        exchange: string;
      }) => {
        calls.push(`identity:${identity.symbol}:${identity.exchange}`);
        return {
          instrumentId: "instrument-fixture",
          symbol: "ACME",
          exchange: "XNAS",
          assetType: "stock",
          currency: "USD",
          country: "US",
          active: false,
          company,
        };
      },
    },
    secQueries: {
      findCompanyByCik: async () => company,
      listFilings: async () => {
        calls.push("filings");
        return [
          {
            accessionNumber: "0000123456-26-000001",
            form: "10-K",
            filingDate: "2026-02-01",
            reportDate: "2025-12-31",
            primaryDocument: "acme.htm",
            sourceUrl: "https://www.sec.gov/Archives/acme.htm",
            fetchedAt: new Date("2026-02-02T00:00:00.000Z"),
            source: {
              provider: "sec-edgar",
              name: "SEC EDGAR",
              baseUrl: "https://data.sec.gov",
            },
          },
        ];
      },
      listFundamentalFacts: async () => {
        calls.push("facts");
        return [
          {
            taxonomy: "us-gaap",
            tag: "Assets",
            unit: "USD",
            value: "123.45",
            accessionNumber: "0000123456-26-000001",
            form: "10-K",
            filingDate: "2026-02-01",
            reportingStart: null,
            reportingEnd: "2025-12-31",
            fiscalYear: 2025,
            fiscalPeriod: "FY",
            frame: "CY2025Q4I",
            sourceAsOf: null,
            fetchedAt: new Date("2026-02-02T00:00:00.000Z"),
            source: {
              provider: "sec-edgar",
              name: "SEC EDGAR",
              baseUrl: "https://data.sec.gov",
            },
          },
        ];
      },
    },
  } as unknown as Repositories;
}

test("composed runtime carries curated approval and persisted issuer identity into stored filings and facts", async () => {
  const calls: string[] = [];
  const runtime = createTrustedFinancialQueryRuntime({
    repositories: repositories(calls),
    registry,
    clock: () => asOf,
  });
  const filings = await runtime.queries.getFilingsByInstrument({
    symbol: "acme",
    exchange: "xnas",
  });
  assert.equal(filings.status, "available");
  if (filings.status !== "available") return;
  assert.equal(filings.company.cik, company.cik);
  assert.equal(filings.mapping.revisionId, "fictional-acme@1");
  assert.equal(filings.items[0]?.source.provider, "sec-edgar");
  const facts = await runtime.queries.getFundamentalFactsByInstrument(
    { symbol: "ACME", exchange: "XNAS" },
    { asOf },
  );
  assert.equal(facts.status, "available");
  if (facts.status === "available")
    assert.equal(facts.items[0]?.value, "123.45");
  assert.deepEqual(calls, [
    "identity:ACME:XNAS",
    "filings",
    "identity:ACME:XNAS",
    "facts",
  ]);
});

test("empty, missing, and malformed authority remain distinct and fail closed", async () => {
  const deps = repositories();
  const empty = createTrustedFinancialQueryRuntime({
    repositories: deps,
    registry: { ...registry, revisions: [] },
    clock: () => asOf,
  });
  assert.deepEqual(
    await empty.queries.getCompanyDataByInstrument({
      symbol: "ACME",
      exchange: "XNAS",
    }),
    {
      status: "unsupported-instrument",
      reason: "INSTRUMENT_NOT_IN_CURATED_REGISTRY",
    },
  );
  const missing = createTrustedFinancialQueryRuntime({
    repositories: deps,
    registry: null,
    clock: () => asOf,
  });
  assert.deepEqual(
    await missing.queries.getCompanyDataByInstrument({
      symbol: "ACME",
      exchange: "XNAS",
    }),
    { status: "authority-unavailable", reason: "CURATED_REGISTRY_UNAVAILABLE" },
  );
  const malformed = createTrustedFinancialQueryRuntime({
    repositories: deps,
    registry: { ...registry, version: 99 as never },
    clock: () => asOf,
  });
  assert.deepEqual(
    await malformed.queries.getCompanyDataByInstrument({
      symbol: "ACME",
      exchange: "XNAS",
    }),
    { status: "authority-unavailable", reason: "INVALID_CURATED_REGISTRY" },
  );
  assert.equal(
    (await malformed.queries.resolveCompanyByCik("123456")).status,
    "available",
  );
});

test("readiness evaluates mapping lifecycle at the supplied effective time", async () => {
  const calls: string[] = [];
  const runtime = createTrustedFinancialQueryRuntime({
    repositories: repositories(calls),
    registry,
    clock: () => asOf,
  });
  const result = await runtime.queries.assessFinancialDataReadinessByInstrument(
    { symbol: "ACME", exchange: "XNAS" },
    { asOf: new Date("2025-12-31T23:59:59.999Z") },
  );
  assert.deepEqual(result, {
    status: "unauthorized-mapping",
    reason: "FUTURE_EFFECTIVE_MAPPING",
  });
  assert.deepEqual(calls, []);
});

test("invalid query options are rejected before authorization or repository reads", async () => {
  const calls: string[] = [];
  const runtime = createTrustedFinancialQueryRuntime({
    repositories: repositories(calls),
    registry,
    clock: () => asOf,
  });
  assert.equal(
    (
      await runtime.queries.getFilingsByInstrument(
        { symbol: "ACME", exchange: "XNAS" },
        { limit: 0 },
      )
    ).status,
    "invalid-input",
  );
  assert.equal(
    (
      await runtime.queries.getFundamentalFactsByInstrument(
        { symbol: "ACME", exchange: "XNAS" },
        { taxonomy: "us-gaap" },
      )
    ).status,
    "invalid-input",
  );
  assert.equal(
    (await runtime.queries.getFilingsByCik("123456", { limit: 0 })).status,
    "invalid-input",
  );
  assert.equal(
    (
      await runtime.queries.getFundamentalFactsByCik("123456", {
        reportingEnd: "2025-02-30",
      })
    ).status,
    "invalid-input",
  );
  assert.deepEqual(calls, []);
});

test("database-backed runtime releases its owned pool when composition fails and on close", async () => {
  let closeCalls = 0;
  const fakeDatabase = {
    db: {} as ReturnType<typeof createDatabase>["db"],
    pool: {} as ReturnType<typeof createDatabase>["pool"],
    close: async () => {
      closeCalls += 1;
    },
  } as ReturnType<typeof createDatabase>;
  const databaseFactory = (() => fakeDatabase) as typeof createDatabase;
  const config = loadConfig({
    DATABASE_URL: "postgres://fixture:fixture@127.0.0.1/test",
  });
  const unclonableRegistry = {
    version: CURATED_STOCK_MAPPING_REGISTRY_VERSION,
    revisions: [],
    lifecycleEvents: [],
    forbiddenFunction: () => undefined,
  } as unknown as CuratedStockMappingRegistry;

  await assert.rejects(
    createDatabaseBackedTrustedFinancialQueryRuntime(config, {
      databaseFactory,
      registry: unclonableRegistry,
    }),
    /could not be cloned/i,
  );
  assert.equal(closeCalls, 1);

  const runtime = await createDatabaseBackedTrustedFinancialQueryRuntime(
    config,
    {
      databaseFactory,
      registry: {
        version: CURATED_STOCK_MAPPING_REGISTRY_VERSION,
        revisions: [],
        lifecycleEvents: [],
      },
    },
  );
  await runtime.close();
  assert.equal(closeCalls, 2);
});

test("composed authority is an immutable startup snapshot", async () => {
  const input = structuredClone(registry);
  const runtime = createTrustedFinancialQueryRuntime({
    repositories: repositories(),
    registry: input,
    clock: () => asOf,
  });
  input.revisions[0]!.approval.status = "rejected";
  assert.equal(
    (await runtime.authorization.resolve({ symbol: "ACME", exchange: "XNAS" }))
      .status,
    "available",
  );
});
