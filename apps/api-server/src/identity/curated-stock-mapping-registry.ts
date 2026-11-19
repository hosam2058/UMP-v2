import {
  validateCuratedSecSupportedStockMappings,
  type CuratedSecSupportedStockMapping,
  type ValidatedCuratedSecSupportedStockMapping,
} from "./sec-supported-mappings";

/** The source-controlled registry format. Increment only for a breaking format change. */
export const CURATED_STOCK_MAPPING_REGISTRY_VERSION = 1;
export const SUPPORTED_US_STOCK_EXCHANGES = ["XNAS", "XNYS"] as const;

export type CuratedStockMappingLifecycle = "active" | "retired" | "superseded";
export type CuratedStockMappingApprovalStatus =
  "approved" | "pending" | "rejected";

export interface CuratedStockMappingEvidence {
  source: string;
  reference: string;
  retrievedAt: string;
}

/** A complete historical revision. It is data only; it does not create persistence or provider work. */
export interface CuratedUsStockMappingRevision {
  mappingId: string;
  revision: number;
  revisionId: string;
  effectiveFrom: string;
  effectiveTo?: string;
  changeReason: string;
  lifecycle: CuratedStockMappingLifecycle;
  successorRevisionId?: string;
  instrument: {
    symbol: string;
    exchange: string;
    name: string;
    assetType: "stock";
    currency: "USD";
    listingCountry: "US";
  };
  company: { cik: string; legalName: string };
  /** Evidence that the symbol/exchange identifies this listing. */
  exchangeListingEvidence: CuratedStockMappingEvidence;
  /** SEC evidence corroborating the associated company CIK. */
  secCompanyEvidence: CuratedStockMappingEvidence;
  approval: {
    status: CuratedStockMappingApprovalStatus;
    approvedBy: string;
    approvedAt: string;
  };
}

export interface CuratedStockMappingRegistry {
  version: typeof CURATED_STOCK_MAPPING_REGISTRY_VERSION;
  revisions: readonly CuratedUsStockMappingRevision[];
}

export type CuratedStockMappingRegistryValidationCode =
  | "INVALID_REGISTRY_VERSION"
  | "MISSING_REQUIRED_FIELD"
  | "INVALID_REVISION_IDENTIFIER"
  | "INVALID_EFFECTIVE_DATE"
  | "INVALID_LIFECYCLE"
  | "INVALID_SUCCESSOR"
  | "INVALID_STOCK_SCOPE"
  | "UNSUPPORTED_EXCHANGE"
  | "INVALID_EVIDENCE"
  | "INVALID_COMPANY_IDENTITY"
  | "INVALID_REVISION_CHAIN"
  | "DUPLICATE_REVISION_ID"
  | "DUPLICATE_ACTIVE_MAPPING"
  | "AMBIGUOUS_SUCCESSOR";

export interface CuratedStockMappingRegistryValidationError {
  index: number;
  code: CuratedStockMappingRegistryValidationCode;
  message: string;
}

export type CuratedStockMappingRegistryValidationResult =
  | { ok: true; registry: CuratedStockMappingRegistry }
  | {
      ok: false;
      errors: readonly CuratedStockMappingRegistryValidationError[];
    };

export type CuratedStockMappingRuntimeEligibilityResult =
  | { ok: true; mappings: readonly ValidatedCuratedSecSupportedStockMapping[] }
  | {
      ok: false;
      errors: readonly CuratedStockMappingRegistryValidationError[];
    };

const IDENTIFIER = /^[a-z][a-z0-9-]{2,63}$/;
const REVISION_IDENTIFIER = /^[a-z][a-z0-9-]{2,63}@(?:[1-9][0-9]*)$/;

function present(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function error(
  index: number,
  code: CuratedStockMappingRegistryValidationCode,
  message: string,
): CuratedStockMappingRegistryValidationError {
  return { index, code, message };
}

function identity(revision: CuratedUsStockMappingRevision): string {
  return `${revision.instrument?.symbol?.trim().toUpperCase() ?? ""}\u0000${revision.instrument?.exchange?.trim().toUpperCase() ?? ""}`;
}

function validateEvidence(
  evidence: CuratedStockMappingEvidence | undefined,
  label: string,
  index: number,
  errors: CuratedStockMappingRegistryValidationError[],
): void {
  if (
    !present(evidence?.source) ||
    !present(evidence?.reference) ||
    !timestamp(evidence?.retrievedAt)
  ) {
    errors.push(
      error(
        index,
        "INVALID_EVIDENCE",
        `${label} requires source, reference, and a valid retrieval timestamp.`,
      ),
    );
  }
}

/**
 * Validates the complete revision history. Historical records need not be
 * currently approved or active, so this deliberately does not use runtime rules.
 */
export function validateCuratedStockMappingRegistry(
  registry: CuratedStockMappingRegistry,
): CuratedStockMappingRegistryValidationResult {
  const errors: CuratedStockMappingRegistryValidationError[] = [];
  if (registry?.version !== CURATED_STOCK_MAPPING_REGISTRY_VERSION) {
    errors.push(
      error(
        -1,
        "INVALID_REGISTRY_VERSION",
        `Registry version must be ${CURATED_STOCK_MAPPING_REGISTRY_VERSION}.`,
      ),
    );
  }
  if (!Array.isArray(registry?.revisions)) {
    errors.push(
      error(
        -1,
        "MISSING_REQUIRED_FIELD",
        "Registry revisions must be an array.",
      ),
    );
    return { ok: false, errors };
  }

  const revisionIds = new Map<string, number>();
  const recordsById = new Map<
    string,
    Array<{ revision: CuratedUsStockMappingRevision; index: number }>
  >();
  const activeIdentities = new Map<string, number>();
  const successorTargets = new Map<string, number>();

  registry.revisions.forEach((record, index) => {
    const requiredFields: Array<[unknown, string]> = [
      [record?.mappingId, "mapping ID"],
      [record?.revisionId, "revision ID"],
      [record?.changeReason, "change reason"],
      [record?.instrument?.symbol, "instrument symbol"],
      [record?.instrument?.name, "instrument name"],
      [record?.company?.cik, "company CIK"],
      [record?.company?.legalName, "company legal name"],
      [record?.approval?.approvedBy, "approval reviewer"],
      [record?.approval?.approvedAt, "approval timestamp"],
    ];
    for (const [value, label] of requiredFields)
      if (!present(value))
        errors.push(
          error(index, "MISSING_REQUIRED_FIELD", `${label} is required.`),
        );
    if (
      !record ||
      !IDENTIFIER.test(record.mappingId) ||
      !REVISION_IDENTIFIER.test(record.revisionId) ||
      record.revisionId !== `${record.mappingId}@${record.revision}` ||
      !Number.isSafeInteger(record.revision) ||
      record.revision < 1
    ) {
      errors.push(
        error(
          index,
          "INVALID_REVISION_IDENTIFIER",
          "mappingId, positive revision, and revisionId '<mappingId>@<revision>' must agree.",
        ),
      );
    }
    if (
      !timestamp(record?.effectiveFrom) ||
      (record.effectiveTo !== undefined && !timestamp(record.effectiveTo)) ||
      (record.effectiveTo &&
        Date.parse(record.effectiveTo) < Date.parse(record.effectiveFrom))
    ) {
      errors.push(
        error(
          index,
          "INVALID_EFFECTIVE_DATE",
          "Effective dates must be valid and effectiveTo cannot precede effectiveFrom.",
        ),
      );
    }
    if (
      record?.lifecycle !== "active" &&
      record?.lifecycle !== "retired" &&
      record?.lifecycle !== "superseded"
    )
      errors.push(
        error(
          index,
          "INVALID_LIFECYCLE",
          "Lifecycle must be active, retired, or superseded.",
        ),
      );
    if (
      (record?.lifecycle === "superseded") !==
      present(record?.successorRevisionId)
    )
      errors.push(
        error(
          index,
          "INVALID_SUCCESSOR",
          "Only a superseded revision must name exactly one successor.",
        ),
      );
    if (
      record?.instrument?.assetType !== "stock" ||
      record?.instrument?.currency !== "USD" ||
      record?.instrument?.listingCountry !== "US"
    )
      errors.push(
        error(
          index,
          "INVALID_STOCK_SCOPE",
          "Registry scope is US-listed USD stocks only.",
        ),
      );
    if (
      !SUPPORTED_US_STOCK_EXCHANGES.includes(
        record?.instrument?.exchange
          ?.trim()
          .toUpperCase() as (typeof SUPPORTED_US_STOCK_EXCHANGES)[number],
      )
    )
      errors.push(
        error(
          index,
          "UNSUPPORTED_EXCHANGE",
          "Registry exchange must be XNAS or XNYS.",
        ),
      );
    validateEvidence(
      record?.exchangeListingEvidence,
      "Exchange listing evidence",
      index,
      errors,
    );
    validateEvidence(
      record?.secCompanyEvidence,
      "SEC company evidence",
      index,
      errors,
    );
    if (
      !timestamp(record?.approval?.approvedAt) ||
      !["approved", "pending", "rejected"].includes(record?.approval?.status)
    )
      errors.push(
        error(
          index,
          "MISSING_REQUIRED_FIELD",
          "Approval status and timestamp must be valid.",
        ),
      );

    const previous = revisionIds.get(record?.revisionId);
    if (previous !== undefined)
      errors.push(
        error(
          index,
          "DUPLICATE_REVISION_ID",
          `Revision ID duplicates record at index ${previous}.`,
        ),
      );
    else if (record?.revisionId) revisionIds.set(record.revisionId, index);
    if (record?.mappingId) {
      const records = recordsById.get(record.mappingId) ?? [];
      records.push({ revision: record, index });
      recordsById.set(record.mappingId, records);
    }

    if (record?.lifecycle === "active") {
      const prior = activeIdentities.get(identity(record));
      if (prior !== undefined)
        errors.push(
          error(
            index,
            "DUPLICATE_ACTIVE_MAPPING",
            `Active instrument identity duplicates record at index ${prior}.`,
          ),
        );
      else activeIdentities.set(identity(record), index);
    }
    if (record?.successorRevisionId) {
      const prior = successorTargets.get(record.successorRevisionId);
      if (prior !== undefined)
        errors.push(
          error(
            index,
            "AMBIGUOUS_SUCCESSOR",
            `Successor is already named by record at index ${prior}.`,
          ),
        );
      else successorTargets.set(record.successorRevisionId, index);
    }
  });

  for (const records of recordsById.values()) {
    records.sort((a, b) => a.revision.revision - b.revision.revision);
    records.forEach(({ revision, index }, position) => {
      if (revision.revision !== position + 1)
        errors.push(
          error(
            index,
            "INVALID_REVISION_CHAIN",
            "Revisions for a mappingId must start at 1 and be contiguous.",
          ),
        );
      if (revision.lifecycle === "superseded") {
        const next = records[position + 1]?.revision;
        if (
          !next ||
          revision.successorRevisionId !== next.revisionId ||
          Date.parse(next.effectiveFrom) < Date.parse(revision.effectiveFrom)
        )
          errors.push(
            error(
              index,
              "INVALID_REVISION_CHAIN",
              "A superseded revision must lead to its next chronological revision.",
            ),
          );
      } else if (position !== records.length - 1) {
        errors.push(
          error(
            index,
            "INVALID_REVISION_CHAIN",
            "Only the final revision may be active or retired.",
          ),
        );
      }
    });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, registry };
}

/**
 * Selects only human-approved active records, then delegates final mapping
 * validation to the unchanged Task 4C-A contract.
 */
export function validateCuratedStockMappingRuntimeEligibility(
  registry: CuratedStockMappingRegistry,
): CuratedStockMappingRuntimeEligibilityResult {
  const historical = validateCuratedStockMappingRegistry(registry);
  if (!historical.ok) return historical;
  const candidates = registry.revisions.filter(
    (record) =>
      record.lifecycle === "active" && record.approval.status === "approved",
  );
  const projected: CuratedSecSupportedStockMapping[] = candidates.map(
    (record) => ({
      instrument: record.instrument,
      company: record.company,
      companyRelationship: { companyCik: record.company.cik },
      mappingProvenance: record.exchangeListingEvidence,
      approval: record.approval,
      active: true,
    }),
  );
  const validated = validateCuratedSecSupportedStockMappings(projected);
  if (validated.ok) return validated;
  return {
    ok: false,
    errors: validated.errors.map((item) =>
      error(item.index, "INVALID_COMPANY_IDENTITY", item.message),
    ),
  };
}
