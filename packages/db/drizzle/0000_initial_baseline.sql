CREATE TYPE "public"."asset_type" AS ENUM('stock', 'etf', 'fund', 'bond', 'crypto', 'other');--> statement-breakpoint
CREATE TYPE "public"."bar_interval" AS ENUM('1m', '5m', '15m', '1h', '1d', '1wk', '1mo');--> statement-breakpoint
CREATE TYPE "public"."ingestion_status" AS ENUM('started', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"cik" varchar(10),
	"country" varchar(2),
	"sic_code" varchar(10),
	"sic_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_cik_ten_decimal_digits_check" CHECK ("companies"."cik" ~ '^[0-9]{10}$')
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"base_url" text,
	"is_delayed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fundamental_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"taxonomy" varchar(128) NOT NULL,
	"tag" varchar(255) NOT NULL,
	"value" numeric(30, 10) NOT NULL,
	"unit" varchar(64) NOT NULL,
	"fiscal_year" integer,
	"fiscal_period" varchar(16),
	"form" varchar(32) NOT NULL,
	"reporting_start" date,
	"reporting_end" date NOT NULL,
	"frame" varchar(128),
	"filing_date" date NOT NULL,
	"accession_number" varchar(32) NOT NULL,
	"source_id" uuid NOT NULL,
	"source_as_of" timestamp with time zone,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fundamental_facts_identity_unique" UNIQUE NULLS NOT DISTINCT("company_id","source_id","taxonomy","tag","unit","accession_number","form","filing_date","reporting_start","reporting_end","fiscal_year","fiscal_period","frame")
);
--> statement-breakpoint
CREATE TABLE "ingestion_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"resource_type" varchar(100) NOT NULL,
	"resource_key" text NOT NULL,
	"status" "ingestion_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"source_as_of" timestamp with time zone,
	"fetched_at" timestamp with time zone,
	"error_code" varchar(100),
	"error_message" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"symbol" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"asset_type" "asset_type" NOT NULL,
	"exchange" varchar(64),
	"currency" varchar(3) NOT NULL,
	"country" varchar(2),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instruments_symbol_exchange_unique" UNIQUE NULLS NOT DISTINCT("symbol","exchange")
);
--> statement-breakpoint
CREATE TABLE "news_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" uuid,
	"title" text NOT NULL,
	"summary" text,
	"url" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"source_id" uuid NOT NULL,
	"source_as_of" timestamp with time zone,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_bars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"interval" "bar_interval" NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"open" numeric(24, 10) NOT NULL,
	"high" numeric(24, 10) NOT NULL,
	"low" numeric(24, 10) NOT NULL,
	"close" numeric(24, 10) NOT NULL,
	"volume" numeric(28, 0),
	"source_id" uuid NOT NULL,
	"source_as_of" timestamp with time zone,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sec_filings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"form" varchar(32) NOT NULL,
	"accession_number" varchar(32) NOT NULL,
	"filing_date" date NOT NULL,
	"report_date" date,
	"primary_document" text,
	"source_url" text NOT NULL,
	"source_id" uuid NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fundamental_facts" ADD CONSTRAINT "fundamental_facts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundamental_facts" ADD CONSTRAINT "fundamental_facts_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_records" ADD CONSTRAINT "ingestion_records_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_articles" ADD CONSTRAINT "news_articles_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_articles" ADD CONSTRAINT "news_articles_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_bars" ADD CONSTRAINT "price_bars_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_bars" ADD CONSTRAINT "price_bars_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sec_filings" ADD CONSTRAINT "sec_filings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sec_filings" ADD CONSTRAINT "sec_filings_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_cik_unique" ON "companies" USING btree ("cik");--> statement-breakpoint
CREATE UNIQUE INDEX "data_sources_provider_name_unique" ON "data_sources" USING btree ("provider","name");--> statement-breakpoint
CREATE INDEX "fundamental_facts_company_tag_idx" ON "fundamental_facts" USING btree ("company_id","tag");--> statement-breakpoint
CREATE INDEX "ingestion_records_source_resource_idx" ON "ingestion_records" USING btree ("source_id","resource_type","resource_key");--> statement-breakpoint
CREATE INDEX "ingestion_records_status_started_idx" ON "ingestion_records" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "instruments_company_id_idx" ON "instruments" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "news_articles_url_source_unique" ON "news_articles" USING btree ("url","source_id");--> statement-breakpoint
CREATE INDEX "news_articles_instrument_published_idx" ON "news_articles" USING btree ("instrument_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_bars_instrument_interval_timestamp_source_unique" ON "price_bars" USING btree ("instrument_id","interval","timestamp","source_id");--> statement-breakpoint
CREATE INDEX "price_bars_instrument_timestamp_idx" ON "price_bars" USING btree ("instrument_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "sec_filings_source_accession_unique" ON "sec_filings" USING btree ("source_id","accession_number");--> statement-breakpoint
CREATE INDEX "sec_filings_company_filing_date_idx" ON "sec_filings" USING btree ("company_id","filing_date");