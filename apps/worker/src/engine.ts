import {
  PolicyError,
  VerificationPolicySchema,
  WorkflowDefinitionSchema,
  aggregateCost,
  budgetRemaining,
  buildCanonicalReceipt,
  canTransition,
  classifyFailureMessage,
  compareExpectedState,
  createId,
  decideStaleJob,
  decideWriteRetry,
  evaluateEvidence,
  assertSafeNavigationUrl,
  findStart,
  isRunStatus,
  isTerminal,
  maskValue,
  nextNodeId,
  proposeDeterministicRepair,
  redactRecord,
  remainingRecoveryAttempts,
  repairChangesWrite,
  resolveNavigationUrl,
  substituteValues,
  type RecoveryAction,
  type RunStatus,
  type WorkflowNode,
} from "@flowproof/core";
import {
  CUSTOMER_TOOL,
  ExplanationSchema,
  INVOICE_TOOL,
  REPAIR_SYSTEM,
  REVIEW_SYSTEM,
  RecoveryProposalSchema,
  OtariError,
  completeStructured,
  otariChat,
  otariConfigured,
  readOtariConfig,
} from "@flowproof/ai";
import { appendEvent, asJson, audit, completeJob, failJob, prisma, requeueJob, touchJob, transitionRun } from "@flowproof/database";
import type { Page, Response as PlaywrightResponse } from "playwright";

class PauseRequestedError extends Error {
  constructor() {
    super("Paused before the next action.");
    this.name = "PauseRequestedError";
  }
}
import {
  allowlist,
  assertResolvable,
  loadSettings,
  openBrowser,
  portalOrigin,
  readSnapshot,
  recordAi,
  saveScreenshot,
  verifyFetch,
} from "./runtime.js";

export async function executeRun(runId: string, jobId?: string, repairModel?: string): Promise<void> {
  const existing = await prisma.run.findUnique({ where: { id: runId } });
  if (!existing || !isRunStatus(existing.status) || isTerminal(existing.status)) return;
  const settings = await loadSettings();
  if (existing.status === "QUEUED") await transitionRun(runId, "STARTING");
  const starting = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  if (starting.status === "STARTING") {
    await transitionRun(runId, "RUNNING", { startedAt: starting.startedAt ?? new Date() });
  }
  await appendEvent(runId, "run.started", { worker: process.env.WORKER_ID ?? "worker" });
  const session = await openBrowser();
  const variables: Record<string, string> = {};
  try {
    const loaded = await loadGraph(runId);
    let nodeId: string | null = findStart(loaded.definition).id;
    const seen = new Set<string>();
    let steps = 0;
    const started = Date.now();
    while (nodeId) {
      if (await stopIfCancelled(runId)) return;
      if (steps >= settings.execution.maxSteps) throw new PolicyError("step_limit", "The run reached the step limit.");
      if (Date.now() - started > settings.execution.maxRunDurationMs) {
        throw new PolicyError("duration_limit", "The run reached the time limit.");
      }
      await pauseIfRequested(runId, jobId, settings.execution.approvalWaitMs);
      if (seen.has(nodeId)) throw new PolicyError("cycle", "The workflow tried to repeat a step.");
      seen.add(nodeId);
      const node = loaded.definition.nodes.find((item) => item.id === nodeId);
      if (!node) throw new PolicyError("missing_node", `Missing node ${nodeId}.`);
      if (jobId) await touchJob(jobId);
      let output: { handle?: "true" | "false"; stopped?: boolean };
      try {
        output = await runNode(runId, node, loaded, session.page, variables, settings, jobId, repairModel);
      } catch (error) {
        if (error instanceof PauseRequestedError) {
          seen.delete(nodeId);
          await pauseIfRequested(runId, jobId, settings.execution.approvalWaitMs);
          continue;
        }
        throw error;
      }
      if (output.stopped) return;
      if (node.type === "end" || node.type === "verify_outcome") break;
      nodeId = nextNodeId(loaded.definition, node.id, output.handle);
      steps += 1;
    }
    await verifyAndClose(runId, session.page, settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Run failed";
    const current = await prisma.run.findUnique({ where: { id: runId } });
    if (current && isRunStatus(current.status) && !isTerminal(current.status)) {
      const blocked = error instanceof PolicyError;
      const next: RunStatus = blocked && canTransition(current.status, "BLOCKED") ? "BLOCKED" : "FAILED";
      if (canTransition(current.status, next)) {
        await transitionRun(runId, next, { endedAt: new Date(), errorSummary: message, outcome: next });
      }
      await appendEvent(runId, "run.failed", { message, blocked });
      const existingReceipt = await prisma.outcomeReceipt.findUnique({ where: { runId } });
      if (!existingReceipt) {
        const loaded = await loadGraph(runId).catch(() => null);
        if (loaded) {
          await writeReceipt(runId, next === "BLOCKED" ? "BLOCKED" : "FAILED", loaded, {}, [], [message], false, message).catch(() => undefined);
        }
      }
    }
  } finally {
    await session.close();
  }
}

async function runNode(
  runId: string,
  node: WorkflowNode,
  loaded: Awaited<ReturnType<typeof loadGraph>>,
  page: Page,
  variables: Record<string, string>,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  jobId?: string,
  repairModel?: string,
): Promise<{ handle?: "true" | "false"; stopped?: boolean }> {
  if (node.type === "start" || node.type === "end") {
    await appendEvent(runId, `node.${node.type}`, { nodeId: node.id });
    return {};
  }
  if (node.type === "verify_outcome") {
    await verifyAndClose(runId, page, settings);
    return { stopped: true };
  }
  if (node.type === "approval") {
    const stopped = await ensureWriteApproval(runId, node, settings.execution.approvalWaitMs);
    return { stopped };
  }
  if (node.type === "ai_recovery") {
    await appendEvent(runId, "recovery.checkpoint", {
      nodeId: node.id,
      note: "Recovery is attempted when a step with failure behavior recover does not succeed.",
    });
    return {};
  }
  if (node.data.effect === "write" && settings.execution.requireApprovalBeforeWrite) {
    const stopped = await ensureWriteApproval(runId, node, settings.execution.approvalWaitMs);
    if (stopped) return { stopped: true };
  }
  const step = await prisma.runStep.create({
    data: {
      id: createId("step"),
      runId,
      nodeId: node.id,
      actionType: node.type,
      name: node.data.name,
      status: "running",
      sequence: await nextSequence(runId),
      startedAt: new Date(),
      input: asJson(redactRecord(stepInput(node, loaded.requested))),
    },
  });
  await appendEvent(runId, "step.started", { nodeId: node.id, stepId: step.id, action: node.type });
  const began = Date.now();
  try {
    await assertNotPaused(runId);
    const result = await perform(runId, page, node, loaded.requested, variables);
    await finishStep(step.id, "completed", Date.now() - began, result.output);
    await shot(page, runId, node.data.name, settings);
    if (result.variables) Object.assign(variables, result.variables);
    await appendEvent(runId, "step.completed", { nodeId: node.id, stepId: step.id });
    return { handle: result.handle };
  } catch (error) {
    if (error instanceof PauseRequestedError) {
      await prisma.runStep.delete({ where: { id: step.id } }).catch(() => undefined);
      throw error;
    }
    const message = error instanceof Error ? error.message : "Step failed";
    const category = error instanceof PolicyError ? "policy_violation" : classifyFailureMessage(message);
    await finishStep(step.id, "failed", Date.now() - began, undefined, category, message);
    await shot(page, runId, `${node.data.name} failed`, settings);
    await appendEvent(runId, "step.failed", { nodeId: node.id, stepId: step.id, category, message });
    if (category === "policy_violation") throw error;
    const fresh = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    if (node.data.effect === "write" && fresh.writeStarted && !fresh.writeResponseKnown) {
      await appendEvent(runId, "write.not_retried", { nodeId: node.id, reason: decideWriteRetry({ writeStarted: true, responseKnown: false }).reason });
      await verifyAndClose(runId, page, settings);
      return { stopped: true };
    }
    if (node.data.optional || node.data.failureBehavior === "skip") {
      await appendEvent(runId, "step.skipped", { nodeId: node.id, message });
      return {};
    }
    if (node.data.failureBehavior === "recover") {
      const recovery = await attemptRecovery({ runId, node, page, requested: loaded.requested, settings, message, category, jobId, repairModel });
      if (recovery === "applied") {
        await prisma.runStep.update({ where: { id: step.id }, data: { status: "recovered" } });
        return {};
      }
      if (recovery === "cancelled") return { stopped: true };
      if (recovery === "reconcile") {
        await verifyAndClose(runId, page, settings);
        return { stopped: true };
      }
    }
    await transitionRun(runId, "FAILED", { endedAt: new Date(), errorSummary: message, outcome: "FAILED", durationMs: durationOf(fresh.startedAt) });
    await appendEvent(runId, "run.failed", { message, nodeId: node.id });
    return { stopped: true };
  }
}

async function perform(
  runId: string,
  page: Page,
  node: WorkflowNode,
  requested: Record<string, string>,
  variables: Record<string, string>,
): Promise<{ output?: unknown; variables?: Record<string, string>; handle?: "true" | "false" }> {
  if (node.type === "open_website") {
    const url = resolveNavigationUrl(node.data.url ?? "", portalOrigin(), allowlist());
    await assertResolvable(url);
    const response = await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: node.data.timeoutMs ?? 20_000 });
    assertSafeNavigationUrl(page.url(), allowlist());
    return { output: { url: page.url(), status: response?.status() ?? null } };
  }
  if (node.type === "branch") {
    const actual = variables[node.data.variable ?? ""] ?? "";
    const handle = actual.toLowerCase() === (node.data.equals ?? "").toLowerCase() ? "true" : "false";
    return { handle, output: { actual, handle } };
  }
  if (node.type === "wait_for") {
    const texts = node.data.textAny ?? [];
    await Promise.any(texts.map((text) => page.getByText(text, { exact: false }).first().waitFor({ timeout: node.data.timeoutMs ?? 8000 })));
    return { output: { matched: true } };
  }

  const locator = await primaryLocator(page, node);
  const hasHints = (node.data.semanticLabels?.length ?? 0) + (node.data.semanticNames?.length ?? 0) > 0;
  const recoverFast = node.data.failureBehavior === "recover" && hasHints;
  let timeout = node.data.timeoutMs ?? (node.data.optional ? 1500 : 8000);
  if (recoverFast) timeout = Math.min(timeout, 1500);
  try {
    await waitForVisible(locator, timeout, runId);
  } catch (error) {
    if (error instanceof PauseRequestedError) throw error;
    if (node.data.optional) return { output: { skipped: true } };
    throw error;
  }
  await assertNotPaused(runId);
  if (node.type === "locate") return { output: { found: true } };
  if (node.type === "extract") {
    const value = await readLocator(locator);
    const key = node.data.variable ?? "extracted";
    return { variables: { [key]: value }, output: { [key]: value } };
  }
  if (node.type === "validate_field") {
    const actual = await readLocator(locator);
    const expected = resolveValue(node, requested);
    if (actual.trim() !== expected.trim()) throw new Error(`Validation failed. Expected ${expected} but found ${actual}.`);
    return { output: { actual } };
  }
  if (node.type === "type") {
    const value = resolveValue(node, requested);
    await locator.fill(value);
    return { output: { filled: true, value: maskValue(value, Boolean(node.data.sensitive)) } };
  }
  if (node.type === "select") {
    const value = resolveValue(node, requested);
    await locator.selectOption({ label: value });
    return { output: { selected: value } };
  }
  if (node.type === "click") {
    return clickLocator(page, locator, node, runId);
  }
  throw new PolicyError("unsupported_action", `${node.type} is not supported.`);
}

async function clickLocator(page: Page, locator: import("playwright").Locator, node: WorkflowNode, runId: string) {
  const visibleName = (await locator.innerText().catch(() => node.data.targetName ?? "")).trim();
  const commitNames = node.data.commitNames ?? [];
  const isCommit =
    node.data.effect === "write" &&
    (commitNames.length === 0 || commitNames.some((name) => name.toLowerCase() === visibleName.toLowerCase()));
  const completions: Array<Promise<number | null>> = [];
  const onResponse = (response: PlaywrightResponse) => {
    if (response.request().method() !== "POST") return;
    const url = response.url();
    if (!url.includes("/invoices") && !url.includes("/customers")) return;
    const completedWrite = response.headers()["x-northstar-result"] === "complete";
    completions.push(response.finished().then(() => (completedWrite ? response.status() : null)).catch(() => null));
  };
  page.on("response", onResponse);
  try {
    await assertNotPaused(runId);
    if (isCommit) {
      await prisma.run.update({ where: { id: runId }, data: { writeStarted: true, writeResponseKnown: false } });
    }
    await locator.click({ timeout: node.data.timeoutMs ?? 12_000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => undefined);
    assertSafeNavigationUrl(page.url(), allowlist());
    return { output: { clicked: visibleName } };
  } finally {
    page.off("response", onResponse);
    const statuses = await Promise.all(completions);
    const completed = statuses.find((status) => status != null);
    if (isCommit && completed != null) {
      await prisma.run.update({ where: { id: runId }, data: { writeResponseKnown: true } }).catch(() => undefined);
    }
  }
}

async function attemptRecovery(input: {
  runId: string;
  node: WorkflowNode;
  page: Page;
  requested: Record<string, string>;
  settings: Awaited<ReturnType<typeof loadSettings>>;
  message: string;
  category: string;
  jobId?: string;
  repairModel?: string;
}): Promise<"applied" | "failed" | "cancelled" | "reconcile"> {
  const used = await prisma.recoveryAttempt.count({ where: { runId: input.runId, nodeId: input.node.id } });
  if (remainingRecoveryAttempts(used, input.settings.ai.maxRepairAttempts) <= 0) return "failed";
  const current = await prisma.run.findUniqueOrThrow({ where: { id: input.runId } });
  if (isRunStatus(current.status) && canTransition(current.status, "RECOVERING")) {
    await transitionRun(input.runId, "RECOVERING");
  }
  const snapshot = await readSnapshot(input.page);
  const original = {
    type: input.node.type,
    role: input.node.data.role,
    name: input.node.data.targetName,
    label: input.node.data.label,
    value: input.node.data.valueFrom ? input.requested[input.node.data.valueFrom] : input.node.data.value,
    semanticNames: input.node.data.semanticNames,
    semanticLabels: input.node.data.semanticLabels,
    effect: input.node.data.effect,
  };
  let proposal: RecoveryAction | null = null;
  let source = "deterministic";
  let diagnosis = input.message;
  let uncertainty = "The replacement matches an accessible name authorized on this step.";
  let modelSaidWriteChange = false;
  let evidence: string[] = snapshot.candidates.slice(0, 6).map((candidate) => `${candidate.role}: ${candidate.name}`);
  const deterministic = proposeDeterministicRepair({ original, candidates: snapshot.candidates });
  const askModel = Boolean(input.repairModel) || !deterministic || !input.settings.execution.autoApproveSafeLocatorRepair;
  const aiProposal = askModel
    ? await proposeWithOtari(input.runId, input.settings, original, snapshot, input.category, input.message, input.repairModel)
    : null;
  if (aiProposal) {
    const name = aiProposal.proposedAction.name ?? aiProposal.proposedAction.label ?? "";
    const visible = snapshot.candidates.some((candidate) => candidate.role === aiProposal.proposedAction.role && candidate.name.toLowerCase() === name.toLowerCase());
    if (visible && aiProposal.proposedAction.type !== "skip") {
      proposal = { ...aiProposal.proposedAction, value: original.value };
      source = "otari";
      diagnosis = aiProposal.diagnosis;
      uncertainty = aiProposal.uncertainty;
      modelSaidWriteChange = aiProposal.changesWriteBehavior;
      evidence = aiProposal.evidence;
    } else {
      await appendEvent(input.runId, "recovery.rejected_model_output", { nodeId: input.node.id, reason: "The proposal did not match a visible candidate or tried to skip." });
    }
  }
  if (!proposal) proposal = proposeDeterministicRepair({ original, candidates: snapshot.candidates });
  if (!proposal) {
    await prisma.recoveryAttempt.create({
      data: {
        id: createId("rec"),
        runId: input.runId,
        nodeId: input.node.id,
        attempt: used + 1,
        source: "deterministic",
        failureCategory: input.category,
        diagnosis,
        proposal: asJson({ type: "none" }),
        uncertainty: "No authorized visible target matched.",
        changesWriteBehavior: false,
        approvalState: "rejected",
        result: "no_candidate",
      },
    });
    return "failed";
  }
  const changesWrite = repairChangesWrite(original, proposal) || modelSaidWriteChange;
  const needsApproval = changesWrite || !input.settings.execution.autoApproveSafeLocatorRepair;
  const attempt = await prisma.recoveryAttempt.create({
    data: {
      id: createId("rec"),
      runId: input.runId,
      nodeId: input.node.id,
      attempt: used + 1,
      source,
      failureCategory: input.category,
      diagnosis,
      proposal: asJson(proposal),
      uncertainty,
      changesWriteBehavior: changesWrite,
      approvalState: needsApproval ? "pending" : "auto",
      result: "proposed",
    },
  });
  await appendEvent(input.runId, "recovery.proposed", { recoveryId: attempt.id, source, changesWrite, proposal, evidence });
  if (needsApproval) {
    const approval = await prisma.approval.create({
      data: {
        id: createId("apr"),
        runId: input.runId,
        recoveryId: attempt.id,
        requester: "worker",
        scope: changesWrite ? "recovery_write_change" : "recovery",
        decision: "pending",
      },
    });
    if (canTransition("RECOVERING", "PAUSED_FOR_APPROVAL")) await transitionRun(input.runId, "PAUSED_FOR_APPROVAL");
    const decision = await waitForDecision(input.runId, approval.id, input.settings.execution.approvalWaitMs, input.jobId);
    if (decision !== "approved") {
      await prisma.recoveryAttempt.update({ where: { id: attempt.id }, data: { approvalState: decision === "rejected" ? "rejected" : "rejected", result: decision } });
      return decision === "cancelled" ? "cancelled" : "failed";
    }
    await prisma.recoveryAttempt.update({ where: { id: attempt.id }, data: { approvalState: "approved" } });
    const paused = await prisma.run.findUniqueOrThrow({ where: { id: input.runId } });
    if (paused.status === "PAUSED_FOR_APPROVAL") await transitionRun(input.runId, "RECOVERING");
  } else {
    await prisma.approval.create({
      data: {
        id: createId("apr"),
        runId: input.runId,
        recoveryId: attempt.id,
        requester: "worker",
        actor: "policy",
        scope: "recovery",
        decision: "approved",
        note: "Authorized locator repair. The business values did not change.",
        decidedAt: new Date(),
      },
    });
  }
  try {
    await applyRepair(input.page, input.runId, input.node, proposal, original.value ?? "");
    await prisma.recoveryAttempt.update({ where: { id: attempt.id }, data: { applied: true, result: "applied" } });
    const after = await prisma.run.findUniqueOrThrow({ where: { id: input.runId } });
    if (after.writeStarted && !after.writeResponseKnown) return "reconcile";
    if (after.status === "RECOVERING") await transitionRun(input.runId, "RUNNING");
    await appendEvent(input.runId, "recovery.applied", { recoveryId: attempt.id });
    return "applied";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Recovery action failed";
    await prisma.recoveryAttempt.update({ where: { id: attempt.id }, data: { result: "failed" } });
    await appendEvent(input.runId, "recovery.failed", { recoveryId: attempt.id, message });
    const after = await prisma.run.findUniqueOrThrow({ where: { id: input.runId } });
    if (after.writeStarted && !after.writeResponseKnown) return "reconcile";
    return "failed";
  }
}

async function applyRepair(page: Page, runId: string, node: WorkflowNode, proposal: RecoveryAction, authorizedValue: string) {
  if (proposal.type === "skip") return;
  const name = proposal.name ?? proposal.label ?? "";
  if (proposal.type === "click") {
    const locator = page.getByRole(proposal.role ?? "button", { name, exact: true });
    await clickLocator(page, locator, { ...node, data: { ...node.data, targetName: name } }, runId);
    return;
  }
  const locator = page.getByLabel(proposal.label ?? name, { exact: true });
  if (proposal.type === "select") await locator.selectOption({ label: authorizedValue });
  else await locator.fill(authorizedValue);
}

async function proposeWithOtari(
  runId: string,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  original: unknown,
  snapshot: { url: string; title: string; text: string; candidates: Array<{ role: string; name: string }> },
  category: string,
  message: string,
  modelOverride?: string,
) {
  const config = readOtariConfig();
  const model = modelOverride || settings.ai.repairModel || process.env.OTARI_MODEL_REPAIR || settings.ai.primaryModel || process.env.OTARI_MODEL_PRIMARY || "";
  if (!otariConfigured(config) || !model) return null;
  const spent = aggregateCost(await prisma.aIRequest.findMany({ where: { runId }, select: { costUsd: true } }));
  if (budgetRemaining({ spentUsd: spent.knownUsd, ceilingUsd: settings.ai.perRunBudgetUsd }).exceeded) {
    await recordAi({ runId, role: "repair", requestedModel: model, status: "budget_exceeded", error: "Per-run AI budget reached." });
    return null;
  }
  try {
    const result = await completeStructured(config, {
      model,
      schema: RecoveryProposalSchema,
      maxCalls: 2,
      system: REPAIR_SYSTEM,
      metadata: { purpose: "repair", runId },
      user: JSON.stringify({
        failureCategory: category,
        error: message,
        action: original,
        url: snapshot.url,
        title: snapshot.title,
        candidates: snapshot.candidates.slice(0, 40),
        pageText: snapshot.text.slice(0, 2500),
      }),
    });
    for (const call of result.calls) {
      await recordAi({
        runId,
        role: "repair",
        requestedModel: call.requestedModel,
        servedModel: call.servedModel,
        provider: call.provider,
        otariRequestId: call.requestId,
        promptTokens: call.usage.promptTokens,
        completionTokens: call.usage.completionTokens,
        totalTokens: call.usage.totalTokens,
        costUsd: call.usage.costUsd,
        pricingSource: call.usage.pricingSource,
        latencyMs: call.latencyMs,
        status: "completed",
      });
    }
    return result.value;
  } catch (error) {
    if (error instanceof OtariError) {
      for (const call of error.calls) {
        await recordAi({
          runId,
          role: "repair",
          requestedModel: call.requestedModel,
          servedModel: call.servedModel,
          provider: call.provider,
          otariRequestId: call.requestId,
          promptTokens: call.usage.promptTokens,
          completionTokens: call.usage.completionTokens,
          totalTokens: call.usage.totalTokens,
          costUsd: call.usage.costUsd,
          pricingSource: call.usage.pricingSource,
          latencyMs: call.latencyMs,
          status: "invalid_output",
        });
      }
    }
    await recordAi({
      runId,
      role: "repair",
      requestedModel: model,
      status: "failed",
      error: error instanceof Error ? error.message : "Otari repair failed",
    });
    return null;
  }
}

async function verifyAndClose(runId: string, page: Page, settings: Awaited<ReturnType<typeof loadSettings>>) {
  const loaded = await loadGraph(runId);
  const current = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  if (!isRunStatus(current.status) || isTerminal(current.status)) return;
  if (current.status !== "VERIFYING" && canTransition(current.status, "VERIFYING")) await transitionRun(runId, "VERIFYING");
  const dom = await page.locator("body").innerText().catch(() => "");
  const domSuccess = /invoice submitted successfully|customer note saved/i.test(dom);
  const checks: Array<{
    name: string;
    strategy: string;
    authoritative: boolean;
    result: "PASS" | "FAIL" | "ERROR" | "SUPPORTING" | "ABSENT";
    expected: Record<string, string> | null;
    observed: Record<string, string> | null;
    source: string;
    details: string;
  }> = [];
  let observed: Record<string, string> = {};
  if (loaded.policy.recordType === "invoice") {
    const byKey = loaded.requested.clientReference
      ? await verifyFetch(`/api/verify/invoices?idempotencyKey=${encodeURIComponent(loaded.requested.clientReference)}`)
      : { status: 404, body: null };
    if (byKey.status === 0) {
      checks.push({ name: "Authoritative invoice", strategy: "trusted_api", authoritative: true, result: "ERROR", expected: loaded.requested, observed: null, source: "northstar.verify", details: "The verification endpoint could not be reached." });
    } else if (!byKey.body) {
      const byId = await verifyFetch(`/api/verify/invoices/${encodeURIComponent(loaded.requested.invoiceId ?? "")}`);
      checks.push({
        name: "Authoritative invoice",
        strategy: "trusted_api",
        authoritative: true,
        result: "FAIL",
        expected: loaded.requested,
        observed: byId.body,
        source: "northstar.verify",
        details: byId.body ? "An invoice with that id exists, but it was not written by this run." : "No invoice is stored for this run.",
      });
      observed = byId.body ?? {};
    } else {
      const diffs = compareExpectedState(loaded.requested, byKey.body, loaded.policy.matchFields);
      observed = byKey.body;
      checks.push({
        name: "Authoritative invoice",
        strategy: "trusted_api",
        authoritative: true,
        result: diffs.length === 0 ? "PASS" : "FAIL",
        expected: loaded.requested,
        observed: byKey.body,
        source: "northstar.verify",
        details:
          diffs.length === 0
            ? current.writeResponseKnown
              ? "The saved invoice matches the requested values."
              : "The saved invoice matches. The browser response did not finish, so this is a read-back of the stored record."
            : `Differences: ${diffs.map((diff) => diff.field).join(", ")}`,
      });
    }
  } else if (loaded.policy.recordType === "customer") {
    const customer = await verifyFetch(`/api/verify/customers/${encodeURIComponent(loaded.requested.customerId ?? "")}`);
    if (customer.status === 0 || !customer.body) {
      checks.push({ name: "Authoritative customer", strategy: "trusted_api", authoritative: true, result: customer.status === 0 ? "ERROR" : "FAIL", expected: loaded.requested, observed: customer.body, source: "northstar.verify", details: "The customer record could not be confirmed." });
    } else {
      observed = customer.body;
      const diffs = compareExpectedState(loaded.requested, customer.body, loaded.policy.matchFields);
      checks.push({ name: "Authoritative customer", strategy: "trusted_api", authoritative: true, result: diffs.length === 0 ? "PASS" : "FAIL", expected: loaded.requested, observed: customer.body, source: "northstar.verify", details: diffs.length === 0 ? "The saved note matches." : "The saved note differs." });
    }
  }
  checks.push({
    name: "Browser message",
    strategy: "dom_evidence",
    authoritative: false,
    result: domSuccess ? "SUPPORTING" : "ABSENT",
    expected: null,
    observed: { text: dom.slice(0, 400) },
    source: "page_text",
    details: "Page text is supporting evidence and cannot override the authoritative record.",
  });
  const verdict = evaluateEvidence({
    checks: checks.map((check) => ({ id: check.name, strategy: check.strategy as "trusted_api", authoritative: check.authoritative, result: check.result, reason: check.details })),
    writeAttempted: current.writeStarted,
    writeResponseKnown: current.writeResponseKnown,
    policyBlocked: false,
    authoritativeRequired: settings.verification.requireAuthoritativeEvidence || loaded.policy.requireAuthoritative,
  });
  for (const check of checks) {
    await prisma.verificationCheck.create({
      data: {
        id: createId("chk"),
        runId,
        name: check.name,
        strategy: check.strategy,
        authoritative: check.authoritative,
        expected: check.expected ? asJson(check.expected) : undefined,
        observed: check.observed ? asJson(check.observed) : undefined,
        source: check.source,
        result: check.result,
        details: check.details,
      },
    });
  }
  await shot(page, runId, "Verification", settings);
  const uncertainties = verdict.reconciled ? ["The browser response was lost. The verdict comes from a later read of the saved record."] : [];
  if (!domSuccess && verdict.verdict === "VERIFIED") uncertainties.push("The confirmation screen did not report success. The saved record did.");
  if (domSuccess && verdict.verdict !== "VERIFIED") uncertainties.push("The page reported success. That message was not treated as proof.");
  await explain(runId, settings, verdict.verdict, loaded.requested, observed);
  await writeReceipt(runId, verdict.verdict, loaded, observed, checks, uncertainties, verdict.reconciled, verdict.explanation);
  const finished = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  await transitionRun(runId, verdict.verdict, {
    outcome: verdict.verdict,
    endedAt: new Date(),
    durationMs: durationOf(finished.startedAt),
    errorSummary: verdict.verdict === "VERIFIED" ? null : verdict.explanation,
  });
  await appendEvent(runId, "run.verified_decision", { verdict: verdict.verdict, explanation: verdict.explanation, reconciled: verdict.reconciled });
  await audit({ action: "run.completed", targetType: "run", targetId: runId, metadata: { verdict: verdict.verdict } });
  await deliverWebhook(runId, verdict.verdict, settings);
}

async function explain(
  runId: string,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  verdict: string,
  requested: Record<string, string>,
  observed: Record<string, string>,
) {
  const config = readOtariConfig();
  const model = settings.ai.reviewModel || process.env.OTARI_MODEL_REVIEW || settings.ai.primaryModel || process.env.OTARI_MODEL_PRIMARY || "";
  if (!otariConfigured(config) || !model) return;
  try {
    const first = await otariChat(config, {
      model,
      metadata: { purpose: "review", runId },
      tools: [INVOICE_TOOL, CUSTOMER_TOOL],
      messages: [
        { role: "system", content: REVIEW_SYSTEM },
        { role: "user", content: JSON.stringify({ verdict, requested, observedSoFar: observed }) },
      ],
    });
    await recordAi({
      runId,
      role: "review",
      requestedModel: first.requestedModel,
      servedModel: first.servedModel,
      provider: first.provider,
      otariRequestId: first.requestId,
      promptTokens: first.usage.promptTokens,
      completionTokens: first.usage.completionTokens,
      totalTokens: first.usage.totalTokens,
      costUsd: first.usage.costUsd,
      pricingSource: first.usage.pricingSource,
      latencyMs: first.latencyMs,
      status: "completed",
    });
    let content = first.content;
    const call = first.toolCalls[0];
    if (call) {
      const args = JSON.parse(call.arguments) as { invoiceId?: string; customerId?: string };
      let toolBody: unknown = { error: "tool_not_allowed" };
      if (call.name === "get_invoice_evidence" && args.invoiceId && args.invoiceId === requested.invoiceId) {
        toolBody = await verifyFetch(`/api/verify/invoices/${encodeURIComponent(args.invoiceId)}`);
      } else if (call.name === "get_customer_evidence" && args.customerId && args.customerId === requested.customerId) {
        toolBody = await verifyFetch(`/api/verify/customers/${encodeURIComponent(args.customerId)}`);
      } else toolBody = { error: "outside_run_scope" };
      const second = await otariChat(config, {
        model,
        metadata: { purpose: "review", runId },
        messages: [
          { role: "system", content: REVIEW_SYSTEM },
          {
            role: "user",
            content: JSON.stringify({
              verdict,
              requested,
              authorizedToolResult: { name: call.name, body: toolBody },
              instruction: "Explain the verdict from this authorized read-only result. Return JSON.",
            }),
          },
        ],
      });
      content = second.content;
      await recordAi({
        runId,
        role: "review",
        requestedModel: second.requestedModel,
        servedModel: second.servedModel,
        provider: second.provider,
        otariRequestId: second.requestId,
        promptTokens: second.usage.promptTokens,
        completionTokens: second.usage.completionTokens,
        totalTokens: second.usage.totalTokens,
        costUsd: second.usage.costUsd,
        pricingSource: second.usage.pricingSource,
        latencyMs: second.latencyMs,
        status: "completed",
      });
    }
    const parsed = ExplanationSchema.safeParse(JSON.parse(content));
    if (parsed.success) await appendEvent(runId, "ai.explanation", parsed.data);
  } catch (error) {
    await recordAi({
      runId,
      role: "review",
      requestedModel: model,
      status: "failed",
      error: error instanceof Error ? error.message : "Review failed",
    });
  }
}

async function assertNotPaused(runId: string) {
  const run = await prisma.run.findUnique({ where: { id: runId }, select: { pauseRequested: true } });
  if (run?.pauseRequested) throw new PauseRequestedError();
}

async function waitForVisible(locator: import("playwright").Locator, timeout: number, runId: string) {
  const found = locator.waitFor({ state: "visible", timeout }).then(() => true as const);
  const started = Date.now();
  while (Date.now() - started < timeout) {
    await assertNotPaused(runId);
    const winner = await Promise.race([
      found,
      new Promise<"tick">((resolve) => setTimeout(() => resolve("tick"), 300)),
    ]);
    if (winner === true) return;
  }
  await found.catch(() => undefined);
  throw new Error(`Timed out after ${timeout}ms waiting for the target.`);
}

async function writeReceipt(
  runId: string,
  decision: "VERIFIED" | "FAILED" | "UNVERIFIED" | "BLOCKED" | "OUTCOME_UNKNOWN",
  loaded: Awaited<ReturnType<typeof loadGraph>>,
  observed: Record<string, string>,
  checks: Array<{ name: string; strategy: string; authoritative: boolean; result: string; expected: unknown; observed: unknown; source: string }>,
  uncertainties: string[],
  reconciled: boolean,
  decisionNote?: string,
) {
  const [steps, recoveries, models, run] = await Promise.all([
    prisma.runStep.findMany({ where: { runId }, orderBy: { sequence: "asc" } }),
    prisma.recoveryAttempt.findMany({ where: { runId }, orderBy: { createdAt: "asc" } }),
    prisma.aIRequest.findMany({ where: { runId }, orderBy: { createdAt: "asc" } }),
    prisma.run.findUniqueOrThrow({ where: { id: runId } }),
  ]);
  const verified = checks.find((check) => check.authoritative && check.result === "PASS")?.observed;
  const built = buildCanonicalReceipt({
    id: createId("rcpt"),
    runId,
    workflowId: run.workflowId,
    workflowVersion: loaded.versionNumber,
    executedAt: new Date().toISOString(),
    objective: run.objective,
    decision,
    requested: loaded.requested,
    observed,
    verified: verified && typeof verified === "object" ? (verified as Record<string, string>) : {},
    checks: checks.map((check) => ({
      name: check.name,
      strategy: check.strategy,
      authoritative: check.authoritative,
      result: check.result,
      expected: check.expected,
      observed: check.observed,
      source: check.source,
    })),
    steps: steps.map((step) => ({
      nodeId: step.nodeId,
      actionType: step.actionType,
      status: step.status,
      durationMs: step.durationMs,
      errorType: step.errorType,
    })),
    recoveries: recoveries.map((item) => ({
      attempt: item.attempt,
      source: item.source,
      failureCategory: item.failureCategory,
      approvalState: item.approvalState,
      applied: item.applied,
      result: item.result,
      changesWriteBehavior: item.changesWriteBehavior,
    })),
    models: models.map((item) => ({
      role: item.role,
      requestedModel: item.requestedModel,
      otariRequestId: item.otariRequestId,
      costUsd: item.costUsd,
      promptTokens: item.promptTokens,
      completionTokens: item.completionTokens,
    })),
    uncertainties,
    reconciledFromUnknown: reconciled,
    decisionNote,
  });
  await prisma.outcomeReceipt.create({
    data: {
      id: built.canonical.id,
      runId,
      decision,
      canonical: asJson(built.canonical),
      integrityHash: built.integrityHash,
    },
  });
}

export async function recoverStaleJobs() {
  const cutoff = new Date(Date.now() - 120_000);
  const jobs = await prisma.job.findMany({ where: { status: "running", lockedAt: { lt: cutoff } } });
  for (const job of jobs) {
    if (!job.runId) {
      await failJob(job.id, "Stale job had no run.");
      continue;
    }
    const run = await prisma.run.findUnique({ where: { id: job.runId } });
    if (!run || !isRunStatus(run.status) || isTerminal(run.status)) {
      await completeJob(job.id);
      continue;
    }
    const decision = decideStaleJob({
      status: run.status,
      writeStarted: run.writeStarted,
      writeResponseKnown: run.writeResponseKnown,
      attempts: job.attempts,
    });
    if (decision === "requeue" && run.status === "QUEUED") {
      await requeueJob(job.id);
      continue;
    }
    if (run.writeStarted && !run.writeResponseKnown) {
      await reconcileAbandoned(run.id, job.id);
      continue;
    }
    if (canTransition(run.status, "FAILED")) {
      await transitionRun(run.id, "FAILED", {
        endedAt: new Date(),
        outcome: "FAILED",
        errorSummary: "The worker stopped before the run finished. No write was left in an unknown state.",
      });
    }
    await appendEvent(run.id, "run.worker_lost", { decision });
    await failJob(job.id, "Worker lock expired.");
  }
}

async function reconcileAbandoned(runId: string, jobId: string) {
  const loaded = await loadGraph(runId).catch(() => null);
  if (!loaded) {
    await failJob(jobId, "Could not load the abandoned run.");
    return;
  }
  const byKey = loaded.requested.clientReference
    ? await verifyFetch(`/api/verify/invoices?idempotencyKey=${encodeURIComponent(loaded.requested.clientReference)}`)
    : { status: 0, body: null };
  const current = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  if (!isRunStatus(current.status) || !canTransition(current.status, "VERIFYING")) {
    await failJob(jobId, "Abandoned run could not enter verification.");
    return;
  }
  await transitionRun(runId, "VERIFYING");
  const matched = Boolean(byKey.body) && compareExpectedState(loaded.requested, byKey.body ?? {}, loaded.policy.matchFields).length === 0;
  const verdict = matched ? "VERIFIED" : byKey.status === 0 ? "OUTCOME_UNKNOWN" : "FAILED";
  await transitionRun(runId, verdict, {
    outcome: verdict,
    endedAt: new Date(),
    errorSummary: matched ? null : "The worker stopped after a write whose browser response was not observed.",
  });
  await appendEvent(runId, "run.reconciled_after_crash", { verdict });
  await completeJob(jobId);
}

async function loadGraph(runId: string) {
  const run = await prisma.run.findUniqueOrThrow({
    where: { id: runId },
    include: { workflowVersion: true },
  });
  const requested: Record<string, string> = {
    ...(run.requestedValues as Record<string, string>),
    clientReference: run.idempotencyKey,
  };
  return {
    definition: WorkflowDefinitionSchema.parse(run.workflowVersion.definition),
    policy: VerificationPolicySchema.parse(run.workflowVersion.verificationPolicy),
    requested,
    versionNumber: run.workflowVersion.version,
  };
}

async function ensureWriteApproval(runId: string, node: WorkflowNode, waitMs: number): Promise<boolean> {
  const existing = await prisma.approval.findFirst({ where: { runId, scope: "write_step", decision: "approved" } });
  if (existing) return false;
  const approval = await prisma.approval.create({
    data: { id: createId("apr"), runId, requester: "worker", scope: "write_step", decision: "pending", note: node.data.name },
  });
  const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  if (isRunStatus(run.status) && canTransition(run.status, "PAUSED_FOR_APPROVAL")) await transitionRun(runId, "PAUSED_FOR_APPROVAL");
  const decision = await waitForDecision(runId, approval.id, waitMs);
  if (decision !== "approved") {
    if (decision === "cancelled") return true;
    await transitionRun(runId, "BLOCKED", { endedAt: new Date(), outcome: "BLOCKED", errorSummary: "The write was not approved." });
    return true;
  }
  const paused = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  if (paused.status === "PAUSED_FOR_APPROVAL") await transitionRun(runId, "RUNNING");
  return false;
}

async function pauseIfRequested(runId: string, jobId: string | undefined, waitMs: number) {
  const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  if (!run.pauseRequested) return;
  let approval = await prisma.approval.findFirst({ where: { runId, scope: "operator_pause", decision: "pending" } });
  if (!approval) {
    approval = await prisma.approval.create({
      data: { id: createId("apr"), runId, requester: "operator", scope: "operator_pause", decision: "pending" },
    });
  }
  if (isRunStatus(run.status) && canTransition(run.status, "PAUSED_FOR_APPROVAL")) await transitionRun(runId, "PAUSED_FOR_APPROVAL");
  await appendEvent(runId, "run.paused", { scope: "operator_pause", approvalId: approval.id });
  await waitForDecision(runId, approval.id, waitMs, jobId);
  await prisma.run.update({ where: { id: runId }, data: { pauseRequested: false } });
  const paused = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  if (paused.status === "PAUSED_FOR_APPROVAL") await transitionRun(runId, "RUNNING");
}

async function waitForDecision(runId: string, approvalId: string, waitMs: number, jobId?: string) {
  const started = Date.now();
  while (Date.now() - started < waitMs) {
    const run = await prisma.run.findUnique({ where: { id: runId } });
    if (run?.cancelRequested) {
      if (run && isRunStatus(run.status) && canTransition(run.status, "CANCELLED")) {
        await transitionRun(runId, "CANCELLED", { endedAt: new Date(), outcome: "CANCELLED" });
      }
      return "cancelled" as const;
    }
    const approval = await prisma.approval.findUnique({ where: { id: approvalId } });
    if (approval?.decision === "approved" || approval?.decision === "rejected") return approval.decision;
    if (jobId) await touchJob(jobId);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return "timeout" as const;
}

async function stopIfCancelled(runId: string) {
  const run = await prisma.run.findUnique({ where: { id: runId } });
  if (!run?.cancelRequested || !isRunStatus(run.status) || isTerminal(run.status)) return false;
  if (canTransition(run.status, "CANCELLED")) await transitionRun(runId, "CANCELLED", { endedAt: new Date(), outcome: "CANCELLED" });
  await appendEvent(runId, "run.cancelled", {});
  return true;
}

async function primaryLocator(page: Page, node: WorkflowNode) {
  if (node.type === "click") {
    return page.getByRole(node.data.role ?? "button", { name: node.data.targetName ?? node.data.label ?? "", exact: true });
  }
  return page.getByLabel(node.data.label ?? node.data.targetName ?? "", { exact: true });
}

async function readLocator(locator: import("playwright").Locator) {
  const value = await locator.inputValue().catch(() => "");
  if (value) return value.trim();
  return (await locator.innerText()).trim();
}

function resolveValue(node: WorkflowNode, requested: Record<string, string>) {
  if (node.data.valueFrom) {
    const value = requested[node.data.valueFrom];
    if (!value) throw new PolicyError("missing_value", `${node.data.name} is missing ${node.data.valueFrom}.`);
    return substituteValues(value, requested);
  }
  return substituteValues(node.data.value ?? "", requested);
}

function stepInput(node: WorkflowNode, requested: Record<string, string>) {
  return {
    type: node.type,
    label: node.data.label,
    targetName: node.data.targetName,
    value: node.data.sensitive ? "[redacted]" : node.data.valueFrom ? requested[node.data.valueFrom] : node.data.value,
  };
}

async function finishStep(id: string, status: string, durationMs: number, output?: unknown, errorType?: string, errorMessage?: string) {
  await prisma.runStep.update({
    where: { id },
    data: {
      status,
      endedAt: new Date(),
      durationMs,
      output: output === undefined ? undefined : asJson(output),
      errorType,
      errorMessage,
    },
  });
}

async function nextSequence(runId: string) {
  const aggregate = await prisma.runStep.aggregate({ where: { runId }, _max: { sequence: true } });
  return (aggregate._max.sequence ?? 0) + 1;
}

async function shot(page: Page, runId: string, label: string, settings: Awaited<ReturnType<typeof loadSettings>>) {
  const count = await prisma.runArtifact.count({ where: { runId } });
  if (count >= settings.evidence.maxArtifactsPerRun) return;
  await saveScreenshot(page, runId, label, settings.evidence.maxScreenshotBytes).catch(() => undefined);
}

function durationOf(startedAt: Date | null) {
  return startedAt ? Date.now() - startedAt.getTime() : null;
}

async function deliverWebhook(runId: string, verdict: string, settings: Awaited<ReturnType<typeof loadSettings>>) {
  const target = settings.notifications.webhookUrl.trim();
  if (!target) return;
  try {
    const url = resolveNavigationUrl(target, portalOrigin(), allowlist());
    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PORTAL_ADMIN_TOKEN ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ runId, verdict, source: "flowproof" }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (error) {
    await audit({ action: "webhook.failed", targetType: "run", targetId: runId, metadata: { message: error instanceof Error ? error.message : "failed" } });
  }
}
