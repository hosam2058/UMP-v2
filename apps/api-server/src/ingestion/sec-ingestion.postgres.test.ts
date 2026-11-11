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
  ingestionRecords,
  secFilings,
  type Repositories,
} from "@ump/db";
import type {
  ExternalCompany,
  ExternalFundamentalFact,
  ExternalSecFiling,
} from "../domain/models";
import type { ProviderResult, Provenance } from "../providers/contracts";
import {
  SecIngestionService,
  type SecIngestionProvider,
  type SecSourceDescriptor,
} from "./sec-ingestion";

const INTEGRATION_FLAG = "UMP_POSTGRES_INTEGRATION";
const TEST_DATABASE = "ump_v2_test";
const TEST_PORT = "55432";
const TEST_USER = "ump_test";
const EXACT_DECIMAL = "123456789012345678901234567890.12345678901234567890";

let fixtureSequence = 0;

type IntegrationDatabase = ReturnType<typeof createDatabase>;
type IntegrationTransaction = Parameters<
  Parameters<IntegrationDatabase["db"]["transaction"]>[0]
>[0];

class RollbackIsolatedTest extends Error {
  constructor() {
    super("Rollback isolated PostgreSQL integration test");
  }
}

function integrationConnectionString(): string {
  if (process.env[INTEGRATION_FLAG] !== "1") {
    throw new Error(`${INTEGRATION_FLAG}=1 is required for PostgreSQL integration tests.`);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for PostgreSQL integration tests.");
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  if (
    (url.protocol !== "postgresql:" && url.protocol !== "postgres:") ||
    url.pathname !== `/${TEST_DATABASE}` ||
    url.hostname !== "127.0.0.1" ||
    url.port !== TEST_PORT ||
    url.username !== TEST_USER
  ) {
    throw new Error(
      `PostgreSQL integration tests require local ${TEST_DATABASE} on port ${TEST_PORT}.`,
    );
  }

  return connectionString;
}

async function assertSchemaPrerequisites(
  database: IntegrationDatabase,
): Promise<void> {
  const databaseName = await database.pool.query<{ database_name: string }>(
    "SELECT current_database() AS database_name",
  );
  if (databaseName.rows[0]?.database_name !== TEST_DATABASE) {
    throw new Error(`PostgreSQL integration tests require ${TEST_DATABASE}.`);
  }

  const requiredTables = [
    "companies",
    "data_sources",
    "fundamental_facts",
    "sec_filings",
    "ingestion_records",
  ];
  const tableResult = await database.pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
    [requiredTables],
  );
  const foundTables = new Set(tableResult.rows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((table) => !foundTables.has(table));
  if (missingTables.length > 0) {
    throw new Error(
      `PostgreSQL integration schema prerequisite missing tables: ${missingTables.join(", ")}. Migrations must be applied separately.`,
    );
  }

  const numericResult = await database.pool.query<{
    data_type: string;
    numeric_precision: number | null;
    numeric_scale: number | null;
  }>(
    "SELECT data_type, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'fundamental_facts' AND column_name = 'value'",
  );
  const valueColumn = numericResult.rows[0];
  if (
    valueColumn?.data_type !== "numeric" ||
    valueColumn.numeric_precision !== null ||
    valueColumn.numeric_scale !== null
  ) {
    throw new Error(
      "PostgreSQL integration schema requires fundamental_facts.value to be unrestricted numeric. Apply approved migrations separately.",
    );
  }
}

interface Fixture {
  cik: string;
  companyId: string;
  source: SecSourceDescriptor;
  provider: SecIngestionProvider;
}

function nextFixtureCik(): string {
  fixtureSequence += 1;
  return `9${String((Date.now() + fixtureSequence) % 1_000_000_000).padStart(9, "0")}`;
}

function createFixture(
  cik: string,
  companyId: string,
  facts: ExternalFundamentalFact[] = [createFact(EXACT_DECIMAL)],
): Fixture {
  const source: SecSourceDescriptor = {
    name: `UMP Task 4B integration ${randomUUID()}`,
    baseUrl: "https://data.sec.gov",
    isDelayed: false,
  };
  const companyProvenance = provenance(cik, "submissions", "2026-10-08T06:00:01.000Z");
  const factsProvenance = provenance(cik, "facts", "2026-10-08T06:00:02.000Z");
  const filingsProvenance = provenance(cik, "submissions", "2026-10-08T06:00:03.000Z");

  return {
    cik,
    companyId,
    source,
    provider: {
      name: "sec-edgar",
      async resolveCompanyByCik(): Promise<ProviderResult<ExternalCompany>> {
        return {
          data: {
            externalIdentifier: { scheme: "cik", value: cik },
            legalName: "UMP Task 4B Integration Issuer",
            country: "US",
            sicCode: null,
            sicDescription: null,
          },
          provenance: companyProvenance,
        };
      },
      async getCompanyFactsByCik(): Promise<
        ProviderResult<ExternalFundamentalFact[]>
      > {
        return {
          data: facts.map((fact) => ({
            ...fact,
            companyIdentifier: { scheme: "cik", value: cik },
          })),
          provenance: factsProvenance,
        };
      },
      async getFilingsByCik(): Promise<ProviderResult<ExternalSecFiling[]>> {
        return {
          data: [
            {
              companyIdentifier: { scheme: "cik", value: cik },
              form: "10-K",
              accessionNumber: "0000000001-26-000001",
              filingDate: "2026-02-01",
              reportDate: "2025-12-31",
              primaryDocument: "ump-20251231.htm",
              sourceUrl: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/000000000126000001/ump-20251231.htm`,
            },
          ],
          provenance: filingsProvenance,
        };
      },
    },
  };
}

function createFact(value: string, tag = "Assets"): ExternalFundamentalFact {
  return {
    companyIdentifier: { scheme: "cik", value: "0000000000" },
    taxonomy: "us-gaap",
    tag,
    unit: "USD",
    value,
    form: "10-K",
    filingDate: "2026-02-01",
    accessionNumber: "0000000001-26-000001",
    reportingStart: null,
    reportingEnd: "2025-12-31",
    fiscalYear: 2025,
    fiscalPeriod: "FY",
    frame: "CY2025Q4I",
  };
}

function provenance(
  cik: string,
  resource: "submissions" | "facts",
  retrievedAt: string,
): Provenance {
  return {
    provider: "sec-edgar",
    retrievedAt: new Date(retrievedAt),
    asOf: null,
    isDelayed: false,
    sourceUrl:
      resource === "facts"
        ? `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`
        : `https://data.sec.gov/submissions/CIK${cik}.json`,
  };
}

interface Faults {
  afterFactWrite?: Error;
  failFactPersistenceAttempt?: { attempt: number; error: Error };
  onFactPersistenceAttempt?: () => void;
  onFactPersisted?: () => void;
  afterFilingWrite?: Error;
  completionError?: Error;
  auditError?: Error;
}

function withFaults(repositories: Repositories, faults: Faults): Repositories {
  return {
    ...repositories,
    ingestionRecords: {
      ...repositories.ingestionRecords,
      async fail(input) {
        if (faults.auditError) throw faults.auditError;
        return repositories.ingestionRecords.fail(input);
      },
    },
    async withTransaction(operation) {
      return repositories.withTransaction(async (transaction) => {
        let factWrites = 0;
        let filingWrites = 0;
        const faultingTransaction: Repositories = {
          ...transaction,
          fundamentalFacts: {
            async persist(input) {
              factWrites += 1;
              faults.onFactPersistenceAttempt?.();
              if (
                faults.failFactPersistenceAttempt?.attempt === factWrites
              ) {
                throw faults.failFactPersistenceAttempt.error;
              }
              const result = await transaction.fundamentalFacts.persist(input);
              faults.onFactPersisted?.();
              if (faults.afterFactWrite && factWrites === 1) {
                throw faults.afterFactWrite;
              }
              return result;
            },
          },
          secFilings: {
            async persist(input) {
              const result = await transaction.secFilings.persist(input);
              filingWrites += 1;
              if (faults.afterFilingWrite && filingWrites === 1) {
                throw faults.afterFilingWrite;
              }
              return result;
            },
          },
          ingestionRecords: {
            ...transaction.ingestionRecords,
            async complete(input) {
              if (faults.completionError) throw faults.completionError;
              return transaction.ingestionRecords.complete(input);
            },
          },
        };
        return operation(faultingTransaction);
      });
    },
  };
}

async function withIsolatedDatabaseTest(
  operation: (context: {
    transaction: IntegrationTransaction;
    repositories: Repositories;
  }) => Promise<void>,
): Promise<void> {
  const database = createDatabase({ connectionString: integrationConnectionString() });
  try {
    await assertSchemaPrerequisites(database);
    try {
      await database.db.transaction(async (transaction) => {
        const repositories = createRepositories(transaction);
        await operation({ transaction, repositories });
        throw new RollbackIsolatedTest();
      });
    } catch (error) {
      if (!(error instanceof RollbackIsolatedTest)) throw error;
    }
  } finally {
    await database.close();
  }
}

async function insertExistingCompany(
  transaction: IntegrationTransaction,
  cik: string,
): Promise<string> {
  const inserted = await transaction
    .insert(companies)
    .values({
      legalName: "UMP Task 4B Integration Fixture",
      cik,
      country: "US",
      sicCode: null,
      sicDescription: null,
    })
    .returning({ id: companies.id });
  const company = inserted[0];
  assert.ok(company, "fixture company insert must return an id");
  return company.id;
}

async function operationRows(
  transaction: IntegrationTransaction,
  sourceName: string,
) {
  const source = await transaction.query.dataSources.findFirst({
    where: eq(dataSources.name, sourceName),
  });
  if (!source) return { facts: [], filings: [], records: [] };

  const facts = await transaction
    .select()
    .from(fundamentalFacts)
    .where(eq(fundamentalFacts.sourceId, source.id));
  const filings = await transaction
    .select()
    .from(secFilings)
    .where(eq(secFilings.sourceId, source.id));
  const records = await transaction
    .select()
    .from(ingestionRecords)
    .where(eq(ingestionRecords.sourceId, source.id));
  return { facts, filings, records };
}

async function createServiceContext(
  transaction: IntegrationTransaction,
  repositories: Repositories,
  facts?: ExternalFundamentalFact[],
) {
  const cik = nextFixtureCik();
  const companyId = await insertExistingCompany(transaction, cik);
  const fixture = createFixture(cik, companyId, facts);
  return {
    fixture,
    service: new SecIngestionService({
      provider: fixture.provider,
      repositories,
      source: fixture.source,
      clock: { now: () => new Date("2026-10-08T06:01:00.000Z") },
    }),
  };
}

test("PostgreSQL: ingests facts, filings, and completion atomically", async () => {
  await withIsolatedDatabaseTest(async ({ transaction, repositories }) => {
    const { fixture, service } = await createServiceContext(transaction, repositories);
    const result = await service.ingest(fixture.cik);
    const rows = await operationRows(transaction, fixture.source.name);

    assert.equal(result.facts.inserted, 1);
    assert.equal(result.filings.inserted, 1);
    assert.equal(rows.facts.length, 1);
    assert.equal(rows.filings.length, 1);
    assert.equal(rows.records.length, 1);
    assert.equal(rows.records[0]?.status, "completed");
  });
});

test("PostgreSQL: rolls back partial fact writes and records failed audit", async () => {
  await withIsolatedDatabaseTest(async ({ transaction, repositories }) => {
    const original = new Error("partial fact persistence failure");
    const facts = [createFact(EXACT_DECIMAL), createFact("99", "Liabilities")];
    let factPersistenceAttempts = 0;
    let persistedFacts = 0;
    const { fixture, service } = await createServiceContext(
      transaction,
      withFaults(repositories, {
        failFactPersistenceAttempt: { attempt: 2, error: original },
        onFactPersistenceAttempt: () => {
          factPersistenceAttempts += 1;
        },
        onFactPersisted: () => {
          persistedFacts += 1;
        },
      }),
      facts,
    );

    await assert.rejects(service.ingest(fixture.cik), (error: unknown) => error === original);
    const rows = await operationRows(transaction, fixture.source.name);
    assert.equal(factPersistenceAttempts, 2);
    assert.equal(persistedFacts, 1);
    assert.equal(rows.facts.length, 0);
    assert.equal(rows.filings.length, 0);
    assert.equal(rows.records.length, 1);
    assert.equal(rows.records[0]?.status, "failed");
    assert.equal(rows.records[0]?.errorCode, "SEC_INGESTION_FAILURE");
  });
});

test("PostgreSQL: rolls back fact and filing writes after filing failure", async () => {
  await withIsolatedDatabaseTest(async ({ transaction, repositories }) => {
    const original = new Error("filing persistence failure");
    const { fixture, service } = await createServiceContext(
      transaction,
      withFaults(repositories, { afterFilingWrite: original }),
    );

    await assert.rejects(service.ingest(fixture.cik), (error: unknown) => error === original);
    const rows = await operationRows(transaction, fixture.source.name);
    assert.equal(rows.facts.length, 0);
    assert.equal(rows.filings.length, 0);
    assert.equal(rows.records[0]?.status, "failed");
  });
});

test("PostgreSQL: rolls back writes when completion fails", async () => {
  await withIsolatedDatabaseTest(async ({ transaction, repositories }) => {
    const original = new Error("completion failure");
    const { fixture, service } = await createServiceContext(
      transaction,
      withFaults(repositories, { completionError: original }),
    );

    await assert.rejects(service.ingest(fixture.cik), (error: unknown) => error === original);
    const rows = await operationRows(transaction, fixture.source.name);
    assert.equal(rows.facts.length, 0);
    assert.equal(rows.filings.length, 0);
    assert.equal(rows.records[0]?.status, "failed");
  });
});

test("PostgreSQL: failed audit persists after the inner transaction rolls back", async () => {
  await withIsolatedDatabaseTest(async ({ transaction, repositories }) => {
    const original = new Error("transaction failure with durable audit");
    const { fixture, service } = await createServiceContext(
      transaction,
      withFaults(repositories, { afterFactWrite: original }),
    );

    await assert.rejects(service.ingest(fixture.cik), (error: unknown) => error === original);
    const rows = await operationRows(transaction, fixture.source.name);
    assert.deepEqual(rows.facts, []);
    assert.deepEqual(rows.filings, []);
    assert.equal(rows.records.length, 1);
    assert.equal(rows.records[0]?.status, "failed");
    assert.equal(rows.records[0]?.errorCode, "SEC_INGESTION_FAILURE");
  });
});

test("PostgreSQL: audit failure does not replace the original error", async () => {
  await withIsolatedDatabaseTest(async ({ transaction, repositories }) => {
    const original = new Error("original transactional failure");
    const auditFailure = new Error("audit write unavailable");
    const { fixture, service } = await createServiceContext(
      transaction,
      withFaults(repositories, {
        afterFactWrite: original,
        auditError: auditFailure,
      }),
    );

    await assert.rejects(service.ingest(fixture.cik), (error: unknown) => error === original);
    const rows = await operationRows(transaction, fixture.source.name);
    assert.deepEqual(rows.facts, []);
    assert.deepEqual(rows.filings, []);
    assert.equal(rows.records[0]?.status, "started");
  });
});

test("PostgreSQL: duplicate ingestion preserves the exact decimal string", async () => {
  await withIsolatedDatabaseTest(async ({ transaction, repositories }) => {
    const { fixture, service } = await createServiceContext(transaction, repositories);
    const first = await service.ingest(fixture.cik);
    const second = await service.ingest(fixture.cik);
    const rows = await operationRows(transaction, fixture.source.name);

    assert.deepEqual(first.facts, { inserted: 1, duplicate: 0, updated: 0 });
    assert.deepEqual(second.facts, { inserted: 0, duplicate: 1, updated: 0 });
    assert.deepEqual(second.filings, { inserted: 0, duplicate: 1, updated: 0 });
    assert.equal(rows.facts.length, 1);
    assert.equal(rows.filings.length, 1);
    assert.equal(rows.facts[0]?.value, EXACT_DECIMAL);
    assert.equal(rows.records.length, 2);
    assert.ok(rows.records.every((record: { status: string }) => record.status === "completed"));
  });
});
