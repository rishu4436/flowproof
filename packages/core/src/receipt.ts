import { canonicalJson, sha256 } from "./ids.js";
import type { Verdict } from "./verification.js";

export const INTEGRITY_STATEMENT =
  "This SHA-256 hash detects later modification of the canonical receipt contents. It is tamper evidence for this record, not a third-party signature, and it does not prove that the underlying observations were true.";

export interface ReceiptStep {
  nodeId: string;
  actionType: string;
  status: string;
  durationMs: number | null;
  errorType: string | null;
}

export interface ReceiptRecovery {
  attempt: number;
  source: string;
  failureCategory: string;
  approvalState: string;
  applied: boolean;
  result: string | null;
  changesWriteBehavior: boolean;
}

export interface ReceiptCheck {
  name: string;
  strategy: string;
  authoritative: boolean;
  result: string;
  expected: unknown;
  observed: unknown;
  source: string;
}

export interface ReceiptModelCall {
  role: string;
  requestedModel: string;
  otariRequestId: string | null;
  costUsd: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface ReceiptDraft {
  id: string;
  runId: string;
  workflowId: string;
  workflowVersion: number;
  executedAt: string;
  objective: string;
  decision: Verdict;
  requested: Record<string, string>;
  observed: Record<string, string>;
  verified: Record<string, string>;
  checks: ReceiptCheck[];
  steps: ReceiptStep[];
  recoveries: ReceiptRecovery[];
  models: ReceiptModelCall[];
  uncertainties: string[];
  reconciledFromUnknown: boolean;
  /** Shown above the comparison. Lost responses must not read like an ordinary success. */
  decisionNote?: string;
}

export interface CanonicalReceipt extends ReceiptDraft {
  receiptVersion: 1;
  integrity: { algorithm: "sha256"; statement: string };
}

export function buildCanonicalReceipt(draft: ReceiptDraft): { canonical: CanonicalReceipt; integrityHash: string } {
  const canonical: CanonicalReceipt = {
    receiptVersion: 1,
    ...draft,
    integrity: { algorithm: "sha256", statement: INTEGRITY_STATEMENT },
  };
  return { canonical, integrityHash: `sha256:${sha256(canonicalJson(canonical))}` };
}

export function verifyReceiptHash(canonical: unknown, integrityHash: string): boolean {
  return `sha256:${sha256(canonicalJson(canonical))}` === integrityHash;
}
