import assert from "node:assert/strict";
import test from "node:test";
import { ProviderError } from "./contracts";
import { normalizeCik, SecEdgarProvider } from "./sec-edgar";

const validFact: Record<string, unknown> = {
  val: 123.45,
  fy: 2024,
  fp: "FY",
  form: "10-K",
  filed: "2025-02-01",
  accn: "0000320193-25-000010",
  start: "2024-01-01",
  end: "2024-12-31",
  frame: "CY2024",
};

function providerForText(
  body: string,
  status = 200,
  options: { maxRetries?: number; timeoutMs?: number } = {},
): SecEdgarProvider {
  return new SecEdgarProvider({
    userAgent: "UMP tests test@example.com",
    minRequestIntervalMs: 0,
    maxRetries: options.maxRetries ?? 0,
    timeoutMs: options.timeoutMs,
    fetchImpl: async () =>
      new Response(body, {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  });
}

function providerForPayload(payload: unknown, status = 200): SecEdgarProvider {
  const serialized = JSON.stringify(payload);
  if (serialized === undefined)
    throw new Error("Test payload could not be serialized.");
  return providerForText(serialized, status);
}

function companyFactsPayload(
  fact: Record<string, unknown> = validFact,
  unitContainer: unknown = { USD: [fact] },
): Record<string, unknown> {
  return {
    cik: 320193,
    facts: {
      "us-gaap": {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: unitContainer,
        },
      },
    },
  };
}

async function expectInvalidResponse(
  operation: Promise<unknown>,
): Promise<void> {
  await assert.rejects(
    operation,
    (error: unknown) =>
      error instanceof ProviderError && error.code === "INVALID_RESPONSE",
  );
}

test("normalizes SEC CIK values", () => {
  assert.equal(normalizeCik("320193"), "0000320193");
  assert.equal(normalizeCik("0000320193"), "0000320193");
  assert.throws(() => normalizeCik("not-a-cik"));
  assert.throws(() => normalizeCik("32x0193"));
  assert.throws(() => normalizeCik(" 320193 "));
  assert.throws(() => normalizeCik("+320193"));
  assert.throws(() => normalizeCik("12345678901"));
});

test("validates SEC response CIK identity for submissions and companyfacts", async () => {
  const validSubmissions = {
    cik: "0000320193",
    name: "Apple Inc.",
    filings: { recent: {} },
  };

  const company =
    await providerForPayload(validSubmissions).resolveCompanyByCik("320193");
  assert.equal(company.data.legalName, "Apple Inc.");
  const filings =
    await providerForPayload(validSubmissions).getFilingsByCik("320193");
  assert.deepEqual(filings.data, []);
  const facts = await providerForPayload(
    companyFactsPayload(),
  ).getCompanyFactsByCik("320193");
  assert.equal(facts.data.length, 1);

  await expectInvalidResponse(
    providerForPayload({
      ...validSubmissions,
      cik: "0000789019",
    }).resolveCompanyByCik("320193"),
  );
  await expectInvalidResponse(
    providerForPayload({
      ...validSubmissions,
      cik: "0000789019",
    }).getFilingsByCik("320193"),
  );
  await expectInvalidResponse(
    providerForPayload({
      ...companyFactsPayload(),
      cik: 789019,
    }).getCompanyFactsByCik("320193"),
  );
  await expectInvalidResponse(
    providerForPayload({
      ...validSubmissions,
      cik: 320193,
    }).resolveCompanyByCik("320193"),
  );
  await expectInvalidResponse(
    providerForPayload({
      ...companyFactsPayload(),
      cik: "0000320193",
    }).getCompanyFactsByCik("320193"),
  );

  const malformedCiks: unknown[] = [
    null,
    "",
    0,
    "0000000000",
    "320193x",
    "12345678901",
    320193.5,
    Number.MAX_SAFE_INTEGER + 1,
    undefined,
  ];
  for (const cik of malformedCiks) {
    await expectInvalidResponse(
      providerForPayload({ ...validSubmissions, cik }).resolveCompanyByCik(
        "320193",
      ),
    );
    await expectInvalidResponse(
      providerForPayload({ ...validSubmissions, cik }).getFilingsByCik(
        "320193",
      ),
    );
    await expectInvalidResponse(
      providerForPayload({
        ...companyFactsPayload(),
        cik,
      }).getCompanyFactsByCik("320193"),
    );
  }
});

test("maps valid SEC submissions and preserves provenance", async () => {
  const provider = providerForPayload({
    cik: "0000320193",
    name: "Apple Inc.",
    sic: "3571",
    filings: {
      recent: {
        accessionNumber: ["0000320193-24-000123"],
        form: ["10-K"],
        filingDate: ["2024-11-01"],
        reportDate: ["2024-09-30"],
        primaryDocument: ["aapl-20240928.htm"],
      },
    },
  });
  const result = await provider.getFilingsByCik("320193");

  assert.equal(result.provenance.provider, "sec-edgar");
  assert.ok(result.provenance.retrievedAt instanceof Date);
  assert.equal(result.provenance.isDelayed, false);
  assert.equal(result.provenance.asOf, null);
  assert.equal(
    result.provenance.sourceUrl,
    "https://data.sec.gov/submissions/CIK0000320193.json",
  );
  assert.deepEqual(result.data, [
    {
      companyIdentifier: { scheme: "cik", value: "0000320193" },
      form: "10-K",
      accessionNumber: "0000320193-24-000123",
      filingDate: "2024-11-01",
      reportDate: "2024-09-30",
      primaryDocument: "aapl-20240928.htm",
      sourceUrl:
        "https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm",
    },
  ]);
});

test("returns no filings when recent or accession numbers are genuinely absent", async () => {
  const payloads = [
    { cik: "0000320193" },
    { cik: "0000320193", filings: {} },
    { cik: "0000320193", filings: { recent: {} } },
    {
      cik: "0000320193",
      filings: { recent: { form: ["10-K"], filingDate: ["2024-11-01"] } },
    },
    { cik: "0000320193", filings: { recent: { accessionNumber: [] } } },
  ];

  for (const payload of payloads) {
    const result = await providerForPayload(payload).getFilingsByCik("320193");
    assert.deepEqual(result.data, []);
  }
});

test("maps absent or blank optional filing fields to null", async () => {
  const provider = providerForPayload({
    cik: "0000320193",
    filings: {
      recent: {
        accessionNumber: ["0000320193-24-000123"],
        form: ["10-K"],
        filingDate: ["2024-11-01"],
        reportDate: [""],
        primaryDocument: [""],
      },
    },
  });

  const result = await provider.getFilingsByCik("320193");
  assert.equal(result.data[0]?.reportDate, null);
  assert.equal(result.data[0]?.primaryDocument, null);
  assert.equal(
    result.data[0]?.sourceUrl,
    "https://data.sec.gov/submissions/CIK0000320193.json",
  );
});

test("rejects malformed submissions arrays and incomplete filing rows", async () => {
  const validRecent = {
    accessionNumber: ["0000320193-24-000123"],
    form: ["10-K"],
    filingDate: ["2024-11-01"],
  };
  const malformedRecent = [
    { ...validRecent, accessionNumber: "0000320193-24-000123" },
    { ...validRecent, form: "10-K" },
    { ...validRecent, filingDate: [2024] },
    { ...validRecent, form: [] },
    { ...validRecent, reportDate: [null] },
    { ...validRecent, accessionNumber: [""] },
    { ...validRecent, filingDate: ["2024-02-30"] },
  ];

  for (const recent of malformedRecent) {
    await expectInvalidResponse(
      providerForPayload({
        cik: "0000320193",
        filings: { recent },
      }).getFilingsByCik("320193"),
    );
  }
});

test("rejects malformed submissions accession numbers", async () => {
  for (const accessionNumber of [
    "0000320193-240-000123",
    "0000320193-24-00012",
    "not-an-accession",
  ]) {
    await expectInvalidResponse(
      providerForPayload({
        cik: "0000320193",
        filings: {
          recent: {
            accessionNumber: [accessionNumber],
            form: ["10-K"],
            filingDate: ["2024-11-01"],
          },
        },
      }).getFilingsByCik("320193"),
    );
  }
});

test("rejects malformed submissions envelopes and company identity", async () => {
  for (const payload of [
    null,
    [],
    { cik: "0000320193", filings: null },
    { cik: "0000320193", filings: { recent: null } },
  ]) {
    await expectInvalidResponse(
      providerForPayload(payload).getFilingsByCik("320193"),
    );
  }

  for (const payload of [
    null,
    [],
    {},
    { cik: "0000320193", name: "" },
    { cik: "0000320193", name: 123 },
  ]) {
    await expectInvalidResponse(
      providerForPayload(payload).resolveCompanyByCik("320193"),
    );
  }
});

test("maps a complete companyfacts context and retains provenance", async () => {
  const provider = providerForPayload(companyFactsPayload());
  const result = await provider.getCompanyFactsByCik("320193");

  assert.deepEqual(result.data, [
    {
      companyIdentifier: { scheme: "cik", value: "0000320193" },
      taxonomy: "us-gaap",
      tag: "RevenueFromContractWithCustomerExcludingAssessedTax",
      unit: "USD",
      value: "123.45",
      fiscalYear: 2024,
      fiscalPeriod: "FY",
      form: "10-K",
      filingDate: "2025-02-01",
      accessionNumber: "0000320193-25-000010",
      reportingStart: "2024-01-01",
      reportingEnd: "2024-12-31",
      frame: "CY2024",
    },
  ]);
  assert.equal(result.provenance.provider, "sec-edgar");
  assert.ok(result.provenance.retrievedAt instanceof Date);
  assert.equal(result.provenance.isDelayed, false);
  assert.equal(result.provenance.asOf, null);
  assert.equal(
    result.provenance.sourceUrl,
    "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
  );
});

test("preserves exact companyfacts numeric values beyond JavaScript safe integers", async () => {
  const body = JSON.stringify(
    companyFactsPayload({ ...validFact, val: 0 }),
  ).replace('"val":0', '"val":9007199254740993');

  const result = await providerForText(body).getCompanyFactsByCik("320193");

  assert.equal(result.data[0]?.value, "9007199254740993");
});

test("accepts zero and nullable companyfacts context without inventing dates", async () => {
  const fact: Record<string, unknown> = {
    ...validFact,
    val: 0,
  };
  delete fact.fy;
  delete fact.fp;
  delete fact.start;
  delete fact.frame;

  const result = await providerForPayload(
    companyFactsPayload(fact),
  ).getCompanyFactsByCik("320193");

  assert.equal(result.data[0]?.value, "0");
  assert.equal(result.data[0]?.fiscalYear, null);
  assert.equal(result.data[0]?.fiscalPeriod, null);
  assert.equal(result.data[0]?.reportingStart, null);
  assert.equal(result.data[0]?.reportingEnd, "2024-12-31");
  assert.equal(result.data[0]?.frame, null);
});

test("rejects companyfacts records missing required canonical context", async () => {
  for (const field of ["end", "form", "filed", "accn", "val"] as const) {
    const fact: Record<string, unknown> = { ...validFact };
    delete fact[field];
    await expectInvalidResponse(
      providerForPayload(companyFactsPayload(fact)).getCompanyFactsByCik(
        "320193",
      ),
    );
  }
});

test("rejects invalid required companyfacts canonical values", async () => {
  const invalidFacts = [
    { ...validFact, end: "2024-02-30" },
    { ...validFact, form: 10 },
    { ...validFact, filed: "not-a-date" },
    { ...validFact, accn: null },
  ];

  for (const fact of invalidFacts) {
    await expectInvalidResponse(
      providerForPayload(companyFactsPayload(fact)).getCompanyFactsByCik(
        "320193",
      ),
    );
  }
});

test("rejects malformed companyfacts accession numbers", async () => {
  for (const accn of [
    "0000320193-240-000123",
    "0000320193-24-00012",
    "not-an-accession",
  ]) {
    await expectInvalidResponse(
      providerForPayload(
        companyFactsPayload({ ...validFact, accn }),
      ).getCompanyFactsByCik("320193"),
    );
  }
});

test("rejects non-numeric companyfacts values", async () => {
  await expectInvalidResponse(
    providerForPayload(
      companyFactsPayload({ ...validFact, val: "123.45" }),
    ).getCompanyFactsByCik("320193"),
  );
});

test("preserves valid JSON numbers beyond JavaScript numeric range", async () => {
  const body = JSON.stringify(
    companyFactsPayload({ ...validFact, val: 0 }),
  ).replace('"val":0', '"val":1e999');

  const result = await providerForText(body).getCompanyFactsByCik("320193");

  assert.equal(result.data[0]?.value, "1e999");
});

test("rejects malformed companyfacts unit containers", async () => {
  for (const units of [null, [], { USD: {} }, { USD: [null] }]) {
    await expectInvalidResponse(
      providerForPayload(
        companyFactsPayload(validFact, units),
      ).getCompanyFactsByCik("320193"),
    );
  }
  await expectInvalidResponse(
    providerForPayload(
      companyFactsPayload(validFact, { "": [validFact] }),
    ).getCompanyFactsByCik("320193"),
  );
});

test("rejects malformed companyfacts roots and nested maps", async () => {
  const malformedPayloads = [
    null,
    [],
    {},
    { cik: 320193, facts: [] },
    { cik: 320193, facts: { "us-gaap": [] } },
    { cik: 320193, facts: { "us-gaap": { Assets: null } } },
    { cik: 320193, facts: { "us-gaap": { Assets: {} } } },
  ];

  for (const payload of malformedPayloads) {
    await expectInvalidResponse(
      providerForPayload(payload).getCompanyFactsByCik("320193"),
    );
  }
});

test("accepts an empty facts object as a valid empty result", async () => {
  const result = await providerForPayload({
    cik: 320193,
    facts: {},
  }).getCompanyFactsByCik("320193");
  assert.deepEqual(result.data, []);
});

test("does not fabricate reporting context for an incomplete fact", async () => {
  const fact: Record<string, unknown> = { ...validFact };
  delete fact.end;

  await expectInvalidResponse(
    providerForPayload(companyFactsPayload(fact)).getCompanyFactsByCik(
      "320193",
    ),
  );
});

test("maps malformed successful JSON bodies to INVALID_RESPONSE", async () => {
  await expectInvalidResponse(
    providerForText("{").getCompanyFactsByCik("320193"),
  );
  await expectInvalidResponse(providerForText("{").getFilingsByCik("320193"));
});

test("preserves typed upstream and rate-limit errors", async () => {
  await assert.rejects(
    providerForText("{}", 429).getFilingsByCik("320193"),
    (error: unknown) =>
      error instanceof ProviderError && error.code === "RATE_LIMITED",
  );
  await assert.rejects(
    providerForText("{}", 500).getFilingsByCik("320193"),
    (error: unknown) =>
      error instanceof ProviderError && error.code === "UPSTREAM",
  );
});
