CREATE TYPE "public"."mapping_lifecycle" AS ENUM('active', 'retired', 'superseded');
CREATE TABLE "curated_stock_mapping_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mapping_id" varchar(64) NOT NULL, "revision" integer NOT NULL, "revision_id" varchar(80) NOT NULL,
  "instrument_id" uuid NOT NULL REFERENCES "instruments"("id"), "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "lifecycle" "mapping_lifecycle" NOT NULL, "successor_revision_id" varchar(80),
  "effective_from" timestamp with time zone NOT NULL, "effective_to" timestamp with time zone, "change_reason" text NOT NULL,
  "listing_evidence_source_id" uuid NOT NULL REFERENCES "data_sources"("id"), "listing_evidence_reference" text NOT NULL, "listing_evidence_retrieved_at" timestamp with time zone NOT NULL,
  "sec_evidence_source_id" uuid NOT NULL REFERENCES "data_sources"("id"), "sec_evidence_reference" text NOT NULL, "sec_evidence_retrieved_at" timestamp with time zone NOT NULL,
  "approval_status" varchar(16) NOT NULL, "approved_by" text NOT NULL, "approved_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "curated_stock_mapping_effective_dates_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "curated_stock_mapping_approval_status_check" CHECK ("approval_status" IN ('approved', 'pending', 'rejected')),
  CONSTRAINT "curated_stock_mapping_initial_lifecycle_check" CHECK ("lifecycle" = 'active' AND "successor_revision_id" IS NULL)
);
CREATE UNIQUE INDEX "curated_stock_mapping_revision_id_unique" ON "curated_stock_mapping_revisions" USING btree ("revision_id");
CREATE UNIQUE INDEX "curated_stock_mapping_mapping_revision_unique" ON "curated_stock_mapping_revisions" USING btree ("mapping_id", "revision");
CREATE INDEX "curated_stock_mapping_instrument_idx" ON "curated_stock_mapping_revisions" USING btree ("instrument_id");
CREATE TABLE "curated_stock_mapping_lifecycle_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "revision_id" varchar(80) NOT NULL REFERENCES "curated_stock_mapping_revisions"("revision_id"),
  "lifecycle" "mapping_lifecycle" NOT NULL, "successor_revision_id" varchar(80),
  "effective_from" timestamp with time zone NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL,
  CONSTRAINT "curated_stock_mapping_lifecycle_event_successor_check" CHECK (("lifecycle" = 'superseded') = ("successor_revision_id" IS NOT NULL))
);
CREATE UNIQUE INDEX "curated_stock_mapping_lifecycle_event_unique" ON "curated_stock_mapping_lifecycle_events" USING btree ("revision_id", "lifecycle", "successor_revision_id", "effective_from", "recorded_at") NULLS NOT DISTINCT;
