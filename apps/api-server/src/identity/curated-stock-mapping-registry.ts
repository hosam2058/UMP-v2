import { normalizeSecCik } from "@ump/db";
import {
  validateCuratedSecSupportedStockMappings,
  type CuratedSecSupportedStockMapping,
  type ValidatedCuratedSecSupportedStockMapping,
} from "./sec-supported-mappings";

/** Incremented because lifecycle observations are now explicit source data. */
export const CURATED_STOCK_MAPPING_REGISTRY_VERSION = 2;
export const SUPPORTED_US_STOCK_EXCHANGES = ["XNAS", "XNYS"] as const;
export type CuratedStockMappingLifecycle = "active" | "retired" | "superseded";
export type CuratedStockMappingApprovalStatus = "approved" | "pending" | "rejected";
export interface CuratedStockMappingEvidence { source: string; reference: string; retrievedAt: string; }
export interface CuratedUsStockMappingRevision {
  mappingId: string; revision: number; revisionId: string; effectiveFrom: string; effectiveTo?: string; changeReason: string;
  /** Immutable state on initial entry. Later state belongs in lifecycleEvents. */
  lifecycle: "active"; successorRevisionId?: never;
  instrument: { symbol: string; exchange: string; name: string; assetType: "stock"; currency: "USD"; listingCountry: "US" };
  company: { cik: string; legalName: string };
  exchangeListingEvidence: CuratedStockMappingEvidence; secCompanyEvidence: CuratedStockMappingEvidence;
  approval: { status: CuratedStockMappingApprovalStatus; approvedBy: string; approvedAt: string };
}
/** Later append-only transition. recordedAt is supplied independently of effectiveFrom. */
export interface CuratedStockMappingLifecycleEvent {
  revisionId: string; lifecycle: "retired" | "superseded"; successorRevisionId?: string;
  effectiveFrom: string; recordedAt: string;
}
export interface CuratedStockMappingRegistry {
  version: typeof CURATED_STOCK_MAPPING_REGISTRY_VERSION;
  revisions: readonly CuratedUsStockMappingRevision[];
  lifecycleEvents: readonly CuratedStockMappingLifecycleEvent[];
}
export type CuratedStockMappingRegistryValidationCode =
  | "INVALID_REGISTRY_VERSION" | "MISSING_REQUIRED_FIELD" | "INVALID_REVISION_IDENTIFIER"
  | "INVALID_EFFECTIVE_DATE" | "INVALID_LIFECYCLE" | "INVALID_SUCCESSOR"
  | "INVALID_STOCK_SCOPE" | "UNSUPPORTED_EXCHANGE" | "INVALID_EVIDENCE"
  | "INVALID_COMPANY_IDENTITY" | "INVALID_REVISION_CHAIN" | "DUPLICATE_REVISION_ID"
  | "DUPLICATE_ACTIVE_MAPPING" | "INVALID_LIFECYCLE_EVENT"
  | "CONFLICTING_COMPANY_IDENTITY" | "CONFLICTING_INSTRUMENT_IDENTITY";
export interface CuratedStockMappingRegistryValidationError { index: number; code: CuratedStockMappingRegistryValidationCode; message: string; }
export type CuratedStockMappingRegistryValidationResult = { ok: true; registry: CuratedStockMappingRegistry } | { ok: false; errors: readonly CuratedStockMappingRegistryValidationError[] };
export type CuratedStockMappingRuntimeEligibilityResult = { ok: true; mappings: readonly ValidatedCuratedSecSupportedStockMapping[] } | { ok: false; errors: readonly CuratedStockMappingRegistryValidationError[] };

const IDENTIFIER = /^[a-z][a-z0-9-]{2,63}$/;
const REVISION_IDENTIFIER = /^[a-z][a-z0-9-]{2,63}@(?:[1-9][0-9]*)$/;
const present = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const error = (index: number, code: CuratedStockMappingRegistryValidationCode, message: string): CuratedStockMappingRegistryValidationError => ({ index, code, message });
const identity = (record: CuratedUsStockMappingRevision) => `${record.instrument.symbol.trim().toUpperCase()}\\0${record.instrument.exchange.trim().toUpperCase()}`;
function evidence(value: CuratedStockMappingEvidence | undefined, label: string, index: number, errors: CuratedStockMappingRegistryValidationError[]) {
  if (!present(value?.source) || !present(value?.reference) || !timestamp(value?.retrievedAt)) errors.push(error(index, "INVALID_EVIDENCE", `${label} requires source, reference, and a valid retrieval timestamp.`));
}

/** Deterministic current state after valid transitions, ordered as in source control. */
export function effectiveCuratedStockMappingLifecycles(registry: CuratedStockMappingRegistry): ReadonlyMap<string, CuratedStockMappingLifecycle> {
  const states = new Map<string, CuratedStockMappingLifecycle>(
    registry.revisions.map((revision) => [revision.revisionId, revision.lifecycle]),
  );
  for (const event of registry.lifecycleEvents) states.set(event.revisionId, event.lifecycle);
  return states;
}

/** Validates immutable revisions separately from later append-only transitions. */
export function validateCuratedStockMappingRegistry(registry: CuratedStockMappingRegistry): CuratedStockMappingRegistryValidationResult {
  const errors: CuratedStockMappingRegistryValidationError[] = [];
  if (registry?.version !== CURATED_STOCK_MAPPING_REGISTRY_VERSION) errors.push(error(-1, "INVALID_REGISTRY_VERSION", `Registry version must be ${CURATED_STOCK_MAPPING_REGISTRY_VERSION}.`));
  if (!Array.isArray(registry?.revisions) || !Array.isArray(registry?.lifecycleEvents)) {
    errors.push(error(-1, "MISSING_REQUIRED_FIELD", "Registry revisions and lifecycleEvents must be arrays."));
    return { ok: false, errors };
  }
  const ids = new Map<string, number>();
  const byMapping = new Map<string, Array<{ record: CuratedUsStockMappingRevision; index: number }>>();
  const companyNames = new Map<string, string>();
  const instrumentCompanies = new Map<string, string>();
  registry.revisions.forEach((record, index) => {
    const fields: Array<[unknown, string]> = [[record?.mappingId, "mapping ID"], [record?.revisionId, "revision ID"], [record?.changeReason, "change reason"], [record?.instrument?.symbol, "instrument symbol"], [record?.instrument?.exchange, "instrument exchange"], [record?.instrument?.name, "instrument name"], [record?.company?.cik, "company CIK"], [record?.company?.legalName, "company legal name"], [record?.approval?.approvedBy, "approval reviewer"], [record?.approval?.approvedAt, "approval timestamp"]];
    for (const [value, label] of fields) if (!present(value)) errors.push(error(index, "MISSING_REQUIRED_FIELD", `${label} is required.`));
    if (!record || !IDENTIFIER.test(record.mappingId) || !REVISION_IDENTIFIER.test(record.revisionId) || record.revisionId !== `${record.mappingId}@${record.revision}` || !Number.isSafeInteger(record.revision) || record.revision < 1) errors.push(error(index, "INVALID_REVISION_IDENTIFIER", "mappingId, positive revision, and revisionId '<mappingId>@<revision>' must agree."));
    if (!timestamp(record?.effectiveFrom) || (record.effectiveTo !== undefined && !timestamp(record.effectiveTo)) || (record.effectiveTo && Date.parse(record.effectiveTo) < Date.parse(record.effectiveFrom))) errors.push(error(index, "INVALID_EFFECTIVE_DATE", "Effective dates must be valid and effectiveTo cannot precede effectiveFrom."));
    if (record?.lifecycle !== "active" || record?.successorRevisionId !== undefined) errors.push(error(index, "INVALID_LIFECYCLE", "A revision starts active; later retirement or supersession must be a lifecycle event."));
    if (record?.instrument?.assetType !== "stock" || record?.instrument?.currency !== "USD" || record?.instrument?.listingCountry !== "US") errors.push(error(index, "INVALID_STOCK_SCOPE", "Registry scope is US-listed USD stocks only."));
    const exchange = record?.instrument?.exchange?.trim().toUpperCase();
    if (!SUPPORTED_US_STOCK_EXCHANGES.includes(exchange as (typeof SUPPORTED_US_STOCK_EXCHANGES)[number])) errors.push(error(index, "UNSUPPORTED_EXCHANGE", "Registry exchange must be XNAS or XNYS."));
    evidence(record?.exchangeListingEvidence, "Exchange listing evidence", index, errors);
    evidence(record?.secCompanyEvidence, "SEC company evidence", index, errors);
    let cik = "";
    try { cik = normalizeSecCik(record?.company?.cik as string); } catch { errors.push(error(index, "INVALID_COMPANY_IDENTITY", "Company CIK must contain one to ten decimal digits.")); }
    if (!timestamp(record?.approval?.approvedAt) || !["approved", "pending", "rejected"].includes(record?.approval?.status)) errors.push(error(index, "MISSING_REQUIRED_FIELD", "Approval status and timestamp must be valid."));
    if (record?.revisionId) { const prior = ids.get(record.revisionId); if (prior !== undefined) errors.push(error(index, "DUPLICATE_REVISION_ID", `Revision ID duplicates record at index ${prior}.`)); else ids.set(record.revisionId, index); }
    if (record?.mappingId) { const list = byMapping.get(record.mappingId) ?? []; list.push({ record, index }); byMapping.set(record.mappingId, list); }
    if (cik && present(record?.company?.legalName)) { const prior = companyNames.get(cik); if (prior !== undefined && prior !== record.company.legalName) errors.push(error(index, "CONFLICTING_COMPANY_IDENTITY", "A CIK cannot be assigned different legal names.")); else companyNames.set(cik, record.company.legalName); }
    if (cik && record?.instrument?.symbol && record?.instrument?.exchange) { const key = identity(record); const prior = instrumentCompanies.get(key); if (prior !== undefined && prior !== cik) errors.push(error(index, "CONFLICTING_INSTRUMENT_IDENTITY", "An instrument identity cannot be reassigned to another company.")); else instrumentCompanies.set(key, cik); }
  });
  for (const records of byMapping.values()) { records.sort((a, b) => a.record.revision - b.record.revision); records.forEach(({ record, index }, position) => { if (record.revision !== position + 1) errors.push(error(index, "INVALID_REVISION_CHAIN", "Revisions for a mappingId must start at 1 and be contiguous.")); }); }
  const terminal = new Set<string>(); const successorTargets = new Set<string>(); const eventKeys = new Set<string>();
  registry.lifecycleEvents.forEach((event, index) => {
    const eventIndex = registry.revisions.length + index;
    if (!event || !present(event.revisionId) || !timestamp(event.effectiveFrom) || !timestamp(event.recordedAt) || (event.lifecycle !== "retired" && event.lifecycle !== "superseded") || ((event.lifecycle === "superseded") !== present(event.successorRevisionId))) { errors.push(error(eventIndex, "INVALID_LIFECYCLE_EVENT", "Lifecycle events require a revision, valid dates, and exactly one successor only for supersession.")); return; }
    const revisionIndex = ids.get(event.revisionId);
    if (revisionIndex === undefined) { errors.push(error(eventIndex, "INVALID_LIFECYCLE_EVENT", "Lifecycle event references an unknown revision.")); return; }
    const revision = registry.revisions[revisionIndex]!;
    if (Date.parse(event.effectiveFrom) < Date.parse(revision.effectiveFrom) || Date.parse(event.recordedAt) < Date.parse(event.effectiveFrom)) errors.push(error(eventIndex, "INVALID_EFFECTIVE_DATE", "Lifecycle events cannot predate their revision and recordedAt cannot predate effectiveFrom."));
    const key = `${event.revisionId}\\0${event.lifecycle}\\0${event.successorRevisionId ?? ""}\\0${event.effectiveFrom}\\0${event.recordedAt}`;
    if (eventKeys.has(key) || terminal.has(event.revisionId)) errors.push(error(eventIndex, "INVALID_LIFECYCLE_EVENT", "A revision may have one terminal lifecycle transition."));
    eventKeys.add(key); terminal.add(event.revisionId);
    if (event.lifecycle === "superseded") {
      const successorIndex = ids.get(event.successorRevisionId!); const successor = successorIndex === undefined ? undefined : registry.revisions[successorIndex];
      if (!successor || successor.mappingId !== revision.mappingId || successor.revision !== revision.revision + 1 || Date.parse(successor.effectiveFrom) < Date.parse(event.effectiveFrom) || successorTargets.has(successor.revisionId)) errors.push(error(eventIndex, "INVALID_SUCCESSOR", "Supersession must name the next revision of the same mapping exactly once."));
      successorTargets.add(event.successorRevisionId!);
    }
  });
  const states = effectiveCuratedStockMappingLifecycles(registry); const active = new Map<string, number>();
  registry.revisions.forEach((record, index) => { if (states.get(record.revisionId) === "active") { const key = identity(record); const prior = active.get(key); if (prior !== undefined) errors.push(error(index, "DUPLICATE_ACTIVE_MAPPING", `Active instrument identity duplicates record at index ${prior}.`)); else active.set(key, index); } });
  return errors.length ? { ok: false, errors } : { ok: true, registry };
}

/** Historical records remain inert unless their effective lifecycle is active and approval is explicit. */
export function validateCuratedStockMappingRuntimeEligibility(registry: CuratedStockMappingRegistry): CuratedStockMappingRuntimeEligibilityResult {
  const historical = validateCuratedStockMappingRegistry(registry); if (!historical.ok) return historical;
  const states = effectiveCuratedStockMappingLifecycles(registry);
  const projected: CuratedSecSupportedStockMapping[] = registry.revisions.filter((record) => states.get(record.revisionId) === "active" && record.approval.status === "approved").map((record) => ({ instrument: record.instrument, company: record.company, companyRelationship: { companyCik: record.company.cik }, mappingProvenance: record.exchangeListingEvidence, approval: record.approval, active: true }));
  const validated = validateCuratedSecSupportedStockMappings(projected);
  return validated.ok ? validated : { ok: false, errors: validated.errors.map((item) => error(item.index, "INVALID_COMPANY_IDENTITY", item.message)) };
}
