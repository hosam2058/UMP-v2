import assert from "node:assert/strict";
import test from "node:test";
import {
  CURATED_STOCK_MAPPING_REGISTRY_VERSION,
  effectiveCuratedStockMappingLifecycles,
  validateCuratedStockMappingRegistry,
  validateCuratedStockMappingRuntimeEligibility,
  type CuratedStockMappingLifecycleEvent,
  type CuratedStockMappingRegistry,
  type CuratedUsStockMappingRevision,
} from "./curated-stock-mapping-registry";
import { curatedStockMappingRegistry } from "./curated-stock-mapping-registry-data";

function revision(overrides: Partial<CuratedUsStockMappingRevision> = {}): CuratedUsStockMappingRevision {
  return {
    mappingId: "fictional-acme-common", revision: 1, revisionId: "fictional-acme-common@1",
    effectiveFrom: "2026-01-01T00:00:00.000Z", changeReason: "Initial fictional fixture.", lifecycle: "active",
    instrument: { symbol: "ACME", exchange: "XNAS", name: "Fictional Acme Common", assetType: "stock", currency: "USD", listingCountry: "US" },
    company: { cik: "123456", legalName: "Fictional Acme Corporation" },
    exchangeListingEvidence: { source: "fictional-exchange", reference: "listing/ACME", retrievedAt: "2026-01-01T00:00:00.000Z" },
    secCompanyEvidence: { source: "fictional-sec", reference: "CIK0000123456", retrievedAt: "2026-01-01T00:00:00.000Z" },
    approval: { status: "approved", approvedBy: "fictional-reviewer", approvedAt: "2026-01-02T00:00:00.000Z" },
    ...overrides,
  };
}
function registry(revisions: CuratedUsStockMappingRevision[] = [revision()], lifecycleEvents: CuratedStockMappingLifecycleEvent[] = []): CuratedStockMappingRegistry {
  return { version: CURATED_STOCK_MAPPING_REGISTRY_VERSION, revisions, lifecycleEvents };
}
function codes(value: ReturnType<typeof validateCuratedStockMappingRegistry>): string[] {
  assert.equal(value.ok, false);
  return value.errors.map((item) => item.code);
}

test("empty source-controlled registry remains valid", () => {
  assert.deepEqual(curatedStockMappingRegistry.revisions, []);
  assert.deepEqual(curatedStockMappingRegistry.lifecycleEvents, []);
  assert.equal(validateCuratedStockMappingRegistry(curatedStockMappingRegistry).ok, true);
});
test("approved active revision is runtime eligible and normalizes its CIK", () => {
  const result = validateCuratedStockMappingRuntimeEligibility(registry());
  assert.equal(result.ok, true);
  assert.equal(result.mappings[0]?.company.cik, "0000123456");
});
test("pending and rejected history persist as valid but never runtime eligible", () => {
  for (const status of ["pending", "rejected"] as const) {
    const value = registry([revision({ approval: { status, approvedBy: "reviewer", approvedAt: "2026-01-02T00:00:00.000Z" } })]);
    assert.equal(validateCuratedStockMappingRegistry(value).ok, true);
    const runtime = validateCuratedStockMappingRuntimeEligibility(value);
    assert.equal(runtime.ok, true);
    assert.deepEqual(runtime.mappings, []);
  }
});
test("retirement determines current state without changing revision identity", () => {
  const value = registry([revision()], [{ revisionId: "fictional-acme-common@1", lifecycle: "retired", effectiveFrom: "2026-03-01T00:00:00.000Z", recordedAt: "2026-03-02T00:00:00.000Z" }]);
  assert.equal(validateCuratedStockMappingRegistry(value).ok, true);
  assert.equal(effectiveCuratedStockMappingLifecycles(value).get("fictional-acme-common@1"), "retired");
  const runtime = validateCuratedStockMappingRuntimeEligibility(value);
  assert.equal(runtime.ok, true);
  assert.deepEqual(runtime.mappings, []);
});
test("supersession requires the next immutable revision and preserves event timestamps", () => {
  const second = revision({ revision: 2, revisionId: "fictional-acme-common@2", effectiveFrom: "2026-02-01T00:00:00.000Z", changeReason: "Fictional successor." });
  const event: CuratedStockMappingLifecycleEvent = { revisionId: "fictional-acme-common@1", lifecycle: "superseded", successorRevisionId: second.revisionId, effectiveFrom: "2026-02-01T00:00:00.000Z", recordedAt: "2026-02-07T00:00:00.000Z" };
  const value = registry([revision(), second], [event]);
  assert.equal(validateCuratedStockMappingRegistry(value).ok, true);
  assert.equal(effectiveCuratedStockMappingLifecycles(value).get("fictional-acme-common@1"), "superseded");
  const runtime = validateCuratedStockMappingRuntimeEligibility(value);
  assert.equal(runtime.ok, true);
  assert.equal(runtime.mappings.length, 1);
  assert.equal(runtime.mappings[0]?.instrument.symbol, "ACME");
});
test("rejects malformed records, CIKs, unsupported exchanges, and missing lifecycle arrays", () => {
  const malformed = { version: CURATED_STOCK_MAPPING_REGISTRY_VERSION, revisions: [{}] } as unknown as CuratedStockMappingRegistry;
  assert.ok(codes(validateCuratedStockMappingRegistry(malformed)).includes("MISSING_REQUIRED_FIELD"));
  const bad = revision({ company: { cik: "bad", legalName: "Fictional Acme Corporation" }, instrument: { ...revision().instrument, exchange: "ARCX" } });
  const result = codes(validateCuratedStockMappingRegistry(registry([bad])));
  assert.ok(result.includes("INVALID_COMPANY_IDENTITY"));
  assert.ok(result.includes("UNSUPPORTED_EXCHANGE"));
});
test("rejects invalid, backward, duplicate, and ambiguous lifecycle transitions", () => {
  const second = revision({ revision: 2, revisionId: "fictional-acme-common@2", effectiveFrom: "2026-02-01T00:00:00.000Z" });
  const invalid = registry([revision(), second], [
    { revisionId: "fictional-acme-common@1", lifecycle: "superseded", successorRevisionId: "fictional-acme-common@2", effectiveFrom: "2026-02-01T00:00:00.000Z", recordedAt: "2026-01-31T00:00:00.000Z" },
    { revisionId: "fictional-acme-common@1", lifecycle: "retired", effectiveFrom: "2026-03-01T00:00:00.000Z", recordedAt: "2026-03-01T00:00:00.000Z" },
  ]);
  const result = codes(validateCuratedStockMappingRegistry(invalid));
  assert.ok(result.includes("INVALID_EFFECTIVE_DATE"));
  assert.ok(result.includes("INVALID_LIFECYCLE_EVENT"));
});
test("allows multiple share classes but rejects company and instrument reassignment", () => {
  const preferred = revision({ mappingId: "fictional-acme-preferred", revisionId: "fictional-acme-preferred@1", instrument: { ...revision().instrument, symbol: "ACME.P" } });
  assert.equal(validateCuratedStockMappingRegistry(registry([revision(), preferred])).ok, true);
  const differentCompany = revision({ mappingId: "fictional-other", revisionId: "fictional-other@1", company: { cik: "654321", legalName: "Other Fictional Co" } });
  assert.ok(codes(validateCuratedStockMappingRegistry(registry([revision(), differentCompany]))).includes("CONFLICTING_INSTRUMENT_IDENTITY"));
  const renamed = revision({ mappingId: "fictional-renamed", revisionId: "fictional-renamed@1", instrument: { ...revision().instrument, symbol: "ACME.R" }, company: { cik: "123456", legalName: "Different Fictional Name" } });
  assert.ok(codes(validateCuratedStockMappingRegistry(registry([revision(), renamed]))).includes("CONFLICTING_COMPANY_IDENTITY"));
});
