import { normalizeSecCik, type Repositories } from "@ump/db";
import {
  effectiveCuratedStockMappingLifecycles,
  validateCuratedStockMappingRegistry,
  type CuratedStockMappingRegistry,
  type CuratedUsStockMappingRevision,
} from "./curated-stock-mapping-registry";

export interface SupportedInstrumentIdentity {
  symbol: string;
  exchange: string;
}

export interface AuthorizedInstrumentCompany {
  instrument: SupportedInstrumentIdentity & { id: string };
  company: { id: string; cik: string; legalName: string };
  mapping: {
    registryVersion: number;
    mappingId: string;
    revision: number;
    revisionId: string;
    lifecycle: "active";
    effectiveFrom: string;
    listingEvidence: { source: string; reference: string; retrievedAt: string };
    secCompanyEvidence: { source: string; reference: string; retrievedAt: string };
    approval: { approvedBy: string; approvedAt: string };
  };
}

export type RuntimeAuthorizationResult =
  | { status: "available"; authorization: AuthorizedInstrumentCompany }
  | { status: "invalid-input"; reason: "INVALID_INSTRUMENT_IDENTITY" | "INVALID_AS_OF" }
  | { status: "unsupported-instrument"; reason: "INSTRUMENT_NOT_IN_CURATED_REGISTRY" }
  | {
      status: "unauthorized-mapping";
      reason:
        | "PENDING_MAPPING"
        | "REJECTED_MAPPING"
        | "RETIRED_MAPPING"
        | "SUPERSEDED_MAPPING"
        | "FUTURE_EFFECTIVE_MAPPING"
        | "EXPIRED_MAPPING"
        | "PERSISTED_MAPPING_NOT_FOUND"
        | "PERSISTED_MAPPING_MISMATCH";
    }
  | {
      status: "authority-unavailable";
      reason: "CURATED_REGISTRY_UNAVAILABLE" | "INVALID_CURATED_REGISTRY";
    }
  | { status: "ambiguous"; reason: "AMBIGUOUS_CURATED_MAPPING" };

export interface CuratedMappingRuntimeAuthorizationOptions {
  asOf?: Date;
}

const SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,31}$/;
const EXCHANGE = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;

function normalizeIdentity(
  value: SupportedInstrumentIdentity,
): SupportedInstrumentIdentity | undefined {
  if (!value || typeof value.symbol !== "string" || typeof value.exchange !== "string")
    return undefined;
  const symbol = value.symbol.trim().toUpperCase();
  const exchange = value.exchange.trim().toUpperCase();
  return SYMBOL.test(symbol) && EXCHANGE.test(exchange) ? { symbol, exchange } : undefined;
}

function currentRevisionState(
  record: CuratedUsStockMappingRevision,
  registry: CuratedStockMappingRegistry,
  asOf: Date,
) {
  const lifecycle = effectiveCuratedStockMappingLifecycles(registry, asOf).get(
    record.revisionId,
  );
  if (Date.parse(record.effectiveFrom) > asOf.getTime()) return "future" as const;
  if (record.effectiveTo && asOf.getTime() >= Date.parse(record.effectiveTo))
    return "expired" as const;
  return lifecycle;
}

/**
 * Authorizes only source-controlled, approved registry entries that agree with
 * a persisted canonical instrument/company relation. It performs no writes.
 */
export class CuratedMappingRuntimeAuthorizationService {
  constructor(
    private readonly repositories: Repositories,
    private readonly registry: CuratedStockMappingRegistry | undefined,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async resolve(
    input: SupportedInstrumentIdentity,
    options: CuratedMappingRuntimeAuthorizationOptions = {},
  ): Promise<RuntimeAuthorizationResult> {
    const identity = normalizeIdentity(input);
    if (!identity)
      return { status: "invalid-input", reason: "INVALID_INSTRUMENT_IDENTITY" };
    const asOf = options.asOf ?? this.clock();
    if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime()))
      return { status: "invalid-input", reason: "INVALID_AS_OF" };
    if (!this.registry)
      return {
        status: "authority-unavailable",
        reason: "CURATED_REGISTRY_UNAVAILABLE",
      };

    const validation = validateCuratedStockMappingRegistry(this.registry);
    if (!validation.ok) {
      if (
        validation.errors.some((error) =>
          [
            "DUPLICATE_ACTIVE_MAPPING",
            "CONFLICTING_COMPANY_IDENTITY",
            "CONFLICTING_INSTRUMENT_IDENTITY",
          ].includes(error.code),
        )
      )
        return { status: "ambiguous", reason: "AMBIGUOUS_CURATED_MAPPING" };
      return {
        status: "authority-unavailable",
        reason: "INVALID_CURATED_REGISTRY",
      };
    }

    const matching = this.registry.revisions.filter(
      (record) =>
        record.instrument.symbol.trim().toUpperCase() === identity.symbol &&
        record.instrument.exchange.trim().toUpperCase() === identity.exchange,
    );
    if (matching.length === 0)
      return {
        status: "unsupported-instrument",
        reason: "INSTRUMENT_NOT_IN_CURATED_REGISTRY",
      };

    const active = matching.filter(
      (record) => currentRevisionState(record, this.registry!, asOf) === "active",
    );
    if (active.length > 1)
      return { status: "ambiguous", reason: "AMBIGUOUS_CURATED_MAPPING" };
    const candidate = active[0];
    if (!candidate) return this.explainInactiveMapping(matching, asOf);
    if (candidate.approval.status === "pending")
      return { status: "unauthorized-mapping", reason: "PENDING_MAPPING" };
    if (candidate.approval.status === "rejected")
      return { status: "unauthorized-mapping", reason: "REJECTED_MAPPING" };

    const persisted = await this.repositories.runtimeAuthorizations
      .findInstrumentCompanyByIdentity(identity);
    if (!persisted)
      return {
        status: "unauthorized-mapping",
        reason: "PERSISTED_MAPPING_NOT_FOUND",
      };
    let cik: string;
    try {
      cik = normalizeSecCik(candidate.company.cik);
    } catch {
      return { status: "authority-unavailable", reason: "INVALID_CURATED_REGISTRY" };
    }
    if (
      persisted.symbol !== identity.symbol ||
      persisted.exchange !== identity.exchange ||
      persisted.assetType !== "stock" ||
      persisted.currency !== "USD" ||
      persisted.country !== "US" ||
      persisted.company.cik !== cik ||
      persisted.company.legalName !== candidate.company.legalName
    )
      return {
        status: "unauthorized-mapping",
        reason: "PERSISTED_MAPPING_MISMATCH",
      };

    return {
      status: "available",
      authorization: {
        instrument: { id: persisted.instrumentId, ...identity },
        company: persisted.company,
        mapping: {
          registryVersion: this.registry.version,
          mappingId: candidate.mappingId,
          revision: candidate.revision,
          revisionId: candidate.revisionId,
          lifecycle: "active",
          effectiveFrom: candidate.effectiveFrom,
          listingEvidence: candidate.exchangeListingEvidence,
          secCompanyEvidence: candidate.secCompanyEvidence,
          approval: {
            approvedBy: candidate.approval.approvedBy,
            approvedAt: candidate.approval.approvedAt,
          },
        },
      },
    };
  }

  private explainInactiveMapping(
    matching: readonly CuratedUsStockMappingRevision[],
    asOf: Date,
  ): RuntimeAuthorizationResult {
    const state = matching.map((record) =>
      currentRevisionState(record, this.registry!, asOf),
    );
    if (state.includes("future"))
      return { status: "unauthorized-mapping", reason: "FUTURE_EFFECTIVE_MAPPING" };
    if (state.includes("retired"))
      return { status: "unauthorized-mapping", reason: "RETIRED_MAPPING" };
    if (state.includes("superseded"))
      return { status: "unauthorized-mapping", reason: "SUPERSEDED_MAPPING" };
    return { status: "unauthorized-mapping", reason: "EXPIRED_MAPPING" };
  }
}
