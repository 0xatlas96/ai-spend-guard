import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  NodeSqliteStore,
  SpendFirewall,
  SpendPolicyError,
} from "../dist/index.js";

const [major, minor] = process.versions.node.split(".").map(Number);
const sqliteAvailable = major > 22 || (major === 22 && minor >= 5);

test(
  "NodeSqliteStore shares transactional budget state across store instances",
  { skip: !sqliteAvailable },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-spend-guard-"));
    const path = join(dir, "ledger.sqlite");
    const storeA = await NodeSqliteStore.open(path);
    const storeB = await NodeSqliteStore.open(path);

    try {
      const config = {
        policies: [{ id: "global", window: "utc-day", limitUsd: 1 }],
      };
      const a = new SpendFirewall(storeA, config);
      const b = new SpendFirewall(storeB, config);

      const reservation = await a.reserve({
        context: { provider: "openai", resource: "llm" },
        estimatedCostUsd: 0.7,
      });

      await assert.rejects(
        () =>
          b.reserve({
            context: { provider: "anthropic", resource: "llm" },
            estimatedCostUsd: 0.4,
          }),
        SpendPolicyError
      );

      await reservation.settle(0.6);
      const status = await b.status();
      assert.equal(status.policies[0].usage.actualUsd, 0.6);
      assert.equal(status.policies[0].usage.reservedUsd, 0);
    } finally {
      storeA.close();
      storeB.close();
      await rm(dir, { recursive: true, force: true });
    }
  }
);
