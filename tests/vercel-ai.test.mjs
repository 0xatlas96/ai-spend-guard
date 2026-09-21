import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryStore,
  SpendFirewall,
  SpendReconciliationRequiredError,
} from "../dist/index.js";
import { createVercelAiSpendMiddleware } from "../dist/vercel-ai.js";

const usage = {
  inputTokens: {
    total: 100,
    noCache: 100,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 50,
    text: 50,
    reasoning: undefined,
  },
};

const model = {
  specificationVersion: "v3",
  provider: "openai.responses",
  modelId: "example-model",
  supportedUrls: {},
};

function params(metadata = {}) {
  return {
    prompt: [],
    providerOptions: {
      aiSpendGuard: metadata,
    },
  };
}

test("Vercel AI middleware reserves before generate and settles actual usage", async () => {
  const firewall = new SpendFirewall(new MemoryStore(), {
    requiredContext: ["provider", "resource", "userId"],
    policies: [
      {
        id: "per-user",
        groupBy: ["userId"],
        window: "lifetime",
        limitUsd: 1,
      },
    ],
  });

  let called = false;
  const middleware = createVercelAiSpendMiddleware({
    firewall,
    defaultEstimatedCostUsd: 0.2,
    actualCostUsd: ({ usage }) =>
      (usage.inputTokens.total ?? 0) * 0.0001 +
      (usage.outputTokens.total ?? 0) * 0.0002,
  });

  const result = await middleware.wrapGenerate({
    params: params({ userId: "alice" }),
    model,
    doGenerate: async () => {
      const status = await firewall.status();
      assert.equal(status.openReservations, 1);
      called = true;
      return {
        content: [],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      };
    },
    doStream: async () => {
      throw new Error("unused");
    },
  });

  assert.equal(called, true);
  assert.deepEqual(result.content, []);

  const status = await firewall.status();
  assert.equal(status.openReservations, 0);
  assert.ok(Math.abs(status.policies[0].usage.actualUsd - 0.02) < 1e-9);
});

test("Vercel AI middleware request metadata supplies context and estimate", async () => {
  const firewall = new SpendFirewall(new MemoryStore(), {
    requiredContext: ["provider", "resource", "projectId"],
    policies: [
      {
        id: "project",
        groupBy: ["projectId"],
        window: "lifetime",
        limitUsd: 0.1,
      },
    ],
  });

  const middleware = createVercelAiSpendMiddleware({ firewall });

  await assert.rejects(
    () =>
      middleware.wrapGenerate({
        params: params({
          projectId: "demo",
          estimatedCostUsd: 0.2,
        }),
        model,
        doGenerate: async () => ({
          content: [],
          finishReason: { unified: "stop", raw: "stop" },
          usage,
          warnings: [],
        }),
        doStream: async () => {
          throw new Error("unused");
        },
      }),
    /Spend blocked by policy/
  );

  const status = await firewall.status();
  assert.equal(status.openReservations, 0);
});

test("Vercel AI streaming middleware settles on finish usage event", async () => {
  const firewall = new SpendFirewall(new MemoryStore(), {
    policies: [{ id: "global", window: "lifetime", limitUsd: 1 }],
  });

  const middleware = createVercelAiSpendMiddleware({
    firewall,
    defaultEstimatedCostUsd: 0.3,
    actualCostUsd: () => 0.12,
  });

  const wrapped = await middleware.wrapStream({
    params: params(),
    model,
    doGenerate: async () => {
      throw new Error("unused");
    },
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage,
          });
          controller.close();
        },
      }),
    }),
  });

  const reader = wrapped.stream.getReader();
  const seen = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    seen.push(next.value.type);
  }

  assert.deepEqual(seen, ["stream-start", "finish"]);
  const status = await firewall.status();
  assert.equal(status.openReservations, 0);
  assert.equal(status.policies[0].usage.actualUsd, 0.12);
});

test("Vercel AI middleware keeps ambiguous generate failures reserved", async () => {
  const firewall = new SpendFirewall(new MemoryStore(), {
    policies: [{ id: "global", window: "lifetime", limitUsd: 1 }],
  });

  const events = [];
  const middleware = createVercelAiSpendMiddleware({
    firewall,
    defaultEstimatedCostUsd: 0.25,
    onReconciliationRequired: (event) => {
      events.push(event);
    },
  });

  let error;
  try {
    await middleware.wrapGenerate({
      params: params(),
      model,
      doGenerate: async () => {
        throw new Error("timeout after dispatch");
      },
      doStream: async () => {
        throw new Error("unused");
      },
    });
  } catch (caught) {
    error = caught;
  }

  assert.ok(error instanceof SpendReconciliationRequiredError);
  assert.equal(events.length, 1);

  const status = await firewall.status();
  assert.equal(status.openReservations, 1);

  const open = await firewall.listReservations();
  await firewall.release(open[0].reservation.id);
});
