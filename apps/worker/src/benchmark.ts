import { createId, workflowTemplates, type ScenarioId } from "@flowproof/core";
import { asJson, prisma, DEMO_WORKSPACE_ID, touchJob } from "@flowproof/database";
import { executeRun } from "./engine.js";
import { openBrowser, portalOrigin, verifyFetch } from "./runtime.js";

const FOCUSED: ScenarioId[] = ["A", "B", "E"];
const ALL: ScenarioId[] = ["A", "B", "C", "D", "E", "F", "G", "H"];

export async function executeBenchmark(jobId: string, payload: { suiteId?: string; scope?: "focused" | "full" | "models"; models?: string[] }) {
  const suiteId = payload.suiteId;
  if (!suiteId) return;
  if (payload.scope === "models") {
    await compareModels(jobId, suiteId, payload.models ?? []);
    return;
  }
  const scenarios = payload.scope === "full" ? ALL : FOCUSED;
  await prisma.benchmarkSuite.update({ where: { id: suiteId }, data: { status: "running" } });
  const template = workflowTemplates().find((item) => item.id === "wf_invoice");
  if (!template) throw new Error("Invoice workflow template is missing.");
  for (const scenario of scenarios) {
    await touchJob(jobId);
    await setScenario(scenario);
    const nonce = createId("x").slice(-4).toUpperCase();
    const shared = {
      vendor: "Northstar Supplies",
      purchaseOrder: "PO-991",
      amount: "2450.00",
      currency: "USD",
      paymentTerms: "Net 30",
    };
    const baselineValues = { ...shared, invoiceId: scenario === "F" ? "INV-2041" : `INV-${scenario}B${nonce}` };
    const flowValues = { ...shared, invoiceId: scenario === "F" ? "INV-2041" : `INV-${scenario}F${nonce}` };
    const baseline = await runBaseline(scenario, baselineValues);
    await prisma.benchmarkRun.create({
      data: {
        id: createId("bench"),
        suiteId,
        scenario,
        approach: "baseline",
        outcome: baseline.declared,
        actualOutcome: baseline.actual,
        incorrectSuccess: baseline.incorrectSuccess,
        metrics: asJson({ ...baseline, invoiceId: baselineValues.invoiceId }),
      },
    });
    const run = await createMeasuredRun(template.id, scenario, flowValues);
    const started = Date.now();
    await executeRun(run.id, jobId);
    const finished = await prisma.run.findUniqueOrThrow({ where: { id: run.id } });
    const ai = await prisma.aIRequest.findMany({ where: { runId: run.id } });
    const recoveries = await prisma.recoveryAttempt.count({ where: { runId: run.id } });
    const human = await prisma.recoveryAttempt.count({ where: { runId: run.id, approvalState: { not: "auto" } } });
    const actual = await actualVerdict(run.idempotencyKey, flowValues);
    const declared = finished.outcome ?? finished.status;
    await prisma.benchmarkRun.create({
      data: {
        id: createId("bench"),
        suiteId,
        scenario,
        approach: "flowproof",
        model: ai[0]?.requestedModel ?? null,
        outcome: declared,
        actualOutcome: actual,
        incorrectSuccess: declared === "VERIFIED" && actual !== "VERIFIED",
        runId: run.id,
        metrics: asJson({
          invoiceId: flowValues.invoiceId,
          durationMs: finished.durationMs ?? Date.now() - started,
          recoveryAttempts: recoveries,
          humanApprovals: human,
          aiRequests: ai.length,
          knownCostUsd: ai.map((item) => item.costUsd),
        }),
      },
    });
  }
  await prisma.benchmarkSuite.update({ where: { id: suiteId }, data: { status: "completed", endedAt: new Date() } });
}

async function compareModels(jobId: string, suiteId: string, models: string[]) {
  const template = workflowTemplates().find((item) => item.id === "wf_invoice");
  if (!template) throw new Error("Invoice workflow template is missing.");
  if (models.length < 2) throw new Error("A model comparison needs two model ids.");
  await prisma.benchmarkSuite.update({ where: { id: suiteId }, data: { status: "running" } });
  await setScenario("B");
  for (const [index, model] of models.entries()) {
    await touchJob(jobId);
    const nonce = createId("x").slice(-3).toUpperCase();
    const invoiceId = `INV-M${index}${nonce}`;
    const values = {
      invoiceId,
      vendor: "Northstar Supplies",
      purchaseOrder: "PO-991",
      amount: "2450.00",
      currency: "USD",
      paymentTerms: "Net 30",
    };
    const run = await createMeasuredRun(template.id, "B", values, `Compare ${model} on changed-button scenario ${invoiceId}.`);
    const started = Date.now();
    await executeRun(run.id, jobId, model);
    const finished = await prisma.run.findUniqueOrThrow({ where: { id: run.id } });
    const ai = await prisma.aIRequest.findMany({ where: { runId: run.id } });
    const recoveries = await prisma.recoveryAttempt.count({ where: { runId: run.id } });
    const actual = await actualVerdict(run.idempotencyKey, values);
    const declared = finished.outcome ?? finished.status;
    const knownCost = ai.map((item) => item.costUsd).filter((cost): cost is string => Boolean(cost));
    await prisma.benchmarkRun.create({
      data: {
        id: createId("bench"),
        suiteId,
        scenario: "B",
        approach: "flowproof",
        model,
        outcome: declared,
        actualOutcome: actual,
        incorrectSuccess: declared === "VERIFIED" && actual !== "VERIFIED",
        runId: run.id,
        metrics: asJson({
          invoiceId,
          durationMs: finished.durationMs ?? Date.now() - started,
          recoveryAttempts: recoveries,
          aiRequests: ai.length,
          otariRequestIds: ai.map((item) => item.otariRequestId),
          knownCostUsd: knownCost,
          servedModels: ai.map((item) => item.servedModel),
        }),
      },
    });
  }
  await prisma.benchmarkSuite.update({ where: { id: suiteId }, data: { status: "completed", endedAt: new Date() } });
}

async function createMeasuredRun(workflowId: string, scenario: string, values: Record<string, string>, objective?: string) {
  const workflow = await prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } });
  const version = await prisma.workflowVersion.findUniqueOrThrow({
    where: { workflowId_version: { workflowId, version: workflow.activeVersion } },
  });
  const idempotencyKey = createId("idem");
  return prisma.run.create({
    data: {
      id: createId("run"),
      workspaceId: DEMO_WORKSPACE_ID,
      workflowId,
      workflowVersionId: version.id,
      status: "QUEUED",
      objective: objective ?? `Benchmark ${scenario} for ${values.invoiceId}`,
      requestedValues: asJson({ ...values, clientReference: idempotencyKey }),
      environment: "benchmark",
      scenario,
      idempotencyKey,
    },
  });
}

async function runBaseline(scenario: string, values: Record<string, string>) {
  const started = Date.now();
  const session = await openBrowser();
  const reference = createId("base");
  let declared = "FAILED";
  let note = "";
  try {
    await session.page.goto(`${portalOrigin()}/invoices/new`, { waitUntil: "domcontentloaded" });
    await session.page.getByLabel("Invoice ID", { exact: true }).fill(values.invoiceId ?? "");
    await session.page.getByLabel("Vendor", { exact: true }).fill(values.vendor ?? "");
    await session.page.getByLabel("Purchase order", { exact: true }).fill(values.purchaseOrder ?? "");
    await session.page.getByLabel("Amount", { exact: true }).fill(values.amount ?? "");
    await session.page.getByLabel("Currency", { exact: true }).selectOption({ label: values.currency ?? "USD" });
    await session.page.getByLabel("Payment terms", { exact: true }).selectOption({ label: values.paymentTerms ?? "Net 30" });
    await session.page.getByLabel("Client reference", { exact: true }).fill(reference);
    await session.page.getByRole("button", { name: "Submit invoice", exact: true }).click();
    await session.page.waitForLoadState("domcontentloaded").catch(() => undefined);
    const text = await session.page.locator("body").innerText();
    declared = /invoice submitted successfully/i.test(text) ? "VERIFIED" : "FAILED";
    note = "Baseline trusts the success message and uses the original labels only.";
  } catch (error) {
    declared = "FAILED";
    note = error instanceof Error ? error.message : "Baseline failed before submit.";
  } finally {
    await session.close();
  }
  const actual = await actualVerdict(reference, values);
  return {
    scenario,
    declared,
    actual,
    incorrectSuccess: declared === "VERIFIED" && actual !== "VERIFIED",
    durationMs: Date.now() - started,
    recoveryAttempts: 0,
    note,
  };
}

async function actualVerdict(idempotencyKey: string | undefined, values: Record<string, string>) {
  if (!idempotencyKey) return "FAILED";
  const result = await verifyFetch(`/api/verify/invoices?idempotencyKey=${encodeURIComponent(idempotencyKey)}`);
  if (!result.body) return result.status === 0 ? "OUTCOME_UNKNOWN" : "FAILED";
  const same =
    result.body.invoiceId === values.invoiceId &&
    result.body.amount === values.amount &&
    result.body.vendor === values.vendor;
  return same ? "VERIFIED" : "FAILED";
}

async function setScenario(scenario: string) {
  const response = await fetch(`${portalOrigin()}/api/admin/scenario`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PORTAL_ADMIN_TOKEN ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ scenario }),
  });
  if (!response.ok) throw new Error(`Could not set scenario ${scenario}.`);
}

