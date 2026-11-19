import assert from "node:assert/strict";
import test from "node:test";
import {
  CURATED_STOCK_MAPPING_REGISTRY_VERSION,
  validateCuratedStockMappingRegistry,
  validateCuratedStockMappingRuntimeEligibility,
  type CuratedStockMappingRegistry,
  type CuratedUsStockMappingRevision,
} from "./curated-stock-mapping-registry";
import { curatedStockMappingRegistry } from "./curated-stock-mapping-registry-data";

function revision(
  overrides: Partial<CuratedUsStockMappingRevision> = {},
): CuratedUsStockMappingRevision {
  return {
    mappingId: "fictional-acme-common",
    revision: 1,
    revisionId: "fictional-acme-common@1",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    changeReason: "Initial fictional fixture.",
    lifecycle: "active",
    instrument: {
      symbol: "ACME",
      exchange: "XNAS",
      name: "Fictional Acme Common",
      assetType: "stock",
      currency: "USD",
      listingCountry: "US",
    },
    company: { cik: "123456", legalName: "Fictional Acme Corporation" },
    exchangeListingEvidence: {
      source: "fictional-exchange-directory",
      reference: "listing/ACME",
      retrievedAt: "2026-01-01T00:00:00.000Z",
    },
    secCompanyEvidence: {
      source: "fictional-sec-submissions",
      reference: "CIK0000123456",
      retrievedAt: "2026-01-01T00:00:00.000Z",
    },
    approval: {
      status: "approved",
      approvedBy: "fictional-reviewer",
      approvedAt: "2026-01-02T00:00:00.000Z",
    },
    ...overrides,
  };
}

function registry(
  ...revisions: CuratedUsStockMappingRevision[]
): CuratedStockMappingRegistry {
  return { version: CURATED_STOCK_MAPPING_REGISTRY_VERSION, revisions };
}

function codes(
  result: ReturnType<typeof validateCuratedStockMappingRegistry>,
): string[] {
  assert.equal(result.ok, false);
  return result.errors.map((item) => item.code);
}

test("the source-controlled registry starts empty and is historically valid", () => {
  assert.deepEqual(curatedStockMappingRegistry.revisions, []);
  assert.equal(
    validateCuratedStockMappingRegistry(curatedStockMappingRegistry).ok,
    true,
  );
  const runtime = validateCuratedStockMappingRuntimeEligibility(
    curatedStockMappingRegistry,
  );
  assert.equal(runtime.ok, true);
  assert.deepEqual(runtime.mappings, []);
});

test("accepts a complete approved active fictional record and delegates runtime eligibility", () => {
  const value = registry(revision());
  assert.equal(validateCuratedStockMappingRegistry(value).ok, true);
  const runtime = validateCuratedStockMappingRuntimeEligibility(value);
  assert.equal(runtime.ok, true);
  assert.equal(runtime.mappings[0]?.instrument.exchange, "XNAS");
  assert.equal(runtime.mappings[0]?.company.cik, "0000123456");
});

test("allows both approved initial MICs", () => {
  assert.equal(
    validateCuratedStockMappingRegistry(
      registry(
        revision({
          instrument: { ...revision().instrument, exchange: "XNYS" },
        }),
      ),
    ).ok,
    true,
  );
});

test("historical validation permits a pending retired record but runtime never selects it", () => {
  const value = registry(
    revision({
      lifecycle: "retired",
      approval: {
        status: "pending",
        approvedBy: "fictional-reviewer",
        approvedAt: "2026-01-02T00:00:00.000Z",
      },
    }),
  );
  assert.equal(validateCuratedStockMappingRegistry(value).ok, true);
  const runtime = validateCuratedStockMappingRuntimeEligibility(value);
  assert.equal(runtime.ok, true);
  assert.deepEqual(runtime.mappings, []);
});

test("rejects unsupported exchanges, missing evidence, and duplicate active identities", () => {
  const nyseDuplicate = revision({
    mappingId: "fictional-acme-duplicate",
    revisionId: "fictional-acme-duplicate@1",
  });
  const bad = revision({
    instrument: { ...revision().instrument, exchange: "ARCX" },
    exchangeListingEvidence: {
      ...revision().exchangeListingEvidence,
      reference: "",
    },
  });
  const result = validateCuratedStockMappingRegistry(
    registry(revision(), nyseDuplicate, bad),
  );
  const resultCodes = codes(result);
  assert.ok(resultCodes.includes("DUPLICATE_ACTIVE_MAPPING"));
  assert.ok(resultCodes.includes("UNSUPPORTED_EXCHANGE"));
  assert.ok(resultCodes.includes("INVALID_EVIDENCE"));
});

test("rejects invalid and ambiguous successor chains", () => {
  const first = revision({
    lifecycle: "superseded",
    successorRevisionId: "fictional-acme-common@2",
  });
  const second = revision({
    revision: 2,
    revisionId: "fictional-acme-common@2",
    effectiveFrom: "2026-02-01T00:00:00.000Z",
  });
  const competing = revision({
    mappingId: "fictional-other",
    revisionId: "fictional-other@1",
    lifecycle: "superseded",
    successorRevisionId: "fictional-acme-common@2",
  });
  const result = validateCuratedStockMappingRegistry(
    registry(first, second, competing),
  );
  const resultCodes = codes(result);
  assert.ok(resultCodes.includes("AMBIGUOUS_SUCCESSOR"));
  assert.ok(resultCodes.includes("INVALID_REVISION_CHAIN"));
});

test("rejects gaps and a mismatched successor rather than inferring a revision", () => {
  const first = revision({
    lifecycle: "superseded",
    successorRevisionId: "fictional-acme-common@3",
  });
  const third = revision({
    revision: 3,
    revisionId: "fictional-acme-common@3",
    effectiveFrom: "2026-02-01T00:00:00.000Z",
  });
  const resultCodes = codes(
    validateCuratedStockMappingRegistry(registry(first, third)),
  );
  assert.ok(resultCodes.includes("INVALID_REVISION_CHAIN"));
});
