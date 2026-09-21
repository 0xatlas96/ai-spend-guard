import { MemoryStore } from "./store.js";
import { SpendFirewall } from "./firewall.js";
import type { FirewallConfig, PolicyViolation, SpendRequest } from "./firewall-types.js";
import type { SpendContext } from "./types.js";

export interface PolicyTestRecordedSpend {
  type: "record";
  context?: SpendContext;
  actualCostUsd: number;
}

export interface PolicyTestReservedSpend {
  type: "reserve";
  context?: SpendContext;
  estimatedCostUsd: number;
}

export type PolicyTestSetupStep =
  | PolicyTestRecordedSpend
  | PolicyTestReservedSpend;

export interface PolicyTestExpectation {
  allowed: boolean;
  /** Optional exact set of enforced policy IDs expected to block the request. */
  blockingPolicyIds?: string[];
  /** Optional exact set of observe-only policy IDs expected to report a violation. */
  observedPolicyIds?: string[];
}

export interface PolicyTestCase {
  name: string;
  setup?: PolicyTestSetupStep[];
  request: SpendRequest;
  expect: PolicyTestExpectation;
}

export interface PolicyTestSuite {
  name?: string;
  /** ISO timestamp used as "now". Defaults to the real current time. */
  now?: string;
  cases: PolicyTestCase[];
}

export interface PolicyTestCaseResult {
  name: string;
  passed: boolean;
  expected: PolicyTestExpectation;
  actual: {
    allowed: boolean;
    blockingPolicyIds: string[];
    observedPolicyIds: string[];
    blockingViolations: PolicyViolation[];
    observedViolations: PolicyViolation[];
  };
  failures: string[];
}

export interface PolicyTestSuiteResult {
  suiteName?: string;
  passed: boolean;
  passedCases: number;
  failedCases: number;
  cases: PolicyTestCaseResult[];
}

/**
 * Run deterministic policy contract tests against isolated in-memory ledgers.
 * Each case starts from an empty ledger and may add recorded or reserved spend.
 */
export async function runPolicyTests(
  config: FirewallConfig,
  suite: PolicyTestSuite
): Promise<PolicyTestSuiteResult> {
  const now = suite.now ? new Date(suite.now) : new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error(`Invalid policy test suite now timestamp: ${suite.now}`);
  }
  if (!Array.isArray(suite.cases)) {
    throw new Error("Policy test suite must contain a cases array.");
  }

  const results: PolicyTestCaseResult[] = [];

  for (const testCase of suite.cases) {
    if (!testCase.name?.trim()) {
      throw new Error("Every policy test case needs a non-empty name.");
    }

    const store = new MemoryStore();
    const firewall = new SpendFirewall(store, config, {
      now: () => new Date(now),
    });

    for (const step of testCase.setup ?? []) {
      if (step.type === "record") {
        await firewall.recordActual({
          ...(step.context ? { context: step.context } : {}),
          actualCostUsd: step.actualCostUsd,
        });
      } else if (step.type === "reserve") {
        await firewall.reserve({
          ...(step.context ? { context: step.context } : {}),
          estimatedCostUsd: step.estimatedCostUsd,
        });
      } else {
        const exhaustive: never = step;
        throw new Error(`Unsupported policy test setup step: ${String(exhaustive)}`);
      }
    }

    const decision = await firewall.explain(testCase.request);
    const blockingPolicyIds = uniqueSorted(
      decision.blockingViolations.map((violation) => violation.policyId)
    );
    const observedPolicyIds = uniqueSorted(
      decision.observedViolations.map((violation) => violation.policyId)
    );
    const failures: string[] = [];

    if (decision.allowed !== testCase.expect.allowed) {
      failures.push(
        `expected allowed=${testCase.expect.allowed}, got ${decision.allowed}`
      );
    }

    if (testCase.expect.blockingPolicyIds) {
      const expected = uniqueSorted(testCase.expect.blockingPolicyIds);
      if (!sameStrings(expected, blockingPolicyIds)) {
        failures.push(
          `expected blocking policies [${expected.join(", ")}], got [${blockingPolicyIds.join(", ")}]`
        );
      }
    }

    if (testCase.expect.observedPolicyIds) {
      const expected = uniqueSorted(testCase.expect.observedPolicyIds);
      if (!sameStrings(expected, observedPolicyIds)) {
        failures.push(
          `expected observed policies [${expected.join(", ")}], got [${observedPolicyIds.join(", ")}]`
        );
      }
    }

    results.push({
      name: testCase.name,
      passed: failures.length === 0,
      expected: testCase.expect,
      actual: {
        allowed: decision.allowed,
        blockingPolicyIds,
        observedPolicyIds,
        blockingViolations: decision.blockingViolations,
        observedViolations: decision.observedViolations,
      },
      failures,
    });
  }

  const passedCases = results.filter((item) => item.passed).length;
  const failedCases = results.length - passedCases;
  return {
    ...(suite.name ? { suiteName: suite.name } : {}),
    passed: failedCases === 0,
    passedCases,
    failedCases,
    cases: results,
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
