import { and, eq, isNull } from "drizzle-orm";
import type { createDatabase } from "./index";
import { companies, dataSources, fundamentalFacts, secFilings } from "./schema";

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
export interface Repositories {
  dataSources: {
    persist(input: DataSourceInput): Promise<RepositoryWriteResult>;
  };
  companies: {
    findExistingByCik(
      cik: string,
    ): Promise<{ id: string; cik: string | null } | undefined>;
  };
  secFilings: {
    persist(input: SecFilingInput): Promise<RepositoryWriteResult>;
  };
  fundamentalFacts: {
    persist(input: FundamentalFactInput): Promise<RepositoryWriteResult>;
  };
  withTransaction<T>(
    operation: (repositories: Repositories) => Promise<T>,
  ): Promise<T>;
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

        if (inserted.length > 0) return { status: "inserted" };

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
          ? { status: "duplicate" }
          : { status: "conflict", conflict: "data-source-metadata" };
      },
    },
    companies: {
      async findExistingByCik(cik) {
        const canonicalCik = normalizeSecCik(cik);
        return (
          await database
            .select({ id: companies.id, cik: companies.cik })
            .from(companies)
            .where(eq(companies.cik, canonicalCik))
            .limit(1)
        )[0];
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
    withTransaction(operation) {
      return database.transaction((transaction) =>
        operation(createRepositories(transaction)),
      );
    },
  };
  return repository;
}
