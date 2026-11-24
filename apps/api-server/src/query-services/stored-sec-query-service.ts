import { normalizeSecCik, type Repositories } from "@ump/db";
import type {
  CuratedMappingRuntimeAuthorizationService,
  RuntimeAuthorizationResult,
  SupportedInstrumentIdentity,
} from "../identity/curated-mapping-runtime-authorization";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1]!;
}

export type StoredSecQueryStatus = "available" | "invalid-input" | "not-found" | "unsupported";

export interface StoredSecCompany {
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

export interface StoredFundamentalFactFilter {
  taxonomy?: string;
  tag?: string;
  fiscalYear?: number;
  fiscalPeriod?: string;
  form?: string;
  /** Undefined means any interval; null explicitly selects instant facts. */
  reportingStart?: string | null;
  reportingEnd?: string;
  limit?: number;
}

export interface StoredFinancialReadinessOptions {
  filingLimit?: number;
  factFilter?: StoredFundamentalFactFilter;
  asOf?: Date;
}

export type StoredDatasetAvailability = "empty" | "available" | "requested-data-missing";
export type StoredProvenanceStatus = "not-applicable" | "complete" | "incomplete";

export interface StoredDatasetReadiness<T> {
  availability: StoredDatasetAvailability;
  provenance: StoredProvenanceStatus;
  items: readonly T[];
  returnedCount: number;
  limit: number;
}

export interface StoredFinancialDataReadiness {
  status: "available";
  company: StoredSecCompany;
  mapping?: Extract<RuntimeAuthorizationResult, { status: "available" }>["authorization"]["mapping"];
  filings: StoredDatasetReadiness<StoredSecFiling>;
  fundamentals: StoredDatasetReadiness<StoredFundamentalFact> & {
    request?: Omit<StoredFundamentalFactFilter, "limit">;
  };
  freshness: {
    status: "unknown" | "not-applicable";
    reason: "FRESHNESS_POLICY_NOT_CONFIGURED" | "NO_STORED_FINANCIAL_DATA";
  };
}

type ReadinessInputError = { status: "invalid-input"; reason: string };
export type CompanyFinancialReadinessResult =
  | StoredFinancialDataReadiness
  | ReadinessInputError
  | { status: "not-found"; reason: "COMPANY_NOT_FOUND" };
export type InstrumentFinancialReadinessResult =
  | (StoredFinancialDataReadiness & { mapping: NonNullable<StoredFinancialDataReadiness["mapping"]> })
  | ReadinessInputError
  | AuthorizedInstrumentResult
  | StoredSecInstrumentResult;

type CompanyResult =
  | { status: "available"; company: StoredSecCompany }
  | { status: "invalid-input"; reason: "INVALID_CIK" }
  | { status: "not-found"; reason: "COMPANY_NOT_FOUND" };
type CollectionResult<T> =
  | { status: "available"; company: StoredSecCompany; items: readonly T[]; limit: number }
  | { status: "invalid-input"; reason: string }
  | { status: "not-found"; reason: "COMPANY_NOT_FOUND" };
export type StoredSecInstrumentResult = {
  status: "unsupported";
  reason: "CURATED_MAPPING_RUNTIME_AUTHORIZATION_UNAVAILABLE";
};
type AuthorizedInstrumentResult = Exclude<
  RuntimeAuthorizationResult,
  { status: "available" }
>;
type InstrumentCollectionResult<T> =
  | {
      status: "available";
      company: StoredSecCompany;
      mapping: Extract<RuntimeAuthorizationResult, { status: "available" }> ["authorization"]["mapping"];
      items: readonly T[];
      limit: number;
    }
  | AuthorizedInstrumentResult
  | { status: "invalid-input"; reason: string }
  | StoredSecInstrumentResult;

function nonBlank(value: string | undefined): boolean {
  return value === undefined || value.trim().length > 0;
}

function validatedLimit(value: number | undefined): number | undefined {
  const limit = value ?? DEFAULT_LIMIT;
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= MAX_LIMIT
    ? limit
    : undefined;
}

function validHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function hasValidSource(
  source: { provider: string; name: string; baseUrl: string | null } | null | undefined,
): boolean {
  return (
    source !== null &&
    source !== undefined &&
    typeof source === "object" &&
    typeof source.provider === "string" &&
    source.provider.trim().length > 0 &&
    typeof source.name === "string" &&
    source.name.trim().length > 0 &&
    (source.baseUrl === null ||
      (typeof source.baseUrl === "string" && validHttpsUrl(source.baseUrl)))
  );
}

function validDateValue(value: unknown): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function filingHasValidProvenance(filing: StoredSecFiling): boolean {
  return (
    validDateValue(filing.fetchedAt) &&
    hasValidSource(filing.source) &&
    validHttpsUrl(filing.sourceUrl)
  );
}

function factHasValidProvenance(fact: StoredFundamentalFact): boolean {
  return (
    validDateValue(fact.fetchedAt) &&
    (fact.sourceAsOf === null || validDateValue(fact.sourceAsOf)) &&
    hasValidSource(fact.source)
  );
}

function provenanceStatus<T>(
  items: readonly T[],
  isValid: (item: T) => boolean,
): StoredProvenanceStatus {
  if (items.length === 0) return "not-applicable";
  return items.every(isValid) ? "complete" : "incomplete";
}

/**
 * Read-only company-level SEC queries over already persisted canonical records.
 * It never contacts a provider and deliberately has no database write path.
 */
export class StoredSecQueryService {
  constructor(
    private readonly repositories: Repositories,
    private readonly runtimeAuthorizer?: CuratedMappingRuntimeAuthorizationService,
  ) {}

  async resolveCompanyByCik(cik: string): Promise<CompanyResult> {
    const company = await this.resolveStoredCompany(cik);
    if (company.status !== "available") return company;
    return {
      status: "available",
      company: { cik: company.company.cik, legalName: company.company.legalName },
    };
  }

  async getFilingsByCik(
    cik: string,
    options: { limit?: number } = {},
  ): Promise<CollectionResult<StoredSecFiling>> {
    const limit = validatedLimit(options.limit);
    if (limit === undefined)
      return { status: "invalid-input", reason: "INVALID_LIMIT" };
    const company = await this.resolveStoredCompany(cik);
    if (company.status !== "available") return company;
    const items = await this.repositories.secQueries.listFilings({
      companyId: company.company.id,
      limit,
    });
    return {
      status: "available",
      company: { cik: company.company.cik, legalName: company.company.legalName },
      items,
      limit,
    };
  }

  async getFundamentalFactsByCik(
    cik: string,
    filter: StoredFundamentalFactFilter = {},
  ): Promise<CollectionResult<StoredFundamentalFact>> {
    const validation = this.validateFactFilter(filter);
    if (typeof validation === "string")
      return { status: "invalid-input", reason: validation };
    const company = await this.resolveStoredCompany(cik);
    if (company.status !== "available") return company;
    const items = await this.repositories.secQueries.listFundamentalFacts({
      companyId: company.company.id,
      ...validation,
    });
    return {
      status: "available",
      company: { cik: company.company.cik, legalName: company.company.legalName },
      items,
      limit: validation.limit,
    };
  }

  /**
   * Summarizes stored filing/fact coverage without inferring freshness. A
   * filtered miss is distinguished from an issuer with no stored facts.
   */
  async assessFinancialDataReadinessByCik(
    cik: string,
    options: StoredFinancialReadinessOptions = {},
  ): Promise<CompanyFinancialReadinessResult> {
    const validated = this.validateReadinessOptions(options);
    if (typeof validated === "string")
      return { status: "invalid-input", reason: validated };
    const company = await this.resolveStoredCompany(cik);
    if (company.status !== "available") return company;
    return this.loadFinancialDataReadiness(
      company.company.id,
      { cik: company.company.cik, legalName: company.company.legalName },
      validated,
    );
  }

  /** Readiness for an instrument is available only after normal authorization. */
  async assessFinancialDataReadinessByInstrument(
    instrument: SupportedInstrumentIdentity,
    options: StoredFinancialReadinessOptions = {},
  ): Promise<InstrumentFinancialReadinessResult> {
    const validated = this.validateReadinessOptions(options);
    if (typeof validated === "string")
      return { status: "invalid-input", reason: validated };
    const authorization = await this.getCompanyDataByInstrument(instrument, {
      asOf: options.asOf,
    });
    if (authorization.status !== "available") return authorization;
    const readiness = await this.loadFinancialDataReadiness(
      authorization.authorization.company.id,
      {
        cik: authorization.authorization.company.cik,
        legalName: authorization.authorization.company.legalName,
      },
      validated,
    );
    return { ...readiness, mapping: authorization.authorization.mapping };
  }

  private async resolveStoredCompany(
    cik: string,
  ): Promise<
    | { status: "available"; company: { id: string; cik: string; legalName: string } }
    | { status: "invalid-input"; reason: "INVALID_CIK" }
    | { status: "not-found"; reason: "COMPANY_NOT_FOUND" }
  > {
    let canonicalCik: string;
    try {
      canonicalCik = normalizeSecCik(cik);
    } catch {
      return { status: "invalid-input", reason: "INVALID_CIK" };
    }
    const company =
      await this.repositories.secQueries.findCompanyByCik(canonicalCik);
    return company
      ? { status: "available", company }
      : { status: "not-found", reason: "COMPANY_NOT_FOUND" };
  }

  /**
   * A missing runtime authorizer remains fail-closed; ticker, instruments.active,
   * and persisted mappings alone are never authorization.
   */
  async getCompanyDataByInstrument(
    instrument?: SupportedInstrumentIdentity,
    options: { asOf?: Date } = {},
  ): Promise<
    | StoredSecInstrumentResult
    | RuntimeAuthorizationResult
  > {
    if (!this.runtimeAuthorizer || !instrument)
      return {
        status: "unsupported",
        reason: "CURATED_MAPPING_RUNTIME_AUTHORIZATION_UNAVAILABLE",
      };
    return this.runtimeAuthorizer.resolve(instrument, options);
  }

  async getFilingsByInstrument(
    instrument: SupportedInstrumentIdentity,
    options: { limit?: number; asOf?: Date } = {},
  ): Promise<InstrumentCollectionResult<StoredSecFiling>> {
    const limit = validatedLimit(options.limit);
    if (limit === undefined)
      return { status: "invalid-input", reason: "INVALID_LIMIT" };
    const authorization = await this.getInstrumentAuthorization(instrument, { asOf: options.asOf });
    if (authorization.status !== "available") return authorization;
    const items = await this.repositories.secQueries.listFilings({
      companyId: authorization.authorization.company.id,
      limit,
    });
    return {
      status: "available",
      company: authorization.authorization.company,
      mapping: authorization.authorization.mapping,
      items,
      limit,
    };
  }

  async getFundamentalFactsByInstrument(
    instrument: SupportedInstrumentIdentity,
    filter: StoredFundamentalFactFilter & { asOf?: Date } = {},
  ): Promise<InstrumentCollectionResult<StoredFundamentalFact>> {
    const { asOf, ...queryFilter } = filter;
    const validation = this.validateFactFilter(queryFilter);
    if (typeof validation === "string")
      return { status: "invalid-input", reason: validation };
    const authorization = await this.getInstrumentAuthorization(instrument, { asOf });
    if (authorization.status !== "available") return authorization;
    const items = await this.repositories.secQueries.listFundamentalFacts({
      companyId: authorization.authorization.company.id,
      ...validation,
    });
    return {
      status: "available",
      company: authorization.authorization.company,
      mapping: authorization.authorization.mapping,
      items,
      limit: validation.limit,
    };
  }

  private async getInstrumentAuthorization(
    instrument: SupportedInstrumentIdentity,
    options: { asOf?: Date } = {},
  ): Promise<RuntimeAuthorizationResult | StoredSecInstrumentResult> {
    return this.getCompanyDataByInstrument(instrument, options);
  }

  private validateFactFilter(
    filter: StoredFundamentalFactFilter,
  ):
    | {
        taxonomy?: string;
        tag?: string;
        fiscalYear?: number;
        fiscalPeriod?: string;
        form?: string;
        reportingEnd?: string;
        limit: number;
      }
  | string {
    if (!filter || typeof filter !== "object") return "INVALID_FILTER";
    if ((filter.taxonomy === undefined) !== (filter.tag === undefined))
      return "CONCEPT_REQUIRES_TAXONOMY_AND_TAG";
    if (
      !nonBlank(filter.taxonomy) ||
      !nonBlank(filter.tag) ||
      !nonBlank(filter.fiscalPeriod) ||
      !nonBlank(filter.form)
    )
      return "INVALID_FILTER";
    if (
      filter.fiscalYear !== undefined &&
      (!Number.isSafeInteger(filter.fiscalYear) || filter.fiscalYear < 0)
    )
      return "INVALID_FISCAL_YEAR";
    if (
      filter.reportingEnd !== undefined &&
      !isCalendarDate(filter.reportingEnd)
    )
      return "INVALID_REPORTING_END";
    if (
      filter.reportingStart !== undefined &&
      filter.reportingStart !== null &&
      !isCalendarDate(filter.reportingStart)
    )
      return "INVALID_REPORTING_START";
    if (
      typeof filter.reportingStart === "string" &&
      filter.reportingEnd !== undefined &&
      filter.reportingStart > filter.reportingEnd
    )
      return "INVALID_REPORTING_PERIOD";
    const limit = validatedLimit(filter.limit);
    if (limit === undefined) return "INVALID_LIMIT";
    return { ...filter, limit };
  }

  private validateReadinessOptions(
    options: StoredFinancialReadinessOptions,
  ):
    | {
        filingLimit: number;
        factFilter: StoredFundamentalFactFilter & { limit: number };
        request?: Omit<StoredFundamentalFactFilter, "limit">;
      }
    | string {
    if (!options || typeof options !== "object") return "INVALID_OPTIONS";
    if (
      options.asOf !== undefined &&
      (!(options.asOf instanceof Date) || !Number.isFinite(options.asOf.getTime()))
    )
      return "INVALID_AS_OF";
    const filingLimit = validatedLimit(options.filingLimit);
    if (filingLimit === undefined) return "INVALID_FILING_LIMIT";
    const rawFilter = options.factFilter ?? {};
    const factFilter = this.validateFactFilter(rawFilter);
    if (typeof factFilter === "string") return factFilter;
    const { limit: _limit, ...request } = rawFilter;
    const hasRequest = Object.values(request).some((value) => value !== undefined);
    return {
      filingLimit,
      factFilter,
      ...(hasRequest ? { request } : {}),
    };
  }

  private async loadFinancialDataReadiness(
    companyId: string,
    company: StoredSecCompany,
    options: {
      filingLimit: number;
      factFilter: StoredFundamentalFactFilter & { limit: number };
      request?: Omit<StoredFundamentalFactFilter, "limit">;
    },
  ): Promise<StoredFinancialDataReadiness> {
    const [filings, facts] = await Promise.all([
      this.repositories.secQueries.listFilings({
        companyId,
        limit: options.filingLimit,
      }),
      this.repositories.secQueries.listFundamentalFacts({
        companyId,
        ...options.factFilter,
      }),
    ]);

    let anyFactsExist = facts.length > 0;
    if (!anyFactsExist && options.request) {
      const existing = await this.repositories.secQueries.listFundamentalFacts({
        companyId,
        limit: 1,
      });
      anyFactsExist = existing.length > 0;
    }

    const requestedDataMissing =
      facts.length === 0 && anyFactsExist && options.request !== undefined;
    const filingsStatus = provenanceStatus(filings, filingHasValidProvenance);
    const factsStatus = provenanceStatus(facts, factHasValidProvenance);
    const hasStoredData = filings.length > 0 || anyFactsExist;

    return {
      status: "available",
      company,
      filings: {
        availability: filings.length === 0 ? "empty" : "available",
        provenance: filingsStatus,
        items: filings,
        returnedCount: filings.length,
        limit: options.filingLimit,
      },
      fundamentals: {
        availability: requestedDataMissing
          ? "requested-data-missing"
          : facts.length === 0
            ? "empty"
            : "available",
        provenance: factsStatus,
        items: facts,
        returnedCount: facts.length,
        limit: options.factFilter.limit,
        ...(options.request ? { request: options.request } : {}),
      },
      freshness: hasStoredData
        ? {
            status: "unknown",
            reason: "FRESHNESS_POLICY_NOT_CONFIGURED",
          }
        : { status: "not-applicable", reason: "NO_STORED_FINANCIAL_DATA" },
    };
  }
}
