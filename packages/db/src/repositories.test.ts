import assert from "node:assert/strict";
import test from "node:test";
import {
  createRepositories,
  fundamentalFactCorrection,
  fundamentalFactIdentity,
  normalizeSecCik,
  type DataSourceInput,
  type FundamentalFactInput,
  type SecFilingInput,
} from "./repositories";

const fact: FundamentalFactInput = {
  companyId: "company-1",
  sourceId: "source-1",
  taxonomy: "us-gaap",
  tag: "Assets",
  unit: "USD",
  value: "100",
  accessionNumber: "0000000000-24-000001",
  form: "10-K",
  filingDate: "2024-02-01",
  reportingStart: null,
  reportingEnd: "2023-12-31",
  fiscalYear: null,
  fiscalPeriod: null,
  frame: null,
  sourceAsOf: null,
  fetchedAt: new Date("2024-02-02T00:00:00.000Z"),
};

const filing: SecFilingInput = {
  companyId: "company-1",
  sourceId: "source-1",
  accessionNumber: "0000000000-24-000001",
  form: "10-K",
  filingDate: "2024-02-01",
  reportDate: null,
  primaryDocument: null,
  sourceUrl: "https://www.sec.gov/Archives/example",
  fetchedAt: new Date("2024-02-02T00:00:00.000Z"),
};

const source: DataSourceInput = {
  provider: "sec-edgar",
  name: "SEC EDGAR",
  baseUrl: "https://data.sec.gov",
  isDelayed: false,
};

interface FakeConfig {
  selectRows?: unknown[][];
  insertResults?: unknown[][];
  transactionDatabase?: ReturnType<typeof fakeDatabase>["database"];
  label?: string;
}

function fakeDatabase(config: FakeConfig = {}) {
  const calls: Array<{
    operation: string;
    value?: unknown;
    label?: string;
  }> = [];

  const selectRows = [...(config.selectRows ?? [])];
  const insertResults = [...(config.insertResults ?? [])];

  const database = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            calls.push({ operation: "select", label: config.label });
            return selectRows.shift() ?? [];
          },
        }),
      }),
    }),

    insert: () => ({
      values: (value: unknown) => {
        calls.push({ operation: "insert", value, label: config.label });

        return {
          onConflictDoNothing: () => ({
            returning: async () => {
              calls.push({ operation: "returning", label: config.label });
              return insertResults.shift() ?? [];
            },
          }),
        };
      },
    }),

    update: () => ({
      set: (value: unknown) => ({
        where: async () => {
          calls.push({ operation: "update", value, label: config.label });
        },
      }),
    }),

    transaction: async <T>(operation: (transaction: unknown) => Promise<T>) => {
      calls.push({ operation: "transaction", label: config.label });
      return operation(config.transactionDatabase ?? database);
    },
  };

  return { database, calls };
}

test("normalizes and validates canonical SEC CIKs", () => {
  assert.equal(normalizeSecCik("320193"), "0000320193");
  assert.equal(normalizeSecCik("0000320193"), "0000320193");
  assert.equal(normalizeSecCik(" 320193 "), "0000320193");

  assert.throws(() => normalizeSecCik(""));
  assert.throws(() => normalizeSecCik("CIK-320193"));
  assert.throws(() => normalizeSecCik("12345678901"));
});

test("existing-company lookup normalizes CIK and never creates a company", async () => {
  const fake = fakeDatabase({
    selectRows: [[{ id: "company-1", cik: "0000320193" }]],
  });

  const result = await createRepositories(
    fake.database as never,
  ).companies.findExistingByCik("320193");

  assert.deepEqual(result, {
    id: "company-1",
    cik: "0000320193",
  });

  assert.deepEqual(
    fake.calls.map((call) => call.operation),
    ["select"],
  );
});

test("data source insert reports inserted", async () => {
  const fake = fakeDatabase({
    insertResults: [[{ id: "source-1" }]],
  });

  const result = await createRepositories(
    fake.database as never,
  ).dataSources.persist(source);

  assert.deepEqual(result, { status: "inserted" });
  assert.deepEqual(
    fake.calls.map((call) => call.operation),
    ["insert", "returning"],
  );
});

test("data source exact duplicate is a no-op", async () => {
  const existing = {
    ...source,
    id: "source-1",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const fake = fakeDatabase({
    insertResults: [[]],
    selectRows: [[existing]],
  });

  const result = await createRepositories(
    fake.database as never,
  ).dataSources.persist(source);

  assert.deepEqual(result, { status: "duplicate" });
});

test("data source changed metadata conflicts", async () => {
  for (const existing of [
    { ...source, baseUrl: "https://old.example" },
    { ...source, isDelayed: true },
  ]) {
    const fake = fakeDatabase({
      insertResults: [[]],
      selectRows: [
        [
          {
            ...existing,
            id: "source-1",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      ],
    });

    assert.deepEqual(
      await createRepositories(fake.database as never).dataSources.persist(
        source,
      ),
      {
        status: "conflict",
        conflict: "data-source-metadata",
      },
    );
  }
});

test("filing insert reports inserted", async () => {
  const fake = fakeDatabase({
    insertResults: [[{ id: "filing-1" }]],
  });

  assert.deepEqual(
    await createRepositories(fake.database as never).secFilings.persist(filing),
    { status: "inserted" },
  );
});

test("filing exact duplicate is a no-op", async () => {
  const fake = fakeDatabase({
    insertResults: [[]],
    selectRows: [[{ ...filing, id: "filing-1" }]],
  });

  assert.deepEqual(
    await createRepositories(fake.database as never).secFilings.persist(filing),
    { status: "duplicate" },
  );
});

test("filing company conflict is distinct", async () => {
  const fake = fakeDatabase({
    insertResults: [[]],
    selectRows: [
      [
        {
          ...filing,
          id: "filing-1",
          companyId: "company-2",
        },
      ],
    ],
  });

  assert.deepEqual(
    await createRepositories(fake.database as never).secFilings.persist(filing),
    {
      status: "conflict",
      conflict: "filing-company",
    },
  );
});

test("every approved filing metadata change conflicts", async () => {
  const variants = [
    { form: "10-Q" },
    { filingDate: "2024-02-02" },
    { reportDate: "2023-12-31" },
    { primaryDocument: "changed.htm" },
    { sourceUrl: "https://changed.example" },
  ];

  for (const variant of variants) {
    const fake = fakeDatabase({
      insertResults: [[]],
      selectRows: [
        [
          {
            ...filing,
            ...variant,
            id: "filing-1",
          },
        ],
      ],
    });

    assert.deepEqual(
      await createRepositories(fake.database as never).secFilings.persist(
        filing,
      ),
      {
        status: "conflict",
        conflict: "filing-metadata",
      },
    );
  }
});

test("fact identity retains nullable fields and excludes value/provenance", () => {
  const identity = fundamentalFactIdentity(fact);

  assert.equal(identity.reportingStart, null);
  assert.equal(identity.fiscalYear, null);
  assert.equal(identity.fiscalPeriod, null);
  assert.equal(identity.frame, null);

  assert.equal("value" in identity, false);
  assert.equal("sourceAsOf" in identity, false);
  assert.equal("fetchedAt" in identity, false);
});

test("fact correction command changes only approved fields", () => {
  const correction = fundamentalFactCorrection({
    ...fact,
    value: "101",
    sourceAsOf: new Date("2024-02-01T00:00:00.000Z"),
  });

  assert.deepEqual(correction, {
    value: "101",
    sourceAsOf: new Date("2024-02-01T00:00:00.000Z"),
    fetchedAt: fact.fetchedAt,
  });
});

test("fact insert reports inserted", async () => {
  const fake = fakeDatabase({
    insertResults: [[{ id: "fact-1" }]],
  });

  assert.deepEqual(
    await createRepositories(fake.database as never).fundamentalFacts.persist(
      fact,
    ),
    { status: "inserted" },
  );
});

test("same fact value and sourceAsOf is duplicate even with newer fetchedAt", async () => {
  const laterFetch = new Date("2024-02-03T00:00:00.000Z");

  const existing = {
    ...fact,
    id: "fact-1",
    fetchedAt: fact.fetchedAt,
  };

  const fake = fakeDatabase({
    insertResults: [[]],
    selectRows: [[existing]],
  });

  const result = await createRepositories(
    fake.database as never,
  ).fundamentalFacts.persist({
    ...fact,
    fetchedAt: laterFetch,
  });

  assert.deepEqual(result, { status: "duplicate" });

  assert.equal(
    fake.calls.some((call) => call.operation === "update"),
    false,
  );
});

test("numerically equivalent fact values are duplicates", async () => {
  const existing = {
    ...fact,
    id: "fact-1",
    value: "123.4500000000",
  };

  const fake = fakeDatabase({
    insertResults: [[]],
    selectRows: [[existing]],
  });

  const result = await createRepositories(
    fake.database as never,
  ).fundamentalFacts.persist({
    ...fact,
    value: "1.2345e2",
  });

  assert.deepEqual(result, { status: "duplicate" });
  assert.equal(
    fake.calls.some((call) => call.operation === "update"),
    false,
  );
});

test("same fact identity with corrected value updates approved fields", async () => {
  const existing = {
    ...fact,
    id: "fact-1",
  };

  const corrected = {
    ...fact,
    value: "101",
    sourceAsOf: new Date("2024-02-05T00:00:00.000Z"),
    fetchedAt: new Date("2024-02-06T00:00:00.000Z"),
  };

  const fake = fakeDatabase({
    insertResults: [[]],
    selectRows: [[existing]],
  });

  const result = await createRepositories(
    fake.database as never,
  ).fundamentalFacts.persist(corrected);

  assert.deepEqual(result, { status: "updated" });

  const update = fake.calls.find((call) => call.operation === "update");

  assert.deepEqual(update?.value, {
    value: corrected.value,
    sourceAsOf: corrected.sourceAsOf,
    fetchedAt: corrected.fetchedAt,
  });
});

test("transaction-bound repositories execute against transaction handle", async () => {
  const transactionFake = fakeDatabase({
    insertResults: [[{ id: "source-1" }]],
    label: "transaction",
  });

  const outerFake = fakeDatabase({
    transactionDatabase: transactionFake.database,
    label: "outer",
  });

  const repositories = createRepositories(outerFake.database as never);

  const result = await repositories.withTransaction(async (bound) =>
    bound.dataSources.persist(source),
  );

  assert.deepEqual(result, { status: "inserted" });

  assert.deepEqual(
    outerFake.calls.map((call) => call.operation),
    ["transaction"],
  );

  assert.deepEqual(
    transactionFake.calls.map((call) => call.operation),
    ["insert", "returning"],
  );
});

test("DTOs contain no SEC mapping or API fields", () => {
  assert.equal("symbol" in source, false);
  assert.equal("cik" in filing, false);
  assert.equal("response" in fact, false);
});
