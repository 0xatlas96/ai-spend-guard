#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  createFirewallFromConfig,
  loadFirewallConfig,
} from "./config.js";
import { inspectFirewallConfig } from "./doctor.js";
import { SpendPolicyError } from "./firewall-errors.js";
import type {
  FirewallStatus,
  SpendPlan,
  SpendRequest,
} from "./firewall-types.js";
import type { SpendContext } from "./types.js";

const args = process.argv.slice(2);
const command = args.shift() ?? "help";

function value(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function has(flag: string): boolean {
  return args.includes(flag);
}

function num(flag: string): number {
  const raw = value(flag);
  if (raw === undefined) throw new Error(`Missing ${flag}`);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative number`);
  }
  return parsed;
}

function optionalNum(flag: string): number | undefined {
  const raw = value(flag);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative number`);
  }
  return parsed;
}

function configPath(): string {
  return value("--config") ?? "ai-spend-firewall.config.json";
}

function required(flag: string): string {
  const result = value(flag);
  if (!result) throw new Error(`Missing ${flag}`);
  return result;
}

function contextFromArgs(): SpendContext {
  return {
    ...(value("--provider") ? { provider: value("--provider")! } : {}),
    ...(value("--model") ? { model: value("--model")! } : {}),
    ...(value("--resource") ? { resource: value("--resource")! } : {}),
    ...(value("--project") ? { projectId: value("--project")! } : {}),
    ...(value("--user") ? { userId: value("--user")! } : {}),
    ...(value("--session") ? { sessionId: value("--session")! } : {}),
    ...(value("--agent") ? { agentId: value("--agent")! } : {}),
    ...(value("--route") ? { route: value("--route")! } : {}),
    ...(value("--env") ? { environment: value("--env")! } : {}),
  };
}

function spendRequestFromArgs(): SpendRequest {
  return {
    context: contextFromArgs(),
    estimatedCostUsd: num("--cost"),
    ...(value("--request-id") ? { requestId: value("--request-id")! } : {}),
    ...(value("--idempotency-key")
      ? { idempotencyKey: value("--idempotency-key")! }
      : {}),
  };
}

async function main(): Promise<void> {
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "doctor") {
    const config = await loadFirewallConfig(configPath());
    const report = inspectFirewallConfig(config);
    if (has("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(
        `AI Spend Guard doctor — ${report.enforcedPolicies} enforced, ${report.observedPolicies} observe-only`
      );
      for (const finding of report.findings) {
        const mark =
          finding.severity === "error"
            ? "ERROR"
            : finding.severity === "warning"
              ? "WARN"
              : "INFO";
        console.log(`[${mark}] ${finding.code}: ${finding.message}`);
      }
    }
    if (!report.ok) process.exitCode = 2;
    return;
  }

  const firewall = await createFirewallFromConfig(configPath());

  if (command === "status") {
    const status = await firewall.status();
    if (has("--json")) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      printStatus(status);
    }
    return;
  }

  if (command === "explain") {
    const decision = await firewall.explain(spendRequestFromArgs());
    console.log(JSON.stringify(decision, null, 2));
    if (!decision.allowed) process.exitCode = 2;
    return;
  }

  if (command === "reserve") {
    const reservation = await firewall.reserve(spendRequestFromArgs());
    if (has("--json")) {
      console.log(
        JSON.stringify(
          {
            id: reservation.id,
            estimatedCostUsd: reservation.estimatedCostUsd,
            context: reservation.context,
            decision: reservation.decision,
          },
          null,
          2
        )
      );
    } else {
      console.log(reservation.id);
    }
    return;
  }

  if (command === "settle") {
    const result = await firewall.settle(required("--id"), {
      actualCostUsd: num("--cost"),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "release") {
    await firewall.release(required("--id"));
    console.log("released");
    return;
  }

  if (command === "record") {
    const result = await firewall.recordActual({
      context: contextFromArgs(),
      actualCostUsd: num("--cost"),
      ...(value("--request-id") ? { requestId: value("--request-id")! } : {}),
      ...(value("--idempotency-key")
        ? { idempotencyKey: value("--idempotency-key")! }
        : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "reservations") {
    const olderThanRaw = value("--older-than");
    const reservations = await firewall.listReservations({
      ...(olderThanRaw ? { olderThanMs: parseDuration(olderThanRaw) } : {}),
      ...(Object.keys(contextFromArgs()).length
        ? { context: contextFromArgs() }
        : {}),
    });
    if (has("--json")) {
      console.log(JSON.stringify(reservations, null, 2));
    } else if (reservations.length === 0) {
      console.log("No matching open reservations.");
    } else {
      for (const item of reservations) {
        console.log(
          `${item.reservation.id}  $${item.reservation.estimatedCostUsd.toFixed(6)}  ${formatDuration(item.ageMs)}  ${item.stale ? "STALE" : "open"}  ${item.reservation.provider}`
        );
      }
    }
    return;
  }

  if (command === "plan") {
    const file = required("--file");
    const raw = await readFile(file, "utf8");
    const plan = JSON.parse(raw) as SpendPlan;
    const result = await firewall.simulate(plan);
    const maxTotal = optionalNum("--max-total");
    const totalExceeded = maxTotal !== undefined && result.totalUsd > maxTotal + Number.EPSILON;

    if (has("--json")) {
      console.log(
        JSON.stringify(
          {
            ...result,
            ...(maxTotal !== undefined
              ? { maxTotalUsd: maxTotal, maxTotalExceeded: totalExceeded }
              : {}),
          },
          null,
          2
        )
      );
    } else {
      console.log(
        `Plan ${result.planName ?? file}: $${result.totalUsd.toFixed(6)} across ${result.totalCalls} calls`
      );
      for (const entry of result.policyResults) {
        console.log(
          `  ${entry.policyId}: +$${entry.additionalUsd.toFixed(6)}, +${entry.additionalCalls} calls, projected $${entry.projectedUsd.toFixed(6)}`
        );
      }
      for (const violation of result.blockingViolations) {
        console.log(`  BLOCK ${violation.policyId}: ${violation.message}`);
      }
      for (const violation of result.observedViolations) {
        console.log(`  OBSERVE ${violation.policyId}: ${violation.message}`);
      }
      if (totalExceeded) {
        console.log(
          `  BLOCK cli:max-total: plan total $${result.totalUsd.toFixed(6)} exceeds $${maxTotal!.toFixed(6)}`
        );
      }
    }

    if (result.blockingViolations.length > 0 || totalExceeded) {
      process.exitCode = 2;
    }
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function printStatus(status: FirewallStatus): void {
  console.log(`AI Spend Guard — ${status.generatedAt}`);
  console.log(
    `open reservations: ${status.openReservations} · stale: ${status.staleReservations}`
  );

  for (const entry of status.policies) {
    const limit = entry.policy.limitUsd;
    const calls = entry.policy.limitCalls;
    const pieces = [
      limit !== undefined
        ? `$${entry.usage.projectedUsd.toFixed(4)}/$${limit.toFixed(4)}`
        : undefined,
      calls !== undefined
        ? `${entry.usage.projectedCalls}/${calls} calls`
        : undefined,
      entry.policy.maxConcurrent !== undefined
        ? `${entry.usage.concurrent}/${entry.policy.maxConcurrent} in-flight`
        : undefined,
      entry.policy.mode === "observe" ? "observe" : "enforce",
    ].filter(Boolean);
    console.log(`${entry.policy.id}: ${pieces.join(" · ")}`);
  }
}

function parseDuration(raw: string): number {
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/i);
  if (!match) {
    throw new Error(
      `Invalid duration "${raw}". Use values such as 500ms, 30s, 15m, 2h, or 7d.`
    );
  }
  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  const multiplier =
    unit === "ms"
      ? 1
      : unit === "s"
        ? 1_000
        : unit === "m"
          ? 60_000
          : unit === "h"
            ? 3_600_000
            : 86_400_000;
  return amount * multiplier;
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}

function printHelp(): void {
  console.log(`AI Spend Guard — universal financial firewall for AI apps

Usage:
  ai-spend-guard <command> [options]

Core commands:
  status [--config path] [--json]
  doctor [--config path] [--json]
  explain --cost usd [context flags] [--config path]
  reserve --cost usd [context flags] [--idempotency-key key] [--config path]
  settle --id reservation --cost usd [--config path]
  release --id reservation [--config path]
  record --cost usd [context flags] [--config path]
  reservations [--older-than 1h] [context flags] [--json]
  plan --file spend-plan.json [--max-total usd] [--config path] [--json]

Context flags:
  --provider name   --model name       --resource llm|image|audio|video|tool|...
  --project id      --user id          --session id
  --agent id        --route name       --env production

Exit codes:
  0  success / allowed
  1  invalid input or runtime error
  2  spend policy or plan violation
`);
}

main().catch((error: unknown) => {
  if (error instanceof SpendPolicyError) {
    console.error(error.message);
    for (const violation of error.decision.blockingViolations) {
      console.error(`- ${violation.policyId}: ${violation.message}`);
    }
    process.exitCode = 2;
    return;
  }

  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
