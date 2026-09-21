export class AiSpendGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnknownEstimateError extends AiSpendGuardError {
  constructor(provider: string) {
    super(`No cost estimate was supplied for provider "${provider}" and unknownEstimate is set to "deny".`);
  }
}

export class BudgetExceededError extends AiSpendGuardError {
  readonly details: {
    scope: "global" | "provider";
    provider?: string;
    period: "daily" | "monthly" | "request";
    limitUsd: number;
    projectedUsd: number;
  };

  constructor(details: BudgetExceededError["details"]) {
    const who = details.scope === "provider" ? `provider ${details.provider}` : "global budget";
    super(
      `AI spend blocked: ${who} ${details.period} limit is $${details.limitUsd.toFixed(6)}, ` +
        `projected spend is $${details.projectedUsd.toFixed(6)}.`
    );
    this.details = details;
  }
}

export class ReservationNotFoundError extends AiSpendGuardError {
  constructor(id: string) {
    super(`Reservation "${id}" was not found. It may already have been settled or released.`);
  }
}
