import type { FirewallConfig, SpendPolicy } from "./firewall-types.js";
import { validateFirewallConfig } from "./policy.js";

export type DoctorSeverity = "error" | "warning" | "info";

export interface DoctorFinding {
  severity: DoctorSeverity;
  code: string;
  message: string;
}

export interface DoctorReport {
  ok: boolean;
  findings: DoctorFinding[];
  enforcedPolicies: number;
  observedPolicies: number;
}

export function inspectFirewallConfig(config: FirewallConfig): DoctorReport {
  const findings: DoctorFinding[] = [];

  try {
    validateFirewallConfig(config);
  } catch (error) {
    findings.push({
      severity: "error",
      code: "invalid-config",
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, findings, enforcedPolicies: 0, observedPolicies: 0 };
  }

  const enforced = config.policies.filter((policy) => (policy.mode ?? "enforce") === "enforce");
  const observed = config.policies.filter((policy) => policy.mode === "observe");

  if (enforced.length === 0) {
    findings.push({
      severity: "error",
      code: "no-enforced-policy",
      message: "All policies are observe-only; this configuration cannot block spend.",
    });
  }

  if (!enforced.some(isGlobalFinancialCap)) {
    findings.push({
      severity: "warning",
      code: "no-global-cap",
      message:
        "No catch-all enforced USD/call policy exists. Matched scopes may be protected while unmatched operations remain uncapped.",
    });
  }

  if (config.unknownEstimate === "allow") {
    findings.push({
      severity: "warning",
      code: "unknown-estimate-allowed",
      message:
        "unknownEstimate is set to allow. Unpriced operations can pass with a $0 reservation and weaken hard-cap guarantees.",
    });
  }

  if (!enforced.some((policy) => policy.maxOperationUsd !== undefined)) {
    findings.push({
      severity: "info",
      code: "no-operation-cap",
      message:
        "No enforced maxOperationUsd policy exists. A single expensive request can consume the remaining window budget.",
    });
  }

  if (!enforced.some((policy) => policy.maxConcurrent !== undefined)) {
    findings.push({
      severity: "info",
      code: "no-concurrency-cap",
      message:
        "No maxConcurrent policy exists. Dollar reservations still prevent budget races, but concurrency itself is unrestricted.",
    });
  }

  if (!enforced.some((policy) => policy.limitCalls !== undefined)) {
    findings.push({
      severity: "info",
      code: "no-call-count-cap",
      message:
        "No limitCalls policy exists. A loop of very cheap or intentionally $0 operations is not bounded by call count.",
    });
  }

  const rolling = config.policies.filter(
    (policy) => typeof policy.window === "object" && policy.window !== null
  );
  if (rolling.length > 0) {
    findings.push({
      severity: "info",
      code: "rolling-windows",
      message: `${rolling.length} polic${rolling.length === 1 ? "y uses" : "ies use"} rolling windows; ensure the selected LedgerStore retains enough history for those windows.`,
    });
  }

  const observeOnly = observed.filter(
    (policy) => !config.policies.some((candidate) => sameMatchAndWindow(policy, candidate) && (candidate.mode ?? "enforce") === "enforce")
  );
  if (observeOnly.length > 0) {
    findings.push({
      severity: "info",
      code: "observe-only-scopes",
      message: `${observeOnly.length} observe-only polic${observeOnly.length === 1 ? "y is" : "ies are"} useful for shadow testing but will not block violations.`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: "info",
      code: "clean",
      message: "No obvious configuration weaknesses detected.",
    });
  }

  return {
    ok: !findings.some((finding) => finding.severity === "error"),
    findings,
    enforcedPolicies: enforced.length,
    observedPolicies: observed.length,
  };
}

function isGlobalFinancialCap(policy: SpendPolicy): boolean {
  return (
    !policy.match &&
    (policy.limitUsd !== undefined || policy.limitCalls !== undefined) &&
    (policy.mode ?? "enforce") === "enforce"
  );
}

function sameMatchAndWindow(a: SpendPolicy, b: SpendPolicy): boolean {
  return JSON.stringify(a.match ?? {}) === JSON.stringify(b.match ?? {}) &&
    JSON.stringify(a.window ?? "utc-month") === JSON.stringify(b.window ?? "utc-month");
}
