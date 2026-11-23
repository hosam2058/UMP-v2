import {
  CURATED_STOCK_MAPPING_REGISTRY_VERSION,
  type CuratedStockMappingRegistry,
} from "./curated-stock-mapping-registry";

/**
 * Deliberately empty: additions require source-backed evidence and explicit human approval.
 * This module is source-controlled configuration, not an ingestion trigger.
 */
export const curatedStockMappingRegistry: CuratedStockMappingRegistry = {
  version: CURATED_STOCK_MAPPING_REGISTRY_VERSION,
  revisions: [],
  lifecycleEvents: [],
};
