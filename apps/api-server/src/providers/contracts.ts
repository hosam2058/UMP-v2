import type {
  ExternalCompany,
  ExternalFundamentalFact,
  ExternalSecFiling,
  NewsArticle,
  PriceBar,
  PriceInterval,
} from "../domain/models";

export interface Provenance {
  provider: string;
  retrievedAt: Date;
  asOf: Date | null;
  isDelayed: boolean;
  sourceUrl?: string;
}

export interface ProviderResult<T> {
  data: T;
  provenance: Provenance;
}

export interface Quote {
  symbol: string;
  price: string;
  currency: string;
  timestamp: Date;
}

export interface HistoricalBarsRequest {
  symbol: string;
  interval: PriceInterval;
  from: Date;
  to: Date;
}

export interface MarketDataProvider {
  readonly name: string;
  getQuote(symbol: string): Promise<ProviderResult<Quote>>;
  getHistoricalBars(request: HistoricalBarsRequest): Promise<ProviderResult<PriceBar[]>>;
}

export interface FundamentalsProvider {
  readonly name: string;
  resolveCompanyByCik(cik: string): Promise<ProviderResult<ExternalCompany>>;
  getCompanyFactsByCik(cik: string): Promise<ProviderResult<ExternalFundamentalFact[]>>;
}

export interface FilingsProvider {
  readonly name: string;
  getFilingsByCik(cik: string): Promise<ProviderResult<ExternalSecFiling[]>>;
}

export interface NewsProvider {
  readonly name: string;
  getNews(symbol: string): Promise<ProviderResult<NewsArticle[]>>;
}

export type ProviderErrorCode = "CONFIGURATION" | "UNAVAILABLE" | "TIMEOUT" | "RATE_LIMITED" | "UPSTREAM" | "INVALID_RESPONSE";

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly provider: string,
    public readonly retryable: boolean,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
