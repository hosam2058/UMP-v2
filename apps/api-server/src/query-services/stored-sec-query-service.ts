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
  reportingEnd?: string;
  limit?: number;
}

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
    const company = await this.resolveStoredCompany(cik);
    if (company.status !== "available") return company;
    const limit = validatedLimit(options.limit);
    if (limit === undefined)
      return { status: "invalid-input", reason: "INVALID_LIMIT" };
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
    const company = await this.resolveStoredCompany(cik);
    if (company.status !== "available") return company;
    const validation = this.validateFactFilter(filter);
    if (typeof validation === "string")
      return { status: "invalid-input", reason: validation };
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
  ): Promise<
    | StoredSecInstrumentResult
    | RuntimeAuthorizationResult
  > {
    if (!this.runtimeAuthorizer || !instrument)
      return {
        status: "unsupported",
        reason: "CURATED_MAPPING_RUNTIME_AUTHORIZATION_UNAVAILABLE",
      };
    return this.runtimeAuthorizer.resolve(instrument);
  }

  async getFilingsByInstrument(
    instrument: SupportedInstrumentIdentity,
    options: { limit?: number } = {},
  ): Promise<InstrumentCollectionResult<StoredSecFiling>> {
    const authorization = await this.getInstrumentAuthorization(instrument);
    if (authorization.status !== "available") return authorization;
    const limit = validatedLimit(options.limit);
    if (limit === undefined)
      return { status: "invalid-input", reason: "INVALID_LIMIT" };
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
    filter: StoredFundamentalFactFilter = {},
  ): Promise<InstrumentCollectionResult<StoredFundamentalFact>> {
    const authorization = await this.getInstrumentAuthorization(instrument);
    if (authorization.status !== "available") return authorization;
    const validation = this.validateFactFilter(filter);
    if (typeof validation === "string")
      return { status: "invalid-input", reason: validation };
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
  ): Promise<RuntimeAuthorizationResult | StoredSecInstrumentResult> {
    return this.getCompanyDataByInstrument(instrument);
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
    const limit = validatedLimit(filter.limit);
    if (limit === undefined) return "INVALID_LIMIT";
    return { ...filter, limit };
  }
}
