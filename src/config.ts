import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { GuardConfig } from "./types.js";
import type { FirewallConfig } from "./firewall-types.js";
import { AiSpendGuard } from "./guard.js";
import { SpendFirewall } from "./firewall.js";
import { JsonFileStore } from "./store.js";

export async function loadConfig(path = "ai-spend-guard.config.json"): Promise<GuardConfig> {
  const absolute = resolve(path);
  const raw = await readFile(absolute, "utf8");
  return JSON.parse(raw) as GuardConfig;
}

export async function createGuardFromConfig(path = "ai-spend-guard.config.json"): Promise<AiSpendGuard> {
  const absolute = resolve(path);
  const config = await loadConfig(absolute);
  const ledgerPath = config.ledgerPath
    ? resolve(dirname(absolute), config.ledgerPath)
    : resolve(dirname(absolute), ".ai-spend-guard", "ledger.json");
  return new AiSpendGuard(new JsonFileStore(ledgerPath), config);
}

export async function loadFirewallConfig(
  path = "ai-spend-firewall.config.json"
): Promise<FirewallConfig> {
  const absolute = resolve(path);
  const raw = await readFile(absolute, "utf8");
  return JSON.parse(raw) as FirewallConfig;
}

export async function createFirewallFromConfig(
  path = "ai-spend-firewall.config.json"
): Promise<SpendFirewall> {
  const absolute = resolve(path);
  const config = await loadFirewallConfig(absolute);
  const ledgerPath = config.ledgerPath
    ? resolve(dirname(absolute), config.ledgerPath)
    : resolve(dirname(absolute), ".ai-spend-guard", "firewall-ledger.json");
  return new SpendFirewall(new JsonFileStore(ledgerPath), config);
}
