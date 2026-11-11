import {
  normalizeSecCik,
  type DataSourceInput,
  type FundamentalFactInput,
  type Repositories,
  type RepositoryWriteResult,
  type SecFilingInput,
} from "@ump/db";
import type {
  ExternalCompany,
  ExternalFundamentalFact,
  ExternalIdentifier,
  ExternalSecFiling,
} from "../domain/models";
import {
  ProviderError,
  type FilingsProvider,
  type FundamentalsProvider,
  type ProviderResult,
  type Provenance,
} from "../providers/contracts";

export type SecIngestionProvider = FundamentalsProvider & FilingsProvider;

const SEC_PROVIDER_NAME = "sec-edgar";
const SEC_API_BASE_URL = "https://data.sec.gov";
const SEC_ARCHIVES_BASE_URL = "https://www.sec.gov/Archives/edgar/data";

type SecProvenanceResource = "company" | "facts" | "filings";

/** Reviewed source metadata is supplied by composition; this module creates no defaults. */
export interface SecSourceDescriptor {
  name: string;
  baseUrl: string | null;
  isDelayed: boolean;
}

export interface Clock {
  now(): Date;
}

export interface SecIngestionDependencies {
  provider: SecIngestionProvider;
  repositories: Repositories;
  source: SecSourceDescriptor;
  clock: Clock;
}

export interface IngestionWriteCounts {
  inserted: number;
  duplicate: number;
  updated: number;
}

export interface SecIngestionResult {
  cik: string;
  companyId: string;
  ingestionRecordId: string;
  facts: IngestionWriteCounts;
  filings: IngestionWriteCounts;
}

export type SecIngestionErrorCode =
  | "SOURCE_CONFIGURATION_CONFLICT"
  | "SOURCE_DESCRIPTOR_INVALID"
  | "INVALID_PROVENANCE"
  | "COMPANY_NOT_FOUND"
  | "COMPANY_IDENTIFIER_MISMATCH"
  | "FACT_IDENTIFIER_MISMATCH"
  | "FILING_IDENTIFIER_MISMATCH"
  | "PERSISTENCE_CONFLICT";

export class SecIngestionError extends Error {
  constructor(
    public readonly code: SecIngestionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SecIngestionError";
  }
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function sameDate(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

function sourceUrlMatchesBase(sourceUrl: string, baseUrl: string): boolean {
  try {
    const source = new URL(sourceUrl);
    const base = new URL(baseUrl);

    if (
      source.protocol !== "https:" ||
      source.username !== "" ||
      source.password !== "" ||
      source.search !== "" ||
      source.hash !== "" ||
      source.origin !== base.origin
    ) return false;

    const basePath = base.pathname.replace(/\/+$/, "");
    return (
      basePath.length === 0 ||
      source.pathname === basePath ||
      source.pathname.startsWith(`${basePath}/`)
    );
  } catch {
    return false;
  }
}

function validateSourceDescriptor(source: SecSourceDescriptor): void {
  if (!source.name.trim()) {
    throw new SecIngestionError(
      "SOURCE_DESCRIPTOR_INVALID",
      "SEC source name must be non-empty.",
    );
  }

  if (source.baseUrl !== SEC_API_BASE_URL) {
    throw new SecIngestionError(
      "SOURCE_DESCRIPTOR_INVALID",
      "SEC source base URL must be the official SEC data API origin.",
    );
  }
}

function validateProvenance(
  provenance: Provenance,
  providerName: string,
  source: SecSourceDescriptor,
  cik: string,
  resource: SecProvenanceResource,
): void {
  if (providerName !== SEC_PROVIDER_NAME || provenance.provider !== SEC_PROVIDER_NAME) {
    throw new SecIngestionError(
      "INVALID_PROVENANCE",
      "SEC provenance provider does not match the configured provider.",
    );
  }

  if (!validDate(provenance.retrievedAt)) {
    throw new SecIngestionError(
      "INVALID_PROVENANCE",
      "SEC provenance retrievedAt must be a valid Date.",
    );
  }

  if (provenance.asOf !== null && !validDate(provenance.asOf)) {
    throw new SecIngestionError(
      "INVALID_PROVENANCE",
      "SEC provenance asOf must be null or a valid Date.",
    );
  }

  if (provenance.isDelayed !== source.isDelayed) {
    throw new SecIngestionError(
      "INVALID_PROVENANCE",
      "SEC provenance delay state does not match reviewed source metadata.",
    );
  }

  const expectedPath =
    resource === "facts"
      ? `/api/xbrl/companyfacts/CIK${cik}.json`
      : `/submissions/CIK${cik}.json`;
  if (
    typeof provenance.sourceUrl !== "string" ||
    provenance.sourceUrl.trim().length === 0 ||
    !sourceUrlMatchesBase(provenance.sourceUrl, SEC_API_BASE_URL) ||
    new URL(provenance.sourceUrl).pathname !== expectedPath
  ) {
    throw new SecIngestionError(
      "INVALID_PROVENANCE",
      "SEC provenance source URL does not match the requested SEC resource.",
    );
  }
}

function validateIdentifier(
  identifier: ExternalIdentifier,
  cik: string,
  errorCode:
    | "COMPANY_IDENTIFIER_MISMATCH"
    | "FACT_IDENTIFIER_MISMATCH"
    | "FILING_IDENTIFIER_MISMATCH",
  resource: string,
): void {
  if (identifier.scheme !== "cik" || identifier.value !== cik) {
    throw new SecIngestionError(
      errorCode,
      `${resource} CIK does not match the requested canonical CIK.`,
    );
  }
}

function validateCompany(
  result: ProviderResult<ExternalCompany>,
  cik: string,
): void {
  validateIdentifier(
    result.data.externalIdentifier,
    cik,
    "COMPANY_IDENTIFIER_MISMATCH",
    "SEC company",
  );
}

function validateFacts(
  result: ProviderResult<ExternalFundamentalFact[]>,
  cik: string,
): void {
  for (const fact of result.data) {
    validateIdentifier(
      fact.companyIdentifier,
      cik,
      "FACT_IDENTIFIER_MISMATCH",
      "SEC fundamental fact",
    );
  }
}

function validateFilings(
  result: ProviderResult<ExternalSecFiling[]>,
  cik: string,
): void {
  for (const filing of result.data) {
    validateIdentifier(
      filing.companyIdentifier,
      cik,
      "FILING_IDENTIFIER_MISMATCH",
      "SEC filing",
    );
    if (typeof filing.sourceUrl !== "string" || filing.sourceUrl.trim() === "") {
      throw new SecIngestionError(
        "INVALID_PROVENANCE",
        "SEC filing source URL must be non-empty.",
      );
    }

    const cikDigits = String(Number(cik));
    const accessionPath = filing.accessionNumber.replace(/-/g, "");
    const expectedArchivePath = filing.primaryDocument
      ? `${new URL(SEC_ARCHIVES_BASE_URL).pathname}/${cikDigits}/${accessionPath}/${filing.primaryDocument}`
      : null;
    const isArchiveUrl = expectedArchivePath !== null &&
      sourceUrlMatchesBase(filing.sourceUrl, SEC_ARCHIVES_BASE_URL) &&
      new URL(filing.sourceUrl).pathname === expectedArchivePath;
    const isOfficialSubmissionsReference = filing.primaryDocument === null &&
      sourceUrlMatchesBase(filing.sourceUrl, SEC_API_BASE_URL) &&
      new URL(filing.sourceUrl).pathname === `/submissions/CIK${cik}.json`;

    if (!isArchiveUrl && !isOfficialSubmissionsReference) {
      throw new SecIngestionError(
        "INVALID_PROVENANCE",
        "SEC filing URL must identify its official archive document or submissions API record.",
      );
    }
  }
}

function newCounts(): IngestionWriteCounts {
  return { inserted: 0, duplicate: 0, updated: 0 };
}

function recordWriteResult(
  result: RepositoryWriteResult,
  counts: IngestionWriteCounts,
  resource: string,
): void {
  if (result.status === "conflict") {
    throw new SecIngestionError(
      "PERSISTENCE_CONFLICT",
      `${resource} persistence conflict: ${result.conflict}.`,
    );
  }

  counts[result.status] += 1;
}

function sourceAsOf(provenances: readonly Provenance[]): Date | null {
  const first = provenances[0]?.asOf ?? null;
  if (!provenances.every((provenance) => sameDate(provenance.asOf, first))) {
    throw new SecIngestionError(
      "INVALID_PROVENANCE",
      "SEC provenance source-as-of timestamps are inconsistent.",
    );
  }
  return first;
}

function knownSourceAsOf(provenances: readonly Provenance[]): Date | null {
  if (provenances.length === 0) return null;
  const first = provenances[0]?.asOf ?? null;
  return provenances.every((provenance) => sameDate(provenance.asOf, first))
    ? first
    : null;
}

function latestRetrievedAt(provenances: readonly Provenance[]): Date | null {
  let latest: Date | null = null;
  for (const provenance of provenances) {
    if (!validDate(provenance.retrievedAt)) continue;
    if (
      latest === null ||
      provenance.retrievedAt.getTime() > latest.getTime()
    ) {
      latest = provenance.retrievedAt;
    }
  }
  return latest;
}

function provenanceMetadata(provenance: Provenance): Record<string, unknown> {
  return {
    provider: provenance.provider,
    retrievedAt: provenance.retrievedAt.toISOString(),
    asOf: provenance.asOf?.toISOString() ?? null,
    isDelayed: provenance.isDelayed,
    sourceUrl: provenance.sourceUrl ?? null,
  };
}

function errorAuditDetails(error: unknown): {
  errorCode: string;
  errorMessage: string;
} {
  if (error instanceof SecIngestionError) {
    return { errorCode: error.code, errorMessage: error.message };
  }

  if (error instanceof ProviderError) {
    return { errorCode: error.code, errorMessage: error.message };
  }

  if (error instanceof Error) {
    return {
      errorCode: "SEC_INGESTION_FAILURE",
      errorMessage: "SEC ingestion failed.",
    };
  }

  return {
    errorCode: "SEC_INGESTION_FAILURE",
    errorMessage: "SEC ingestion failed with a non-Error value.",
  };
}

function factInput(
  fact: ExternalFundamentalFact,
  companyId: string,
  sourceId: string,
  provenance: Provenance,
): FundamentalFactInput {
  return {
    companyId,
    sourceId,
    taxonomy: fact.taxonomy,
    tag: fact.tag,
    unit: fact.unit,
    value: fact.value,
    accessionNumber: fact.accessionNumber,
    form: fact.form,
    filingDate: fact.filingDate,
    reportingStart: fact.reportingStart,
    reportingEnd: fact.reportingEnd,
    fiscalYear: fact.fiscalYear,
    fiscalPeriod: fact.fiscalPeriod,
    frame: fact.frame,
    sourceAsOf: provenance.asOf,
    fetchedAt: provenance.retrievedAt,
  };
}

function filingInput(
  filing: ExternalSecFiling,
  companyId: string,
  sourceId: string,
  provenance: Provenance,
): SecFilingInput {
  return {
    companyId,
    sourceId,
    accessionNumber: filing.accessionNumber,
    form: filing.form,
    filingDate: filing.filingDate,
    reportDate: filing.reportDate,
    primaryDocument: filing.primaryDocument,
    sourceUrl: filing.sourceUrl,
    fetchedAt: provenance.retrievedAt,
  };
}

export class SecIngestionService {
  constructor(private readonly dependencies: SecIngestionDependencies) {}

  async ingest(cikInput: string): Promise<SecIngestionResult> {
    const cik = normalizeSecCik(cikInput);
    const { provider, repositories, source, clock } = this.dependencies;

    validateSourceDescriptor(source);

    const dataSource: DataSourceInput = {
      provider: provider.name,
      name: source.name,
      baseUrl: source.baseUrl,
      isDelayed: source.isDelayed,
    };
    const persistedSource = await repositories.dataSources.persist(dataSource);

    if (persistedSource.status === "conflict") {
      throw new SecIngestionError(
        "SOURCE_CONFIGURATION_CONFLICT",
        "SEC source configuration conflicts with persisted source metadata.",
      );
    }

    const started = await repositories.ingestionRecords.start({
      sourceId: persistedSource.id,
      resourceType: "sec-company-snapshot",
      resourceKey: cik,
      startedAt: clock.now(),
      metadata: { cik, provider: provider.name },
    });
    const provenances: Provenance[] = [];

    try {
      const company = await repositories.companies.findExistingByCik(cik);
      if (!company) {
        throw new SecIngestionError(
          "COMPANY_NOT_FOUND",
          "Existing company was not found for SEC CIK.",
        );
      }

      const companyResult = await provider.resolveCompanyByCik(cik);
      validateProvenance(
        companyResult.provenance,
        provider.name,
        source,
        cik,
        "company",
      );
      provenances.push(companyResult.provenance);
      validateCompany(companyResult, cik);

      const factsResult = await provider.getCompanyFactsByCik(cik);
      validateProvenance(
        factsResult.provenance,
        provider.name,
        source,
        cik,
        "facts",
      );
      provenances.push(factsResult.provenance);
      validateFacts(factsResult, cik);

      const filingsResult = await provider.getFilingsByCik(cik);
      validateProvenance(
        filingsResult.provenance,
        provider.name,
        source,
        cik,
        "filings",
      );
      provenances.push(filingsResult.provenance);
      validateFilings(filingsResult, cik);

      const operationSourceAsOf = sourceAsOf(provenances);
      const operationFetchedAt = latestRetrievedAt(provenances);

      return await repositories.withTransaction(async (transaction) => {
        const facts = newCounts();
        const filings = newCounts();

        for (const fact of factsResult.data) {
          recordWriteResult(
            await transaction.fundamentalFacts.persist(
              factInput(
                fact,
                company.id,
                persistedSource.id,
                factsResult.provenance,
              ),
            ),
            facts,
            "Fundamental fact",
          );
        }

        for (const filing of filingsResult.data) {
          recordWriteResult(
            await transaction.secFilings.persist(
              filingInput(
                filing,
                company.id,
                persistedSource.id,
                filingsResult.provenance,
              ),
            ),
            filings,
            "SEC filing",
          );
        }

        await transaction.ingestionRecords.complete({
          id: started.id,
          completedAt: clock.now(),
          sourceAsOf: operationSourceAsOf,
          fetchedAt: operationFetchedAt,
          metadata: {
            cik,
            company: provenanceMetadata(companyResult.provenance),
            facts: {
              ...facts,
              received: factsResult.data.length,
              provenance: provenanceMetadata(factsResult.provenance),
            },
            filings: {
              ...filings,
              received: filingsResult.data.length,
              provenance: provenanceMetadata(filingsResult.provenance),
            },
          },
        });

        return {
          cik,
          companyId: company.id,
          ingestionRecordId: started.id,
          facts,
          filings,
        };
      });
    } catch (error) {
      const audit = errorAuditDetails(error);

      try {
        await repositories.ingestionRecords.fail({
          id: started.id,
          completedAt: clock.now(),
          sourceAsOf: knownSourceAsOf(provenances),
          fetchedAt: latestRetrievedAt(provenances),
          errorCode: audit.errorCode,
          errorMessage: audit.errorMessage,
          metadata: { cik, provider: provider.name },
        });
      } catch {
        // The operation error is authoritative and must not be replaced by audit failure.
      }

      throw error;
    }
  }
}
