import { and, desc, eq, isNull } from "drizzle-orm";
import type { createDatabase } from "./index";
import {
  companies,
  curatedStockMappingRevisions,
  curatedStockMappingLifecycleEvents,
  dataSources,
  fundamentalFacts,
  ingestionRecords,
  instruments,
  secFilings,
} from "./schema";

type DatabaseHandle = ReturnType<typeof createDatabase>["db"];
type RepositoryDatabaseHandle = Pick<
  DatabaseHandle,
  "select" | "insert" | "update" | "transaction"
>;

export interface DataSourceInput {
  provider: string;
  name: string;
  baseUrl: string | null;
  isDelayed: boolean;
}

export type DataSourcePersistResult =
  | { status: "inserted"; id: string }
  | { status: "duplicate"; id: string }
  | {
      status: "conflict";
      conflict: "data-source-metadata";
    };

export interface IngestionRecordStartInput {
  sourceId: string;
  resourceType: string;
  resourceKey: string;
  startedAt: Date;
  metadata: Record<string, unknown> | null;
}

export interface IngestionRecordCompleteInput {
  id: string;
  completedAt: Date;
  sourceAsOf: Date | null;
  fetchedAt: Date | null;
  metadata: Record<string, unknown> | null;
}

export interface IngestionRecordFailInput {
  id: string;
  completedAt: Date;
  sourceAsOf: Date | null;
  fetchedAt: Date | null;
  errorCode: string;
  errorMessage: string;
  metadata: Record<string, unknown> | null;
}

export interface SecFilingInput {
  companyId: string;
  sourceId: string;
  accessionNumber: string;
  form: string;
  filingDate: string;
  reportDate: string | null;
  primaryDocument: string | null;
  sourceUrl: string;
  fetchedAt: Date;
}
export interface FundamentalFactInput {
  companyId: string;
  sourceId: string;
  taxonomy: string;
  tag: string;
  unit: string;
  value: string;
  accessionNumber: string;
  form: string;
  filingDate: string;
  reportingStart: string | null;
  reportingEnd: string;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  frame: string | null;
  sourceAsOf: Date | null;
  fetchedAt: Date;
}
export type FundamentalFactIdentity = Pick<
  FundamentalFactInput,
  | "companyId"
  | "sourceId"
  | "taxonomy"
  | "tag"
  | "unit"
  | "accessionNumber"
  | "form"
  | "filingDate"
  | "reportingStart"
  | "reportingEnd"
  | "fiscalYear"
  | "fiscalPeriod"
  | "frame"
>;
export type RepositoryWriteResult =
  | { status: "inserted" }
  | { status: "duplicate" }
  | { status: "updated" }
  | {
      status: "conflict";
      conflict: "data-source-metadata" | "filing-company" | "filing-metadata";
    };
export interface FundamentalFactCorrection {
  value: string;
  sourceAsOf: Date | null;
  fetchedAt: Date;
}
export interface StoredSecCompany {
  id: string;
  cik: string;
  legalName: string;
}
export interface StoredSecFiling {
  accessionNumber: string;
  form: string;
  filingDate: string;
  reportDate: string | null;
  primaryDocument: string | null;
  sourceUrl: string;
  fetchedAt: Date;
  source: { provider: string; name: string; baseUrl: string | null };
}
export interface StoredFundamentalFact {
  taxonomy: string;
  tag: string;
  unit: string;
  value: string;
  accessionNumber: string;
  form: string;
  filingDate: string;
  reportingStart: string | null;
  reportingEnd: string;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  frame: string | null;
  sourceAsOf: Date | null;
  fetchedAt: Date;
  source: { provider: string; name: string; baseUrl: string | null };
}
export interface FundamentalFactQuery {
  companyId: string;
  taxonomy?: string;
  tag?: string;
  fiscalYear?: number;
  fiscalPeriod?: string;
  form?: string;
  reportingEnd?: string;
  limit: number;
}
export interface Repositories {
  dataSources: {
    persist(input: DataSourceInput): Promise<DataSourcePersistResult>;
  };
  companies: {
    findExistingByCik(
      cik: string,
    ): Promise<{ id: string; cik: string | null } | undefined>;
  };
  secQueries: {
    findCompanyByCik(cik: string): Promise<StoredSecCompany | undefined>;
    listFilings(input: {
      companyId: string;
      limit: number;
    }): Promise<readonly StoredSecFiling[]>;
    listFundamentalFacts(
      input: FundamentalFactQuery,
    ): Promise<readonly StoredFundamentalFact[]>;
  };
  mappingOnboarding: {
    persistCompany(input: {
      cik: string;
      legalName: string;
    }): Promise<
      | { status: "inserted" | "duplicate"; id: string }
      | { status: "conflict"; conflict: "company-identity" }
    >;
    persistInstrument(input: {
      companyId: string;
      symbol: string;
      exchange: string;
      name: string;
      assetType: "stock";
      currency: "USD";
      country: "US";
    }): Promise<
      | { status: "inserted" | "duplicate"; id: string }
      | { status: "conflict"; conflict: "instrument-identity" }
    >;
    persistRevision(
      input: MappingRevisionInput,
    ): Promise<
      | { status: "inserted" | "duplicate" }
      | { status: "conflict"; conflict: "mapping-revision" }
    >;
    persistLifecycleEvent(input: {
      revisionId: string;
      lifecycle: "active" | "retired" | "superseded";
      successorRevisionId: string | null;
      effectiveFrom: Date;
      recordedAt: Date;
    }): Promise<
      | { status: "inserted" | "duplicate" }
      | { status: "conflict"; conflict: "lifecycle-event" }
    >;
  };
  secFilings: {
    persist(input: SecFilingInput): Promise<RepositoryWriteResult>;
  };
  fundamentalFacts: {
    persist(input: FundamentalFactInput): Promise<RepositoryWriteResult>;
  };
  ingestionRecords: {
    start(
      input: IngestionRecordStartInput,
    ): Promise<{ status: "started"; id: string }>;
    complete(
      input: IngestionRecordCompleteInput,
    ): Promise<{ status: "completed"; id: string }>;
    fail(
      input: IngestionRecordFailInput,
    ): Promise<{ status: "failed"; id: string }>;
  };
  withTransaction<T>(
    operation: (repositories: Repositories) => Promise<T>,
  ): Promise<T>;
}
export interface MappingRevisionInput {
  mappingId: string;
  revision: number;
  revisionId: string;
  instrumentId: string;
  companyId: string;
  lifecycle: "active" | "retired" | "superseded";
  successorRevisionId: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  changeReason: string;
  listingEvidenceSourceId: string;
  listingEvidenceReference: string;
  listingEvidenceRetrievedAt: Date;
  secEvidenceSourceId: string;
  secEvidenceReference: string;
  secEvidenceRetrievedAt: Date;
  approvalStatus: "approved" | "pending" | "rejected";
  approvedBy: string;
  approvedAt: Date;
}

export function normalizeSecCik(value: string): string {
  const digits = value.trim();
  if (!/^\d{1,10}$/.test(digits))
    throw new Error("SEC CIK must contain between one and ten decimal digits");
  return digits.padStart(10, "0");
}
export function fundamentalFactIdentity(
  input: FundamentalFactInput,
): FundamentalFactIdentity {
  const {
    companyId,
    sourceId,
    taxonomy,
    tag,
    unit,
    accessionNumber,
    form,
    filingDate,
    reportingStart,
    reportingEnd,
    fiscalYear,
    fiscalPeriod,
    frame,
  } = input;
  return {
    companyId,
    sourceId,
    taxonomy,
    tag,
    unit,
    accessionNumber,
    form,
    filingDate,
    reportingStart,
    reportingEnd,
    fiscalYear,
    fiscalPeriod,
    frame,
  };
}
export function fundamentalFactCorrection(
  input: FundamentalFactInput,
): FundamentalFactCorrection {
  return {
    value: input.value,
    sourceAsOf: input.sourceAsOf,
    fetchedAt: input.fetchedAt,
  };
}
function sameValue(left: unknown, right: unknown): boolean {
  return left instanceof Date && right instanceof Date
    ? left.getTime() === right.getTime()
    : left === right;
}

const DECIMAL_NUMBER_PATTERN =
  /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

function canonicalDecimal(value: string): string | null {
  const match = DECIMAL_NUMBER_PATTERN.exec(value);
  if (!match) return null;

  const negative = match[1] === "-";
  const integer = match[2] ?? "";
  const fraction = match[3] ?? "";
  const explicitExponent = match[4] ?? "0";

  let digits = `${integer}${fraction}`.replace(/^0+/, "");
  if (digits.length === 0) return "0";

  let trailingZeros = 0;
  while (digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    trailingZeros += 1;
  }

  const exponent =
    BigInt(explicitExponent) - BigInt(fraction.length) + BigInt(trailingZeros);

  return `${negative ? "-" : ""}${digits}e${exponent}`;
}

function sameNumericValue(left: string, right: string): boolean {
  const canonicalLeft = canonicalDecimal(left);
  const canonicalRight = canonicalDecimal(right);

  if (canonicalLeft === null || canonicalRight === null) {
    return left === right;
  }

  return canonicalLeft === canonicalRight;
}
function sameDataSource(
  existing: typeof dataSources.$inferSelect,
  input: DataSourceInput,
): boolean {
  return (
    sameValue(existing.baseUrl, input.baseUrl) &&
    existing.isDelayed === input.isDelayed
  );
}
function sameFiling(
  existing: typeof secFilings.$inferSelect,
  input: SecFilingInput,
): boolean {
  return (
    existing.companyId === input.companyId &&
    existing.form === input.form &&
    existing.filingDate === input.filingDate &&
    sameValue(existing.reportDate, input.reportDate) &&
    sameValue(existing.primaryDocument, input.primaryDocument) &&
    existing.sourceUrl === input.sourceUrl
  );
}
function sameFactCanonicalValue(
  existing: typeof fundamentalFacts.$inferSelect,
  input: FundamentalFactInput,
): boolean {
  return (
    sameNumericValue(existing.value, input.value) &&
    sameValue(existing.sourceAsOf, input.sourceAsOf)
  );
}

export function createRepositories(
  database: RepositoryDatabaseHandle,
): Repositories {
  const repository: Repositories = {
    dataSources: {
      async persist(input) {
        const inserted = await database
          .insert(dataSources)
          .values(input)
          .onConflictDoNothing({
            target: [dataSources.provider, dataSources.name],
          })
          .returning({ id: dataSources.id });

        const insertedRow = inserted[0];
        if (insertedRow) {
          return { status: "inserted", id: insertedRow.id };
        }

        const existing = (
          await database
            .select()
            .from(dataSources)
            .where(
              and(
                eq(dataSources.provider, input.provider),
                eq(dataSources.name, input.name),
              ),
            )
            .limit(1)
        )[0];

        if (!existing) {
          throw new Error(
            "Data source conflict occurred but the existing row could not be loaded",
          );
        }

        return sameDataSource(existing, input)
          ? { status: "duplicate", id: existing.id }
          : { status: "conflict", conflict: "data-source-metadata" };
      },
    },
    companies: {
      async findExistingByCik(cik) {
        const canonicalCik = normalizeSecCik(cik);
        const row = (
          await database
            .select({ id: companies.id, cik: companies.cik })
            .from(companies)
            .where(eq(companies.cik, canonicalCik))
            .limit(1)
        )[0];
        return row ? { ...row, cik: row.cik! } : undefined;
      },
    },
    secQueries: {
      async findCompanyByCik(cik) {
        const canonicalCik = normalizeSecCik(cik);
        const row = (
          await database
            .select({
              id: companies.id,
              cik: companies.cik,
              legalName: companies.legalName,
            })
            .from(companies)
            .where(eq(companies.cik, canonicalCik))
            .limit(1)
        )[0];
        return row ? { ...row, cik: row.cik! } : undefined;
      },
      async listFilings(input) {
        return database
          .select({
            accessionNumber: secFilings.accessionNumber,
            form: secFilings.form,
            filingDate: secFilings.filingDate,
            reportDate: secFilings.reportDate,
            primaryDocument: secFilings.primaryDocument,
            sourceUrl: secFilings.sourceUrl,
            fetchedAt: secFilings.fetchedAt,
            source: {
              provider: dataSources.provider,
              name: dataSources.name,
              baseUrl: dataSources.baseUrl,
            },
          })
          .from(secFilings)
          .innerJoin(dataSources, eq(secFilings.sourceId, dataSources.id))
          .where(eq(secFilings.companyId, input.companyId))
          .orderBy(desc(secFilings.filingDate), desc(secFilings.accessionNumber))
          .limit(input.limit);
      },
      async listFundamentalFacts(input) {
        const conditions = [
          eq(fundamentalFacts.companyId, input.companyId),
          input.taxonomy === undefined
            ? undefined
            : eq(fundamentalFacts.taxonomy, input.taxonomy),
          input.tag === undefined ? undefined : eq(fundamentalFacts.tag, input.tag),
          input.fiscalYear === undefined
            ? undefined
            : eq(fundamentalFacts.fiscalYear, input.fiscalYear),
          input.fiscalPeriod === undefined
            ? undefined
            : eq(fundamentalFacts.fiscalPeriod, input.fiscalPeriod),
          input.form === undefined ? undefined : eq(fundamentalFacts.form, input.form),
          input.reportingEnd === undefined
            ? undefined
            : eq(fundamentalFacts.reportingEnd, input.reportingEnd),
        ];
        return database
          .select({
            taxonomy: fundamentalFacts.taxonomy,
            tag: fundamentalFacts.tag,
            unit: fundamentalFacts.unit,
            value: fundamentalFacts.value,
            accessionNumber: fundamentalFacts.accessionNumber,
            form: fundamentalFacts.form,
            filingDate: fundamentalFacts.filingDate,
            reportingStart: fundamentalFacts.reportingStart,
            reportingEnd: fundamentalFacts.reportingEnd,
            fiscalYear: fundamentalFacts.fiscalYear,
            fiscalPeriod: fundamentalFacts.fiscalPeriod,
            frame: fundamentalFacts.frame,
            sourceAsOf: fundamentalFacts.sourceAsOf,
            fetchedAt: fundamentalFacts.fetchedAt,
            source: {
              provider: dataSources.provider,
              name: dataSources.name,
              baseUrl: dataSources.baseUrl,
            },
          })
          .from(fundamentalFacts)
          .innerJoin(dataSources, eq(fundamentalFacts.sourceId, dataSources.id))
          .where(and(...conditions))
          .orderBy(
            desc(fundamentalFacts.reportingEnd),
            desc(fundamentalFacts.filingDate),
            desc(fundamentalFacts.accessionNumber),
          )
          .limit(input.limit);
      },
    },
    mappingOnboarding: {
      async persistCompany(input) {
        const cik = normalizeSecCik(input.cik);
        const inserted = await database
          .insert(companies)
          .values({ cik, legalName: input.legalName, country: "US" })
          .onConflictDoNothing({ target: [companies.cik] })
          .returning({ id: companies.id });
        if (inserted[0]) return { status: "inserted", id: inserted[0].id };
        const existing = (
          await database
            .select()
            .from(companies)
            .where(eq(companies.cik, cik))
            .limit(1)
        )[0];
        if (!existing)
          throw new Error(
            "Company conflict occurred but existing row could not be loaded",
          );
        return existing.legalName === input.legalName
          ? { status: "duplicate", id: existing.id }
          : { status: "conflict", conflict: "company-identity" };
      },
      async persistInstrument(input) {
        const inserted = await database
          .insert(instruments)
          // Mapping-ledger eligibility, never this legacy broad instrument flag,
          // authorizes curated runtime support. Historical onboarding stays inert.
          .values({ ...input, active: false })
          .onConflictDoNothing({
            target: [instruments.symbol, instruments.exchange],
          })
          .returning({ id: instruments.id });
        if (inserted[0]) return { status: "inserted", id: inserted[0].id };
        const existing = (
          await database
            .select()
            .from(instruments)
            .where(
              and(
                eq(instruments.symbol, input.symbol),
                eq(instruments.exchange, input.exchange),
              ),
            )
            .limit(1)
        )[0];
        if (!existing)
          throw new Error(
            "Instrument conflict occurred but existing row could not be loaded",
          );
        return existing.companyId === input.companyId &&
          existing.name === input.name &&
          existing.assetType === input.assetType &&
          existing.currency === input.currency &&
          existing.country === input.country
          ? { status: "duplicate", id: existing.id }
          : { status: "conflict", conflict: "instrument-identity" };
      },
      async persistRevision(input) {
        const inserted = await database
          .insert(curatedStockMappingRevisions)
          .values(input)
          // Either immutable identity can collide. Inspect both instead of
          // treating a mapping/revision collision as an unexplained duplicate.
          .onConflictDoNothing()
          .returning({ id: curatedStockMappingRevisions.id });
        if (inserted[0]) return { status: "inserted" };
        const existing = (
          await database
            .select()
            .from(curatedStockMappingRevisions)
            .where(
              eq(curatedStockMappingRevisions.revisionId, input.revisionId),
            )
            .limit(1)
        )[0];
        if (!existing) {
          const existingMappingRevision = (
            await database
              .select()
              .from(curatedStockMappingRevisions)
              .where(
                and(
                  eq(curatedStockMappingRevisions.mappingId, input.mappingId),
                  eq(curatedStockMappingRevisions.revision, input.revision),
                ),
              )
              .limit(1)
          )[0];
          if (existingMappingRevision)
            return { status: "conflict", conflict: "mapping-revision" };
          throw new Error(
            "Mapping revision conflict occurred but existing rows could not be loaded",
          );
        }
        return existing.mappingId === input.mappingId &&
          existing.revision === input.revision &&
          existing.instrumentId === input.instrumentId &&
          existing.companyId === input.companyId &&
          existing.lifecycle === input.lifecycle &&
          existing.successorRevisionId === input.successorRevisionId &&
          existing.effectiveFrom.getTime() === input.effectiveFrom.getTime() &&
          (existing.effectiveTo?.getTime() ?? null) ===
            (input.effectiveTo?.getTime() ?? null) &&
          existing.changeReason === input.changeReason &&
          existing.listingEvidenceSourceId === input.listingEvidenceSourceId &&
          existing.listingEvidenceReference ===
            input.listingEvidenceReference &&
          existing.listingEvidenceRetrievedAt.getTime() ===
            input.listingEvidenceRetrievedAt.getTime() &&
          existing.secEvidenceSourceId === input.secEvidenceSourceId &&
          existing.secEvidenceReference === input.secEvidenceReference &&
          existing.secEvidenceRetrievedAt.getTime() ===
            input.secEvidenceRetrievedAt.getTime() &&
          existing.approvalStatus === input.approvalStatus &&
          existing.approvedBy === input.approvedBy &&
          existing.approvedAt.getTime() === input.approvedAt.getTime()
          ? { status: "duplicate" }
          : { status: "conflict", conflict: "mapping-revision" };
      },
      async persistLifecycleEvent(input) {
        const inserted = await database
          .insert(curatedStockMappingLifecycleEvents)
          .values(input)
          .onConflictDoNothing({
            target: [
              curatedStockMappingLifecycleEvents.revisionId,
              curatedStockMappingLifecycleEvents.lifecycle,
              curatedStockMappingLifecycleEvents.successorRevisionId,
              curatedStockMappingLifecycleEvents.effectiveFrom,
              curatedStockMappingLifecycleEvents.recordedAt,
            ],
          })
          .returning({ id: curatedStockMappingLifecycleEvents.id });
        if (inserted[0]) return { status: "inserted" };
        const existing = (
          await database
            .select()
            .from(curatedStockMappingLifecycleEvents)
            .where(
              and(
                eq(curatedStockMappingLifecycleEvents.revisionId, input.revisionId),
                eq(curatedStockMappingLifecycleEvents.lifecycle, input.lifecycle),
                input.successorRevisionId === null
                  ? isNull(
                      curatedStockMappingLifecycleEvents.successorRevisionId,
                    )
                  : eq(
                      curatedStockMappingLifecycleEvents.successorRevisionId,
                      input.successorRevisionId,
                    ),
                eq(
                  curatedStockMappingLifecycleEvents.effectiveFrom,
                  input.effectiveFrom,
                ),
                eq(
                  curatedStockMappingLifecycleEvents.recordedAt,
                  input.recordedAt,
                ),
              ),
            )
            .limit(1)
        )[0];
        return existing
          ? { status: "duplicate" }
          : { status: "conflict", conflict: "lifecycle-event" };
      },
    },
    secFilings: {
      async persist(input) {
        const inserted = await database
          .insert(secFilings)
          .values(input)
          .onConflictDoNothing({
            target: [secFilings.sourceId, secFilings.accessionNumber],
          })
          .returning({ id: secFilings.id });

        if (inserted.length > 0) return { status: "inserted" };

        const existing = (
          await database
            .select()
            .from(secFilings)
            .where(
              and(
                eq(secFilings.sourceId, input.sourceId),
                eq(secFilings.accessionNumber, input.accessionNumber),
              ),
            )
            .limit(1)
        )[0];

        if (!existing) {
          throw new Error(
            "SEC filing conflict occurred but the existing row could not be loaded",
          );
        }

        if (existing.companyId !== input.companyId) {
          return { status: "conflict", conflict: "filing-company" };
        }

        return sameFiling(existing, input)
          ? { status: "duplicate" }
          : { status: "conflict", conflict: "filing-metadata" };
      },
    },
    fundamentalFacts: {
      async persist(input) {
        const identity = fundamentalFactIdentity(input);

        const inserted = await database
          .insert(fundamentalFacts)
          .values(input)
          .onConflictDoNothing({
            target: [
              fundamentalFacts.companyId,
              fundamentalFacts.sourceId,
              fundamentalFacts.taxonomy,
              fundamentalFacts.tag,
              fundamentalFacts.unit,
              fundamentalFacts.accessionNumber,
              fundamentalFacts.form,
              fundamentalFacts.filingDate,
              fundamentalFacts.reportingStart,
              fundamentalFacts.reportingEnd,
              fundamentalFacts.fiscalYear,
              fundamentalFacts.fiscalPeriod,
              fundamentalFacts.frame,
            ],
          })
          .returning({ id: fundamentalFacts.id });

        if (inserted.length > 0) return { status: "inserted" };

        const existing = (
          await database
            .select()
            .from(fundamentalFacts)
            .where(
              and(
                eq(fundamentalFacts.companyId, identity.companyId),
                eq(fundamentalFacts.sourceId, identity.sourceId),
                eq(fundamentalFacts.taxonomy, identity.taxonomy),
                eq(fundamentalFacts.tag, identity.tag),
                eq(fundamentalFacts.unit, identity.unit),
                eq(fundamentalFacts.accessionNumber, identity.accessionNumber),
                eq(fundamentalFacts.form, identity.form),
                eq(fundamentalFacts.filingDate, identity.filingDate),
                identity.reportingStart === null
                  ? isNull(fundamentalFacts.reportingStart)
                  : eq(
                      fundamentalFacts.reportingStart,
                      identity.reportingStart,
                    ),
                eq(fundamentalFacts.reportingEnd, identity.reportingEnd),
                identity.fiscalYear === null
                  ? isNull(fundamentalFacts.fiscalYear)
                  : eq(fundamentalFacts.fiscalYear, identity.fiscalYear),
                identity.fiscalPeriod === null
                  ? isNull(fundamentalFacts.fiscalPeriod)
                  : eq(fundamentalFacts.fiscalPeriod, identity.fiscalPeriod),
                identity.frame === null
                  ? isNull(fundamentalFacts.frame)
                  : eq(fundamentalFacts.frame, identity.frame),
              ),
            )
            .limit(1)
        )[0];

        if (!existing) {
          throw new Error(
            "Fundamental fact conflict occurred but the existing row could not be loaded",
          );
        }

        if (sameFactCanonicalValue(existing, input)) {
          return { status: "duplicate" };
        }

        await database
          .update(fundamentalFacts)
          .set(fundamentalFactCorrection(input))
          .where(eq(fundamentalFacts.id, existing.id));

        return { status: "updated" };
      },
    },
    ingestionRecords: {
      async start(input) {
        const started = await database
          .insert(ingestionRecords)
          .values({
            sourceId: input.sourceId,
            resourceType: input.resourceType,
            resourceKey: input.resourceKey,
            status: "started",
            startedAt: input.startedAt,
            completedAt: null,
            sourceAsOf: null,
            fetchedAt: null,
            errorCode: null,
            errorMessage: null,
            metadata: input.metadata,
          })
          .returning({ id: ingestionRecords.id });

        const startedRow = started[0];
        if (!startedRow) {
          throw new Error("Ingestion record insert did not return an id");
        }

        return { status: "started", id: startedRow.id };
      },

      async complete(input) {
        const completed = await database
          .update(ingestionRecords)
          .set({
            status: "completed",
            completedAt: input.completedAt,
            sourceAsOf: input.sourceAsOf,
            fetchedAt: input.fetchedAt,
            errorCode: null,
            errorMessage: null,
            metadata: input.metadata,
          })
          .where(
            and(
              eq(ingestionRecords.id, input.id),
              eq(ingestionRecords.status, "started"),
            ),
          )
          .returning({ id: ingestionRecords.id });

        const completedRow = completed[0];
        if (!completedRow) {
          throw new Error(
            "Ingestion record must exist and be started before completion",
          );
        }

        return { status: "completed", id: completedRow.id };
      },

      async fail(input) {
        const failed = await database
          .update(ingestionRecords)
          .set({
            status: "failed",
            completedAt: input.completedAt,
            sourceAsOf: input.sourceAsOf,
            fetchedAt: input.fetchedAt,
            errorCode: input.errorCode,
            errorMessage: input.errorMessage,
            metadata: input.metadata,
          })
          .where(
            and(
              eq(ingestionRecords.id, input.id),
              eq(ingestionRecords.status, "started"),
            ),
          )
          .returning({ id: ingestionRecords.id });

        const failedRow = failed[0];
        if (!failedRow) {
          throw new Error(
            "Ingestion record must exist and be started before failure",
          );
        }

        return { status: "failed", id: failedRow.id };
      },
    },

    withTransaction(operation) {
      return database.transaction((transaction) =>
        operation(createRepositories(transaction)),
      );
    },
  };
  return repository;
}
