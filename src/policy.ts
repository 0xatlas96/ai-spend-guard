import type { ChargeRecord, LedgerState, ReservationRecord, SpendContext } from "./types.js";
import type {
  BudgetWindow,
  FirewallConfig,
  FirewallDecision,
  PolicyEvaluation,
  PolicyUsage,
  PolicyViolation,
  SpendGroupField,
  SpendMatchValue,
  SpendPolicy,
  SpendPolicyGroup,
  SpendPolicyMatch,
} from "./firewall-types.js";
import { InvalidPolicyError } from "./firewall-errors.js";
import { normalizeContext } from "./fingerprint.js";

export function validateFirewallConfig(config: FirewallConfig): void {
  if (!Array.isArray(config.policies)) {
    throw new InvalidPolicyError("Firewall config must contain a policies array.");
  }

  const ids = new Set<string>();
  for (const policy of config.policies) {
    if (!policy.id?.trim()) throw new InvalidPolicyError("Every policy needs a non-empty id.");
    if (ids.has(policy.id)) {
      throw new InvalidPolicyError(`Duplicate policy id: ${policy.id}`, policy.id);
    }
    ids.add(policy.id);

    const controls = [
      policy.limitUsd,
      policy.limitCalls,
      policy.maxOperationUsd,
      policy.maxConcurrent,
    ];
    if (controls.every((value) => value === undefined)) {
      throw new InvalidPolicyError(
        `Policy "${policy.id}" has no limit. Configure limitUsd, limitCalls, maxOperationUsd, or maxConcurrent.`,
        policy.id
      );
    }

    finiteNonNegative(policy.limitUsd, "limitUsd", policy.id);
    finiteNonNegative(policy.maxOperationUsd, "maxOperationUsd", policy.id);
    integerNonNegative(policy.limitCalls, "limitCalls", policy.id);
    integerNonNegative(policy.maxConcurrent, "maxConcurrent", policy.id);

    if (typeof policy.window === "object") {
      if (!Number.isFinite(policy.window.rollingMs) || policy.window.rollingMs <= 0) {
        throw new InvalidPolicyError(
          `Policy "${policy.id}" rollingMs must be a positive finite number.`,
          policy.id
        );
      }
    }

    if (policy.groupBy) {
      const seen = new Set<string>();
      for (const field of policy.groupBy) {
        if (!field || seen.has(field)) {
          throw new InvalidPolicyError(
            `Policy "${policy.id}" groupBy fields must be unique non-empty values.`,
            policy.id
          );
        }
        if (field.startsWith("tag:") && field.slice(4).trim() === "") {
          throw new InvalidPolicyError(
            `Policy "${policy.id}" contains an empty tag groupBy key.`,
            policy.id
          );
        }
        seen.add(field);
      }
    }

    for (const threshold of policy.warnAt ?? []) {
      if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
        throw new InvalidPolicyError(
          `Policy "${policy.id}" warnAt values must be > 0 and <= 1.`,
          policy.id
        );
      }
    }
  }

  if (
    config.staleAfterMs !== undefined &&
    (!Number.isFinite(config.staleAfterMs) || config.staleAfterMs < 0)
  ) {
    throw new InvalidPolicyError("staleAfterMs must be a finite non-negative number.");
  }
}

export function evaluateSpendRequest(
  state: LedgerState,
  policies: readonly SpendPolicy[],
  contextInput: SpendContext,
  estimatedCostUsd: number,
  now: Date
): FirewallDecision {
  const context = normalizeContext(contextInput);
  const matchedPolicies: PolicyEvaluation[] = [];

  for (const policy of policies) {
    if (!matchesPolicy(context, policy.match)) continue;
    const group = policyGroup(policy, context);
    const usage = policyUsage(state, policy, now, context);
    const violations = requestViolations(policy, usage, estimatedCostUsd);
    const projectedRatio =
      policy.limitUsd === undefined || policy.limitUsd === 0
        ? policy.limitUsd === 0 && usage.projectedUsd + estimatedCostUsd > 0
          ? Infinity
          : 0
        : (usage.projectedUsd + estimatedCostUsd) / policy.limitUsd;

    matchedPolicies.push({
      policy,
      matched: true,
      ...(group ? { group } : {}),
      usage: {
        ...usage,
        projectedUsd: usage.projectedUsd + estimatedCostUsd,
        projectedCalls: usage.projectedCalls + 1,
      },
      violations,
      warningThresholds: sanitizeWarnAt(policy.warnAt).filter(
        (threshold) => projectedRatio >= threshold
      ),
    });
  }

  const allViolations = matchedPolicies.flatMap((entry) => entry.violations);
  const blockingViolations = allViolations.filter((violation) => violation.mode === "enforce");
  const observedViolations = allViolations.filter((violation) => violation.mode === "observe");

  return {
    allowed: blockingViolations.length === 0,
    estimatedCostUsd,
    context,
    matchedPolicies,
    blockingViolations,
    observedViolations,
  };
}

export function policyUsage(
  state: LedgerState,
  policy: SpendPolicy,
  now: Date,
  groupContext?: SpendContext
): PolicyUsage {
  let actualUsd = 0;
  let reservedUsd = 0;
  let settledCalls = 0;
  let reservedCalls = 0;
  const targetGroup = groupContext ? policyGroup(policy, groupContext) : undefined;

  for (const charge of state.charges) {
    if (!inBudgetWindow(charge.createdAt, policy.window, now)) continue;
    const context = contextForCharge(charge);
    if (!matchesPolicy(context, policy.match)) continue;
    if (targetGroup && policyGroup(policy, context)?.key !== targetGroup.key) continue;
    actualUsd += charge.costUsd;
    settledCalls += 1;
  }

  for (const reservation of Object.values(state.reservations)) {
    if (!inBudgetWindow(reservation.createdAt, policy.window, now)) continue;
    const context = contextForReservation(reservation);
    if (!matchesPolicy(context, policy.match)) continue;
    if (targetGroup && policyGroup(policy, context)?.key !== targetGroup.key) continue;
    reservedUsd += reservation.estimatedCostUsd;
    reservedCalls += 1;
  }

  return {
    actualUsd,
    reservedUsd,
    projectedUsd: actualUsd + reservedUsd,
    settledCalls,
    reservedCalls,
    projectedCalls: settledCalls + reservedCalls,
    concurrent: reservedCalls,
  };
}

export function listPolicyGroups(
  state: LedgerState,
  policy: SpendPolicy
): SpendPolicyGroup[] {
  if (!policy.groupBy?.length) return [];
  const groups = new Map<string, SpendPolicyGroup>();

  for (const charge of state.charges) {
    const context = contextForCharge(charge);
    if (!matchesPolicy(context, policy.match)) continue;
    const group = policyGroup(policy, context);
    if (group) groups.set(group.key, group);
  }

  for (const reservation of Object.values(state.reservations)) {
    const context = contextForReservation(reservation);
    if (!matchesPolicy(context, policy.match)) continue;
    const group = policyGroup(policy, context);
    if (group) groups.set(group.key, group);
  }

  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function policyGroup(
  policy: SpendPolicy,
  contextInput: SpendContext
): SpendPolicyGroup | undefined {
  if (!policy.groupBy?.length) return undefined;
  const context = normalizeContext(contextInput);
  const values: Record<string, string> = {};

  for (const field of policy.groupBy) {
    values[field] = groupFieldValue(context, field);
  }

  return {
    key: policy.groupBy.map((field) => `${field}=${values[field]}`).join("|"),
    values,
  };
}

export function postSettlementViolations(
  state: LedgerState,
  policies: readonly SpendPolicy[],
  context: SpendContext,
  now: Date
): PolicyViolation[] {
  return policies
    .filter((policy) => matchesPolicy(context, policy.match))
    .flatMap((policy) => {
      const usage = policyUsage(state, policy, now, context);
      const mode = policy.mode ?? "enforce";
      const violations: PolicyViolation[] = [];
      if (policy.limitUsd !== undefined && usage.projectedUsd > policy.limitUsd + Number.EPSILON) {
        violations.push({
          policyId: policy.id,
          mode,
          kind: "budget",
          limit: policy.limitUsd,
          projected: usage.projectedUsd,
          message: `settled + reserved spend is $${usage.projectedUsd.toFixed(6)} above the $${policy.limitUsd.toFixed(6)} limit`,
        });
      }
      if (policy.limitCalls !== undefined && usage.projectedCalls > policy.limitCalls) {
        violations.push({
          policyId: policy.id,
          mode,
          kind: "call-count",
          limit: policy.limitCalls,
          projected: usage.projectedCalls,
          message: `settled + reserved calls are ${usage.projectedCalls}, above the ${policy.limitCalls} call limit`,
        });
      }
      return violations;
    });
}

export function matchesPolicy(
  contextInput: SpendContext,
  match: SpendPolicyMatch | undefined
): boolean {
  if (!match) return true;
  const context = normalizeContext(contextInput);
  const fields: Array<keyof Omit<SpendPolicyMatch, "tags">> = [
    "provider",
    "model",
    "resource",
    "projectId",
    "userId",
    "sessionId",
    "agentId",
    "route",
    "environment",
  ];

  for (const field of fields) {
    const expected = match[field];
    if (expected === undefined) continue;
    const actual = context[field];
    if (typeof actual !== "string" || !matchesValue(actual, expected)) return false;
  }

  for (const [key, expected] of Object.entries(match.tags ?? {})) {
    const actual = context.tags?.[key];
    if (actual === undefined || !matchesValue(actual, expected)) return false;
  }

  return true;
}

export function inBudgetWindow(
  createdAt: string,
  window: BudgetWindow | undefined,
  now: Date
): boolean {
  const chosen = window ?? "utc-month";
  const created = new Date(createdAt);
  if (!Number.isFinite(created.getTime())) return false;

  if (chosen === "lifetime") return true;
  if (chosen === "utc-day") {
    return (
      created.getUTCFullYear() === now.getUTCFullYear() &&
      created.getUTCMonth() === now.getUTCMonth() &&
      created.getUTCDate() === now.getUTCDate()
    );
  }
  if (chosen === "utc-month") {
    return (
      created.getUTCFullYear() === now.getUTCFullYear() &&
      created.getUTCMonth() === now.getUTCMonth()
    );
  }
  return (
    created.getTime() >= now.getTime() - chosen.rollingMs &&
    created.getTime() <= now.getTime()
  );
}

export function contextForReservation(record: ReservationRecord): SpendContext {
  return normalizeContext(record.context ?? { provider: record.provider });
}

export function contextForCharge(record: ChargeRecord): SpendContext {
  return normalizeContext(record.context ?? { provider: record.provider });
}

export function sanitizeWarnAt(values: readonly number[] | undefined): number[] {
  return [...new Set(values ?? [0.8, 0.95])]
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 1)
    .sort((a, b) => a - b);
}

function requestViolations(
  policy: SpendPolicy,
  usage: PolicyUsage,
  estimatedCostUsd: number
): PolicyViolation[] {
  const mode = policy.mode ?? "enforce";
  const violations: PolicyViolation[] = [];

  if (
    policy.maxOperationUsd !== undefined &&
    estimatedCostUsd > policy.maxOperationUsd + Number.EPSILON
  ) {
    violations.push({
      policyId: policy.id,
      mode,
      kind: "operation-cost",
      limit: policy.maxOperationUsd,
      projected: estimatedCostUsd,
      message: `operation estimate is $${estimatedCostUsd.toFixed(6)}, above the $${policy.maxOperationUsd.toFixed(6)} per-operation limit`,
    });
  }

  if (policy.limitUsd !== undefined) {
    const projected = usage.projectedUsd + estimatedCostUsd;
    if (projected > policy.limitUsd + Number.EPSILON) {
      violations.push({
        policyId: policy.id,
        mode,
        kind: "budget",
        limit: policy.limitUsd,
        projected,
        message: `projected spend is $${projected.toFixed(6)}, above the $${policy.limitUsd.toFixed(6)} limit`,
      });
    }
  }

  if (policy.limitCalls !== undefined) {
    const projected = usage.projectedCalls + 1;
    if (projected > policy.limitCalls) {
      violations.push({
        policyId: policy.id,
        mode,
        kind: "call-count",
        limit: policy.limitCalls,
        projected,
        message: `projected call count is ${projected}, above the ${policy.limitCalls} call limit`,
      });
    }
  }

  if (policy.maxConcurrent !== undefined) {
    const projected = usage.concurrent + 1;
    if (projected > policy.maxConcurrent) {
      violations.push({
        policyId: policy.id,
        mode,
        kind: "concurrency",
        limit: policy.maxConcurrent,
        projected,
        message: `projected in-flight operations are ${projected}, above the ${policy.maxConcurrent} concurrency limit`,
      });
    }
  }

  return violations;
}

function matchesValue(actual: string, expected: SpendMatchValue): boolean {
  return typeof expected === "string" ? actual === expected : expected.includes(actual);
}

function groupFieldValue(context: SpendContext, field: SpendGroupField): string {
  if (field.startsWith("tag:")) {
    return context.tags?.[field.slice(4)] ?? "<missing>";
  }
  const value = context[field];
  return typeof value === "string" ? value : "<missing>";
}

function finiteNonNegative(value: number | undefined, label: string, policyId: string): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidPolicyError(
      `Policy "${policyId}" ${label} must be a finite non-negative number.`,
      policyId
    );
  }
}

function integerNonNegative(value: number | undefined, label: string, policyId: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidPolicyError(
      `Policy "${policyId}" ${label} must be a non-negative integer.`,
      policyId
    );
  }
}
