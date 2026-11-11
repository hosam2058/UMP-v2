import assert from "node:assert/strict";
import test from "node:test";
import type {
  DataSourceInput,
  FundamentalFactInput,
  Repositories,
  RepositoryWriteResult,
  SecFilingInput,
} from "@ump/db";
import type {
  ExternalCompany,
  ExternalFundamentalFact,
  ExternalSecFiling,
} from "../domain/models";
import type { ProviderResult, Provenance } from "../providers/contracts";
import {
  SecIngestionError,
  SecIngestionService,
  type SecIngestionProvider,
  type SecSourceDescriptor,
} from "./sec-ingestion";

const cik = "0000320193";
const source: SecSourceDescriptor = {
  name: "Reviewed SEC EDGAR source",
  baseUrl: "https://data.sec.gov",
  isDelayed: false,
};

function provenance(
  retrievedAt: Date,
  overrides: Partial<Provenance> = {},
): Provenance {
  return {
    provider: "sec-edgar",
    retrievedAt,
    asOf: null,
    isDelayed: false,
    sourceUrl: "https://data.sec.gov/submissions/CIK0000320193.json",
    ...overrides,
  };
}

function factsProvenance(
  retrievedAt: Date,
  overrides: Partial<Provenance> = {},
): Provenance {
  return provenance(retrievedAt, {
    sourceUrl: `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
    ...overrides,
  });
}

function company(overrides: Partial<ExternalCompany> = {}): ExternalCompany {
  return {
    externalIdentifier: { scheme: "cik", value: cik },
    legalName: "Example Issuer, Inc.",
    country: null,
    sicCode: null,
    sicDescription: null,
    ...overrides,
  };
}

function fact(
  overrides: Partial<ExternalFundamentalFact> = {},
): ExternalFundamentalFact {
  return {
    companyIdentifier: { scheme: "cik", value: cik },
    taxonomy: "us-gaap",
    tag: "Assets",
    unit: "USD",
    value: "123.45",
    form: "10-K",
    filingDate: "2025-02-01",
    accessionNumber: "0000320193-25-000010",
    reportingStart: null,
    reportingEnd: "2024-12-31",
    fiscalYear: 2024,
    fiscalPeriod: "FY",
    frame: "CY2024Q4I",
    ...overrides,
  };
}

function filing(overrides: Partial<ExternalSecFiling> = {}): ExternalSecFiling {
  return {
    companyIdentifier: { scheme: "cik", value: cik },
    form: "10-K",
    accessionNumber: "0000320193-25-000010",
    filingDate: "2025-02-01",
    reportDate: "2024-12-31",
    primaryDocument: "example-20241231.htm",
    sourceUrl:
      "https://www.sec.gov/Archives/edgar/data/320193/000032019325000010/example-20241231.htm",
    ...overrides,
  };
}

type SourcePersistResult = Awaited<
  ReturnType<Repositories["dataSources"]["persist"]>
>;
type StartInput = Parameters<Repositories["ingestionRecords"]["start"]>[0];
type CompleteInput = Parameters<
  Repositories["ingestionRecords"]["complete"]
>[0];
type FailInput = Parameters<Repositories["ingestionRecords"]["fail"]>[0];

interface HarnessOptions {
  missingCompany?: boolean;
  sourceResult?: SourcePersistResult;
  companyResult?: ProviderResult<ExternalCompany> | Error;
  factsResult?: ProviderResult<ExternalFundamentalFact[]> | Error;
  filingsResult?: ProviderResult<ExternalSecFiling[]> | Error;
  factResults?: Array<RepositoryWriteResult | Error>;
  filingResults?: Array<RepositoryWriteResult | Error>;
  completeError?: Error;
  failError?: Error;
  source?: SecSourceDescriptor;
}

interface Stage {
  facts: FundamentalFactInput[];
  filings: SecFilingInput[];
  completed: CompleteInput[];
}

function outcome<T>(value: T | Error): Promise<T> {
  if (value instanceof Error) return Promise.reject(value);
  return Promise.resolve(value);
}

/**
 * This is an in-memory transaction double. It stages transaction writes and
 * discards them on error; it is not a PostgreSQL integration test.
 */
function createHarness(options: HarnessOptions = {}) {
  const companyResult: ProviderResult<ExternalCompany> = {
    data: company(),
    provenance: provenance(new Date("2026-10-08T06:00:01.000Z")),
  };
  const factsResult: ProviderResult<ExternalFundamentalFact[]> = {
    data: [fact()],
    provenance: factsProvenance(new Date("2026-10-08T06:00:02.000Z")),
  };
  const filingsResult: ProviderResult<ExternalSecFiling[]> = {
    data: [filing()],
    provenance: provenance(new Date("2026-10-08T06:00:03.000Z")),
  };
  const factResults = [...(options.factResults ?? [])];
  const filingResults = [...(options.filingResults ?? [])];

  const state = {
    calls: [] as string[],
    sourceInputs: [] as DataSourceInput[],
    companyLookups: [] as string[],
    started: [] as StartInput[],
    failed: [] as FailInput[],
    attemptedFacts: [] as FundamentalFactInput[],
    attemptedFilings: [] as SecFilingInput[],
    committedFacts: [] as FundamentalFactInput[],
    committedFilings: [] as SecFilingInput[],
    completed: [] as CompleteInput[],
    rollbacks: 0,
    commits: 0,
    providerCalls: [] as string[],
  };

  const provider: SecIngestionProvider = {
    name: "sec-edgar",
    resolveCompanyByCik(requestedCik) {
      state.providerCalls.push(`company:${requestedCik}`);
      return outcome(options.companyResult ?? companyResult);
    },
    getCompanyFactsByCik(requestedCik) {
      state.providerCalls.push(`facts:${requestedCik}`);
      return outcome(options.factsResult ?? factsResult);
    },
    getFilingsByCik(requestedCik) {
      state.providerCalls.push(`filings:${requestedCik}`);
      return outcome(options.filingsResult ?? filingsResult);
    },
  };

  const repositories = {
    dataSources: {
      async persist(input: DataSourceInput): Promise<SourcePersistResult> {
        state.calls.push("root.source.persist");
        state.sourceInputs.push(input);
        return options.sourceResult ?? { status: "inserted", id: "source-1" };
      },
    },
    companies: {
      async findExistingByCik(requestedCik: string) {
        state.calls.push("root.company.find");
        state.companyLookups.push(requestedCik);
        return options.missingCompany
          ? undefined
          : { id: "company-1", cik: requestedCik };
      },
    },
    ingestionRecords: {
      async start(input: StartInput) {
        state.calls.push("root.ingestion.start");
        state.started.push(input);
        return { status: "started" as const, id: "ingestion-1" };
      },
      async complete(_input: CompleteInput) {
        throw new Error("Completion must use transaction-bound repositories.");
      },
      async fail(input: FailInput) {
        state.calls.push("root.ingestion.fail");
        if (options.failError) throw options.failError;
        state.failed.push(input);
        return { status: "failed" as const, id: input.id };
      },
    },
    fundamentalFacts: {
      async persist(_input: FundamentalFactInput) {
        throw new Error(
          "Fact persistence must use transaction-bound repositories.",
        );
      },
    },
    secFilings: {
      async persist(_input: SecFilingInput) {
        throw new Error(
          "Filing persistence must use transaction-bound repositories.",
        );
      },
    },
    async withTransaction<T>(operation: (bound: Repositories) => Promise<T>) {
      state.calls.push("root.transaction.begin");
      const stage: Stage = { facts: [], filings: [], completed: [] };
      const transaction = {
        fundamentalFacts: {
          async persist(
            input: FundamentalFactInput,
          ): Promise<RepositoryWriteResult> {
            state.calls.push("transaction.fact.persist");
            state.attemptedFacts.push(input);
            const result = factResults.shift() ?? {
              status: "inserted" as const,
            };
            if (result instanceof Error) throw result;
            stage.facts.push(input);
            return result;
          },
        },
        secFilings: {
          async persist(input: SecFilingInput): Promise<RepositoryWriteResult> {
            state.calls.push("transaction.filing.persist");
            state.attemptedFilings.push(input);
            const result = filingResults.shift() ?? {
              status: "inserted" as const,
            };
            if (result instanceof Error) throw result;
            stage.filings.push(input);
            return result;
          },
        },
        ingestionRecords: {
          async complete(input: CompleteInput) {
            state.calls.push("transaction.ingestion.complete");
            if (options.completeError) throw options.completeError;
            stage.completed.push(input);
            return { status: "completed" as const, id: input.id };
          },
        },
      };

      try {
        const result = await operation(transaction as unknown as Repositories);
        state.calls.push("root.transaction.commit");
        state.commits += 1;
        state.committedFacts.push(...stage.facts);
        state.committedFilings.push(...stage.filings);
        state.completed.push(...stage.completed);
        return result;
      } catch (error) {
        state.calls.push("root.transaction.rollback");
        state.rollbacks += 1;
        throw error;
      }
    },
  } as unknown as Repositories;

  const service = new SecIngestionService({
    provider,
    repositories,
    source: options.source ?? source,
    clock: { now: () => new Date("2026-10-08T06:01:00.000Z") },
  });

  return { service, state };
}

async function expectIngestionError(
  operation: Promise<unknown>,
  code: SecIngestionError["code"],
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof SecIngestionError);
    assert.equal(error.code, code);
    return true;
  });
}

test("ingests facts and filings transactionally with authentic provenance", async () => {
  const exactValue = "123456789012345678901234567890.12345678901234567890";
  const harness = createHarness({
    factsResult: {
      data: [fact({ value: exactValue })],
      provenance: factsProvenance(new Date("2026-10-08T06:00:02.000Z")),
    },
  });

  const result = await harness.service.ingest("320193");

  assert.deepEqual(result, {
    cik,
    companyId: "company-1",
    ingestionRecordId: "ingestion-1",
    facts: { inserted: 1, duplicate: 0, updated: 0 },
    filings: { inserted: 1, duplicate: 0, updated: 0 },
  });
  assert.deepEqual(harness.state.sourceInputs, [
    {
      provider: "sec-edgar",
      name: source.name,
      baseUrl: source.baseUrl,
      isDelayed: source.isDelayed,
    },
  ]);
  assert.equal(harness.state.committedFacts[0]?.value, exactValue);
  assert.equal(
    harness.state.committedFilings[0]?.sourceUrl,
    filing().sourceUrl,
  );
  assert.equal(
    harness.state.completed[0]?.fetchedAt?.toISOString(),
    "2026-10-08T06:00:03.000Z",
  );
  assert.equal(harness.state.failed.length, 0);
  assert.equal(harness.state.commits, 1);
});

test("completes empty facts and filings as a successful snapshot", async () => {
  const harness = createHarness({
    factsResult: {
      data: [],
      provenance: factsProvenance(new Date("2026-10-08T06:00:02.000Z")),
    },
    filingsResult: {
      data: [],
      provenance: provenance(new Date("2026-10-08T06:00:03.000Z")),
    },
  });

  const result = await harness.service.ingest(cik);

  assert.deepEqual(result.facts, { inserted: 0, duplicate: 0, updated: 0 });
  assert.deepEqual(result.filings, { inserted: 0, duplicate: 0, updated: 0 });
  assert.equal(harness.state.completed.length, 1);
});

test("reports duplicate facts and filings without duplicating writes", async () => {
  const harness = createHarness({
    factResults: [{ status: "duplicate" }],
    filingResults: [{ status: "duplicate" }],
  });

  const result = await harness.service.ingest(cik);

  assert.deepEqual(result.facts, { inserted: 0, duplicate: 1, updated: 0 });
  assert.deepEqual(result.filings, { inserted: 0, duplicate: 1, updated: 0 });
  assert.equal(harness.state.commits, 1);
});

test("reports corrected fundamental facts as updates", async () => {
  const harness = createHarness({
    factResults: [{ status: "updated" }],
    filingsResult: {
      data: [],
      provenance: provenance(new Date("2026-10-08T06:00:03.000Z")),
    },
  });

  const result = await harness.service.ingest(cik);

  assert.deepEqual(result.facts, { inserted: 0, duplicate: 0, updated: 1 });
  assert.equal(harness.state.commits, 1);
});

test("fails after audit start when the company does not already exist", async () => {
  const harness = createHarness({ missingCompany: true });

  await expectIngestionError(harness.service.ingest(cik), "COMPANY_NOT_FOUND");

  assert.deepEqual(harness.state.providerCalls, []);
  assert.equal(harness.state.failed.length, 1);
  assert.equal(harness.state.failed[0]?.errorCode, "COMPANY_NOT_FOUND");
  assert.equal(harness.state.rollbacks, 0);
});

test("rejects invalid CIKs before source resolution or audit creation", async () => {
  const harness = createHarness();

  await assert.rejects(harness.service.ingest("not-a-cik"));

  assert.equal(harness.state.sourceInputs.length, 0);
  assert.equal(harness.state.started.length, 0);
});

test("fails closed when the returned company identifier mismatches the CIK", async () => {
  const harness = createHarness({
    companyResult: {
      data: company({
        externalIdentifier: { scheme: "cik", value: "0000000001" },
      }),
      provenance: provenance(new Date("2026-10-08T06:00:01.000Z")),
    },
  });

  await expectIngestionError(
    harness.service.ingest(cik),
    "COMPANY_IDENTIFIER_MISMATCH",
  );

  assert.deepEqual(harness.state.providerCalls, [`company:${cik}`]);
  assert.equal(harness.state.failed.length, 1);
});

test("fails closed when a fact or filing identifier mismatches the CIK", async () => {
  const cases = [
    {
      options: {
        factsResult: {
          data: [
            fact({ companyIdentifier: { scheme: "cik", value: "0000000001" } }),
          ],
          provenance: factsProvenance(new Date("2026-10-08T06:00:02.000Z")),
        },
      },
      code: "FACT_IDENTIFIER_MISMATCH" as const,
    },
    {
      options: {
        filingsResult: {
          data: [
            filing({
              companyIdentifier: { scheme: "cik", value: "0000000001" },
            }),
          ],
          provenance: provenance(new Date("2026-10-08T06:00:03.000Z")),
        },
      },
      code: "FILING_IDENTIFIER_MISMATCH" as const,
    },
  ];

  for (const { options, code } of cases) {
    const harness = createHarness(options);
    await expectIngestionError(harness.service.ingest(cik), code);
    assert.equal(harness.state.rollbacks, 0);
    assert.equal(harness.state.failed[0]?.errorCode, code);
  }
});

test("fails closed for invalid or source-inconsistent provenance", async () => {
  const harness = createHarness({
    factsResult: {
      data: [fact()],
      provenance: factsProvenance(new Date("2026-10-08T06:00:02.000Z"), {
        isDelayed: true,
      }),
    },
  });

  await expectIngestionError(harness.service.ingest(cik), "INVALID_PROVENANCE");

  assert.equal(harness.state.rollbacks, 0);
  assert.equal(harness.state.failed[0]?.errorCode, "INVALID_PROVENANCE");
});

test("rejects missing, invalid, or mismatched SEC provenance", async () => {
  const invalidProvenanceCases: Array<{
    name: string;
    result: ProviderResult<ExternalFundamentalFact[]>;
  }> = [
    {
      name: "missing source URL",
      result: {
        data: [fact()],
        provenance: factsProvenance(new Date("2026-10-08T06:00:02.000Z"), {
          sourceUrl: undefined,
        }),
      },
    },
    {
      name: "invalid retrieval timestamp",
      result: {
        data: [fact()],
        provenance: factsProvenance(new Date(Number.NaN)),
      },
    },
    {
      name: "invalid source-as-of timestamp",
      result: {
        data: [fact()],
        provenance: factsProvenance(new Date("2026-10-08T06:00:02.000Z"), {
          asOf: new Date(Number.NaN),
        }),
      },
    },
    {
      name: "wrong provider identity",
      result: {
        data: [fact()],
        provenance: factsProvenance(new Date("2026-10-08T06:00:02.000Z"), {
          provider: "unreviewed-provider",
        }),
      },
    },
    {
      name: "wrong SEC endpoint CIK",
      result: {
        data: [fact()],
        provenance: factsProvenance(new Date("2026-10-08T06:00:02.000Z"), {
          sourceUrl: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json",
        }),
      },
    },
    {
      name: "non-SEC endpoint",
      result: {
        data: [fact()],
        provenance: factsProvenance(new Date("2026-10-08T06:00:02.000Z"), {
          sourceUrl: "https://example.com/api/xbrl/companyfacts/CIK0000320193.json",
        }),
      },
    },
  ];

  for (const { name, result } of invalidProvenanceCases) {
    const harness = createHarness({ factsResult: result });
    await expectIngestionError(harness.service.ingest(cik), "INVALID_PROVENANCE");
    assert.equal(harness.state.attemptedFacts.length, 0, name);
    assert.equal(harness.state.failed[0]?.errorCode, "INVALID_PROVENANCE", name);
  }
});

test("rejects official SEC endpoints assigned to the wrong resource type", async () => {
  const companyHarness = createHarness({
    companyResult: {
      data: company(),
      provenance: factsProvenance(new Date("2026-10-08T06:00:01.000Z")),
    },
  });
  await expectIngestionError(
    companyHarness.service.ingest(cik),
    "INVALID_PROVENANCE",
  );
  assert.deepEqual(companyHarness.state.providerCalls, [`company:${cik}`]);

  const factsHarness = createHarness({
    factsResult: {
      data: [fact()],
      provenance: provenance(new Date("2026-10-08T06:00:02.000Z")),
    },
  });
  await expectIngestionError(
    factsHarness.service.ingest(cik),
    "INVALID_PROVENANCE",
  );
  assert.deepEqual(factsHarness.state.providerCalls, [
    `company:${cik}`,
    `facts:${cik}`,
  ]);

  const filingsHarness = createHarness({
    filingsResult: {
      data: [filing()],
      provenance: factsProvenance(new Date("2026-10-08T06:00:03.000Z")),
    },
  });
  await expectIngestionError(
    filingsHarness.service.ingest(cik),
    "INVALID_PROVENANCE",
  );
  assert.deepEqual(filingsHarness.state.providerCalls, [
    `company:${cik}`,
    `facts:${cik}`,
    `filings:${cik}`,
  ]);
});

test("rejects a null SEC source base URL before creating an audit record", async () => {
  const harness = createHarness({ source: { ...source, baseUrl: null } });

  await expectIngestionError(
    harness.service.ingest(cik),
    "SOURCE_DESCRIPTOR_INVALID",
  );

  assert.equal(harness.state.sourceInputs.length, 0);
  assert.equal(harness.state.started.length, 0);
});

test("validates official archive URLs separately from SEC API provenance", async () => {
  const harness = createHarness({
    filingsResult: {
      data: [
        filing({
          sourceUrl:
            "https://data.sec.gov/Archives/edgar/data/320193/000032019325000010/example-20241231.htm",
        }),
      ],
      provenance: provenance(new Date("2026-10-08T06:00:03.000Z")),
    },
  });

  await expectIngestionError(harness.service.ingest(cik), "INVALID_PROVENANCE");
  assert.equal(harness.state.attemptedFilings.length, 0);
  assert.equal(harness.state.failed[0]?.errorCode, "INVALID_PROVENANCE");
});

test("fails closed on source configuration conflict before audit creation", async () => {
  const harness = createHarness({
    sourceResult: { status: "conflict", conflict: "data-source-metadata" },
  });

  await expectIngestionError(
    harness.service.ingest(cik),
    "SOURCE_CONFIGURATION_CONFLICT",
  );

  assert.equal(harness.state.started.length, 0);
  assert.equal(harness.state.failed.length, 0);
  assert.equal(harness.state.providerCalls.length, 0);
});

test("rolls back when fundamental fact persistence fails", async () => {
  const failure = new Error("fact persistence failed");
  const harness = createHarness({ factResults: [failure] });

  await assert.rejects(
    harness.service.ingest(cik),
    (error: unknown) => error === failure,
  );

  assert.equal(harness.state.rollbacks, 1);
  assert.equal(harness.state.committedFacts.length, 0);
  assert.equal(harness.state.completed.length, 0);
  assert.equal(harness.state.failed.length, 1);
});

test("rolls back after a prior staged fact when a later fact fails", async () => {
  const failure = new Error("second fact failed");
  const harness = createHarness({
    factsResult: {
      data: [fact(), fact({ tag: "Liabilities" })],
      provenance: factsProvenance(new Date("2026-10-08T06:00:02.000Z")),
    },
    factResults: [{ status: "inserted" }, failure],
  });

  await assert.rejects(
    harness.service.ingest(cik),
    (error: unknown) => error === failure,
  );

  assert.equal(harness.state.attemptedFacts.length, 2);
  assert.equal(harness.state.committedFacts.length, 0);
  assert.equal(harness.state.rollbacks, 1);
});

test("rolls back when SEC filing persistence fails", async () => {
  const failure = new Error("filing persistence failed");
  const harness = createHarness({ filingResults: [failure] });

  await assert.rejects(
    harness.service.ingest(cik),
    (error: unknown) => error === failure,
  );

  assert.equal(harness.state.attemptedFacts.length, 1);
  assert.equal(harness.state.attemptedFilings.length, 1);
  assert.equal(harness.state.committedFacts.length, 0);
  assert.equal(harness.state.committedFilings.length, 0);
  assert.equal(harness.state.rollbacks, 1);
});

test("treats filing metadata conflicts as failed ingestion", async () => {
  const harness = createHarness({
    filingResults: [{ status: "conflict", conflict: "filing-metadata" }],
  });

  await expectIngestionError(
    harness.service.ingest(cik),
    "PERSISTENCE_CONFLICT",
  );

  assert.equal(harness.state.rollbacks, 1);
  assert.equal(harness.state.committedFacts.length, 0);
  assert.equal(harness.state.failed[0]?.errorCode, "PERSISTENCE_CONFLICT");
});

test("rolls back facts and filings when transaction completion fails", async () => {
  const failure = new Error("completion failed");
  const harness = createHarness({ completeError: failure });

  await assert.rejects(
    harness.service.ingest(cik),
    (error: unknown) => error === failure,
  );

  assert.equal(harness.state.rollbacks, 1);
  assert.equal(harness.state.committedFacts.length, 0);
  assert.equal(harness.state.committedFilings.length, 0);
  assert.equal(harness.state.completed.length, 0);
  assert.equal(harness.state.failed.length, 1);
});

test("records failure outside the rolled-back transaction", async () => {
  const failure = new Error("fact write failed");
  const harness = createHarness({ factResults: [failure] });

  await assert.rejects(
    harness.service.ingest(cik),
    (error: unknown) => error === failure,
  );

  const rollback = harness.state.calls.indexOf("root.transaction.rollback");
  const failed = harness.state.calls.indexOf("root.ingestion.fail");
  assert.ok(rollback >= 0);
  assert.ok(failed > rollback);
  assert.equal(harness.state.failed.length, 1);
});

test("does not replace the original error when failure auditing also fails", async () => {
  const original = new Error("original persistence failure");
  const auditFailure = new Error("failure audit unavailable");
  const harness = createHarness({
    factResults: [original],
    failError: auditFailure,
  });

  await assert.rejects(
    harness.service.ingest(cik),
    (error: unknown) => error === original,
  );

  assert.equal(harness.state.rollbacks, 1);
  assert.equal(harness.state.failed.length, 0);
  assert.ok(harness.state.calls.includes("root.ingestion.fail"));
});

test("preserves the original provider error after recording failed ingestion", async () => {
  const original = new Error("provider transport failure");
  const harness = createHarness({ factsResult: original });

  await assert.rejects(
    harness.service.ingest(cik),
    (error: unknown) => error === original,
  );

  assert.equal(harness.state.failed.length, 1);
  assert.equal(harness.state.failed[0]?.errorMessage, "SEC ingestion failed.");
  assert.equal(harness.state.rollbacks, 0);
});
