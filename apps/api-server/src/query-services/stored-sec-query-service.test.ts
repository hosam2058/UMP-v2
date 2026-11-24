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
        return options.filings ?? [filing];
      },
      listFundamentalFacts: async (input: { companyId: string; limit: number }) => {
        calls.push("facts:" + input.companyId + ":" + input.limit);
        return options.facts ?? [fact];
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
    { limit: 0 },
  ]) {
    const invalid = await h.service.getFundamentalFactsByCik("123456", filter);
    assert.equal(invalid.status, "invalid-input");
  }
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
