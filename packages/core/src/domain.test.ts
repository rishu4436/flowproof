import { describe, expect, it } from "vitest";
import { aggregateCost, budgetRemaining, costPerVerified } from "./cost.js";
import { buildCanonicalReceipt, verifyReceiptHash } from "./receipt.js";
import {
  decideWriteRetry,
  proposeDeterministicRepair,
  remainingRecoveryAttempts,
  repairChangesWrite,
} from "./recovery.js";
import { assertTransition, decideStaleJob, InvalidTransitionError } from "./state-machine.js";
import { workflowTemplates } from "./templates.js";
import {
  assertResolvedAddresses,
  assertSafeNavigationUrl,
  parseAllowlist,
  PolicyError,
} from "./url-safety.js";
import { compareExpectedState, evaluateEvidence } from "./verification.js";
import { validateWorkflow, validationErrors, VerificationPolicySchema, WorkflowDefinitionSchema } from "./workflow.js";

const allow = parseAllowlist(["http://127.0.0.1:4100"]);

describe("state machine", () => {
  it("allows the execution path and rejects skips", () => {
    expect(() => assertTransition("QUEUED", "STARTING")).not.toThrow();
    expect(() => assertTransition("RUNNING", "VERIFYING")).not.toThrow();
    expect(() => assertTransition("VERIFYING", "VERIFIED")).not.toThrow();
    expect(() => assertTransition("QUEUED", "VERIFIED")).toThrow(InvalidTransitionError);
    expect(() => assertTransition("VERIFIED", "FAILED")).toThrow(InvalidTransitionError);
  });

  it("does not retry an uncertain write after a crash", () => {
    expect(decideStaleJob({ status: "RUNNING", writeStarted: true, writeResponseKnown: false, attempts: 1 })).toBe(
      "outcome_unknown",
    );
    expect(decideStaleJob({ status: "RUNNING", writeStarted: false, writeResponseKnown: false, attempts: 1 })).toBe(
      "requeue",
    );
    expect(decideStaleJob({ status: "PAUSED_FOR_APPROVAL", writeStarted: false, writeResponseKnown: false, attempts: 1 })).toBe(
      "leave_paused",
    );
  });
});

describe("url safety", () => {
  it("allows the demo portal and blocks metadata, schemes, and other private hosts", () => {
    expect(assertSafeNavigationUrl("http://127.0.0.1:4100/invoices/new", allow).pathname).toBe("/invoices/new");
    expect(() => assertSafeNavigationUrl("http://169.254.169.254/latest", allow)).toThrow(PolicyError);
    expect(() => assertSafeNavigationUrl("file:///etc/passwd", allow)).toThrow(PolicyError);
    expect(() => assertSafeNavigationUrl("http://192.168.1.20/admin", allow)).toThrow(PolicyError);
    expect(() => assertSafeNavigationUrl("http://example.com", allow)).toThrow(PolicyError);
  });

  it("rejects a public name that resolves into a private network", () => {
    expect(() =>
      assertResolvedAddresses("portal.example", [{ address: "10.0.0.8", family: 4 }], allow),
    ).toThrow(PolicyError);
    expect(() =>
      assertResolvedAddresses("localhost", [{ address: "127.0.0.1", family: 4 }], allow),
    ).not.toThrow();
  });
});

describe("verification", () => {
  it("does not treat a success message as a saved invoice", () => {
    const result = evaluateEvidence({
      writeAttempted: true,
      writeResponseKnown: true,
      policyBlocked: false,
      authoritativeRequired: true,
      checks: [
        { id: "api", strategy: "trusted_api", authoritative: true, result: "FAIL", reason: "not_found" },
        { id: "dom", strategy: "dom_evidence", authoritative: false, result: "SUPPORTING", reason: "toast" },
      ],
    });
    expect(result.verdict).toBe("FAILED");
  });

  it("verifies a matching record even when the confirmation page failed", () => {
    const result = evaluateEvidence({
      writeAttempted: true,
      writeResponseKnown: true,
      policyBlocked: false,
      authoritativeRequired: true,
      checks: [
        { id: "api", strategy: "trusted_api", authoritative: true, result: "PASS", reason: "match" },
        { id: "dom", strategy: "dom_evidence", authoritative: false, result: "ABSENT", reason: "no confirmation" },
      ],
    });
    expect(result.verdict).toBe("VERIFIED");
  });

  it("keeps a lost response unknown until reconciliation, then accepts a matching read-back", () => {
    const unknown = evaluateEvidence({
      writeAttempted: true,
      writeResponseKnown: false,
      policyBlocked: false,
      authoritativeRequired: true,
      checks: [{ id: "api", strategy: "trusted_api", authoritative: true, result: "ERROR", reason: "unreachable" }],
    });
    expect(unknown.verdict).toBe("OUTCOME_UNKNOWN");
    const reconciled = evaluateEvidence({
      writeAttempted: true,
      writeResponseKnown: false,
      policyBlocked: false,
      authoritativeRequired: true,
      checks: [{ id: "api", strategy: "trusted_api", authoritative: true, result: "PASS", reason: "match" }],
    });
    expect(reconciled.verdict).toBe("VERIFIED");
    expect(reconciled.reconciled).toBe(true);
  });

  it("compares money in cents and reports field differences", () => {
    const diffs = compareExpectedState(
      { amount: "$2,450.00", vendor: "Northstar Supplies" },
      { amount: "2450.00", vendor: "Other" },
      ["amount", "vendor"],
    );
    expect(diffs.map((diff) => diff.field)).toEqual(["vendor"]);
  });
});

describe("receipts", () => {
  it("hashes canonical content and notices modification", () => {
    const built = buildCanonicalReceipt({
      id: "rcpt_test",
      runId: "run_test",
      workflowId: "wf_invoice",
      workflowVersion: 1,
      executedAt: "2026-11-09T00:00:00.000Z",
      objective: "Submit INV-2041",
      decision: "VERIFIED",
      requested: { invoiceId: "INV-2041" },
      observed: { invoiceId: "INV-2041" },
      verified: { invoiceId: "INV-2041" },
      checks: [],
      steps: [],
      recoveries: [],
      models: [],
      uncertainties: [],
      reconciledFromUnknown: false,
    });
    expect(verifyReceiptHash(built.canonical, built.integrityHash)).toBe(true);
    const tampered = { ...built.canonical, decision: "FAILED" };
    expect(verifyReceiptHash(tampered, built.integrityHash)).toBe(false);
  });
});

describe("recovery policy", () => {
  it("caps attempts and refuses to repeat a write", () => {
    expect(remainingRecoveryAttempts(2, 5)).toBe(0);
    expect(remainingRecoveryAttempts(0, 2)).toBe(2);
    expect(decideWriteRetry({ writeStarted: true, responseKnown: false }).allow).toBe(false);
    expect(decideWriteRetry({ writeStarted: true, responseKnown: true }).reason).toBe("write_already_attempted");
  });

  it("treats an authorized label change as safe and a new value as a write change", () => {
    const original = {
      type: "click",
      role: "button",
      name: "Submit invoice",
      semanticNames: ["Submit invoice", "Send to accounts"],
      effect: "write" as const,
    };
    expect(repairChangesWrite(original, { type: "click", role: "button", name: "Send to accounts" })).toBe(false);
    expect(repairChangesWrite(original, { type: "click", role: "button", name: "Delete all" })).toBe(true);
    const proposal = proposeDeterministicRepair({
      original,
      candidates: [
        { role: "button", name: "Send to accounts" },
        { role: "button", name: "Cancel" },
      ],
    });
    expect(proposal?.name).toBe("Send to accounts");
  });
});

describe("workflow templates", () => {
  it("accepts every bundled template", () => {
    for (const template of workflowTemplates()) {
      const definition = WorkflowDefinitionSchema.parse(template.definition);
      const policy = VerificationPolicySchema.parse(template.verificationPolicy);
      const issues = validationErrors(validateWorkflow(definition, policy, ["http://127.0.0.1:4100"]));
      expect(issues, template.id).toEqual([]);
    }
  });

  it("rejects a write that ends without verification", () => {
    const definition = WorkflowDefinitionSchema.parse({
      nodes: [
        { id: "start", type: "start", position: { x: 0, y: 0 }, data: { name: "Start" } },
        {
          id: "go",
          type: "click",
          position: { x: 0, y: 80 },
          data: { name: "Submit", role: "button", targetName: "Submit invoice", effect: "write" },
        },
        { id: "end", type: "end", position: { x: 0, y: 160 }, data: { name: "End" } },
      ],
      edges: [
        { id: "a", source: "start", target: "go" },
        { id: "b", source: "go", target: "end" },
      ],
    });
    const policy = VerificationPolicySchema.parse({
      strategy: "composite",
      requireAuthoritative: true,
      recordType: "invoice",
      matchFields: ["invoiceId"],
      domCannotOverrideApi: true,
      onUnknownWrite: "outcome_unknown",
    });
    const codes = validationErrors(validateWorkflow(definition, policy, ["http://127.0.0.1:4100"])).map((issue) => issue.code);
    expect(codes).toContain("write_without_verification");
  });
});

describe("cost", () => {
  it("sums reported costs and leaves missing costs unknown", () => {
    const total = aggregateCost([{ costUsd: "0.010000" }, { costUsd: "0.002500" }, { costUsd: null }]);
    expect(total.knownUsd).toBe("0.012500");
    expect(total.unknownCount).toBe(1);
    expect(costPerVerified(total.knownUsd, 2)).toBe("0.006250");
    expect(budgetRemaining({ spentUsd: "0.500000", ceilingUsd: 0.5 }).exceeded).toBe(true);
  });
});
