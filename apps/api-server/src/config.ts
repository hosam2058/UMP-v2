import { ProviderError } from "./providers/contracts";

export interface UmpConfig {
  databaseUrl?: string;
  secUserAgent?: string;
  marketDataProvider: "none";
}

const optional = (value: string | undefined): string | undefined => value?.trim() || undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): UmpConfig {
  const marketDataProvider = optional(env.MARKET_DATA_PROVIDER) ?? "none";
  if (marketDataProvider !== "none") {
    throw new ProviderError(
      "CONFIGURATION",
      "MARKET_DATA_PROVIDER must be none in Phase 1 because no market-data adapter is implemented.",
      "configuration",
      false,
    );
  }
  return { databaseUrl: optional(env.DATABASE_URL), secUserAgent: optional(env.SEC_USER_AGENT), marketDataProvider: "none" };
}
