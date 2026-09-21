import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  JsonFileStore,
  MemoryStore,
  SpendFirewall,
  SpendPolicyError,
} from "../dist/index.js";

const config = {
  requiredContext: ["provider", "resource"],
  policies: [
    {
      id: "global",
      window: "utc-day",
      limitUsd: 1,
      maxConcurrent: 100,
    },
  ],
};

async function hammer(firewalls) {
  const attempts = Array.from({ length: 40 }, (_, index) => {
    const firewall = firewalls[index % firewalls.length];
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
  assert.ok(denied.every((item) => item.error instanceof SpendPolicyError));

  const status = await firewalls[0].status();
  const global = status.policies.find((entry) => entry.policy.id === "global");
  assert.ok(global);
  assert.ok(Math.abs(global.usage.projectedUsd - 1) < 1e-9);

  await Promise.all(allowed.map((item) => item.reservation.release()));
}

test("MemoryStore admits exactly the remaining budget under parallel pressure", async () => {
  const store = new MemoryStore();
  const firewall = new SpendFirewall(store, config);
  await hammer([firewall]);
});

test("JsonFileStore coordinates independent instances under parallel pressure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ai-spend-guard-json-"));
  const path = join(dir, "ledger.json");

  try {
    const a = new SpendFirewall(new JsonFileStore(path), config);
    const b = new SpendFirewall(new JsonFileStore(path), config);
    await hammer([a, b]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
