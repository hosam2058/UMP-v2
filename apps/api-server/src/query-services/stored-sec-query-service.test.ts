import assert from "node:assert/strict";
import test from "node:test";
import type { Repositories, StoredFundamentalFact, StoredSecFiling } from "@ump/db";
import { StoredSecQueryService } from "./stored-sec-query-service";

const company = { id: "company-1", cik: "0000123456", legalName: "Fictional Acme Corporation" };
const filing: StoredSecFiling = {
  accessionNumber: "0000123456-26-000001", form: "10-K", filingDate: "2026-02-01",
  reportDate: "2025-12-31", primaryDocument: "acme.htm", sourceUrl: "https://www.sec.gov/Archives/acme.htm",
  fetchedAt: new Date("2026-02-02T00:00:00.000Z"),
  source: { provider: "sec-edgar", name: "SEC EDGAR", baseUrl: "https://data.sec.gov" },
};
const fact: StoredFundamentalFact = {
  taxonomy: "us-gaap", tag: "Assets", unit: "USD", value: "123.45",
  accessionNumber: filing.accessionNumber, form: filing.form, filingDate: filing.filingDate,
  reportingStart: null, reportingEnd: "2025-12-31", fiscalYear: 2025, fiscalPeriod: "FY",
  frame: "CY2025Q4I", sourceAsOf: new Date("2026-01-31T00:00:00.000Z"),
  fetchedAt: filing.fetchedAt, source: filing.source,
};

function harness(options: { exists?: boolean; filings?: readonly StoredSecFiling[]; facts?: readonly StoredFundamentalFact[]; runtimeAuthorizer?: { resolve: (input: { symbol: string; exchange: string }) => Promise<unknown> } } = {}) {
  const calls: string[] = [];
  const repositories = {
    secQueries: {
      findCompanyByCik: async (cik: string) => {
        calls.push("company:" + cik);
        return options.exists === false ? undefined : company;
      },
      listFilings: async (input: { companyId: string; limit: number }) => {
        calls.push("filings:" + input.companyId + ":" + input.limit);
        return (options.filings ?? [filing]).slice(0, input.limit);
      },
      listFundamentalFacts: async (input: { companyId: string; limit: number; taxonomy?: string; tag?: string; fiscalYear?: number; fiscalPeriod?: string; form?: string; reportingStart?: string | null; reportingEnd?: string }) => {
        calls.push("facts:" + input.companyId + ":" + input.limit);
        return (options.facts ?? [fact]).filter((item) =>
          (input.taxonomy === undefined || item.taxonomy === input.taxonomy) &&
          (input.tag === undefined || item.tag === input.tag) &&
          (input.fiscalYear === undefined || item.fiscalYear === input.fiscalYear) &&
          (input.fiscalPeriod === undefined || item.fiscalPeriod === input.fiscalPeriod) &&
          (input.form === undefined || item.form === input.form) &&
          (input.reportingStart === undefined || item.reportingStart === input.reportingStart) &&
          (input.reportingEnd === undefined || item.reportingEnd === input.reportingEnd),
        ).slice(0, input.limit);
      },
    },
  } as unknown as Repositories;
  return { service: new StoredSecQueryService(repositories, options.runtimeAuthorizer as never), calls };
}

test("resolves a stored company by normalized CIK without provider calls", async () => {
  const h = harness();
  assert.deepEqual(await h.service.resolveCompanyByCik("123456"), {
    status: "available",
    company: { cik: company.cik, legalName: company.legalName },
  });
  assert.deepEqual(h.calls, ["company:0000123456"]);
});
test("distinguishes invalid and missing company CIKs", async () => {
  const invalid = harness();
  assert.deepEqual(await invalid.service.resolveCompanyByCik("invalid"), {
    status: "invalid-input", reason: "INVALID_CIK",
  });
  assert.deepEqual(invalid.calls, []);
  const absent = harness({ exists: false });
  assert.deepEqual(await absent.service.resolveCompanyByCik("123456"), {
    status: "not-found", reason: "COMPANY_NOT_FOUND",
  });
});
test("returns stored filing provenance with deterministic limits and allows empty results", async () => {
  const h = harness({ filings: [] });
  const empty = await h.service.getFilingsByCik("123456", { limit: 2 });
  assert.equal(empty.status, "available");
  assert.deepEqual(empty.items, []);
  assert.equal(empty.limit, 2);
  assert.deepEqual(h.calls, ["company:0000123456", "filings:company-1:2"]);
  const provenance = harness();
  const result = await provenance.service.getFilingsByCik("123456");
  assert.equal(result.status, "available");
  assert.deepEqual(result.items[0], filing);
  assert.equal(result.limit, 50);
  assert.deepEqual(await provenance.service.getFilingsByCik("123456", { limit: 101 }), {
    status: "invalid-input", reason: "INVALID_LIMIT",
  });
});
test("filters stored facts only by supported dimensions and preserves reporting provenance", async () => {
  const h = harness();
  const result = await h.service.getFundamentalFactsByCik("123456", {
    taxonomy: "us-gaap", tag: "Assets", fiscalYear: 2025, fiscalPeriod: "FY",
    form: "10-K", reportingEnd: "2025-12-31", limit: 3,
  });
  assert.equal(result.status, "available");
  assert.deepEqual(result.items[0], fact);
  assert.deepEqual(h.calls, ["company:0000123456", "facts:company-1:3"]);
  for (const filter of [
    { taxonomy: "us-gaap" },
    { fiscalYear: 2025.5 },
    { reportingEnd: "31-12-2025" },
    { reportingEnd: "2025-02-29" },
    { reportingStart: "2025-02-30" },
    { reportingStart: "2025-01-01", reportingEnd: "2024-12-31" },
    { limit: 0 },
  ]) {
    const invalid = await h.service.getFundamentalFactsByCik("123456", filter);
    assert.equal(invalid.status, "invalid-input");
  }
});

test("readiness distinguishes unknown company, empty datasets, and missing requested reporting data", async () => {
  const unknown = harness({ exists: false });
  assert.deepEqual(await unknown.service.assessFinancialDataReadinessByCik("123456"), {
    status: "not-found", reason: "COMPANY_NOT_FOUND",
  });

  const empty = harness({ filings: [], facts: [] });
  const emptyResult = await empty.service.assessFinancialDataReadinessByCik("123456", {
    factFilter: { taxonomy: "us-gaap", tag: "Assets", reportingStart: null, reportingEnd: "2025-12-31" },
  });
  assert.equal(emptyResult.status, "available");
  if (emptyResult.status !== "available") return;
  assert.equal(emptyResult.filings.availability, "empty");
  assert.equal(emptyResult.fundamentals.availability, "empty");
  assert.equal(emptyResult.freshness.status, "not-applicable");

  const missing = harness();
  const missingResult = await missing.service.assessFinancialDataReadinessByCik("123456", {
    factFilter: { taxonomy: "ifrs-full", tag: "Assets", reportingEnd: "2025-12-31" },
  });
  assert.equal(missingResult.status, "available");
  if (missingResult.status !== "available") return;
  assert.equal(missingResult.fundamentals.availability, "requested-data-missing");
  assert.equal(missingResult.fundamentals.request?.reportingEnd, "2025-12-31");
  assert.equal(missingResult.freshness.status, "unknown");
  assert.equal(missing.calls.filter((call) => call.startsWith("facts:")).length, 2);

  const missingOnlyFacts = harness({ filings: [], facts: [fact] });
  const missingOnlyFactsResult = await missingOnlyFacts.service.assessFinancialDataReadinessByCik("123456", {
    factFilter: { taxonomy: "ifrs-full", tag: "Assets" },
  });
  assert.equal(missingOnlyFactsResult.status, "available");
  if (missingOnlyFactsResult.status === "available") {
    assert.equal(missingOnlyFactsResult.fundamentals.availability, "requested-data-missing");
    assert.equal(missingOnlyFactsResult.freshness.status, "unknown");
  }
});

test("readiness reports validated provenance without inventing freshness", async () => {
  const h = harness({
    facts: [{ ...fact, value: "900719925474099312345.6789" }],
  });
  const result = await h.service.assessFinancialDataReadinessByCik("123456", {
    factFilter: { taxonomy: "us-gaap", tag: "Assets", reportingStart: null, reportingEnd: "2025-12-31" },
  });
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.equal(result.fundamentals.availability, "available");
  assert.equal(result.fundamentals.provenance, "complete");
  assert.equal(result.fundamentals.items[0]?.value, "900719925474099312345.6789");
  assert.equal(result.filings.provenance, "complete");
  assert.equal(result.freshness.reason, "FRESHNESS_POLICY_NOT_CONFIGURED");

  const incomplete = harness({
    facts: [{ ...fact, source: { ...fact.source, provider: " " }, fetchedAt: new Date(Number.NaN) }],
  });
  const incompleteResult = await incomplete.service.assessFinancialDataReadinessByCik("123456");
  assert.equal(incompleteResult.status, "available");
  if (incompleteResult.status === "available")
    assert.equal(incompleteResult.fundamentals.provenance, "incomplete");
});

test("readiness rejects invalid filters before company or financial repository reads", async () => {
  const h = harness();
  assert.deepEqual(await h.service.assessFinancialDataReadinessByCik("123456", {
    factFilter: { taxonomy: "us-gaap", reportingEnd: "2025-12-31" },
  }), { status: "invalid-input", reason: "CONCEPT_REQUIRES_TAXONOMY_AND_TAG" });
  assert.deepEqual(h.calls, []);
});

test("instrument readiness remains isolated when authority denies the mapping", async () => {
  const h = harness({
    runtimeAuthorizer: {
      resolve: async () => ({ status: "unauthorized-mapping", reason: "RETIRED_MAPPING" }),
    },
  });
  assert.deepEqual(
    await h.service.assessFinancialDataReadinessByInstrument({ symbol: "ACME", exchange: "XNAS" }),
    { status: "unauthorized-mapping", reason: "RETIRED_MAPPING" },
  );
  assert.deepEqual(h.calls, []);
});
test("rejects every instrument request until curated runtime authority is composed", async () => {
  const h = harness();
  assert.deepEqual(await h.service.getCompanyDataByInstrument(), {
    status: "unsupported",
    reason: "CURATED_MAPPING_RUNTIME_AUTHORIZATION_UNAVAILABLE",
  });
  assert.deepEqual(h.calls, []);
});

test("returns stored data by instrument only after runtime authorization", async () => {
  const runtimeCalls: string[] = [];
  const authorized = {
    resolve: async (input: { symbol: string; exchange: string }) => {
      runtimeCalls.push(input.symbol + ":" + input.exchange);
      return {
        status: "available",
        authorization: {
          instrument: { id: "instrument-1", symbol: "ACME", exchange: "XNAS" },
          company,
          mapping: {
            registryVersion: 2, mappingId: "fictional-acme-common", revision: 1,
            revisionId: "fictional-acme-common@1", lifecycle: "active", effectiveFrom: "2026-01-01T00:00:00.000Z",
            listingEvidence: { source: "fixture", reference: "listing", retrievedAt: "2026-01-01T00:00:00.000Z" },
            secCompanyEvidence: { source: "fixture", reference: "cik", retrievedAt: "2026-01-01T00:00:00.000Z" },
            approval: { approvedBy: "fixture-reviewer", approvedAt: "2026-01-02T00:00:00.000Z" },
          },
        },
      };
    },
  };
  const h = harness({ runtimeAuthorizer: authorized });
  const result = await h.service.getFilingsByInstrument({ symbol: "ACME", exchange: "XNAS" }, { limit: 2 });
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.deepEqual(result.items, [filing]);
  assert.equal(result.mapping.revisionId, "fictional-acme-common@1");
  assert.deepEqual(runtimeCalls, ["ACME:XNAS"]);
  assert.deepEqual(h.calls, ["filings:company-1:2"]);

  const denied = harness({ runtimeAuthorizer: { resolve: async () => ({ status: "unauthorized-mapping", reason: "PENDING_MAPPING" }) } });
  assert.deepEqual(await denied.service.getFundamentalFactsByInstrument({ symbol: "ACME", exchange: "XNAS" }), { status: "unauthorized-mapping", reason: "PENDING_MAPPING" });
  assert.deepEqual(denied.calls, []);
});
