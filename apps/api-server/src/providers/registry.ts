import type { FilingsProvider, FundamentalsProvider, MarketDataProvider, NewsProvider } from "./contracts";

/** Registry deliberately has no fallback provider: unavailable data remains unavailable. */
export class ProviderRegistry {
  private readonly marketData = new Map<string, MarketDataProvider>();
  private readonly fundamentals = new Map<string, FundamentalsProvider>();
  private readonly filings = new Map<string, FilingsProvider>();
  private readonly news = new Map<string, NewsProvider>();

  registerMarketData(provider: MarketDataProvider): void { this.marketData.set(provider.name, provider); }
  registerFundamentals(provider: FundamentalsProvider): void { this.fundamentals.set(provider.name, provider); }
  registerFilings(provider: FilingsProvider): void { this.filings.set(provider.name, provider); }
  registerNews(provider: NewsProvider): void { this.news.set(provider.name, provider); }

  getMarketData(name: string): MarketDataProvider | undefined { return this.marketData.get(name); }
  getFundamentals(name: string): FundamentalsProvider | undefined { return this.fundamentals.get(name); }
  getFilings(name: string): FilingsProvider | undefined { return this.filings.get(name); }
  getNews(name: string): NewsProvider | undefined { return this.news.get(name); }
}
