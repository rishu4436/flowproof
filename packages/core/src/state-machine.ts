export const RUN_STATUSES = [
  "QUEUED",
  "STARTING",
  "RUNNING",
  "PAUSED_FOR_APPROVAL",
  "RECOVERING",
  "VERIFYING",
  "VERIFIED",
  "FAILED",
  "BLOCKED",
  "UNVERIFIED",
  "OUTCOME_UNKNOWN",
  "CANCELLED",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_STATUSES: readonly RunStatus[] = [
  "VERIFIED",
  "FAILED",
  "BLOCKED",
  "UNVERIFIED",
  "OUTCOME_UNKNOWN",
  "CANCELLED",
];

const TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  QUEUED: ["STARTING", "CANCELLED"],
  STARTING: ["RUNNING", "FAILED", "CANCELLED"],
  RUNNING: ["PAUSED_FOR_APPROVAL", "RECOVERING", "VERIFYING", "FAILED", "BLOCKED", "CANCELLED"],
  PAUSED_FOR_APPROVAL: ["RECOVERING", "RUNNING", "FAILED", "CANCELLED", "BLOCKED"],
  RECOVERING: ["RUNNING", "VERIFYING", "FAILED", "PAUSED_FOR_APPROVAL", "BLOCKED", "CANCELLED"],
  VERIFYING: ["VERIFIED", "FAILED", "UNVERIFIED", "BLOCKED", "OUTCOME_UNKNOWN"],
  VERIFIED: [],
  FAILED: [],
  BLOCKED: [],
  UNVERIFIED: [],
  OUTCOME_UNKNOWN: [],
  CANCELLED: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Run cannot move from ${from} to ${to}.`);
    this.name = "InvalidTransitionError";
  }
}

export function isRunStatus(value: string): value is RunStatus {
  return (RUN_STATUSES as readonly string[]).includes(value);
}

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export type StaleDecision = "requeue" | "outcome_unknown" | "fail" | "leave_paused";

/**
 * A crashed worker must not turn an uncertain write into success, and it must
 * not resume a paused approval by itself.
 */
export function decideStaleJob(input: {
  status: RunStatus;
  writeStarted: boolean;
  writeResponseKnown: boolean;
  attempts: number;
}): StaleDecision {
  if (isTerminal(input.status)) return "fail";
  if (input.status === "PAUSED_FOR_APPROVAL") return "leave_paused";
  if (input.writeStarted && !input.writeResponseKnown) return "outcome_unknown";
  if (!input.writeStarted && input.attempts < 2) return "requeue";
  return "fail";
}
