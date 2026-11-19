import type { Repositories } from "@ump/db";
import {
  validateCuratedStockMappingRegistry,
  type CuratedStockMappingRegistry,
  type CuratedUsStockMappingRevision,
} from "./curated-stock-mapping-registry";

export class CuratedStockMappingOnboardingError extends Error {
  constructor(
    public readonly code: "INVALID_REGISTRY" | "PERSISTENCE_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "CuratedStockMappingOnboardingError";
  }
}

export interface CuratedStockMappingOnboardingDependencies {
  repositories: Repositories;
}
export interface CuratedStockMappingOnboardingResult {
  inserted: number;
  duplicate: number;
}

/** Explicit, provider-free batch onboarding. Callers own when (and whether) it runs. */
export class CuratedStockMappingOnboardingService {
  constructor(
    private readonly dependencies: CuratedStockMappingOnboardingDependencies,
  ) {}

  async onboard(
    registry: CuratedStockMappingRegistry,
  ): Promise<CuratedStockMappingOnboardingResult> {
    const validation = validateCuratedStockMappingRegistry(registry);
    if (!validation.ok)
      throw new CuratedStockMappingOnboardingError(
        "INVALID_REGISTRY",
        validation.errors.map((item) => item.code).join(", "),
      );
    const eligible = registry.revisions.filter(
      (revision) =>
        revision.lifecycle === "active" &&
        revision.approval.status === "approved",
    );
    return this.dependencies.repositories.withTransaction(
      async (repositories) => {
        let inserted = 0;
        let duplicate = 0;
        for (const revision of eligible) {
          const result = await this.persist(repositories, revision);
          if (result === "inserted") inserted += 1;
          else duplicate += 1;
        }
        return { inserted, duplicate };
      },
    );
  }

  private async persist(
    repositories: Repositories,
    revision: CuratedUsStockMappingRevision,
  ): Promise<"inserted" | "duplicate"> {
    const listingSource = await repositories.dataSources.persist({
      provider: revision.exchangeListingEvidence.source,
      name: revision.exchangeListingEvidence.source,
      baseUrl: null,
      isDelayed: false,
    });
    const secSource = await repositories.dataSources.persist({
      provider: revision.secCompanyEvidence.source,
      name: revision.secCompanyEvidence.source,
      baseUrl: null,
      isDelayed: false,
    });
    if (listingSource.status === "conflict" || secSource.status === "conflict")
      throw new CuratedStockMappingOnboardingError(
        "PERSISTENCE_CONFLICT",
        "Evidence source metadata conflicts with an existing source.",
      );
    const company = await repositories.mappingOnboarding.persistCompany({
      cik: revision.company.cik,
      legalName: revision.company.legalName,
    });
    if (company.status === "conflict")
      throw new CuratedStockMappingOnboardingError(
        "PERSISTENCE_CONFLICT",
        "Company identity conflicts with an existing company.",
      );
    const instrument = await repositories.mappingOnboarding.persistInstrument({
      companyId: company.id,
      symbol: revision.instrument.symbol,
      exchange: revision.instrument.exchange,
      name: revision.instrument.name,
      assetType: "stock",
      currency: "USD",
      country: "US",
    });
    if (instrument.status === "conflict")
      throw new CuratedStockMappingOnboardingError(
        "PERSISTENCE_CONFLICT",
        "Instrument identity conflicts with an existing instrument.",
      );
    const ledger = await repositories.mappingOnboarding.persistRevision({
      mappingId: revision.mappingId,
      revision: revision.revision,
      revisionId: revision.revisionId,
      instrumentId: instrument.id,
      companyId: company.id,
      lifecycle: revision.lifecycle,
      successorRevisionId: revision.successorRevisionId ?? null,
      effectiveFrom: new Date(revision.effectiveFrom),
      effectiveTo: revision.effectiveTo ? new Date(revision.effectiveTo) : null,
      changeReason: revision.changeReason,
      listingEvidenceSourceId: listingSource.id,
      listingEvidenceReference: revision.exchangeListingEvidence.reference,
      listingEvidenceRetrievedAt: new Date(
        revision.exchangeListingEvidence.retrievedAt,
      ),
      secEvidenceSourceId: secSource.id,
      secEvidenceReference: revision.secCompanyEvidence.reference,
      secEvidenceRetrievedAt: new Date(revision.secCompanyEvidence.retrievedAt),
      approvalStatus: "approved",
      approvedBy: revision.approval.approvedBy,
      approvedAt: new Date(revision.approval.approvedAt),
    });
    if (ledger.status === "conflict")
      throw new CuratedStockMappingOnboardingError(
        "PERSISTENCE_CONFLICT",
        "Mapping revision conflicts with an existing immutable revision.",
      );
    return ledger.status;
  }
}
