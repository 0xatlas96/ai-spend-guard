import type { ChargeRecord, ReservationRecord, SpendContext } from "./types.js";

export type SpendMatchValue = string | readonly string[];

export interface SpendPolicyMatch {
  provider?: SpendMatchValue;
  model?: SpendMatchValue;
  resource?: SpendMatchValue;
  projectId?: SpendMatchValue;
  userId?: SpendMatchValue;
  sessionId?: SpendMatchValue;
  agentId?: SpendMatchValue;
  route?: SpendMatchValue;
  environment?: SpendMatchValue;
  tags?: Record<string, SpendMatchValue>;
}

export type BudgetWindow =
  | "utc-day"
  | "utc-month"
  | "lifetime"
  | { rollingMs: number };

export type PolicyMode = "enforce" | "observe";

export interface SpendPolicy {
  /** Stable policy identifier used in decisions, logs, and CI output. */
  id: string;
  description?: string;
  /** Empty/omitted match means every operation. All configured fields are ANDed. */
  match?: SpendPolicyMatch;
  /** Defaults to utc-month. */
  window?: BudgetWindow;
  /** Maximum settled + reserved USD in this window. */
  limitUsd?: number;
  /** Maximum number of settled + reserved operations in this window. */
  limitCalls?: number;
  /** Maximum cost estimate for one operation. */
  maxOperationUsd?: number;
  /** Maximum number of matching in-flight reservations. */
  maxConcurrent?: number;
  /** observe reports a violation but never blocks. Defaults to enforce. */
  mode?: PolicyMode;
  /** Warning thresholds for limitUsd, e.g. [0.8, 0.95]. */
  warnAt?: number[];
}

export interface FirewallWarningEvent {
  policyId: string;
  threshold: number;
  projectedUsd: number;
  limitUsd: number;
  context: SpendContext;
}

export interface FirewallOptions {
  now?: () => Date;
  onDecision?: (decision: FirewallDecision) => void | Promise<void>;
  onWarning?: (event: FirewallWarningEvent) => void | Promise<void>;
}

export interface FirewallConfig {
  policies: SpendPolicy[];
  /** Deny missing estimates by default; set allow only for intentionally unmetered calls. */
  unknownEstimate?: "deny" | "allow";
  /** Used when context.provider is omitted. Defaults to "custom". */
  defaultProvider?: string;
  /** Age after which an open reservation is marked stale in inspection output. */
  staleAfterMs?: number;
  /** Optional persistent ledger path used by createFirewallFromConfig(). */
  ledgerPath?: string;
}

export interface SpendRequest {
  context?: SpendContext;
  estimatedCostUsd?: number;
  requestId?: string;
  /** Blocks accidental duplicate execution/retry when reused. */
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface FirewallSettleInput {
  actualCostUsd: number;
  metadata?: Record<string, unknown>;
}

export interface PolicyUsage {
  actualUsd: number;
  reservedUsd: number;
  projectedUsd: number;
  settledCalls: number;
  reservedCalls: number;
  projectedCalls: number;
  concurrent: number;
}

export type PolicyViolationKind =
  | "budget"
  | "call-count"
  | "operation-cost"
  | "concurrency";

export interface PolicyViolation {
  policyId: string;
  mode: PolicyMode;
  kind: PolicyViolationKind;
  message: string;
  limit: number;
  projected: number;
}

export interface PolicyEvaluation {
  policy: SpendPolicy;
  matched: boolean;
  usage?: PolicyUsage;
  violations: PolicyViolation[];
  warningThresholds: number[];
}

export interface FirewallDecision {
  allowed: boolean;
  estimatedCostUsd: number;
  context: SpendContext;
  matchedPolicies: PolicyEvaluation[];
  blockingViolations: PolicyViolation[];
  observedViolations: PolicyViolation[];
}

export interface FirewallStatus {
  generatedAt: string;
  policies: Array<{
    policy: SpendPolicy;
    usage: PolicyUsage;
    warningThresholds: number[];
  }>;
  openReservations: number;
  staleReservations: number;
}

export interface StaleReservation {
  reservation: ReservationRecord;
  ageMs: number;
  stale: boolean;
}

export interface FirewallSettlementResult {
  charge: ChargeRecord;
  overrunUsd: number;
  postSettlementViolations: PolicyViolation[];
}

export interface FirewallProtectionResult<T> {
  value: T;
  settlement: FirewallSettlementResult;
}

export interface SpendPlanOperation {
  name: string;
  context?: SpendContext;
  estimatedCostUsd: number;
  /** Number of times this operation may execute in the analyzed window. Defaults to 1. */
  count?: number;
  /** Worst-case simultaneous executions for concurrency-policy analysis. Defaults to 1. */
  concurrent?: number;
}

export interface SpendPlan {
  name?: string;
  operations: SpendPlanOperation[];
}

export interface SpendPlanPolicyResult {
  policyId: string;
  additionalUsd: number;
  additionalCalls: number;
  worstCaseConcurrent: number;
  projectedUsd: number;
  projectedCalls: number;
  violations: PolicyViolation[];
}

export interface SpendPlanResult {
  planName?: string;
  totalUsd: number;
  totalCalls: number;
  byProvider: Record<string, number>;
  byResource: Record<string, number>;
  policyResults: SpendPlanPolicyResult[];
  blockingViolations: PolicyViolation[];
  observedViolations: PolicyViolation[];
}
