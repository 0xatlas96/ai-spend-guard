import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { LedgerState, LedgerStore } from "./types.js";
import { emptyLedger } from "./store.js";
import { Mutex } from "./mutex.js";

const mutexes = new Map<string, Mutex>();

function mutexFor(path: string): Mutex {
  const existing = mutexes.get(path);
  if (existing) return existing;
  const created = new Mutex();
  mutexes.set(path, created);
  return created;
}

export interface NodeSqliteStoreOptions {
  busyTimeoutMs?: number;
}

/**
 * Transactional SQLite ledger using Node's built-in node:sqlite module.
 *
 * Requires Node >= 22.5.0. The module is loaded dynamically so importing
 * ai-spend-guard still works on Node 20 when this store is unused.
 */
export class NodeSqliteStore implements LedgerStore {
  readonly path: string;
  private readonly mutex: Mutex;

  private constructor(
    private readonly db: DatabaseSync,
    path: string,
    busyTimeoutMs: number
  ) {
    this.path = path;
    this.mutex = mutexFor(path);
    this.db.exec(`PRAGMA busy_timeout = ${Math.floor(busyTimeoutMs)}`);
    if (path !== ":memory:") {
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA synchronous = NORMAL");
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_spend_guard_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL
      ) STRICT;
      INSERT OR IGNORE INTO ai_spend_guard_state (id, payload)
      VALUES (1, '{"version":1,"reservations":{},"charges":[]}');
    `);
  }

  static async open(
    path: string,
    options: NodeSqliteStoreOptions = {}
  ): Promise<NodeSqliteStore> {
    const runtimeMajor = Number(process.versions.node.split(".")[0]);
    const runtimeMinor = Number(process.versions.node.split(".")[1]);
    if (
      !Number.isFinite(runtimeMajor) ||
      runtimeMajor < 22 ||
      (runtimeMajor === 22 && runtimeMinor < 5)
    ) {
      throw new Error(
        `NodeSqliteStore requires Node >= 22.5.0; current runtime is ${process.versions.node}.`
      );
    }

    const chosenPath = path === ":memory:" ? path : resolve(path);
    if (chosenPath !== ":memory:") {
      await mkdir(dirname(chosenPath), { recursive: true });
    }

    const sqlite = await import("node:sqlite");
    const db = new sqlite.DatabaseSync(chosenPath);
    return new NodeSqliteStore(
      db,
      chosenPath,
      options.busyTimeoutMs ?? 5_000
    );
  }

  async read(): Promise<LedgerState> {
    return this.mutex.runExclusive(() => this.load());
  }

  async transact<T>(
    fn: (state: LedgerState) => T | Promise<T>
  ): Promise<T> {
    return this.mutex.runExclusive(async () => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const state = this.load();
        const result = await fn(state);
        this.save(state);
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          // Preserve the original transaction error.
        }
        throw error;
      }
    });
  }

  close(): void {
    this.db.close();
  }

  private load(): LedgerState {
    const statement = this.db.prepare(
      "SELECT payload FROM ai_spend_guard_state WHERE id = 1"
    );
    const row = statement.get() as { payload?: unknown } | undefined;
    if (!row || typeof row.payload !== "string") return emptyLedger();
    const parsed = JSON.parse(row.payload) as LedgerState;
    if (
      parsed.version !== 1 ||
      !parsed.reservations ||
      !Array.isArray(parsed.charges)
    ) {
      throw new Error("Unsupported or invalid SQLite ledger format.");
    }
    return structuredClone(parsed);
  }

  private save(state: LedgerState): void {
    const statement = this.db.prepare(
      "UPDATE ai_spend_guard_state SET payload = ? WHERE id = 1"
    );
    statement.run(JSON.stringify(state));
  }
}
