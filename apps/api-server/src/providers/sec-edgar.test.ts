import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCik, SecEdgarProvider } from "./sec-edgar";

test("normalizes SEC CIK values", () => {
  assert.equal(normalizeCik("320193"), "0000320193");
  assert.throws(() => normalizeCik("not-a-cik"));
});

test("maps official SEC submissions with provenance", async () => {
  const provider = new SecEdgarProvider({
    userAgent: "UMP tests test@example.com",
    minRequestIntervalMs: 0,
    fetchImpl: async () => new Response(JSON.stringify({ name: "Apple Inc.", sic: "3571", filings: { recent: { accessionNumber: ["0000320193-24-000123"], form: ["10-K"], filingDate: ["2024-11-01"], reportDate: ["2024-09-30"], primaryDocument: ["aapl-20240928.htm"] } } }), { status: 200 }),
  });
  const result = await provider.getFilingsByCik("320193");
  assert.equal(result.provenance.provider, "sec-edgar");
  assert.equal(result.data[0]?.form, "10-K");
  assert.deepEqual(result.data[0]?.companyIdentifier, { scheme: "cik", value: "0000320193" });
  assert.match(result.data[0]?.sourceUrl ?? "", /www\.sec\.gov\/Archives/);
});

test("returns no filings when SEC omits accession numbers", async () => {
  const provider = new SecEdgarProvider({
    userAgent: "UMP tests test@example.com",
    minRequestIntervalMs: 0,
    fetchImpl: async () => new Response(JSON.stringify({ filings: { recent: { form: ["10-K"], filingDate: ["2024-11-01"] } } }), { status: 200 }),
  });
  const result = await provider.getFilingsByCik("320193");
  assert.deepEqual(result.data, []);
});
