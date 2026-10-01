import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const assetTypeEnum = pgEnum("asset_type", ["stock", "etf", "fund", "bond", "crypto", "other"]);
export const barIntervalEnum = pgEnum("bar_interval", ["1m", "5m", "15m", "1h", "1d", "1wk", "1mo"]);
export const ingestionStatusEnum = pgEnum("ingestion_status", ["started", "completed", "failed"]);

/**
 * updated_at defaults on insert only. Every application-level update must set
 * updatedAt: new Date(); Phase 1 intentionally has no database update trigger.
 */
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const dataSources = pgTable(
  "data_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: varchar("provider", { length: 100 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    baseUrl: text("base_url"),
    isDelayed: boolean("is_delayed").default(false).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("data_sources_provider_name_unique").on(table.provider, table.name)],
);

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legalName: text("legal_name").notNull(),
    cik: varchar("cik", { length: 10 }),
    country: varchar("country", { length: 2 }),
    sicCode: varchar("sic_code", { length: 10 }),
    sicDescription: text("sic_description"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("companies_cik_unique").on(table.cik),
    check("companies_cik_ten_decimal_digits_check", sql`${table.cik} ~ '^[0-9]{10}$'`),
  ],
);

export const instruments = pgTable(
  "instruments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    symbol: varchar("symbol", { length: 32 }).notNull(),
    name: text("name").notNull(),
    assetType: assetTypeEnum("asset_type").notNull(),
    exchange: varchar("exchange", { length: 64 }),
    currency: varchar("currency", { length: 3 }).notNull(),
    country: varchar("country", { length: 2 }),
    active: boolean("active").default(true).notNull(),
    ...timestamps,
  },
  (table) => [
    unique("instruments_symbol_exchange_unique").on(table.symbol, table.exchange).nullsNotDistinct(),
    index("instruments_company_id_idx").on(table.companyId),
  ],
);

export const priceBars = pgTable(
  "price_bars",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    instrumentId: uuid("instrument_id").notNull().references(() => instruments.id, { onDelete: "cascade" }),
    interval: barIntervalEnum("interval").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    open: numeric("open", { precision: 24, scale: 10 }).notNull(),
    high: numeric("high", { precision: 24, scale: 10 }).notNull(),
    low: numeric("low", { precision: 24, scale: 10 }).notNull(),
    close: numeric("close", { precision: 24, scale: 10 }).notNull(),
    volume: numeric("volume", { precision: 28, scale: 0 }),
    sourceId: uuid("source_id").notNull().references(() => dataSources.id),
    sourceAsOf: timestamp("source_as_of", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("price_bars_instrument_interval_timestamp_source_unique").on(table.instrumentId, table.interval, table.timestamp, table.sourceId),
    index("price_bars_instrument_timestamp_idx").on(table.instrumentId, table.timestamp),
  ],
);

export const fundamentalFacts = pgTable(
  "fundamental_facts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    taxonomy: varchar("taxonomy", { length: 128 }).notNull(),
    tag: varchar("tag", { length: 255 }).notNull(),
    value: numeric("value", { precision: 30, scale: 10 }).notNull(),
    unit: varchar("unit", { length: 64 }).notNull(),
    fiscalYear: integer("fiscal_year"),
    fiscalPeriod: varchar("fiscal_period", { length: 16 }),
    form: varchar("form", { length: 32 }).notNull(),
    reportingStart: date("reporting_start"),
    reportingEnd: date("reporting_end").notNull(),
    frame: varchar("frame", { length: 128 }),
    filingDate: date("filing_date").notNull(),
    accessionNumber: varchar("accession_number", { length: 32 }).notNull(),
    sourceId: uuid("source_id").notNull().references(() => dataSources.id),
    sourceAsOf: timestamp("source_as_of", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("fundamental_facts_identity_unique").on(
      table.companyId,
      table.sourceId,
      table.taxonomy,
      table.tag,
      table.unit,
      table.accessionNumber,
      table.form,
      table.filingDate,
      table.reportingStart,
      table.reportingEnd,
      table.fiscalYear,
      table.fiscalPeriod,
      table.frame,
    ).nullsNotDistinct(),
    index("fundamental_facts_company_tag_idx").on(table.companyId, table.tag),
  ],
);

export const secFilings = pgTable(
  "sec_filings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    form: varchar("form", { length: 32 }).notNull(),
    accessionNumber: varchar("accession_number", { length: 32 }).notNull(),
    filingDate: date("filing_date").notNull(),
    reportDate: date("report_date"),
    primaryDocument: text("primary_document"),
    sourceUrl: text("source_url").notNull(),
    sourceId: uuid("source_id").notNull().references(() => dataSources.id),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("sec_filings_source_accession_unique").on(table.sourceId, table.accessionNumber),
    index("sec_filings_company_filing_date_idx").on(table.companyId, table.filingDate),
  ],
);

export const newsArticles = pgTable(
  "news_articles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    instrumentId: uuid("instrument_id").references(() => instruments.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    summary: text("summary"),
    url: text("url").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    sourceId: uuid("source_id").notNull().references(() => dataSources.id),
    sourceAsOf: timestamp("source_as_of", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("news_articles_url_source_unique").on(table.url, table.sourceId), index("news_articles_instrument_published_idx").on(table.instrumentId, table.publishedAt)],
);

export const ingestionRecords = pgTable(
  "ingestion_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id").notNull().references(() => dataSources.id),
    resourceType: varchar("resource_type", { length: 100 }).notNull(),
    resourceKey: text("resource_key").notNull(),
    status: ingestionStatusEnum("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    sourceAsOf: timestamp("source_as_of", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    errorCode: varchar("error_code", { length: 100 }),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (table) => [index("ingestion_records_source_resource_idx").on(table.sourceId, table.resourceType, table.resourceKey), index("ingestion_records_status_started_idx").on(table.status, table.startedAt)],
);
