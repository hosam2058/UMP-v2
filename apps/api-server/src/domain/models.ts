export type AssetType = "stock" | "etf" | "fund" | "bond" | "crypto" | "other";
export type PriceInterval = "1m" | "5m" | "15m" | "1h" | "1d" | "1wk" | "1mo";

/** Decimal values are strings so precision is retained across API and PostgreSQL boundaries. */
export type DecimalString = string;

/** Internal database UUIDs are never provider identifiers. */
declare const internalUuidBrand: unique symbol;
export type InternalUuid = string & {
  readonly [internalUuidBrand]: "InternalUuid";
};

/** Identifies a record in an external provider namespace. */
export interface ExternalIdentifier {
  scheme: string;
  value: string;
}

export interface Instrument {
  id: InternalUuid;
  symbol: string;
  name: string;
  assetType: AssetType;
  exchange: string | null;
  currency: string;
  country: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Company {
  id: InternalUuid;
  legalName: string;
  cik: string | null;
  country: string | null;
  sicCode: string | null;
  sicDescription: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Raw provider payload. It intentionally has no internal database ID. */
export interface ExternalCompany {
  externalIdentifier: ExternalIdentifier;
  legalName: string;
  country: string | null;
  sicCode: string | null;
  sicDescription: string | null;
}

export interface PriceBar {
  instrumentId: InternalUuid;
  interval: PriceInterval;
  timestamp: Date;
  open: DecimalString;
  high: DecimalString;
  low: DecimalString;
  close: DecimalString;
  volume: DecimalString | null;
  source: string;
  fetchedAt: Date;
}

export interface FundamentalFact {
  companyId: InternalUuid;
  taxonomy: string;
  tag: string;
  value: DecimalString;
  unit: string;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  filingDate: string | null;
  accessionNumber: string | null;
  source: string;
  fetchedAt: Date;
}

/** Raw provider payload. An ingestion layer resolves the company identifier to an internal UUID. */
export interface ExternalFundamentalFact {
  companyIdentifier: ExternalIdentifier;
  taxonomy: string;
  tag: string;
  value: DecimalString;
  unit: string;
  form: string;
  filingDate: string;
  accessionNumber: string;
  reportingStart: string | null;
  reportingEnd: string;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  frame: string | null;
}

export interface SecFiling {
  companyId: InternalUuid;
  form: string;
  accessionNumber: string;
  filingDate: string;
  reportDate: string | null;
  primaryDocument: string | null;
  sourceUrl: string;
  source: string;
  fetchedAt: Date;
}

/** Raw provider payload. An ingestion layer resolves the company identifier to an internal UUID. */
export interface ExternalSecFiling {
  companyIdentifier: ExternalIdentifier;
  form: string;
  accessionNumber: string;
  filingDate: string;
  reportDate: string | null;
  primaryDocument: string | null;
  sourceUrl: string;
}

export interface NewsArticle {
  instrumentId: InternalUuid | null;
  title: string;
  summary: string | null;
  url: string;
  publishedAt: Date;
  source: string;
  fetchedAt: Date;
}

export interface DataSource {
  id: InternalUuid;
  provider: string;
  name: string;
  baseUrl: string | null;
  isDelayed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IngestionRecord {
  id: InternalUuid;
  sourceId: InternalUuid;
  resourceType: string;
  resourceKey: string;
  status: "started" | "completed" | "failed";
  startedAt: Date;
  completedAt: Date | null;
  sourceAsOf: Date | null;
  fetchedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
}
