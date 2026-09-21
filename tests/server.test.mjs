import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryStore,
  SpendFirewall,
  startSpendGuardServer,
} from "../dist/index.js";

function firewall() {
  return new SpendFirewall(new MemoryStore(), {
    requiredContext: ["provider", "resource"],
    policies: [
      {
        id: "global",
        window: "lifetime",
        limitUsd: 1,
      },
    ],
  });
}

test("HTTP sidecar exposes dashboard, explain, reserve, settle, and status", async () => {
  const server = await startSpendGuardServer(firewall(), {
    port: 0,
    token: "test-token",
  });

  try {
    const unauthorized = await fetch(server.url + "/api/status");
    assert.equal(unauthorized.status, 401);

    const headers = {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    };

    const dashboard = await fetch(server.url + "/", {
      headers: { Authorization: "Bearer test-token" },
    });
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /AI Spend Guard/);

    const explain = await fetch(server.url + "/api/explain", {
      method: "POST",
      headers,
      body: JSON.stringify({
        context: { provider: "openai", resource: "llm" },
        estimatedCostUsd: 0.2,
      }),
    });
    assert.equal(explain.status, 200);
    assert.equal((await explain.json()).allowed, true);

    const reserve = await fetch(server.url + "/api/reserve", {
      method: "POST",
      headers,
      body: JSON.stringify({
        context: { provider: "openai", resource: "llm" },
        estimatedCostUsd: 0.8,
      }),
    });
    assert.equal(reserve.status, 201);
    const reservation = await reserve.json();
    assert.equal(typeof reservation.id, "string");

    const blocked = await fetch(server.url + "/api/reserve", {
      method: "POST",
      headers,
      body: JSON.stringify({
        context: { provider: "video", resource: "video" },
        estimatedCostUsd: 0.3,
      }),
    });
    assert.equal(blocked.status, 402);
    const blockedBody = await blocked.json();
    assert.equal(blockedBody.error.code, "spend-policy-blocked");

    const settle = await fetch(server.url + "/api/settle", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: reservation.id,
        actualCostUsd: 0.5,
      }),
    });
    assert.equal(settle.status, 200);

    const status = await fetch(server.url + "/api/status", { headers });
    const statusBody = await status.json();
    assert.equal(statusBody.openReservations, 0);
    assert.equal(statusBody.policies[0].usage.actualUsd, 0.5);
  } finally {
    await server.close();
  }
});

test("HTTP sidecar refuses remote bind without authentication", async () => {
  await assert.rejects(
    () =>
      startSpendGuardServer(firewall(), {
        host: "0.0.0.0",
        port: 0,
      }),
    /non-loopback address without a bearer token/
  );
});

test("HTTP sidecar caps JSON request bodies", async () => {
  const server = await startSpendGuardServer(firewall(), {
    port: 0,
    maxBodyBytes: 64,
  });

  try {
    const response = await fetch(server.url + "/api/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: {
          provider: "openai",
          resource: "llm",
          userId: "this-value-makes-the-body-larger-than-the-test-cap",
        },
        estimatedCostUsd: 0.1,
      }),
    });

    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, "body-too-large");
  } finally {
    await server.close();
  }
});
