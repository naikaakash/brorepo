import type { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import type { PoolClient, PoolConfig } from "pg";
import { requireCondition } from "./errors.js";

export interface Queryable {
  query<T>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}
export type Database = PGlite | PostgresDatabase;

export function postgresConfig(connectionString: string, poolSize = 5): PoolConfig {
  let url: URL;
  try { url = new URL(connectionString); }
  catch { throw new Error("Set APPLYMATE_DATABASE_URL to a valid PostgreSQL URL; credentials are not logged."); }
  requireCondition(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname && url.pathname.length > 1,
    500, "DATABASE_CONFIG", "A PostgreSQL database URL with a hostname and database is required.");
  requireCondition(!url.search,
    500, "DATABASE_CONFIG", "Database URL query parameters are not allowed; configure pooling and verified TLS through ApplyMate.");
  requireCondition(Number.isInteger(poolSize) && poolSize >= 1 && poolSize <= 20,
    500, "DATABASE_CONFIG", "APPLYMATE_DATABASE_POOL_SIZE must be an integer from 1 through 20.");
  return {
    connectionString, max: poolSize, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
    statement_timeout: 30000, idle_in_transaction_session_timeout: 30000,
    ssl: ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ? false : { rejectUnauthorized: true },
    application_name: "applymate"
  };
}

function connection(client: PoolClient): Queryable {
  return {
    query: async <T>(sql: string, parameters?: unknown[]) => {
      const result = await client.query(sql, parameters);
      return { rows: result.rows as T[] };
    },
    exec: (sql) => client.query(sql)
  };
}

export class PostgresDatabase implements Queryable {
  readonly pool: Pool;
  constructor(connectionString: string, poolSize?: number) {
    this.pool = new Pool(postgresConfig(connectionString, poolSize));
    this.pool.on("error", () => {
      console.error("[ApplyMate] An idle database connection failed. No credentials or query data recorded.");
    });
  }
  async query<T>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }> {
    const result = await this.pool.query(sql, parameters);
    return { rows: result.rows as T[] };
  }
  async exec(sql: string): Promise<unknown> { return this.pool.query(sql); }
  async transaction<T>(operation: (client: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query("BEGIN");
      const result = await operation(connection(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); }
      catch {
        discard = true;
        console.error("[ApplyMate] Database rollback failed; discarding the connection. No query data recorded.");
      }
      throw error;
    } finally { client.release(discard); }
  }
  async close(): Promise<void> { await this.pool.end(); }
}
