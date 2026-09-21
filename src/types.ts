export type ProviderName = string;

export type SpendResource =
  | "llm"
  | "embedding"
  | "image"
  | "audio"
  | "video"
  | "search"
  | "tool"
  | "api"
  | "storage"
  | "other";

/** Multi-dimensional context used by the universal financial firewall. */
export interface SpendContext {
  provider?: string;
  model?: string;
  resource?: SpendResource | string;
  projectId?: string;
  userId?: string;
  sessionId?: string;
  agentId?: string;
  route?: string;
  environment?: string;
  tags?: Record<string, string>;
}

export interface BudgetLimit {
  /** Maximum actual + reserved spend in the current UTC day. */
  dailyUsd?: number;
  /** Maximum actual + reserved spend in the current UTC month. */
  monthlyUsd?: number;
  /** Maximum amount a single reservation may request. */
  perRequestUsd?: number;
}

export interface GuardConfig {
  /** Global limits across every provider. */
  global?: BudgetLimit;
  /** Provider-specific limits, keyed by provider name. */
  providers?: Record<ProviderName, BudgetLimit>;
  /** Fractions at which warnings are emitted. Defaults to [0.8, 0.95]. */
  warnAt?: number[];
  /** What to do if a request has no estimate. Defaults to deny. */
  unknownEstimate?: "deny" | "allow";
  /** Optional persistent ledger path used by createGuardFromConfig(). */
  ledgerPath?: string;
}

export interface ReserveInput {
  provider: ProviderName;
  /** A conservative upper-bound estimate is recommended for hard-cap behavior. */
  estimatedCostUsd?: number;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface SettleInput {
  actualCostUsd: number;
  metadata?: Record<string, unknown>;
}

export interface RecordChargeInput {
  provider: ProviderName;
  costUsd: number;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface ReservationRecord {
  id: string;
  provider: ProviderName;
  estimatedCostUsd: number;
  requestId?: string;
  metadata?: Record<string, unknown>;
  /** Optional richer context used by SpendFirewall. */
  context?: SpendContext;
  /** Optional caller-owned idempotency key used by SpendFirewall. */
  idempotencyKey?: string;
  /** Stable request fingerprint for idempotency conflict detection. */
  fingerprint?: string;
  createdAt: string;
}

export interface ChargeRecord {
  id: string;
  provider: ProviderName;
  costUsd: number;
  requestId?: string;
  metadata?: Record<string, unknown>;
  /** Optional richer context used by SpendFirewall. */
  context?: SpendContext;
  idempotencyKey?: string;
  fingerprint?: string;
  createdAt: string;
  reservationId?: string;
  estimateUsd?: number;
}

export interface LedgerState {
  version: 1;
  reservations: Record<string, ReservationRecord>;
  charges: ChargeRecord[];
}

export interface LedgerStore {
  transact<T>(fn: (state: LedgerState) => T | Promise<T>): Promise<T>;
  read(): Promise<LedgerState>;
}

export interface BudgetSnapshot {
  limitUsd: number;
  actualUsd: number;
  reservedUsd: number;
  projectedUsd: number;
  remainingUsd: number;
  ratio: number;
  exceeded: boolean;
}

export interface ScopeStatus {
  daily?: BudgetSnapshot;
  monthly?: BudgetSnapshot;
}

export interface GuardStatus {
  currency: "USD";
  generatedAt: string;
  global: ScopeStatus;
  providers: Record<string, ScopeStatus>;
  reservations: number;
}

export interface WarningEvent {
  scope: "global" | "provider";
  provider?: string;
  period: "daily" | "monthly";
  threshold: number;
  snapshot: BudgetSnapshot;
}

export interface GuardOptions {
  now?: () => Date;
  onWarning?: (event: WarningEvent) => void | Promise<void>;
}

export interface SettlementResult {
  charge: ChargeRecord;
  overrunUsd: number;
  status: GuardStatus;
}

export interface ProtectionResult<T> {
  value: T;
  settlement: SettlementResult;
}
