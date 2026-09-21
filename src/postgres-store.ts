import type { Pool, PoolClient } from "pg";
import type { LedgerState, LedgerStore } from "./types.js";
import { emptyLedger } from "./store.js";

export interface PostgresStoreOptions {
  connectionString?: string;
  pool?: Pool;
  /** Independent budget ledger inside the same database. Defaults to "default". */
  namespace?: string;
  /** Defaults to "ai_spend_guard_state". */
  tableName?: string;
  maxConnections?: number;
  statementTimeoutMs?: number;
}

export class PostgresStore implements LedgerStore {
  private constructor(
    private readonly pool: Pool,
    private readonly ownsPool: boolean,
    private readonly namespace: string,
    private readonly tableName: string
  ) {}

  static async open(options: PostgresStoreOptions): Promise<PostgresStore> {
    if (!options.pool && !options.connectionString) {
      throw new Error("PostgresStore requires connectionString or an existing pg Pool.");
    }

    const tableName = options.tableName ?? "ai_spend_guard_state";
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      throw new Error(
        "PostgresStore tableName must contain only letters, numbers, and underscores and cannot start with a number."
      );
    }

    const namespace = options.namespace ?? "default";
    if (!namespace.trim()) {
      throw new Error("PostgresStore namespace must be a non-empty string.");
    }

    let pool = options.pool;
    let ownsPool = false;

    if (!pool) {
      const pg = await import("pg");
      pool = new pg.Pool({
        connectionString: options.connectionString,
        max: options.maxConnections ?? 10,
        ...(options.statementTimeoutMs !== undefined
          ? { statement_timeout: options.statementTimeoutMs }
          : {}),
      });
      ownsPool = true;
    }

    const store = new PostgresStore(pool, ownsPool, namespace, tableName);
    await store.initialize();
    return store;
  }

  async read(): Promise<LedgerState> {
    const result = await this.pool.query<{ payload: LedgerState }>(
      `SELECT payload FROM ${quoteIdentifier(this.tableName)} WHERE namespace = $1`,
      [this.namespace]
    );
    if (result.rowCount === 0) return emptyLedger();
    return validateState(result.rows[0]!.payload);
  }

  async transact<T>(
    fn: (state: LedgerState) => T | Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const state = await this.lockAndLoad(client);
      const result = await fn(state);
      await client.query(
        `UPDATE ${quoteIdentifier(this.tableName)}
         SET payload = $2::jsonb, updated_at = NOW()
         WHERE namespace = $1`,
        [this.namespace, JSON.stringify(state)]
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve original transaction error.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }

  private async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${quoteIdentifier(this.tableName)} (
        namespace TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.pool.query(
      `INSERT INTO ${quoteIdentifier(this.tableName)} (namespace, payload)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (namespace) DO NOTHING`,
      [this.namespace, JSON.stringify(emptyLedger())]
    );
  }

  private async lockAndLoad(client: PoolClient): Promise<LedgerState> {
    const result = await client.query<{ payload: LedgerState }>(
      `SELECT payload
       FROM ${quoteIdentifier(this.tableName)}
       WHERE namespace = $1
       FOR UPDATE`,
      [this.namespace]
    );

    if (result.rowCount === 0) {
      await client.query(
        `INSERT INTO ${quoteIdentifier(this.tableName)} (namespace, payload)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (namespace) DO NOTHING`,
        [this.namespace, JSON.stringify(emptyLedger())]
      );
      const retry = await client.query<{ payload: LedgerState }>(
        `SELECT payload
         FROM ${quoteIdentifier(this.tableName)}
         WHERE namespace = $1
         FOR UPDATE`,
        [this.namespace]
      );
      return validateState(retry.rows[0]!.payload);
    }

    return validateState(result.rows[0]!.payload);
  }
}

function validateState(value: unknown): LedgerState {
  const parsed =
    typeof value === "string"
      ? (JSON.parse(value) as LedgerState)
      : (value as LedgerState);

  if (
    !parsed ||
    parsed.version !== 1 ||
    !parsed.reservations ||
    typeof parsed.reservations !== "object" ||
    !Array.isArray(parsed.charges)
  ) {
    throw new Error("Unsupported or invalid Postgres ledger format.");
  }

  return structuredClone(parsed);
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
