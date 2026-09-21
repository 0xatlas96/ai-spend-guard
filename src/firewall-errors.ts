import { AiSpendGuardError } from "./errors.js";
import type { FirewallDecision, PolicyViolation } from "./firewall-types.js";

export class SpendPolicyError extends AiSpendGuardError {
  readonly decision: FirewallDecision;

  constructor(decision: FirewallDecision) {
    const first = decision.blockingViolations[0];
    super(first ? `Spend blocked by policy "${first.policyId}": ${first.message}` : "Spend blocked by policy.");
    this.decision = decision;
  }
}

export class DuplicateOperationError extends AiSpendGuardError {
  readonly idempotencyKey: string;
  readonly existingState: "reserved" | "settled";

  constructor(idempotencyKey: string, existingState: "reserved" | "settled") {
    super(
      `Duplicate operation blocked: idempotency key "${idempotencyKey}" is already ${existingState}.`
    );
    this.idempotencyKey = idempotencyKey;
    this.existingState = existingState;
  }
}

export class IdempotencyConflictError extends AiSpendGuardError {
  readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super(
      `Idempotency conflict: key "${idempotencyKey}" was already used for a different spend intent.`
    );
    this.idempotencyKey = idempotencyKey;
  }
}

export class InvalidPolicyError extends AiSpendGuardError {
  readonly policyId?: string;

  constructor(message: string, policyId?: string) {
    super(message);
    this.policyId = policyId;
  }
}

export class PlanViolationError extends AiSpendGuardError {
  readonly violations: PolicyViolation[];

  constructor(violations: PolicyViolation[]) {
    super(`Spend plan violates ${violations.length} enforced polic${violations.length === 1 ? "y" : "ies"}.`);
    this.violations = violations;
  }
}
