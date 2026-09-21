import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { LedgerState, LedgerStore } from "./types.js";
import { Mutex } from "./mutex.js";

export function emptyLedger(): LedgerState {
  return { version: 1, reservations: {}, charges: [] };
}

function cloneState(state: LedgerState): LedgerState {
  return structuredClone(state);
}

export class MemoryStore implements LedgerStore {
  private state: LedgerState;
  private readonly mutex = new Mutex();

  constructor(initial?: LedgerState) {
    this.state = initial ? cloneState(initial) : emptyLedger();
  }

  async transact<T>(fn: (state: LedgerState) => T | Promise<T>): Promise<T> {
    return this.mutex.runExclusive(async () => {
      const working = cloneState(this.state);
      const result = await fn(working);
      this.state = working;
      return result;
    });
  }

  async read(): Promise<LedgerState> {
    return this.mutex.runExclusive(() => cloneState(this.state));
  }
}

export interface JsonFileStoreOptions {
  lockTimeoutMs?: number;
  lockRetryMs?: number;
}

/**
 * Small local persistent store with a cross-process lock file.
 * Intended for CLIs, scripts and single-host services. For distributed systems,
 * implement LedgerStore on top of a transactional database.
 */
export class JsonFileStore implements LedgerStore {
  readonly path: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryMs: number;
  private readonly mutex = new Mutex();

  constructor(path: string, options: JsonFileStoreOptions = {}) {
    this.path = resolve(path);
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
    this.lockRetryMs = options.lockRetryMs ?? 25;
  }

  async read(): Promise<LedgerState> {
    return this.mutex.runExclusive(async () => {
      const release = await this.acquireFileLock();
      try {
        return await this.load();
      } finally {
        await release();
      }
    });
  }

  async transact<T>(fn: (state: LedgerState) => T | Promise<T>): Promise<T> {
    return this.mutex.runExclusive(async () => {
      const release = await this.acquireFileLock();
      try {
        const state = await this.load();
        const result = await fn(state);
        await this.save(state);
        return result;
      } finally {
        await release();
      }
    });
  }

  private async load(): Promise<LedgerState> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as LedgerState;
      if (parsed.version !== 1 || !parsed.reservations || !Array.isArray(parsed.charges)) {
        throw new Error(`Unsupported or invalid ledger format at ${this.path}`);
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyLedger();
      }
      throw error;
    }
  }

  private async save(state: LedgerState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temp, this.path);
  }

  private async acquireFileLock(): Promise<() => Promise<void>> {
    await mkdir(dirname(this.path), { recursive: true });
    const lockPath = `${this.path}.lock`;
    const deadline = Date.now() + this.lockTimeoutMs;

    for (;;) {
      try {
        const handle = await open(lockPath, "wx");
        await handle.writeFile(`${process.pid}\n`, "utf8");
        await handle.close();
        return async () => {
          try {
            await unlink(lockPath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for ledger lock: ${lockPath}`);
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, this.lockRetryMs));
      }
    }
  }
}
