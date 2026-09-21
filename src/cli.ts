#!/usr/bin/env node
import { createGuardFromConfig } from "./config.js";
import { BudgetExceededError } from "./errors.js";
import type { GuardStatus, ScopeStatus } from "./types.js";

const args = process.argv.slice(2);
const command = args.shift() ?? "help";

function value(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function num(flag: string): number {
  const raw = value(flag);
  if (raw === undefined) throw new Error(`Missing ${flag}`);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative number`);
  return parsed;
}

function configPath(): string {
  return value("--config") ?? "ai-spend-guard.config.json";
}

async function main(): Promise<void> {
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(`ai-spend-guard\n\nCommands:\n  status [--config path] [--json]\n  reserve --provider name --cost usd [--config path]\n  settle --id reservation --cost usd [--config path]\n  release --id reservation [--config path]\n  record --provider name --cost usd [--config path]\n`);
    return;
  }

  const guard = await createGuardFromConfig(configPath());

  if (command === "status") {
    const status = await guard.status();
    if (args.includes("--json")) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    printStatus(status);
    return;
  }

  if (command === "reserve") {
    const reservation = await guard.reserve({
      provider: required("--provider"),
      estimatedCostUsd: num("--cost"),
    });
    console.log(reservation.id);
    return;
  }

  if (command === "settle") {
    const result = await guard.settle(required("--id"), { actualCostUsd: num("--cost") });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "release") {
    await guard.release(required("--id"));
    console.log("released");
    return;
  }

  if (command === "record") {
    const charge = await guard.record({ provider: required("--provider"), costUsd: num("--cost") });
    console.log(JSON.stringify(charge, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function required(flag: string): string {
  const result = value(flag);
  if (!result) throw new Error(`Missing ${flag}`);
  return result;
}

function printStatus(status: GuardStatus): void {
  console.log(`AI Spend Guard — ${status.generatedAt}`);
  printScope("global", status.global);
  for (const [provider, scope] of Object.entries(status.providers)) printScope(provider, scope);
  console.log(`open reservations: ${status.reservations}`);
}

function printScope(name: string, scope: ScopeStatus): void {
  const parts: string[] = [];
  if (scope.daily) parts.push(`day $${scope.daily.projectedUsd.toFixed(4)}/$${scope.daily.limitUsd.toFixed(4)}`);
  if (scope.monthly) parts.push(`month $${scope.monthly.projectedUsd.toFixed(4)}/$${scope.monthly.limitUsd.toFixed(4)}`);
  if (parts.length) console.log(`${name}: ${parts.join(" · ")}`);
}

main().catch((error: unknown) => {
  if (error instanceof BudgetExceededError) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
