import { centsToDecimal, moneyToCents } from "./money.js";

export const VERDICTS = ["VERIFIED", "FAILED", "UNVERIFIED", "BLOCKED", "OUTCOME_UNKNOWN"] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface FieldDiff {
  field: string;
  expected: string;
  observed: string;
}

export interface EvidenceCheck {
  id: string;
  strategy: "trusted_api" | "read_after_write" | "dom_evidence" | "expected_state" | "human_review";
  authoritative: boolean;
  /** PASS, FAIL, ERROR, SUPPORTING, ABSENT */
  result: "PASS" | "FAIL" | "ERROR" | "SUPPORTING" | "ABSENT";
  reason: string;
}

export function compareExpectedState(
  expected: Record<string, string>,
  observed: Record<string, string>,
  fields: string[],
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const field of fields) {
    const left = normalizeField(field, expected[field] ?? "");
    const right = normalizeField(field, observed[field] ?? "");
    if (left !== right) diffs.push({ field, expected: left, observed: right });
  }
  return diffs;
}

export function normalizeField(field: string, value: string): string {
  const trimmed = value.trim();
  if (field === "amount" || field === "amountCents") {
    const cents = moneyToCents(field === "amountCents" ? centsToDecimal(Number(trimmed)) : trimmed);
    return cents == null ? trimmed.toLowerCase() : String(cents);
  }
  return trimmed.toLowerCase();
}

export interface VerdictInput {
  checks: EvidenceCheck[];
  writeAttempted: boolean;
  writeResponseKnown: boolean;
  policyBlocked: boolean;
  authoritativeRequired: boolean;
}

/**
 * Deterministic evidence rules. A model explanation cannot override this.
 * DOM success never promotes a result to VERIFIED.
 */
export function evaluateEvidence(input: VerdictInput): { verdict: Verdict; explanation: string; reconciled: boolean } {
  if (input.policyBlocked) {
    return { verdict: "BLOCKED", explanation: "A safety policy stopped the run before a trustworthy outcome could be claimed.", reconciled: false };
  }

  const authoritative = input.checks.filter((check) => check.authoritative);
  const authoritativePass = authoritative.length > 0 && authoritative.every((check) => check.result === "PASS");
  const authoritativeFail = authoritative.some((check) => check.result === "FAIL");
  const authoritativeError = authoritative.some((check) => check.result === "ERROR");
  const responseLost = input.writeAttempted && !input.writeResponseKnown;

  if (authoritativePass) {
    return {
      verdict: "VERIFIED",
      explanation: responseLost
        ? "The browser response was lost. A read-back of the authoritative record matched the request, so the unknown write was reconciled."
        : "Every authoritative check matched the requested state. Browser messages were not required for this decision.",
      reconciled: responseLost,
    };
  }

  if (authoritativeFail) {
    const domSuccess = input.checks.some((check) => !check.authoritative && check.result === "SUPPORTING");
    return {
      verdict: "FAILED",
      explanation: domSuccess
        ? "The page reported success, but the authoritative record did not match. The success message is not treated as proof."
        : "An authoritative check disagreed with the requested outcome.",
      reconciled: false,
    };
  }

  if (responseLost && (authoritativeError || authoritative.length === 0)) {
    return {
      verdict: "OUTCOME_UNKNOWN",
      explanation: "A write may have reached the server, and the response was lost. The run did not submit again. Reconciliation could not confirm the record.",
      reconciled: false,
    };
  }

  if (authoritativeError && input.authoritativeRequired) {
    return {
      verdict: input.writeAttempted ? "OUTCOME_UNKNOWN" : "UNVERIFIED",
      explanation: input.writeAttempted
        ? "The authoritative check could not be completed after a write. The outcome is unknown rather than successful."
        : "The authoritative check could not be completed, so the outcome stays unverified.",
      reconciled: false,
    };
  }

  if (input.authoritativeRequired) {
    return {
      verdict: "UNVERIFIED",
      explanation: "Authoritative evidence was required and was not available. Missing evidence is not counted as success.",
      reconciled: false,
    };
  }

  return {
    verdict: "UNVERIFIED",
    explanation: "Only supporting browser evidence was available. FlowProof does not promote that to a verified outcome.",
    reconciled: false,
  };
}
