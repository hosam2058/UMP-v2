import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export interface DatabaseConnectionConfig {
  connectionString: string;
  pool?: Omit<pg.PoolConfig, "connectionString">;
}

/**
 * Creates an independently owned database pool and Drizzle handle. Callers
 * must validate connection configuration before invoking this boundary and
 * must call close during their shutdown lifecycle.
 */
export function createDatabase(config: DatabaseConnectionConfig) {
  const pool = new Pool({ ...config.pool, connectionString: config.connectionString });
  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    close: () => pool.end(),
  };
}

export * from "./schema";
