const baseUrl = process.env.AI_SPEND_GUARD_URL ?? "http://127.0.0.1:8787";
const token = process.env.AI_SPEND_GUARD_TOKEN;

const headers = {
  "Content-Type": "application/json",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

const reserve = await fetch(baseUrl + "/api/reserve", {
  method: "POST",
  headers,
  body: JSON.stringify({
    context: {
      provider: "openai",
      resource: "llm",
      userId: "alice",
    },
    estimatedCostUsd: 0.05,
    idempotencyKey: "job-123",
  }),
});

if (!reserve.ok) {
  console.error(await reserve.json());
  process.exit(2);
}

const reservation = await reserve.json();

try {
  // Replace with your paid operation.
  const actualCostUsd = 0.031;

  const settle = await fetch(baseUrl + "/api/settle", {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: reservation.id,
      actualCostUsd,
    }),
  });

  if (!settle.ok) throw new Error(JSON.stringify(await settle.json()));
  console.log(await settle.json());
} catch (error) {
  // Do not blindly release on ambiguous provider failures.
  console.error("Reconcile reservation before release:", reservation.id);
  throw error;
}
