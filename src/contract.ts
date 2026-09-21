import { inspectFirewallConfig, type DoctorReport } from "./doctor.js";
import { simulateSpendPlan } from "./plan.js";
import {
  runPolicyTests,
  type PolicyTestSuite,
  type PolicyTestSuiteResult,
} from "./policy-tests.js";
import { emptyLedger } from "./store.js";
import type {
  FirewallConfig,
  SpendPlan,
  SpendPlanResult,
} from "./firewall-types.js";

export interface BudgetContractPlan {
  id: string;
  plan: SpendPlan;
  /** Optional contract-wide ceiling independent of matching firewall policies. */
  maxTotalUsd?: number;
}

export interface BudgetContract {
  version: 1;
  name?: string;
  description?: string;
  /** Timestamp used for deterministic plan evaluation. Defaults to current time. */
  now?: string;
  /** When true, doctor warnings also fail verification. */
  doctorWarningsAsErrors?: boolean;
  firewall: FirewallConfig;
  policyTests?: PolicyTestSuite;
  plans?: BudgetContractPlan[];
}

export interface BudgetContractPlanResult {
  id: string;
  result: SpendPlanResult;
  maxTotalUsd?: number;
  maxTotalExceeded: boolean;
  passed: boolean;
}

export interface BudgetContractReport {
  contractName?: string;
  passed: boolean;
  doctor: DoctorReport;
  policyTests?: PolicyTestSuiteResult;
  plans: BudgetContractPlanResult[];
  failures: string[];
}

/**
 * Verify a complete budget contract without mutating production state.
 *
 * A contract can combine:
 * - firewall policy/config safety checks
 * - expected allow/deny policy tests
 * - worst-case spend plans
 */
export async function verifyBudgetContract(
  contract: BudgetContract
): Promise<BudgetContractReport> {
  if (contract.version !== 1) {
    throw new Error(`Unsupported budget contract version: ${String(contract.version)}`);
  }
  if (!contract.firewall || !Array.isArray(contract.firewall.policies)) {
    throw new Error("Budget contract requires a firewall configuration.");
  }

  const now = contract.now ? new Date(contract.now) : new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error(`Invalid budget contract now timestamp: ${contract.now}`);
  }

  const doctor = inspectFirewallConfig(contract.firewall);
  const failures: string[] = [];

  if (!doctor.ok) {
    failures.push("firewall doctor reported one or more configuration errors");
  }
  if (
    contract.doctorWarningsAsErrors &&
    doctor.findings.some((finding) => finding.severity === "warning")
  ) {
    failures.push("firewall doctor warnings are configured as contract failures");
  }

  const policyTests = contract.policyTests
    ? await runPolicyTests(contract.firewall, contract.policyTests)
    : undefined;

  if (policyTests && !policyTests.passed) {
    failures.push(
      `${policyTests.failedCases} policy contract test(s) failed`
    );
  }

  const plans: BudgetContractPlanResult[] = [];
  const ids = new Set<string>();

  for (const entry of contract.plans ?? []) {
    if (!entry.id?.trim()) throw new Error("Every budget contract plan needs a non-empty id.");
    if (ids.has(entry.id)) throw new Error(`Duplicate budget contract plan id: ${entry.id}`);
    ids.add(entry.id);

    if (
      entry.maxTotalUsd !== undefined &&
      (!Number.isFinite(entry.maxTotalUsd) || entry.maxTotalUsd < 0)
    ) {
      throw new RangeError(
        `Budget contract plan "${entry.id}" maxTotalUsd must be a finite non-negative number.`
      );
    }

    const result = simulateSpendPlan(
      emptyLedger(),
      contract.firewall,
      entry.plan,
      now
    );
    const maxTotalExceeded =
      entry.maxTotalUsd !== undefined &&
      result.totalUsd > entry.maxTotalUsd + Number.EPSILON;
    const passed =
      result.blockingViolations.length === 0 && !maxTotalExceeded;

    if (!passed) {
      failures.push(
        `spend plan "${entry.id}" violates its budget contract`
      );
    }

    plans.push({
      id: entry.id,
      result,
      ...(entry.maxTotalUsd !== undefined
        ? { maxTotalUsd: entry.maxTotalUsd }
        : {}),
      maxTotalExceeded,
      passed,
    });
  }

  return {
    ...(contract.name ? { contractName: contract.name } : {}),
    passed: failures.length === 0,
    doctor,
    ...(policyTests ? { policyTests } : {}),
    plans,
    failures,
  };
}
