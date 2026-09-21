import { randomUUID } from "node:crypto";
import {
  BudgetExceededError,
  ReservationNotFoundError,
  SpendReconciliationRequiredError,
  UnknownEstimateError,
} from "./errors.js";
import { isSameUtcDay, isSameUtcMonth } from "./windows.js";
import type {
  BudgetLimit,
  BudgetSnapshot,
  ChargeRecord,
  GuardConfig,
  GuardOptions,
  GuardStatus,
  LedgerState,
  LedgerStore,
  ProtectionOptions,
  ProtectionResult,
  RecordChargeInput,
  ReserveInput,
  ReservationRecord,
  ScopeStatus,
  SettleInput,
  SettlementResult,
  WarningEvent,
} from "./types.js";

function money(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number`);
  }
  return value;
}

function safeWarnAt(values: number[] | undefined): number[] {
  const input = values ?? [0.8, 0.95];
  return [...new Set(input)]
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 1)
    .sort((a, b) => a - b);
}

export class Reservation {
  readonly id: string;
  readonly provider: string;
  readonly estimatedCostUsd: number;
  private closed = false;

  constructor(private readonly guard: AiSpendGuard, record: ReservationRecord) {
    this.id = record.id;
    this.provider = record.provider;
    this.estimatedCostUsd = record.estimatedCostUsd;
  }

  async settle(input: SettleInput | number): Promise<SettlementResult> {
    if (this.closed) throw new ReservationNotFoundError(this.id);
    const normalized = typeof input === "number" ? { actualCostUsd: input } : input;
    const result = await this.guard.settle(this.id, normalized);
    this.closed = true;
    return result;
  }

  async release(): Promise<void> {
    if (this.closed) return;
    await this.guard.release(this.id);
    this.closed = true;
  }
}

export class AiSpendGuard {
  private readonly config: GuardConfig;
  private readonly now: () => Date;
  private readonly onWarning?: GuardOptions["onWarning"];
  private readonly warnAt: number[];

  constructor(
    private readonly store: LedgerStore,
    config: GuardConfig,
    options: GuardOptions = {}
  ) {
    this.config = config;
    this.now = options.now ?? (() => new Date());
    this.onWarning = options.onWarning;
    this.warnAt = safeWarnAt(config.warnAt);
    validateConfig(config);
  }

  async reserve(input: ReserveInput): Promise<Reservation> {
    const estimate =
      input.estimatedCostUsd === undefined
        ? this.config.unknownEstimate === "allow"
          ? 0
          : undefined
        : money(input.estimatedCostUsd, "estimatedCostUsd");

    if (estimate === undefined) throw new UnknownEstimateError(input.provider);

    const now = this.now();
    const createdAt = now.toISOString();
    const warnings: WarningEvent[] = [];

    const record = await this.store.transact((state) => {
      this.assertAllowed(state, input.provider, estimate, now);
      const record: ReservationRecord = {
        id: randomUUID(),
        provider: input.provider,
        estimatedCostUsd: estimate,
        createdAt,
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      };
      state.reservations[record.id] = record;
      warnings.push(...this.collectWarnings(state, input.provider, now));
      return record;
    });

    await this.emitWarnings(warnings);
    return new Reservation(this, record);
  }

  async settle(reservationId: string, input: SettleInput): Promise<SettlementResult> {
    const actual = money(input.actualCostUsd, "actualCostUsd");
    const now = this.now();
    const createdAt = now.toISOString();
    const warnings: WarningEvent[] = [];

    const { charge, estimate } = await this.store.transact((state) => {
      const reservation = state.reservations[reservationId];
      if (!reservation) throw new ReservationNotFoundError(reservationId);

      delete state.reservations[reservationId];
      const charge: ChargeRecord = {
        id: randomUUID(),
        provider: reservation.provider,
        costUsd: actual,
        createdAt,
        reservationId,
        estimateUsd: reservation.estimatedCostUsd,
        ...(reservation.requestId ? { requestId: reservation.requestId } : {}),
        ...(reservation.metadata || input.metadata
          ? { metadata: { ...(reservation.metadata ?? {}), ...(input.metadata ?? {}) } }
          : {}),
      };
      state.charges.push(charge);
      warnings.push(...this.collectWarnings(state, reservation.provider, now));
      return { charge, estimate: reservation.estimatedCostUsd };
    });

    await this.emitWarnings(warnings);
    return {
      charge,
      overrunUsd: Math.max(0, actual - estimate),
      status: await this.status(),
    };
  }

  async release(reservationId: string): Promise<void> {
    await this.store.transact((state) => {
      if (!state.reservations[reservationId]) throw new ReservationNotFoundError(reservationId);
      delete state.reservations[reservationId];
    });
  }

  /**
   * Record spend that already happened. This cannot enforce a pre-request hard stop;
   * prefer reserve() -> API call -> settle() for protected requests.
   */
  async record(input: RecordChargeInput): Promise<ChargeRecord> {
    const cost = money(input.costUsd, "costUsd");
    const now = this.now();
    const warnings: WarningEvent[] = [];
    const charge = await this.store.transact((state) => {
      const charge: ChargeRecord = {
        id: randomUUID(),
        provider: input.provider,
        costUsd: cost,
        createdAt: now.toISOString(),
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      };
      state.charges.push(charge);
      warnings.push(...this.collectWarnings(state, input.provider, now));
      return charge;
    });
    await this.emitWarnings(warnings);
    return charge;
  }

  async protect<T>(
    input: ReserveInput,
    operation: () => Promise<T>,
    actualCostUsd: (value: T) => number | Promise<number>,
    options: ProtectionOptions = {}
  ): Promise<ProtectionResult<T>> {
    const reservation = await this.reserve(input);

    let value: T;
    try {
      value = await operation();
    } catch (error) {
      if (options.onOperationError === "release") {
        await reservation.release();
        throw error;
      }
      throw new SpendReconciliationRequiredError(
        reservation.id,
        "operation",
        error
      );
    }

    let actual: number;
    try {
      actual = await actualCostUsd(value);
    } catch (error) {
      throw new SpendReconciliationRequiredError(
        reservation.id,
        "cost-calculation",
        error
      );
    }

    try {
      const settlement = await reservation.settle(actual);
      return { value, settlement };
    } catch (error) {
      throw new SpendReconciliationRequiredError(
        reservation.id,
        "settlement",
        error
      );
    }
  }

  async status(): Promise<GuardStatus> {
    const state = await this.store.read();
    const now = this.now();
    const providers = new Set<string>([
      ...Object.keys(this.config.providers ?? {}),
      ...state.charges.map((charge) => charge.provider),
      ...Object.values(state.reservations).map((reservation) => reservation.provider),
    ]);

    const providerStatuses: Record<string, ScopeStatus> = {};
    for (const provider of providers) {
      providerStatuses[provider] = this.scopeStatus(
        state,
        this.config.providers?.[provider] ?? {},
        now,
        provider
      );
    }

    return {
      currency: "USD",
      generatedAt: now.toISOString(),
      global: this.scopeStatus(state, this.config.global ?? {}, now),
      providers: providerStatuses,
      reservations: Object.keys(state.reservations).length,
    };
  }

  private assertAllowed(state: LedgerState, provider: string, estimate: number, now: Date): void {
    this.assertScope(state, this.config.global ?? {}, estimate, now, "global");
    this.assertScope(
      state,
      this.config.providers?.[provider] ?? {},
      estimate,
      now,
      "provider",
      provider
    );
  }

  private assertScope(
    state: LedgerState,
    limit: BudgetLimit,
    estimate: number,
    now: Date,
    scope: "global" | "provider",
    provider?: string
  ): void {
    if (limit.perRequestUsd !== undefined && estimate > limit.perRequestUsd) {
      throw new BudgetExceededError({
        scope,
        ...(provider ? { provider } : {}),
        period: "request",
        limitUsd: limit.perRequestUsd,
        projectedUsd: estimate,
      });
    }

    for (const period of ["daily", "monthly"] as const) {
      const max = period === "daily" ? limit.dailyUsd : limit.monthlyUsd;
      if (max === undefined) continue;
      const snapshot = this.snapshot(state, max, now, period, provider);
      const projected = snapshot.projectedUsd + estimate;
      if (projected > max + Number.EPSILON) {
        throw new BudgetExceededError({
          scope,
          ...(provider ? { provider } : {}),
          period,
          limitUsd: max,
          projectedUsd: projected,
        });
      }
    }
  }

  private scopeStatus(
    state: LedgerState,
    limit: BudgetLimit,
    now: Date,
    provider?: string
  ): ScopeStatus {
    const result: ScopeStatus = {};
    if (limit.dailyUsd !== undefined) {
      result.daily = this.snapshot(state, limit.dailyUsd, now, "daily", provider);
    }
    if (limit.monthlyUsd !== undefined) {
      result.monthly = this.snapshot(state, limit.monthlyUsd, now, "monthly", provider);
    }
    return result;
  }

  private snapshot(
    state: LedgerState,
    max: number,
    now: Date,
    period: "daily" | "monthly",
    provider?: string
  ): BudgetSnapshot {
    const inWindow = period === "daily" ? isSameUtcDay : isSameUtcMonth;
    const actualUsd = state.charges
      .filter((charge) => (!provider || charge.provider === provider) && inWindow(charge.createdAt, now))
      .reduce((sum, charge) => sum + charge.costUsd, 0);
    const reservedUsd = Object.values(state.reservations)
      .filter(
        (reservation) =>
          (!provider || reservation.provider === provider) && inWindow(reservation.createdAt, now)
      )
      .reduce((sum, reservation) => sum + reservation.estimatedCostUsd, 0);
    const projectedUsd = actualUsd + reservedUsd;
    return {
      limitUsd: max,
      actualUsd,
      reservedUsd,
      projectedUsd,
      remainingUsd: Math.max(0, max - projectedUsd),
      ratio: max === 0 ? (projectedUsd > 0 ? Infinity : 0) : projectedUsd / max,
      exceeded: projectedUsd > max + Number.EPSILON,
    };
  }

  private collectWarnings(state: LedgerState, provider: string, now: Date): WarningEvent[] {
    const events: WarningEvent[] = [];
    const scopes: Array<{
      scope: "global" | "provider";
      provider?: string;
      limit: BudgetLimit;
    }> = [
      { scope: "global", limit: this.config.global ?? {} },
      { scope: "provider", provider, limit: this.config.providers?.[provider] ?? {} },
    ];

    for (const item of scopes) {
      for (const period of ["daily", "monthly"] as const) {
        const max = period === "daily" ? item.limit.dailyUsd : item.limit.monthlyUsd;
        if (max === undefined) continue;
        const snapshot = this.snapshot(state, max, now, period, item.provider);
        const threshold = [...this.warnAt].reverse().find((value) => snapshot.ratio >= value);
        if (threshold !== undefined) {
          events.push({
            scope: item.scope,
            ...(item.provider ? { provider: item.provider } : {}),
            period,
            threshold,
            snapshot,
          });
        }
      }
    }
    return events;
  }

  private async emitWarnings(events: WarningEvent[]): Promise<void> {
    if (!this.onWarning) return;
    for (const event of events) await this.onWarning(event);
  }
}

function validateConfig(config: GuardConfig): void {
  validateLimit(config.global, "global");
  for (const [provider, limit] of Object.entries(config.providers ?? {})) {
    validateLimit(limit, `providers.${provider}`);
  }
}

function validateLimit(limit: BudgetLimit | undefined, path: string): void {
  if (!limit) return;
  for (const [key, value] of Object.entries(limit)) {
    if (value !== undefined) money(value, `${path}.${key}`);
  }
}
