import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  InputSchema,
  VerificationPolicySchema,
  WorkflowDefinitionSchema,
  artifactRoot,
  createId,
  isStoredInside,
  isTerminal,
  isRunStatus,
  repoRoot,
  validationErrors,
  validateWorkflow,
  verifyReceiptHash,
} from "@flowproof/core";
import { DEMO_WORKSPACE_ID, asJson, audit, prisma, transitionRun } from "@flowproof/database";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";
import { HttpError } from "./http";
import { requireSession } from "@/lib/session";
import { allowEntries, currentSettings } from "./workflows";

const CreateRun = z.object({
  workflowId: z.string().min(1),
  objective: z.string().min(8).max(600),
  requestedValues: z.record(z.string(), z.string()),
  scenario: z.enum(["A", "B", "C", "D", "E", "F", "G", "H"]).optional(),
  idempotencyKey: z.string().min(8).max(80).optional(),
});

export async function listRuns(url: URL) {
  await requireSession();
  const workflowId = url.searchParams.get("workflowId") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize") ?? 20) || 20));
  const where = { workspaceId: DEMO_WORKSPACE_ID, ...(workflowId ? { workflowId } : {}), ...(status ? { status } : {}) };
  const [total, items] = await Promise.all([
    prisma.run.count({ where }),
    prisma.run.findMany({
      where,
      include: { workflow: { select: { name: true } }, receipt: { select: { id: true, decision: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { items, total, page, pageSize };
}

export async function createRun(body: unknown) {
  const session = await requireSession();
  const input = CreateRun.parse(body);
  const workflow = await prisma.workflow.findFirst({ where: { id: input.workflowId, workspaceId: session.workspaceId } });
  if (!workflow || workflow.activeVersion < 1) throw new HttpError(409, "workflow_not_approved", "Approve a workflow version before running it.");
  const version = await prisma.workflowVersion.findUnique({
    where: { workflowId_version: { workflowId: workflow.id, version: workflow.activeVersion } },
  });
  if (!version?.approved) throw new HttpError(409, "workflow_not_approved", "The active version is not approved.");
  const definition = WorkflowDefinitionSchema.parse(version.definition);
  const policy = VerificationPolicySchema.parse(version.verificationPolicy);
  const issues = validationErrors(validateWorkflow(definition, policy, allowEntries()));
  if (issues.length) throw new HttpError(422, "workflow_invalid", "The approved graph no longer passes validation.", issues);
  const schema = InputSchema.parse(version.inputSchema);
  for (const field of schema.fields) {
    if (field.required && !input.requestedValues[field.key]) {
      throw new HttpError(422, "missing_value", `${field.label} is required.`);
    }
  }
  const idempotencyKey = input.idempotencyKey ?? createId("idem");
  const existing = await prisma.run.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;
  if (input.scenario) await setPortalScenario(input.scenario);
  const requestedValues = { ...input.requestedValues, clientReference: idempotencyKey };
  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.run.create({
      data: {
        id: createId("run"),
        workspaceId: session.workspaceId,
        workflowId: workflow.id,
        workflowVersionId: version.id,
        status: "QUEUED",
        objective: input.objective,
        requestedValues: asJson(requestedValues),
        environment: "demo",
        scenario: input.scenario,
        idempotencyKey,
      },
    });
    await tx.approval.create({
      data: {
        id: createId("apr"),
        runId: created.id,
        requester: session.name,
        actor: session.userId,
        scope: "objective",
        decision: "approved",
        note: input.objective,
        decidedAt: new Date(),
      },
    });
    await tx.job.create({
      data: { id: createId("job"), type: "run", payload: asJson({ runId: created.id }), status: "pending", runId: created.id },
    });
    return created;
  });
  await audit({ actorId: session.userId, action: "run.queued", targetType: "run", targetId: run.id, metadata: { scenario: input.scenario ?? null } });
  return run;
}

export async function getRun(id: string) {
  await requireSession();
  const run = await prisma.run.findFirst({
    where: { id, workspaceId: DEMO_WORKSPACE_ID },
    include: {
      workflow: true,
      workflowVersion: true,
      steps: { orderBy: { sequence: "asc" } },
      events: { orderBy: { sequence: "asc" } },
      artifacts: { orderBy: { capturedAt: "asc" } },
      recoveries: { orderBy: { createdAt: "asc" } },
      checks: { orderBy: { createdAt: "asc" } },
      approvals: { orderBy: { createdAt: "asc" } },
      aiRequests: { orderBy: { createdAt: "asc" } },
      receipt: true,
    },
  });
  if (!run) throw new HttpError(404, "not_found", "Run not found.");
  return {
    ...run,
    artifacts: run.artifacts.map((artifact) => ({ ...artifact, storagePath: undefined, href: `/api/runs/${run.id}/artifacts/${artifact.id}` })),
  };
}

export async function cancelRun(id: string) {
  const session = await requireSession();
  const run = await prisma.run.findFirst({ where: { id, workspaceId: DEMO_WORKSPACE_ID } });
  if (!run || !isRunStatus(run.status)) throw new HttpError(404, "not_found", "Run not found.");
  if (isTerminal(run.status)) return run;
  await prisma.run.update({ where: { id }, data: { cancelRequested: true } });
  if (run.status === "QUEUED") await transitionRun(id, "CANCELLED", { endedAt: new Date(), outcome: "CANCELLED" });
  await audit({ actorId: session.userId, action: "run.cancel_requested", targetType: "run", targetId: id });
  return prisma.run.findUniqueOrThrow({ where: { id } });
}

export async function pauseRun(id: string) {
  await requireSession();
  const run = await prisma.run.findFirst({ where: { id, workspaceId: DEMO_WORKSPACE_ID } });
  if (!run || !isRunStatus(run.status) || isTerminal(run.status)) throw new HttpError(409, "not_running", "Only an active run can pause.");
  await prisma.run.update({ where: { id }, data: { pauseRequested: true } });
  return { ok: true, note: "Pause takes effect before the next step." };
}

export async function resumeRun(id: string) {
  const session = await requireSession();
  const run = await prisma.run.findFirst({ where: { id, workspaceId: DEMO_WORKSPACE_ID } });
  if (!run) throw new HttpError(404, "not_found", "Run not found.");
  await prisma.approval.updateMany({
    where: { runId: id, decision: "pending", scope: { in: ["operator_pause", "write_step", "recovery", "recovery_write_change"] } },
    data: { decision: "approved", actor: session.userId, decidedAt: new Date() },
  });
  if (run.status === "PAUSED_FOR_APPROVAL") await transitionRun(id, "RUNNING", { pauseRequested: false });
  else await prisma.run.update({ where: { id }, data: { pauseRequested: false } });
  return { ok: true };
}

export async function decideRecovery(id: string, decision: "approved" | "rejected") {
  const session = await requireSession();
  const recovery = await prisma.recoveryAttempt.findUnique({ where: { id } });
  if (!recovery) throw new HttpError(404, "not_found", "Recovery not found.");
  const run = await prisma.run.findFirst({ where: { id: recovery.runId, workspaceId: DEMO_WORKSPACE_ID } });
  if (!run) throw new HttpError(404, "not_found", "Run not found.");
  await prisma.recoveryAttempt.update({ where: { id }, data: { approvalState: decision } });
  await prisma.approval.updateMany({
    where: { recoveryId: id, decision: "pending" },
    data: { decision, actor: session.userId, decidedAt: new Date() },
  });
  if (decision === "approved" && run.status === "PAUSED_FOR_APPROVAL") await transitionRun(run.id, "RECOVERING");
  if (decision === "rejected" && run.status === "PAUSED_FOR_APPROVAL") {
    await transitionRun(run.id, "FAILED", { endedAt: new Date(), outcome: "FAILED", errorSummary: "The recovery was rejected." });
  }
  await audit({ actorId: session.userId, action: `recovery.${decision}`, targetType: "recovery", targetId: id });
  return { ok: true };
}

export async function listReceipts() {
  await requireSession();
  return prisma.outcomeReceipt.findMany({
    where: { run: { workspaceId: DEMO_WORKSPACE_ID } },
    include: { run: { select: { workflowId: true, objective: true, createdAt: true, scenario: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function getReceipt(id: string) {
  await requireSession();
  const receipt = await prisma.outcomeReceipt.findFirst({
    where: { id, run: { workspaceId: DEMO_WORKSPACE_ID } },
    include: { run: { include: { workflow: true, artifacts: true, steps: { orderBy: { sequence: "asc" } }, recoveries: true, checks: true, aiRequests: true } } },
  });
  if (!receipt) throw new HttpError(404, "not_found", "Receipt not found.");
  return { ...receipt, hashMatches: verifyReceiptHash(receipt.canonical, receipt.integrityHash) };
}

export async function receiptExport(id: string, format: string) {
  const receipt = await getReceipt(id);
  if (format === "json") {
    return { contentType: "application/json", body: JSON.stringify(receipt.canonical, null, 2), filename: `${receipt.id}.json` };
  }
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const canonical = receipt.canonical as { objective?: string; decision?: string; integrity?: { statement?: string } };
  page.drawText("FlowProof Outcome Receipt", { x: 48, y: 740, size: 18, font: bold, color: rgb(0.05, 0.08, 0.09) });
  page.drawText(receipt.id, { x: 48, y: 716, size: 10, font });
  page.drawText(`Decision: ${receipt.decision}`, { x: 48, y: 690, size: 14, font: bold });
  wrapText(page, font, canonical.objective ?? "", 48, 660, 500, 11);
  wrapText(page, font, canonical.integrity?.statement ?? "", 48, 120, 500, 9);
  page.drawText(receipt.integrityHash, { x: 48, y: 72, size: 8, font });
  const bytes = await pdf.save();
  return { contentType: "application/pdf", body: Buffer.from(bytes), filename: `${receipt.id}.pdf` };
}

export async function readArtifact(runId: string, artifactId: string) {
  await requireSession();
  const artifact = await prisma.runArtifact.findFirst({ where: { id: artifactId, runId, run: { workspaceId: DEMO_WORKSPACE_ID } } });
  if (!artifact) throw new HttpError(404, "not_found", "Artifact not found.");
  const file = path.resolve(artifact.storagePath);
  const allowed = isStoredInside(artifactRoot(), file) || isStoredInside(repoRoot(), file);
  if (!allowed) throw new HttpError(403, "artifact_blocked", "Artifact path is outside storage.");
  const bytes = await readFile(file);
  return { bytes, mimeType: artifact.mimeType, capturedAt: artifact.capturedAt };
}

export function artifactStream(file: string) {
  return createReadStream(file);
}

async function setPortalScenario(scenario: string) {
  const origin = process.env.DEMO_PORTAL_ORIGIN ?? "http://127.0.0.1:4100";
  const response = await fetch(`${origin}/api/admin/scenario`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.PORTAL_ADMIN_TOKEN ?? ""}`, "Content-Type": "application/json" },
    body: JSON.stringify({ scenario }),
  });
  if (!response.ok) throw new HttpError(502, "portal_unavailable", "The demo portal did not accept the scenario.");
}

export async function resetPortal() {
  await requireSession();
  const origin = process.env.DEMO_PORTAL_ORIGIN ?? "http://127.0.0.1:4100";
  const response = await fetch(`${origin}/api/admin/reset`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.PORTAL_ADMIN_TOKEN ?? ""}` },
  });
  if (!response.ok) throw new HttpError(502, "portal_unavailable", "The demo portal could not be reset.");
  await audit({ action: "demo.reset", targetType: "portal", targetId: "default" });
  return response.json();
}

export async function portalState() {
  const origin = process.env.DEMO_PORTAL_ORIGIN ?? "http://127.0.0.1:4100";
  try {
    const response = await fetch(`${origin}/api/admin/state`, {
      headers: { Authorization: `Bearer ${process.env.PORTAL_ADMIN_TOKEN ?? ""}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, ...(await response.json()) };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function createBenchmark(body: unknown) {
  const session = await requireSession();
  const input = z.object({ name: z.string().min(1).max(80).default("Invoice reliability"), scope: z.enum(["focused", "full"]).default("focused") }).parse(body);
  await currentSettings();
  const suite = await prisma.benchmarkSuite.create({
    data: { id: createId("suite"), name: input.name, status: "queued", config: asJson({ scope: input.scope }) },
  });
  await prisma.job.create({
    data: { id: createId("job"), type: "benchmark", status: "pending", payload: asJson({ suiteId: suite.id, scope: input.scope }) },
  });
  await audit({ actorId: session.userId, action: "benchmark.queued", targetType: "benchmark", targetId: suite.id });
  return suite;
}

function wrapText(page: import("pdf-lib").PDFPage, font: import("pdf-lib").PDFFont, text: string, x: number, y: number, width: number, size: number) {
  const words = text.split(/\s+/);
  let line = "";
  let cursor = y;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width) {
      page.drawText(line, { x, y: cursor, size, font, color: rgb(0.1, 0.14, 0.16) });
      cursor -= size + 4;
      line = word;
    } else line = next;
  }
  if (line) page.drawText(line, { x, y: cursor, size, font, color: rgb(0.1, 0.14, 0.16) });
}
