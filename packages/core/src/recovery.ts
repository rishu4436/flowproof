export const FAILURE_CATEGORIES = [
  "element_not_found",
  "element_not_actionable",
  "navigation_timeout",
  "unexpected_dialog",
  "changed_form_structure",
  "authentication_required",
  "business_validation_failure",
  "network_failure",
  "unexpected_response",
  "outcome_unknown",
  "policy_violation",
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export const HARD_RECOVERY_CAP = 2;

export interface RecoveryAction {
  type: "click" | "type" | "select" | "wait_for" | "skip";
  role?: "button" | "link" | "textbox" | "combobox" | "checkbox";
  name?: string;
  label?: string;
  value?: string;
}

export interface OriginalAction {
  type: string;
  role?: string;
  name?: string;
  label?: string;
  value?: string;
  semanticNames?: string[];
  semanticLabels?: string[];
  effect?: "read" | "write";
}

export function remainingRecoveryAttempts(used: number, configuredMax: number): number {
  const cap = Math.max(0, Math.min(HARD_RECOVERY_CAP, configuredMax));
  return Math.max(0, cap - used);
}

export function repairChangesWrite(original: OriginalAction, proposed: RecoveryAction): boolean {
  if (proposed.type === "skip") return false;
  if (proposed.type !== original.type) return true;
  if ((proposed.value ?? "") !== (original.value ?? "") && proposed.value !== undefined && original.value !== undefined) {
    if (proposed.value !== original.value) return true;
  }
  if (proposed.type === "click") {
    const hints = new Set([original.name, ...(original.semanticNames ?? [])].filter(Boolean).map((item) => item!.toLowerCase()));
    const next = (proposed.name ?? "").toLowerCase();
    if (!next || !hints.has(next)) return true;
    return false;
  }
  if (proposed.type === "type" || proposed.type === "select") {
    const hints = new Set([original.label, ...(original.semanticLabels ?? [])].filter(Boolean).map((item) => item!.toLowerCase()));
    const next = (proposed.label ?? proposed.name ?? "").toLowerCase();
    if (!next || !hints.has(next)) return true;
    if (proposed.value && original.value && proposed.value !== original.value) return true;
    return false;
  }
  return true;
}

export function classifyFailureMessage(message: string): FailureCategory {
  const text = message.toLowerCase();
  if (text.includes("policy") || text.includes("allowlist") || text.includes("blocked")) return "policy_violation";
  if (text.includes("duplicate") || text.includes("validation") || text.includes("409")) return "business_validation_failure";
  if (text.includes("dialog") || text.includes("modal")) return "unexpected_dialog";
  if (text.includes("net::") || text.includes("empty_response") || text.includes("socket") || text.includes("econnreset")) {
    return "network_failure";
  }
  if (text.includes("navigation") || text.includes("goto")) return "navigation_timeout";
  if (text.includes("not enabled") || text.includes("intercepts") || text.includes("not stable") || text.includes("not editable")) {
    return "element_not_actionable";
  }
  if (text.includes("sign in") || text.includes("authentication") || text.includes("401")) return "authentication_required";
  if (text.includes("timeout") && text.includes("waiting")) return "element_not_found";
  if (text.includes("timeout")) return "navigation_timeout";
  if (text.includes("unknown outcome")) return "outcome_unknown";
  return "unexpected_response";
}

/**
 * Writes are never repeated automatically. A lost response stays unknown
 * until a separate read reconciles it.
 */
export function decideWriteRetry(input: { writeStarted: boolean; responseKnown: boolean }): {
  allow: boolean;
  reason: string;
} {
  if (input.writeStarted && !input.responseKnown) {
    return { allow: false, reason: "uncertain_write" };
  }
  if (input.writeStarted) {
    return { allow: false, reason: "write_already_attempted" };
  }
  return { allow: false, reason: "writes_are_single_attempt" };
}

export interface CandidateElement {
  role: string;
  name: string;
}

export function proposeDeterministicRepair(input: {
  original: OriginalAction;
  candidates: CandidateElement[];
}): RecoveryAction | null {
  if (input.original.type === "click") {
    const hints = [input.original.name, ...(input.original.semanticNames ?? [])].filter((item): item is string => Boolean(item));
    const match = bestCandidate(input.candidates, input.original.role ?? "button", hints);
    if (!match) return null;
    return { type: "click", role: (input.original.role as RecoveryAction["role"]) ?? "button", name: match.name };
  }
  if (input.original.type === "type" || input.original.type === "select") {
    const hints = [input.original.label, ...(input.original.semanticLabels ?? [])].filter((item): item is string => Boolean(item));
    const match = bestCandidate(input.candidates, input.original.role ?? "textbox", hints);
    if (!match) return null;
    return {
      type: input.original.type,
      role: input.original.type === "select" ? "combobox" : "textbox",
      label: match.name,
      name: match.name,
      value: input.original.value,
    };
  }
  return null;
}

function bestCandidate(candidates: CandidateElement[], role: string, hints: string[]): CandidateElement | null {
  const pool = candidates.filter((candidate) => candidate.role === role && candidate.name.trim().length > 0);
  let best: { item: CandidateElement; score: number } | null = null;
  let tied = false;
  for (const candidate of pool) {
    const score = hints.reduce((highest, hint) => Math.max(highest, nameScore(candidate.name, hint)), 0);
    if (score < 0.99) continue;
    if (!best || score > best.score) {
      best = { item: candidate, score };
      tied = false;
    } else if (score === best.score && candidate.name.toLowerCase() !== best.item.name.toLowerCase()) {
      tied = true;
    }
  }
  if (!best || tied) return null;
  return best.item;
}

function nameScore(candidate: string, hint: string): number {
  return candidate.trim().toLowerCase() === hint.trim().toLowerCase() ? 1 : 0;
}
