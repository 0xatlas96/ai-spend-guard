import type { LedgerState, SpendContext } from "./types.js";
import type {
  FirewallConfig,
  PolicyViolation,
  SpendPlan,
  SpendPlanResult,
  SpendPolicy,
  SpendPolicyGroup,
} from "./firewall-types.js";
import { matchesPolicy, policyGroup, policyUsage } from "./policy.js";

type NormalizedPlanOperation = {
  name: string;
  context: SpendContext;
  estimatedCostUsd: number;
  count: number;
  concurrent: number;
};

export function simulateSpendPlan(
  state: LedgerState,
  config: FirewallConfig,
  plan: SpendPlan,
  now: Date
): SpendPlanResult {
  const normalized: NormalizedPlanOperation[] = plan.operations.map((operation) => {
    if (!operation.name?.trim()) throw new Error("Every plan operation needs a name.");
    if (!Number.isFinite(operation.estimatedCostUsd) || operation.estimatedCostUsd < 0) {
      throw new RangeError(
        `Plan operation "${operation.name}" estimatedCostUsd must be non-negative.`
      );
    }
    const count = operation.count ?? 1;
    const concurrent = operation.concurrent ?? 1;
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(
        `Plan operation "${operation.name}" count must be a non-negative integer.`
      );
    }
    if (!Number.isInteger(concurrent) || concurrent < 0) {
      throw new RangeError(
        `Plan operation "${operation.name}" concurrent must be a non-negative integer.`
      );
    }
    if (concurrent > count && count !== 0) {
      throw new RangeError(
        `Plan operation "${operation.name}" concurrent cannot exceed count.`
      );
    }
    const context: SpendContext = {
      ...(operation.context ?? {}),
      provider: operation.context?.provider ?? config.defaultProvider ?? "custom",
    };
    return {
      name: operation.name,
      context,
      estimatedCostUsd: operation.estimatedCostUsd,
      count,
      concurrent,
    };
  });

  const byProvider: Record<string, number> = {};
  const byResource: Record<string, number> = {};
  let totalUsd = 0;
  let totalCalls = 0;

  for (const operation of normalized) {
    const subtotal = operation.estimatedCostUsd * operation.count;
    totalUsd += subtotal;
    totalCalls += operation.count;
    const provider = operation.context.provider ?? "custom";
    const resource = operation.context.resource ?? "other";
    byProvider[provider] = (byProvider[provider] ?? 0) + subtotal;
    byResource[resource] = (byResource[resource] ?? 0) + subtotal;
  }

  const policyResults = config.policies.flatMap((policy) => {
    const matching = normalized.filter((operation) =>
      matchesPolicy(operation.context, policy.match)
    );
    if (!policy.groupBy?.length) {
      return [
        buildPolicyResult(state, policy, matching, now),
      ];
    }

    const groups = new Map<
      string,
      { group: SpendPolicyGroup; operations: NormalizedPlanOperation[] }
    >();

    for (const operation of matching) {
      const group = policyGroup(policy, operation.context);
      if (!group) continue;
      const existing = groups.get(group.key);
      if (existing) {
        existing.operations.push(operation);
      } else {
        groups.set(group.key, { group, operations: [operation] });
      }
    }

    return [...groups.values()].map(({ group, operations }) =>
      buildPolicyResult(state, policy, operations, now, group)
    );
  });

  const allViolations = policyResults.flatMap((entry) => entry.violations);
  return {
    ...(plan.name ? { planName: plan.name } : {}),
    totalUsd,
    totalCalls,
    byProvider,
    byResource,
    policyResults,
    blockingViolations: allViolations.filter((item) => item.mode === "enforce"),
    observedViolations: allViolations.filter((item) => item.mode === "observe"),
  };
}

function buildPolicyResult(
  state: LedgerState,
  policy: SpendPolicy,
  matching: NormalizedPlanOperation[],
  now: Date,
  group?: SpendPolicyGroup
) {
  const groupContext = matching[0]?.context;
  const current = policyUsage(state, policy, now, groupContext);
  const additionalUsd = matching.reduce(
    (sum, operation) => sum + operation.estimatedCostUsd * operation.count,
    0
  );
  const additionalCalls = matching.reduce(
    (sum, operation) => sum + operation.count,
    0
  );
  const worstCaseConcurrent = matching.reduce(
    (sum, operation) => sum + operation.concurrent,
    0
  );
  const projectedUsd = current.projectedUsd + additionalUsd;
  const projectedCalls = current.projectedCalls + additionalCalls;
  const violations = planViolations(
    policy,
    current.concurrent,
    matching,
    projectedUsd,
    projectedCalls,
    worstCaseConcurrent
  );

  return {
    policyId: policy.id,
    ...(group ? { group } : {}),
    additionalUsd,
    additionalCalls,
    worstCaseConcurrent,
    projectedUsd,
    projectedCalls,
    violations,
  };
}

function planViolations(
  policy: SpendPolicy,
  currentConcurrent: number,
  matching: NormalizedPlanOperation[],
  projectedUsd: number,
  projectedCalls: number,
  worstCaseConcurrent: number
): PolicyViolation[] {
  const mode = policy.mode ?? "enforce";
  const violations: PolicyViolation[] = [];

  if (
    policy.limitUsd !== undefined &&
    projectedUsd > policy.limitUsd + Number.EPSILON
  ) {
    violations.push({
      policyId: policy.id,
      mode,
      kind: "budget",
      limit: policy.limitUsd,
      projected: projectedUsd,
      message: `plan projects $${projectedUsd.toFixed(6)}, above the $${policy.limitUsd.toFixed(6)} limit`,
    });
  }

  if (
    policy.limitCalls !== undefined &&
    projectedCalls > policy.limitCalls
  ) {
    violations.push({
      policyId: policy.id,
      mode,
      kind: "call-count",
      limit: policy.limitCalls,
      projected: projectedCalls,
      message: `plan projects ${projectedCalls} calls, above the ${policy.limitCalls} call limit`,
    });
  }

  if (policy.maxOperationUsd !== undefined) {
    const largest = matching.reduce(
      (max, operation) => Math.max(max, operation.estimatedCostUsd),
      0
    );
    if (largest > policy.maxOperationUsd + Number.EPSILON) {
      violations.push({
        policyId: policy.id,
        mode,
        kind: "operation-cost",
        limit: policy.maxOperationUsd,
        projected: largest,
        message: `plan contains an operation estimated at $${largest.toFixed(6)}, above the $${policy.maxOperationUsd.toFixed(6)} per-operation limit`,
      });
    }
  }

  if (
    policy.maxConcurrent !== undefined &&
    currentConcurrent + worstCaseConcurrent > policy.maxConcurrent
  ) {
    violations.push({
      policyId: policy.id,
      mode,
      kind: "concurrency",
      limit: policy.maxConcurrent,
      projected: currentConcurrent + worstCaseConcurrent,
      message: `plan worst-case concurrency is ${currentConcurrent + worstCaseConcurrent}, above the ${policy.maxConcurrent} limit`,
    });
  }

  return violations;
}
