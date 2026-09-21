import assert from "node:assert/strict";
import test from "node:test";
import {
  SpendFirewall,
  SpendPolicyError,
} from "../dist/index.js";
import { PostgresStore } from "../dist/postgres-store.js";

const connectionString = process.env.AI_SPEND_GUARD_POSTGRES_URL;

test(
  "PostgresStore enforces one shared budget across independent workers",
  { skip: !connectionString },
  async () => {
    const namespace = "ci-shared-budget";
    const aStore = await PostgresStore.open({
      connectionString,
      namespace,
    });
    const bStore = await PostgresStore.open({
      connectionString,
      namespace,
    });

    const config = {
      policies: [
        {
          id: "global",
          window: "lifetime",
          limitUsd: 1,
          maxConcurrent: 100,
        },
      ],
    };
    const a = new SpendFirewall(aStore, config);
    const b = new SpendFirewall(bStore, config);

    try {
      const attempts = Array.from({ length: 40 }, (_, index) => {
        const firewall = index % 2 === 0 ? a : b;
        return firewall
          .reserve({
            context: { provider: "openai", resource: "llm" },
            estimatedCostUsd: 0.05,
          })
          .then((reservation) => ({ ok: true, reservation }))
          .catch((error) => ({ ok: false, error }));
      });

      const results = await Promise.all(attempts);
      const allowed = results.filter((item) => item.ok);
      const denied = results.filter((item) => !item.ok);

      assert.equal(allowed.length, 20);
      assert.equal(denied.length, 20);
      assert.ok(
        denied.every((item) => item.error instanceof SpendPolicyError)
      );

      const status = await b.status();
      assert.ok(
        Math.abs(status.policies[0].usage.reservedUsd - 1) < 1e-9
      );

      await Promise.all(
        allowed.map((item) => item.reservation.release())
      );

      const after = await a.status();
      assert.equal(after.policies[0].usage.reservedUsd, 0);
    } finally {
      await aStore.close();
      await bStore.close();
    }
  }
);

test(
  "Postgres namespaces isolate independent applications",
  { skip: !connectionString },
  async () => {
    const oneStore = await PostgresStore.open({
      connectionString,
      namespace: "ci-app-one",
    });
    const twoStore = await PostgresStore.open({
      connectionString,
      namespace: "ci-app-two",
    });
    const config = {
      policies: [{ id: "global", window: "lifetime", limitUsd: 1 }],
    };
    const one = new SpendFirewall(oneStore, config);
    const two = new SpendFirewall(twoStore, config);

    try {
      await one.recordActual({
        context: { provider: "openai", resource: "llm" },
        actualCostUsd: 0.9,
      });

      const reservation = await two.reserve({
        context: { provider: "openai", resource: "llm" },
        estimatedCostUsd: 0.9,
      });
      await reservation.release();

      await assert.rejects(
        () =>
          one.reserve({
            context: { provider: "openai", resource: "llm" },
            estimatedCostUsd: 0.2,
          }),
        SpendPolicyError
      );
    } finally {
      await oneStore.close();
      await twoStore.close();
    }
  }
);
