import { randomUUID } from "node:crypto";
import { DuplicateOperationError, IdempotencyConflictError, SpendPolicyError } from "./firewall-errors.js";
import { normalizeContext, spendFingerprint } from "./fingerprint.js";
import {
  contextForReservation,
  evaluateSpendRequest,
  matchesPolicy,
  policyUsage,
  postSettlementViolations,
  sanitizeWarnAt,
  validateFirewallConfig,
} from "./policy.js";
import { ReservationNotFoundError, UnknownEstimateError } from "./errors.js";
import { simulateSpendPlan } from "./plan.js";
import type { LedgerStore, ReservationRecord, SpendContext } from "./types.js";
import type {
  FirewallConfig,
  FirewallDecision,
  FirewallOptions,
  FirewallProtectionResult,
  FirewallRecordResult,
  FirewallSettleInput,
  FirewallSettlementResult,
  FirewallStatus,
  FirewallWarningEvent,
  SpendPolicyMatch,
  SpendPlan,
  SpendPlanResult,
  SpendRequest,
  StaleReservation,
} from "./firewall-types.js";

export class FirewallReservation {
  readonly id: string;
  readonly estimatedCostUsd: number;
  readonly context: SpendContext;
  readonly decision: FirewallDecision;
  private closed = false;

  constructor(
    private readonly firewall: SpendFirewall,
    record: ReservationRecord,
    decision: FirewallDecision
  ) {
    this.id = record.id;
    this.estimatedCostUsd = record.estimatedCostUsd;
    this.context = normalizeContext(record.context);
    this.decision = decision;
  }

  async settle(input: FirewallSettleInput | number): Promise<FirewallSettlementResult> {
    if (this.closed) throw new ReservationNotFoundError(this.id);
    const normalized = typeof input === "number" ? { actualCostUsd: input } : input;
    const result = await this.firewall.settle(this.id, normalized);
    this.closed = true;
    return result;
  }

  async release(): Promise<void> {
    if (this.closed) return;
    await this.firewall.release(this.id);
    this.closed = true;
  }
}

export class SpendFirewall {
  private readonly now: () => Date;
  private readonly onDecision?: FirewallOptions["onDecision"];
  private readonly onWarning?: FirewallOptions["onWarning"];

  constructor(
    private readonly store: LedgerStore,
    readonly config: FirewallConfig,
    options: FirewallOptions = {}
  ) {
    validateFirewallConfig(config);
    this.now = options.now ?? (() => new Date());
    this.onDecision = options.onDecision;
    this.onWarning = options.onWarning;
  }

  async explain(input: SpendRequest): Promise<FirewallDecision> {
    const normalized = this.normalizeRequest(input);
    const state = await this.store.read();
    return evaluateSpendRequest(
      state,
      this.config.policies,
      normalized.context,
      normalized.estimatedCostUsd,
      this.now()
    );
  }

  async reserve(input: SpendRequest): Promise<FirewallReservation> {
    const normalized = this.normalizeRequest(input);
    const now = this.now();

    const { record, decision } = await this.store.transact((state) => {
      if (normalized.idempotencyKey) {
        const pending = Object.values(state.reservations).find(
          (item) => item.idempotencyKey === normalized.idempotencyKey
        );
        const settled = state.charges.find(
          (item) => item.idempotencyKey === normalized.idempotencyKey
        );
        const existing = pending ?? settled;

        if (existing) {
          if (existing.fingerprint && existing.fingerprint !== normalized.fingerprint) {
            throw new IdempotencyConflictError(normalized.idempotencyKey);
          }
          throw new DuplicateOperationError(
            normalized.idempotencyKey,
            pending ? "reserved" : "settled"
          );
        }
      }

      const decision = evaluateSpendRequest(
        state,
        this.config.policies,
        normalized.context,
        normalized.estimatedCostUsd,
        now
      );
      if (!decision.allowed) throw new SpendPolicyError(decision);

      const provider =
        normalized.context.provider ?? this.config.defaultProvider ?? "custom";
      const record: ReservationRecord = {
        id: randomUUID(),
        provider,
        estimatedCostUsd: normalized.estimatedCostUsd,
        createdAt: now.toISOString(),
        context: normalized.context,
        fingerprint: normalized.fingerprint,
        ...(normalized.requestId ? { requestId: normalized.requestId } : {}),
        ...(normalized.idempotencyKey ? { idempotencyKey: normalized.idempotencyKey } : {}),
        ...(normalized.metadata ? { metadata: normalized.metadata } : {}),
      };
      state.reservations[record.id] = record;
      return { record, decision };
    });

    await this.emitDecision(decision);
    await this.emitWarnings(decision);
    return new FirewallReservation(this, record, decision);
  }

  async settle(
    reservationId: string,
    input: FirewallSettleInput
  ): Promise<FirewallSettlementResult> {
    const actualCostUsd = money(input.actualCostUsd, "actualCostUsd");
    const now = this.now();

    return this.store.transact((state) => {
      const reservation = state.reservations[reservationId];
      if (!reservation) throw new ReservationNotFoundError(reservationId);

      delete state.reservations[reservationId];

      const charge = {
        id: randomUUID(),
        provider: reservation.provider,
        costUsd: actualCostUsd,
        createdAt: now.toISOString(),
        reservationId,
        estimateUsd: reservation.estimatedCostUsd,
        ...(reservation.requestId ? { requestId: reservation.requestId } : {}),
        ...(reservation.context ? { context: reservation.context } : {}),
        ...(reservation.idempotencyKey ? { idempotencyKey: reservation.idempotencyKey } : {}),
        ...(reservation.fingerprint ? { fingerprint: reservation.fingerprint } : {}),
        ...(reservation.metadata || input.metadata
          ? { metadata: { ...(reservation.metadata ?? {}), ...(input.metadata ?? {}) } }
          : {}),
      };
      state.charges.push(charge);

      const context = normalizeContext(reservation.context ?? { provider: reservation.provider });
      return {
        charge,
        overrunUsd: Math.max(0, actualCostUsd - reservation.estimatedCostUsd),
        postSettlementViolations: postSettlementViolations(
          state,
          this.config.policies,
          context,
          now
        ),
      };
    });
  }

  async release(reservationId: string): Promise<void> {
    await this.store.transact((state) => {
      if (!state.reservations[reservationId]) throw new ReservationNotFoundError(reservationId);
      delete state.reservations[reservationId];
    });
  }

  async recordActual(input: {
    context?: SpendContext;
    actualCostUsd: number;
    requestId?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<FirewallRecordResult> {
    const actualCostUsd = money(input.actualCostUsd, "actualCostUsd");
    const context = this.normalizeContextWithProvider(input.context);
    const now = this.now();
    const fingerprint = spendFingerprint(context, actualCostUsd, input.requestId);

    return this.store.transact((state) => {
      if (input.idempotencyKey) {
        const existing =
          Object.values(state.reservations).find(
            (item) => item.idempotencyKey === input.idempotencyKey
          ) ?? state.charges.find((item) => item.idempotencyKey === input.idempotencyKey);
        if (existing) {
          if (existing.fingerprint && existing.fingerprint !== fingerprint) {
            throw new IdempotencyConflictError(input.idempotencyKey);
          }
          throw new DuplicateOperationError(
            input.idempotencyKey,
            "estimatedCostUsd" in existing ? "reserved" : "settled"
          );
        }
      }

      const charge = {
        id: randomUUID(),
        provider: context.provider ?? this.config.defaultProvider ?? "custom",
        costUsd: actualCostUsd,
        createdAt: now.toISOString(),
        context,
        fingerprint,
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      };
      state.charges.push(charge);
      return {
        charge,
        postSettlementViolations: postSettlementViolations(
          state,
          this.config.policies,
          context,
          now
        ),
      };
    });
  }

  async protect<T>(
    input: SpendRequest,
    operation: () => Promise<T>,
    actualCostUsd: (value: T) => number | Promise<number>
  ): Promise<FirewallProtectionResult<T>> {
    const reservation = await this.reserve(input);
    try {
      const value = await operation();
      const actual = await actualCostUsd(value);
      const settlement = await reservation.settle(actual);
      return { value, settlement };
    } catch (error) {
      await reservation.release().catch(() => undefined);
      throw error;
    }
  }

  async status(): Promise<FirewallStatus> {
    const state = await this.store.read();
    const now = this.now();
    const staleAfterMs = this.config.staleAfterMs ?? 60 * 60 * 1000;
    const reservations = Object.values(state.reservations);

    return {
      generatedAt: now.toISOString(),
      policies: this.config.policies.map((policy) => {
        const usage = policyUsage(state, policy, now);
        const ratio =
          policy.limitUsd === undefined || policy.limitUsd === 0
            ? policy.limitUsd === 0 && usage.projectedUsd > 0
              ? Infinity
              : 0
            : usage.projectedUsd / policy.limitUsd;
        return {
          policy,
          usage,
          warningThresholds: sanitizeWarnAt(policy.warnAt).filter(
            (threshold) => ratio >= threshold
          ),
        };
      }),
      openReservations: reservations.length,
      staleReservations: reservations.filter(
        (reservation) => now.getTime() - new Date(reservation.createdAt).getTime() >= staleAfterMs
      ).length,
    };
  }

  async simulate(plan: SpendPlan): Promise<SpendPlanResult> {
    const state = await this.store.read();
    return simulateSpendPlan(state, this.config, plan, this.now());
  }

  async listReservations(options: {
    olderThanMs?: number;
    context?: SpendContext;
  } = {}): Promise<StaleReservation[]> {
    const state = await this.store.read();
    const now = this.now();
    const staleAfterMs = this.config.staleAfterMs ?? 60 * 60 * 1000;
    const match = options.context ? contextToMatch(options.context) : undefined;

    return Object.values(state.reservations)
      .map((reservation) => {
        const ageMs = Math.max(0, now.getTime() - new Date(reservation.createdAt).getTime());
        return {
          reservation,
          ageMs,
          stale: ageMs >= staleAfterMs,
        };
      })
      .filter((item) => options.olderThanMs === undefined || item.ageMs >= options.olderThanMs)
      .filter(
        (item) =>
          !match ||
          matchesPolicy(contextForReservation(item.reservation), match)
      )
      .sort((a, b) => b.ageMs - a.ageMs);
  }

  private normalizeRequest(input: SpendRequest): {
    context: SpendContext;
    estimatedCostUsd: number;
    requestId?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
    fingerprint: string;
  } {
    const context = this.normalizeContextWithProvider(input.context);
    const estimate =
      input.estimatedCostUsd === undefined
        ? this.config.unknownEstimate === "allow"
          ? 0
          : undefined
        : money(input.estimatedCostUsd, "estimatedCostUsd");

    if (estimate === undefined) {
      throw new UnknownEstimateError(context.provider ?? "custom");
    }

    return {
      context,
      estimatedCostUsd: estimate,
      fingerprint: spendFingerprint(context, estimate, input.requestId),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
  }

  private normalizeContextWithProvider(input: SpendContext | undefined): SpendContext {
    const context = normalizeContext(input);
    return context.provider
      ? context
      : { ...context, provider: this.config.defaultProvider ?? "custom" };
  }

  private async emitDecision(decision: FirewallDecision): Promise<void> {
    if (!this.onDecision) return;
    try {
      await this.onDecision(decision);
    } catch {
      // Observability hooks must never turn a successfully reserved call into a leaked reservation.
    }
  }

  private async emitWarnings(decision: FirewallDecision): Promise<void> {
    if (!this.onWarning) return;
    const events: FirewallWarningEvent[] = [];

    for (const evaluated of decision.matchedPolicies) {
      if (evaluated.policy.limitUsd === undefined || !evaluated.usage) continue;
      for (const threshold of evaluated.warningThresholds) {
        events.push({
          policyId: evaluated.policy.id,
          threshold,
          projectedUsd: evaluated.usage.projectedUsd,
          limitUsd: evaluated.policy.limitUsd,
          context: decision.context,
        });
      }
    }

    for (const event of events) {
      try {
        await this.onWarning(event);
      } catch {
        // Same safety rule as onDecision: hooks are non-authoritative side effects.
      }
    }
  }
}

function money(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number`);
  }
  return value;
}

function contextToMatch(context: SpendContext): SpendPolicyMatch {
  return {
    ...(context.provider ? { provider: context.provider } : {}),
    ...(context.model ? { model: context.model } : {}),
    ...(context.resource ? { resource: context.resource } : {}),
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.userId ? { userId: context.userId } : {}),
    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    ...(context.agentId ? { agentId: context.agentId } : {}),
    ...(context.route ? { route: context.route } : {}),
    ...(context.environment ? { environment: context.environment } : {}),
    ...(context.tags ? { tags: context.tags } : {}),
  };
}
