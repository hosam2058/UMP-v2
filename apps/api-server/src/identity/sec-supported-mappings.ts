import { normalizeSecCik } from "@ump/db";

/**
 * A reviewed, curated entry in the narrow Phase 2 SEC-supported stock universe.
 * It is not an instruction to create database records or contact a provider.
 */
export interface CuratedSecSupportedStockMapping {
  instrument: {
    symbol: string;
    exchange: string;
    name: string;
    assetType: string;
    currency: string;
  };
  company: {
    cik: string;
    legalName: string;
  };
  /** Explicitly records the instrument -> company association for later persistence. */
  companyRelationship: {
    companyCik: string;
  };
  mappingProvenance: {
    source: string;
    reference: string;
    retrievedAt: string;
  };
  approval: {
    status: "approved" | "pending" | "rejected";
    approvedBy: string;
    approvedAt: string;
  };
  active: boolean;
}

export interface ValidatedCuratedSecSupportedStockMapping {
  instrument: {
    symbol: string;
    exchange: string;
    name: string;
    assetType: "stock";
    currency: string;
  };
  company: {
    cik: string;
    legalName: string;
  };
  companyRelationship: {
    companyCik: string;
  };
  mappingProvenance: CuratedSecSupportedStockMapping["mappingProvenance"];
  approval: CuratedSecSupportedStockMapping["approval"] & {
    status: "approved";
  };
  active: true;
}

export type MappingValidationCode =
  | "MISSING_REQUIRED_FIELD"
  | "INVALID_CIK"
  | "UNSUPPORTED_ASSET_TYPE"
  | "INVALID_INSTRUMENT_IDENTITY"
  | "INCONSISTENT_COMPANY_RELATIONSHIP"
  | "UNAPPROVED_MAPPING"
  | "INACTIVE_MAPPING"
  | "DUPLICATE_INSTRUMENT_IDENTITY"
  | "CONFLICTING_COMPANY_IDENTITY";

export interface MappingValidationError {
  index: number;
  code: MappingValidationCode;
  message: string;
}

export type MappingValidationResult =
  | { ok: true; mappings: readonly ValidatedCuratedSecSupportedStockMapping[] }
  | { ok: false; errors: readonly MappingValidationError[] };

const SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,31}$/;
const EXCHANGE = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;
const CURRENCY = /^[A-Z]{3}$/;

function required(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function normalizeRequired(value: string): string {
  return value.trim();
}

function error(
  index: number,
  code: MappingValidationCode,
  message: string,
): MappingValidationError {
  return { index, code, message };
}

function validateOne(
  mapping: CuratedSecSupportedStockMapping,
  index: number,
):
  | { mapping: ValidatedCuratedSecSupportedStockMapping }
  | { errors: MappingValidationError[] } {
  const errors: MappingValidationError[] = [];
  const instrument = mapping?.instrument;
  const company = mapping?.company;
  const relationship = mapping?.companyRelationship;
  const provenance = mapping?.mappingProvenance;
  const approval = mapping?.approval;

  const requiredFields: Array<[unknown, string]> = [
    [instrument?.symbol, "instrument symbol"],
    [instrument?.exchange, "instrument exchange"],
    [instrument?.name, "instrument name"],
    [instrument?.assetType, "instrument asset type"],
    [instrument?.currency, "instrument currency"],
    [company?.cik, "company CIK"],
    [company?.legalName, "company legal name"],
    [relationship?.companyCik, "company relationship CIK"],
    [provenance?.source, "mapping provenance source"],
    [provenance?.reference, "mapping provenance reference"],
    [approval?.approvedBy, "approval reviewer"],
    [approval?.approvedAt, "approval timestamp"],
  ];
  for (const [value, field] of requiredFields) {
    if (!required(value))
      errors.push(
        error(index, "MISSING_REQUIRED_FIELD", `${field} is required.`),
      );
  }
  if (errors.length > 0) return { errors };

  const symbol = normalizeRequired(instrument.symbol).toUpperCase();
  const exchange = normalizeRequired(instrument.exchange).toUpperCase();
  const currency = normalizeRequired(instrument.currency).toUpperCase();
  if (
    !SYMBOL.test(symbol) ||
    !EXCHANGE.test(exchange) ||
    !CURRENCY.test(currency)
  ) {
    errors.push(
      error(
        index,
        "INVALID_INSTRUMENT_IDENTITY",
        "Symbol, exchange, and currency must be canonical non-ambiguous identifiers.",
      ),
    );
  }
  if (normalizeRequired(instrument.assetType).toLowerCase() !== "stock") {
    errors.push(
      error(
        index,
        "UNSUPPORTED_ASSET_TYPE",
        "Only stock instruments are supported by the Phase 2 SEC mapping contract.",
      ),
    );
  }

  let cik: string | undefined;
  let relationshipCik: string | undefined;
  try {
    cik = normalizeSecCik(company.cik);
    relationshipCik = normalizeSecCik(relationship.companyCik);
  } catch {
    errors.push(
      error(
        index,
        "INVALID_CIK",
        "Company and relationship CIK values must contain one to ten decimal digits.",
      ),
    );
  }
  if (cik && relationshipCik && cik !== relationshipCik) {
    errors.push(
      error(
        index,
        "INCONSISTENT_COMPANY_RELATIONSHIP",
        "Instrument company relationship must reference the same canonical CIK as its company.",
      ),
    );
  }
  if (
    !validIsoTimestamp(provenance.retrievedAt) ||
    !validIsoTimestamp(approval.approvedAt)
  ) {
    errors.push(
      error(
        index,
        "MISSING_REQUIRED_FIELD",
        "Mapping provenance and approval timestamps must be valid dates.",
      ),
    );
  }
  if (approval.status !== "approved") {
    errors.push(
      error(
        index,
        "UNAPPROVED_MAPPING",
        "Only explicitly approved mappings are eligible for SEC support.",
      ),
    );
  }
  if (mapping.active !== true) {
    errors.push(
      error(
        index,
        "INACTIVE_MAPPING",
        "Only active mappings are eligible for SEC support.",
      ),
    );
  }
  if (errors.length > 0 || !cik || !relationshipCik) return { errors };

  return {
    mapping: {
      instrument: {
        symbol,
        exchange,
        name: normalizeRequired(instrument.name),
        assetType: "stock",
        currency,
      },
      company: { cik, legalName: normalizeRequired(company.legalName) },
      companyRelationship: { companyCik: relationshipCik },
      mappingProvenance: {
        ...provenance,
        source: normalizeRequired(provenance.source),
        reference: normalizeRequired(provenance.reference),
      },
      approval: {
        ...approval,
        status: "approved",
        approvedBy: normalizeRequired(approval.approvedBy),
      },
      active: true,
    },
  };
}

/** Validates a complete curated set atomically; any invalid entry rejects the set. */
export function validateCuratedSecSupportedStockMappings(
  mappings: readonly CuratedSecSupportedStockMapping[],
): MappingValidationResult {
  const errors: MappingValidationError[] = [];
  if (!Array.isArray(mappings)) {
    return {
      ok: false,
      errors: [
        error(-1, "MISSING_REQUIRED_FIELD", "Mappings must be an array."),
      ],
    };
  }
  const validated: ValidatedCuratedSecSupportedStockMapping[] = [];
  const instrumentIdentities = new Map<string, number>();
  const companiesByCik = new Map<
    string,
    { legalName: string; index: number }
  >();

  mappings.forEach((mapping, index) => {
    const result = validateOne(mapping, index);
    if ("errors" in result) {
      errors.push(...result.errors);
      return;
    }
    const validatedMapping = result.mapping;
    const identity = `${validatedMapping.instrument.symbol}\u0000${validatedMapping.instrument.exchange}`;
    const priorInstrument = instrumentIdentities.get(identity);
    if (priorInstrument !== undefined) {
      errors.push(
        error(
          index,
          "DUPLICATE_INSTRUMENT_IDENTITY",
          `Instrument identity duplicates mapping at index ${priorInstrument}.`,
        ),
      );
    } else {
      instrumentIdentities.set(identity, index);
    }

    const priorCompany = companiesByCik.get(validatedMapping.company.cik);
    if (
      priorCompany &&
      priorCompany.legalName !== validatedMapping.company.legalName
    ) {
      errors.push(
        error(
          index,
          "CONFLICTING_COMPANY_IDENTITY",
          `Company CIK conflicts with the legal name in mapping at index ${priorCompany.index}.`,
        ),
      );
    } else if (!priorCompany) {
      companiesByCik.set(validatedMapping.company.cik, {
        legalName: validatedMapping.company.legalName,
        index,
      });
    }
    validated.push(validatedMapping);
  });

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, mappings: validated };
}
