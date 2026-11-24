import {
  createDatabase,
  createRepositories,
  type Repositories,
} from "@ump/db";
import { requirePersistenceConfig, type UmpConfig } from "../config";
import { CuratedMappingRuntimeAuthorizationService } from "../identity/curated-mapping-runtime-authorization";
import { curatedStockMappingRegistry } from "../identity/curated-stock-mapping-registry-data";
import type { CuratedStockMappingRegistry } from "../identity/curated-stock-mapping-registry";
import { StoredSecQueryService } from "./stored-sec-query-service";

export interface TrustedFinancialQueryRuntime {
  readonly authorization: CuratedMappingRuntimeAuthorizationService;
  readonly queries: StoredSecQueryService;
}

export interface TrustedFinancialQueryRuntimeOptions {
  repositories: Repositories;
  /** Omit to use source-controlled authority; null represents unavailable authority. */
  registry?: CuratedStockMappingRegistry | null;
  clock?: () => Date;
}

/**
 * Internal-only trusted boundary. The source registry is snapshotted and its
 * complete version/history validated by the authorizer at construction.
 */
export function createTrustedFinancialQueryRuntime(
  options: TrustedFinancialQueryRuntimeOptions,
): TrustedFinancialQueryRuntime {
  const source = options.registry === undefined ? curatedStockMappingRegistry : options.registry;
  // Snapshot mutable caller-owned fixtures/configuration before it becomes authority.
  const registry = source === null ? undefined : structuredClone(source);
  const authorization = new CuratedMappingRuntimeAuthorizationService(
    options.repositories,
    registry,
    options.clock,
  );
  const queries = new StoredSecQueryService(options.repositories, authorization);
  return Object.freeze({ authorization, queries });
}

export interface DatabaseBackedTrustedFinancialQueryRuntime extends TrustedFinancialQueryRuntime {
  close(): Promise<void>;
}

/** Creates and owns a database pool for an explicitly persistence-enabled runtime. */
export function createDatabaseBackedTrustedFinancialQueryRuntime(
  config: UmpConfig,
  options: { clock?: () => Date; registry?: CuratedStockMappingRegistry | null } = {},
): DatabaseBackedTrustedFinancialQueryRuntime {
  const persistence = requirePersistenceConfig(config);
  const database = createDatabase({ connectionString: persistence.databaseUrl });
  const runtime = createTrustedFinancialQueryRuntime({
    repositories: createRepositories(database.db),
    ...(options.registry === undefined ? {} : { registry: options.registry }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  return { ...runtime, close: database.close };
}
