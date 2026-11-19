import assert from "node:assert/strict";
import test from "node:test";
import {
  validateCuratedSecSupportedStockMappings,
  type CuratedSecSupportedStockMapping,
} from "./sec-supported-mappings";

function mapping(overrides: Partial<CuratedSecSupportedStockMapping> = {}): CuratedSecSupportedStockMapping {
  return {
    instrument: { symbol: "ACME", exchange: "XNAS", name: "Acme Class A", assetType: "stock", currency: "USD" },
    company: { cik: "123456", legalName: "Acme Corporation" },
    companyRelationship: { companyCik: "123456" },
    mappingProvenance: { source: "reviewed-curated-source", reference: "issuer-directory/v1#ACME", retrievedAt: "2026-11-01T00:00:00.000Z" },
    approval: { status: "approved", approvedBy: "identity-review", approvedAt: "2026-11-02T00:00:00.000Z" },
    active: true,
    ...overrides,
  };
}

function invalidCodes(result: ReturnType<typeof validateCuratedSecSupportedStockMappings>): string[] {
  assert.equal(result.ok, false);
  return result.errors.map((item) => item.code);
}

test("validates an approved active stock mapping and preserves normalized provenance", () => {
  const result = validateCuratedSecSupportedStockMappings([mapping()]);
  assert.equal(result.ok, true);
  assert.equal(result.mappings[0]?.company.cik, "0000123456");
  assert.equal(result.mappings[0]?.companyRelationship.companyCik, "0000123456");
  assert.deepEqual(result.mappings[0]?.mappingProvenance, mapping().mappingProvenance);
});

test("fails closed for missing fields, invalid CIKs, invalid identities, and unsupported assets", () => {
  const incomplete = mapping({ instrument: { ...mapping().instrument, name: "" } });
  const invalidCik = mapping({ company: { ...mapping().company, cik: "not-cik" } });
  const invalidIdentity = mapping({ instrument: { ...mapping().instrument, symbol: "ACME/US" } });
  const etf = mapping({ instrument: { ...mapping().instrument, assetType: "etf" } });
  const result = validateCuratedSecSupportedStockMappings([incomplete, invalidCik, invalidIdentity, etf]);
  const codes = invalidCodes(result);
  assert.ok(codes.includes("MISSING_REQUIRED_FIELD"));
  assert.ok(codes.includes("INVALID_CIK"));
  assert.ok(codes.includes("INVALID_INSTRUMENT_IDENTITY"));
  assert.ok(codes.includes("UNSUPPORTED_ASSET_TYPE"));
});

test("rejects duplicate symbol/exchange identities and conflicting company links", () => {
  const duplicate = mapping();
  const conflict = mapping({ companyRelationship: { companyCik: "999999" } });
  const result = validateCuratedSecSupportedStockMappings([mapping(), duplicate, conflict]);
  const codes = invalidCodes(result);
  assert.ok(codes.includes("DUPLICATE_INSTRUMENT_IDENTITY"));
  assert.ok(codes.includes("INCONSISTENT_COMPANY_RELATIONSHIP"));
});

test("allows multiple approved share classes for one consistent company", () => {
  const classB = mapping({
    instrument: { symbol: "ACME.B", exchange: "XNAS", name: "Acme Class B", assetType: "stock", currency: "USD" },
  });
  const result = validateCuratedSecSupportedStockMappings([mapping(), classB]);
  assert.equal(result.ok, true);
  assert.equal(result.mappings.length, 2);
  assert.equal(result.mappings[0]?.company.cik, result.mappings[1]?.company.cik);
});

test("rejects inactive and unapproved mappings", () => {
  const inactive = mapping({ active: false });
  const pending = mapping({
    instrument: { ...mapping().instrument, symbol: "PENDING" },
    approval: { ...mapping().approval, status: "pending" },
  });
  const codes = invalidCodes(validateCuratedSecSupportedStockMappings([inactive, pending]));
  assert.ok(codes.includes("INACTIVE_MAPPING"));
  assert.ok(codes.includes("UNAPPROVED_MAPPING"));
});

test("rejects inconsistent company identity records without inferring a relationship", () => {
  const changedCompanyName = mapping({
    instrument: { ...mapping().instrument, symbol: "ACME.C" },
    company: { cik: "123456", legalName: "Different Issuer" },
  });
  const codes = invalidCodes(validateCuratedSecSupportedStockMappings([mapping(), changedCompanyName]));
  assert.ok(codes.includes("CONFLICTING_COMPANY_IDENTITY"));
});
