import type {
  ExternalCompany,
  ExternalFundamentalFact,
  ExternalSecFiling,
} from "../domain/models";
import { ProviderError, type FilingsProvider, type FundamentalsProvider, type ProviderResult } from "./contracts";

const SEC_DATA_BASE_URL = "https://data.sec.gov";
const SEC_ARCHIVES_BASE_URL = "https://www.sec.gov/Archives/edgar/data";

export interface SecEdgarProviderOptions { userAgent: string; fetchImpl?: typeof fetch; timeoutMs?: number; maxRetries?: number; minRequestIntervalMs?: number; }
interface RecentFilings { accessionNumber?: string[]; form?: string[]; filingDate?: string[]; reportDate?: string[]; primaryDocument?: string[]; }
interface Submissions { name?: string; sic?: string; sicDescription?: string; filings?: { recent?: RecentFilings }; }
interface FactUnit { val?: number; fy?: number; fp?: string; filed?: string; accn?: string; }
interface CompanyFacts { facts?: Record<string, Record<string, { units?: Record<string, FactUnit[]> }>>; }

export function normalizeCik(cik: string): string {
  const digits = cik.replace(/\D/g, "");
  if (!digits || digits.length > 10) throw new ProviderError("INVALID_RESPONSE", "CIK must contain one to ten digits.", "sec-edgar", false);
  return digits.padStart(10, "0");
}

export class SecEdgarProvider implements FundamentalsProvider, FilingsProvider {
  readonly name = "sec-edgar";
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly minInterval: number;
  private nextRequestAt = 0;

  constructor(private readonly options: SecEdgarProviderOptions) {
    if (!options.userAgent.trim()) throw new ProviderError("CONFIGURATION", "SEC_USER_AGENT is required for SEC EDGAR requests.", this.name, false);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.minInterval = options.minRequestIntervalMs ?? 100; // SEC's published 10 req/s ceiling
  }

  async resolveCompanyByCik(cik: string): Promise<ProviderResult<ExternalCompany>> {
    const normalizedCik = normalizeCik(cik);
    const response = await this.request<Submissions>(`/submissions/CIK${normalizedCik}.json`);
    if (!response.data.name) throw new ProviderError("INVALID_RESPONSE", "SEC submissions response did not contain a company name.", this.name, false);
    return { data: { externalIdentifier: { scheme: "cik", value: normalizedCik }, legalName: response.data.name, country: null, sicCode: response.data.sic ?? null, sicDescription: response.data.sicDescription ?? null }, provenance: this.provenance(response) };
  }

  async getCompanyFactsByCik(cik: string): Promise<ProviderResult<ExternalFundamentalFact[]>> {
    const normalizedCik = normalizeCik(cik);
    const response = await this.request<CompanyFacts>(`/api/xbrl/companyfacts/CIK${normalizedCik}.json`);
    const facts: ExternalFundamentalFact[] = [];
    for (const [taxonomy, tags] of Object.entries(response.data.facts ?? {})) for (const [tag, definition] of Object.entries(tags)) for (const [unit, values] of Object.entries(definition.units ?? {})) for (const value of values) if (typeof value.val === "number") facts.push({ companyIdentifier: { scheme: "cik", value: normalizedCik }, taxonomy, tag, value: String(value.val), unit, fiscalYear: value.fy ?? null, fiscalPeriod: value.fp ?? null, filingDate: value.filed ?? null, accessionNumber: value.accn ?? null });
    return { data: facts, provenance: this.provenance(response) };
  }

  async getFilingsByCik(cik: string): Promise<ProviderResult<ExternalSecFiling[]>> {
    const normalizedCik = normalizeCik(cik);
    const response = await this.request<Submissions>(`/submissions/CIK${normalizedCik}.json`);
    const recent = response.data.filings?.recent;
    const filings: ExternalSecFiling[] = [];
    const accessionNumbers = recent?.accessionNumber;
    if (!recent || !accessionNumbers) return { data: filings, provenance: this.provenance(response) };
    for (let index = 0; index < accessionNumbers.length; index += 1) {
      const accessionNumber = accessionNumbers[index], form = recent.form?.[index], filingDate = recent.filingDate?.[index];
      if (!accessionNumber || !form || !filingDate) continue;
      const primaryDocument = recent?.primaryDocument?.[index] ?? null;
      const archiveUrl = primaryDocument ? `${SEC_ARCHIVES_BASE_URL}/${Number(normalizedCik)}/${accessionNumber.replace(/-/g, "")}/${primaryDocument}` : response.sourceUrl;
      filings.push({ companyIdentifier: { scheme: "cik", value: normalizedCik }, form, accessionNumber, filingDate, reportDate: recent?.reportDate?.[index] ?? null, primaryDocument, sourceUrl: archiveUrl });
    }
    return { data: filings, provenance: this.provenance(response) };
  }

  private provenance(response: { retrievedAt: Date; sourceUrl: string }) { return { provider: this.name, retrievedAt: response.retrievedAt, asOf: null, isDelayed: false, sourceUrl: response.sourceUrl }; }
  private async request<T>(path: string): Promise<{ data: T; retrievedAt: Date; sourceUrl: string }> {
    const sourceUrl = `${SEC_DATA_BASE_URL}${path}`;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.limit(); const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(sourceUrl, { headers: { Accept: "application/json", "User-Agent": this.options.userAgent }, signal: controller.signal });
        if (res.ok) return { data: (await res.json()) as T, retrievedAt: new Date(), sourceUrl };
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt === this.maxRetries) throw new ProviderError(res.status === 429 ? "RATE_LIMITED" : "UPSTREAM", `SEC request failed with HTTP ${res.status}.`, this.name, retryable);
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (attempt === this.maxRetries) throw new ProviderError(error instanceof DOMException && error.name === "AbortError" ? "TIMEOUT" : "UNAVAILABLE", "SEC EDGAR request failed.", this.name, true, error);
      } finally { clearTimeout(timeout); }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
    throw new ProviderError("UNAVAILABLE", "SEC EDGAR request failed.", this.name, true);
  }
  private async limit(): Promise<void> { const now = Date.now(); const scheduled = Math.max(now, this.nextRequestAt); this.nextRequestAt = scheduled + this.minInterval; if (scheduled > now) await new Promise((resolve) => setTimeout(resolve, scheduled - now)); }
}
