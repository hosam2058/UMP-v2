import type {
  ExternalCompany,
  ExternalFundamentalFact,
  ExternalSecFiling,
} from "../domain/models";
import {
  ProviderError,
  type FilingsProvider,
  type FundamentalsProvider,
  type ProviderResult,
} from "./contracts";

const SEC_DATA_BASE_URL = "https://data.sec.gov";
const SEC_ARCHIVES_BASE_URL = "https://www.sec.gov/Archives/edgar/data";

export interface SecEdgarProviderOptions {
  userAgent: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  minRequestIntervalMs?: number;
}
interface RecentFilings {
  accessionNumber?: string[];
  form?: string[];
  filingDate?: string[];
  reportDate?: string[];
  primaryDocument?: string[];
}

const EXACT_JSON_NUMBER = Symbol("exact-json-number");

interface ExactJsonNumber {
  readonly [EXACT_JSON_NUMBER]: true;
  readonly source: string;
}

interface JsonParseContext {
  readonly source?: string;
}

type JsonParseWithSource = (
  text: string,
  reviver?: (
    this: unknown,
    key: string,
    value: unknown,
    context: JsonParseContext,
  ) => unknown,
) => unknown;

function invalidResponse(message: string, cause?: unknown): never {
  throw new ProviderError(
    "INVALID_RESPONSE",
    message,
    "sec-edgar",
    false,
    cause,
  );
}

function parseSecJson(text: string): unknown {
  const parseWithSource = JSON.parse as JsonParseWithSource;

  return parseWithSource(text, (key, value, context) => {
    if (key !== "val" || typeof value !== "number") return value;

    if (typeof context?.source !== "string") {
      throw new Error(
        "JSON parser did not expose the original numeric source.",
      );
    }

    return {
      [EXACT_JSON_NUMBER]: true,
      source: context.source,
    };
  });
}

function isExactJsonNumber(value: unknown): value is ExactJsonNumber {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as {
    [EXACT_JSON_NUMBER]?: unknown;
    source?: unknown;
  };

  return (
    candidate[EXACT_JSON_NUMBER] === true &&
    typeof candidate.source === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    invalidResponse(`${field} must be an object.`);
  }
  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (!isNonEmptyString(value)) {
    invalidResponse(`${field} must be a non-empty string.`);
  }
  return value;
}

function validateSecResponseCik(
  value: unknown,
  requestedCik: string,
  field: string,
  representation: "string" | "number",
): void {
  let cik: string;
  if (
    representation === "string" &&
    typeof value === "string" &&
    /^\d+$/.test(value)
  ) {
    cik = value;
  } else if (
    representation === "number" &&
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    cik = String(value);
  } else {
    invalidResponse(
      `${field} must be a ${representation === "string" ? "numeric string" : "safe integer"}.`,
    );
  }

  let normalizedResponseCik: string;
  try {
    normalizedResponseCik = normalizeCik(cik);
  } catch (error) {
    invalidResponse(`${field} is malformed.`, error);
  }

  if (/^0+$/.test(normalizedResponseCik)) {
    invalidResponse(`${field} must identify a nonzero SEC CIK.`);
  }

  if (normalizedResponseCik !== requestedCik) {
    invalidResponse(`${field} does not match the requested CIK.`);
  }
}

function requireSecAccessionNumber(value: unknown, field: string): string {
  const accessionNumber = requireNonEmptyString(value, field);
  if (!/^\d{10}-\d{2}-\d{6}$/.test(accessionNumber)) {
    invalidResponse(`${field} must match the SEC accession number format.`);
  }
  return accessionNumber;
}

function isDateOnlyString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function requireDateOnlyString(value: unknown, field: string): string {
  if (!isDateOnlyString(value)) {
    invalidResponse(`${field} must be a valid YYYY-MM-DD date.`);
  }
  return value;
}

function nullableDateOnlyString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return requireDateOnlyString(value, field);
}

function nullableNonEmptyString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return requireNonEmptyString(value, field);
}

function nullableInteger(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    invalidResponse(`${field} must be an integer or null.`);
  }
  return value;
}

function optionalStringArray(
  record: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    invalidResponse(`SEC submissions ${field} must be an array.`);
  }

  const strings: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      invalidResponse(`SEC submissions ${field} must contain only strings.`);
    }
    strings.push(item);
  }
  return strings;
}

function validateRecentFilings(value: unknown): RecentFilings {
  const record = requireRecord(value, "SEC submissions filings.recent");
  const recent: RecentFilings = {
    accessionNumber: optionalStringArray(record, "accessionNumber"),
    form: optionalStringArray(record, "form"),
    filingDate: optionalStringArray(record, "filingDate"),
    reportDate: optionalStringArray(record, "reportDate"),
    primaryDocument: optionalStringArray(record, "primaryDocument"),
  };

  if (recent.accessionNumber !== undefined) {
    const rowCount = recent.accessionNumber.length;
    for (const [field, values] of [
      ["form", recent.form],
      ["filingDate", recent.filingDate],
      ["reportDate", recent.reportDate],
      ["primaryDocument", recent.primaryDocument],
    ] as const) {
      if (values !== undefined && values.length !== rowCount) {
        invalidResponse(
          `SEC submissions ${field} length does not match accessionNumber.`,
        );
      }
    }
    if (
      rowCount > 0 &&
      (recent.form === undefined || recent.filingDate === undefined)
    ) {
      invalidResponse(
        "SEC submissions form and filingDate are required for each accessionNumber.",
      );
    }
  }

  return recent;
}

function validateCompanySubmissions(
  value: unknown,
  requestedCik: string,
): {
  name: string;
  sic: string | null;
  sicDescription: string | null;
} {
  const record = requireRecord(value, "SEC submissions response");
  validateSecResponseCik(
    record.cik,
    requestedCik,
    "SEC submissions cik",
    "string",
  );
  const name = requireNonEmptyString(record.name, "SEC submissions name");
  const sicValue = record.sic;
  const sicDescriptionValue = record.sicDescription;

  if (
    sicValue !== undefined &&
    sicValue !== null &&
    typeof sicValue !== "string"
  ) {
    invalidResponse("SEC submissions sic must be a string or null.");
  }
  if (
    sicDescriptionValue !== undefined &&
    sicDescriptionValue !== null &&
    typeof sicDescriptionValue !== "string"
  ) {
    invalidResponse("SEC submissions sicDescription must be a string or null.");
  }

  return {
    name,
    sic: typeof sicValue === "string" ? sicValue : null,
    sicDescription:
      typeof sicDescriptionValue === "string" ? sicDescriptionValue : null,
  };
}

function mapCompanyFacts(
  value: unknown,
  normalizedCik: string,
): ExternalFundamentalFact[] {
  const response = requireRecord(value, "SEC companyfacts response");
  validateSecResponseCik(
    response.cik,
    normalizedCik,
    "SEC companyfacts cik",
    "number",
  );
  if (!Object.hasOwn(response, "facts")) {
    invalidResponse("SEC companyfacts response did not contain facts.");
  }
  const taxonomies = requireRecord(response.facts, "SEC companyfacts facts");
  const mapped: ExternalFundamentalFact[] = [];

  for (const [taxonomy, rawTags] of Object.entries(taxonomies)) {
    if (!isNonEmptyString(taxonomy))
      invalidResponse("SEC companyfacts taxonomy must not be empty.");
    const tags = requireRecord(
      rawTags,
      `SEC companyfacts taxonomy ${taxonomy}`,
    );

    for (const [tag, rawDefinition] of Object.entries(tags)) {
      if (!isNonEmptyString(tag))
        invalidResponse("SEC companyfacts tag must not be empty.");
      const definition = requireRecord(
        rawDefinition,
        `SEC companyfacts tag ${taxonomy}.${tag}`,
      );
      if (!Object.hasOwn(definition, "units")) {
        invalidResponse(
          `SEC companyfacts tag ${taxonomy}.${tag} did not contain units.`,
        );
      }
      const units = requireRecord(
        definition.units,
        `SEC companyfacts units for ${taxonomy}.${tag}`,
      );

      for (const [unit, rawValues] of Object.entries(units)) {
        if (!isNonEmptyString(unit))
          invalidResponse("SEC companyfacts unit must not be empty.");
        if (!Array.isArray(rawValues)) {
          invalidResponse(
            `SEC companyfacts values for ${taxonomy}.${tag}.${unit} must be an array.`,
          );
        }

        for (let index = 0; index < rawValues.length; index += 1) {
          const context = `SEC companyfacts ${taxonomy}.${tag}.${unit}[${index}]`;
          const fact = requireRecord(rawValues[index], context);
          const rawValue = fact.val;
          if (!isExactJsonNumber(rawValue)) {
            invalidResponse(`${context}.val must be a finite JSON number.`);
          }

          mapped.push({
            companyIdentifier: { scheme: "cik", value: normalizedCik },
            taxonomy,
            tag,
            unit,
            value: rawValue.source,
            form: requireNonEmptyString(fact.form, `${context}.form`),
            filingDate: requireDateOnlyString(fact.filed, `${context}.filed`),
            accessionNumber: requireSecAccessionNumber(
              fact.accn,
              `${context}.accn`,
            ),
            reportingStart: nullableDateOnlyString(
              fact.start,
              `${context}.start`,
            ),
            reportingEnd: requireDateOnlyString(fact.end, `${context}.end`),
            fiscalYear: nullableInteger(fact.fy, `${context}.fy`),
            fiscalPeriod: nullableNonEmptyString(fact.fp, `${context}.fp`),
            frame: nullableNonEmptyString(fact.frame, `${context}.frame`),
          });
        }
      }
    }
  }

  return mapped;
}

function optionalReportDate(
  value: string | undefined,
  field: string,
): string | null {
  if (value === undefined || value.trim().length === 0) return null;
  return requireDateOnlyString(value, field);
}

function optionalPrimaryDocument(value: string | undefined): string | null {
  if (value === undefined || value.trim().length === 0) return null;
  return value;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function normalizeCik(cik: string): string {
  if (!/^\d{1,10}$/.test(cik)) {
    throw new ProviderError(
      "INVALID_RESPONSE",
      "CIK must contain one to ten digits.",
      "sec-edgar",
      false,
    );
  }
  return cik.padStart(10, "0");
}

export class SecEdgarProvider implements FundamentalsProvider, FilingsProvider {
  readonly name = "sec-edgar";
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly minInterval: number;
  private nextRequestAt = 0;

  constructor(private readonly options: SecEdgarProviderOptions) {
    if (!options.userAgent.trim()) {
      throw new ProviderError(
        "CONFIGURATION",
        "SEC_USER_AGENT is required for SEC EDGAR requests.",
        this.name,
        false,
      );
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.minInterval = options.minRequestIntervalMs ?? 100; // SEC's published 10 req/s ceiling
  }

  async resolveCompanyByCik(
    cik: string,
  ): Promise<ProviderResult<ExternalCompany>> {
    const normalizedCik = normalizeCik(cik);
    const response = await this.request(
      `/submissions/CIK${normalizedCik}.json`,
    );
    const company = validateCompanySubmissions(response.data, normalizedCik);
    return {
      data: {
        externalIdentifier: { scheme: "cik", value: normalizedCik },
        legalName: company.name,
        country: null,
        sicCode: company.sic,
        sicDescription: company.sicDescription,
      },
      provenance: this.provenance(response),
    };
  }

  async getCompanyFactsByCik(
    cik: string,
  ): Promise<ProviderResult<ExternalFundamentalFact[]>> {
    const normalizedCik = normalizeCik(cik);
    const response = await this.request(
      `/api/xbrl/companyfacts/CIK${normalizedCik}.json`,
    );
    return {
      data: mapCompanyFacts(response.data, normalizedCik),
      provenance: this.provenance(response),
    };
  }

  async getFilingsByCik(
    cik: string,
  ): Promise<ProviderResult<ExternalSecFiling[]>> {
    const normalizedCik = normalizeCik(cik);
    const response = await this.request(
      `/submissions/CIK${normalizedCik}.json`,
    );
    const submissions = requireRecord(
      response.data,
      "SEC submissions response",
    );
    validateSecResponseCik(
      submissions.cik,
      normalizedCik,
      "SEC submissions cik",
      "string",
    );
    if (submissions.filings === undefined) {
      return { data: [], provenance: this.provenance(response) };
    }
    const filingsPayload = requireRecord(
      submissions.filings,
      "SEC submissions filings",
    );
    if (filingsPayload.recent === undefined) {
      return { data: [], provenance: this.provenance(response) };
    }
    const recent = validateRecentFilings(filingsPayload.recent);
    const accessionNumbers = recent.accessionNumber;
    if (accessionNumbers === undefined) {
      return { data: [], provenance: this.provenance(response) };
    }

    const filings: ExternalSecFiling[] = [];
    for (let index = 0; index < accessionNumbers.length; index += 1) {
      const context = `SEC submissions recent[${index}]`;
      const accessionNumber = requireSecAccessionNumber(
        accessionNumbers[index],
        `${context}.accessionNumber`,
      );
      const form = requireNonEmptyString(
        recent.form?.[index],
        `${context}.form`,
      );
      const filingDate = requireDateOnlyString(
        recent.filingDate?.[index],
        `${context}.filingDate`,
      );
      const reportDate = optionalReportDate(
        recent.reportDate?.[index],
        `${context}.reportDate`,
      );
      const primaryDocument = optionalPrimaryDocument(
        recent.primaryDocument?.[index],
      );
      const archiveUrl = primaryDocument
        ? `${SEC_ARCHIVES_BASE_URL}/${Number(normalizedCik)}/${accessionNumber.replace(/-/g, "")}/${primaryDocument}`
        : response.sourceUrl;

      filings.push({
        companyIdentifier: { scheme: "cik", value: normalizedCik },
        form,
        accessionNumber,
        filingDate,
        reportDate,
        primaryDocument,
        sourceUrl: archiveUrl,
      });
    }
    return { data: filings, provenance: this.provenance(response) };
  }

  private provenance(response: { retrievedAt: Date; sourceUrl: string }) {
    return {
      provider: this.name,
      retrievedAt: response.retrievedAt,
      asOf: null,
      isDelayed: false,
      sourceUrl: response.sourceUrl,
    };
  }

  private async request(
    path: string,
  ): Promise<{ data: unknown; retrievedAt: Date; sourceUrl: string }> {
    const sourceUrl = `${SEC_DATA_BASE_URL}${path}`;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.limit();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(sourceUrl, {
          headers: {
            Accept: "application/json",
            "User-Agent": this.options.userAgent,
          },
          signal: controller.signal,
        });
        if (res.ok) {
          let data: unknown;
          try {
            data = parseSecJson(await res.text());
          } catch (error) {
            if (isAbortError(error)) throw error;
            throw new ProviderError(
              "INVALID_RESPONSE",
              "SEC response body was not valid JSON.",
              this.name,
              false,
              error,
            );
          }
          return { data, retrievedAt: new Date(), sourceUrl };
        }
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt === this.maxRetries) {
          throw new ProviderError(
            res.status === 429 ? "RATE_LIMITED" : "UPSTREAM",
            `SEC request failed with HTTP ${res.status}.`,
            this.name,
            retryable,
          );
        }
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (attempt === this.maxRetries) {
          throw new ProviderError(
            isAbortError(error) ? "TIMEOUT" : "UNAVAILABLE",
            "SEC EDGAR request failed.",
            this.name,
            true,
            error,
          );
        }
      } finally {
        clearTimeout(timeout);
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
    throw new ProviderError(
      "UNAVAILABLE",
      "SEC EDGAR request failed.",
      this.name,
      true,
    );
  }

  private async limit(): Promise<void> {
    const now = Date.now();
    const scheduled = Math.max(now, this.nextRequestAt);
    this.nextRequestAt = scheduled + this.minInterval;
    if (scheduled > now) {
      await new Promise((resolve) => setTimeout(resolve, scheduled - now));
    }
  }
}
