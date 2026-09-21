import { SpendFirewall } from "ai-spend-guard";
import { PostgresStore } from "ai-spend-guard/postgres";

const store = await PostgresStore.open({
  connectionString: process.env.DATABASE_URL!,
  namespace: "production",
});

const firewall = new SpendFirewall(store, {
  requiredContext: ["provider", "resource"],
  policies: [
    {
      id: "global-monthly",
      window: "utc-month",
      limitUsd: 500,
    },
  ],
});

console.log(await firewall.status());

await store.close();
