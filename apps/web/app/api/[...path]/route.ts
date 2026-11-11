import { NextRequest } from "next/server";
import { otariChat, otariHealth, readOtariConfig } from "@flowproof/ai";
import { aggregateCost } from "@flowproof/core";
import { DEMO_WORKSPACE_ID, asJson, prisma } from "@flowproof/database";
import { dateRange, handleError, jsonError } from "@/server/http";
import { overview, systemHealth } from "@/server/analytics";
import { recordAiRequest } from "@/server/ai-log";
import { DEMO_ROLES, runCapability } from "@/server/capabilities";
import {
  cancelRun,
  createBenchmark,
  createRun,
  decideRecovery,
  getReceipt,
  getRun,
  listReceipts,
  listRuns,
  pauseRun,
  portalState,
  readArtifact,
  receiptExport,
  resetPortal,
  resumeRun,
} from "@/server/runs";
import { currentSettings } from "@/server/workflows";
import {
  approveVersion,
  createWorkflow,
  deleteWorkflow,
  duplicateWorkflow,
  generateWorkflow,
  getWorkflow,
  importWorkflow,
  listWorkflows,
  updateWorkflow,
  validateWorkflowById,
} from "@/server/workflows";
import { SettingsSchema, enforceSettings, SCENARIOS } from "@flowproof/core";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

async function dispatch(request: NextRequest, method: string, path: string[]) {
  const url = request.nextUrl;
  const key = path.join("/");
  if (method === "GET" && key === "health") return Response.json({ ok: true, service: "flowproof" });
  if (method === "GET" && key === "workflows") return Response.json(await listWorkflows(url));
  if (method === "POST" && key === "workflows") return Response.json(await createWorkflow(await request.json()));
  if (method === "POST" && key === "workflows/generate") return Response.json(await generateWorkflow(await request.json()));
  if (method === "POST" && key === "workflows/import") return Response.json(await importWorkflow(await request.json()));
  if (path[0] === "workflows" && path[1] && path.length === 2 && method === "GET") return Response.json(await getWorkflow(path[1]));
  if (path[0] === "workflows" && path[1] && path.length === 2 && method === "PATCH") return Response.json(await updateWorkflow(path[1], await request.json()));
  if (path[0] === "workflows" && path[1] && path.length === 2 && method === "DELETE") return Response.json(await deleteWorkflow(path[1]));
  if (path[0] === "workflows" && path[2] === "duplicate" && method === "POST") return Response.json(await duplicateWorkflow(path[1]!));
  if (path[0] === "workflows" && path[2] === "validate" && method === "POST") return Response.json(await validateWorkflowById(path[1]!));
  if (path[0] === "workflows" && path[2] === "versions" && method === "POST") return Response.json(await approveVersion(path[1]!));
  if (method === "GET" && key === "runs") return Response.json(await listRuns(url));
  if (method === "POST" && key === "runs") return Response.json(await createRun(await request.json()), { status: 201 });
  if (path[0] === "runs" && path[1] && path.length === 2 && method === "GET") return Response.json(await getRun(path[1]));
  if (path[0] === "runs" && path[2] === "cancel" && method === "POST") return Response.json(await cancelRun(path[1]!));
  if (path[0] === "runs" && path[2] === "pause" && method === "POST") return Response.json(await pauseRun(path[1]!));
  if (path[0] === "runs" && path[2] === "resume" && method === "POST") return Response.json(await resumeRun(path[1]!));
  if (path[0] === "runs" && path[2] === "events" && method === "GET") {
    const run = await getRun(path[1]!);
    return Response.json({ items: run.events });
  }
  if (path[0] === "runs" && path[2] === "stream" && method === "GET") return streamRun(path[1]!);
  if (path[0] === "runs" && path[2] === "artifacts" && path[3] && method === "GET") return artifactResponse(path[1]!, path[3]);
  if (path[0] === "runs" && path[2] === "artifacts" && method === "GET") {
    const run = await getRun(path[1]!);
    return Response.json({ items: run.artifacts });
  }
  if (path[0] === "runs" && path[2] === "recoveries" && method === "GET") {
    const run = await getRun(path[1]!);
    return Response.json({ items: run.recoveries });
  }
  if (path[0] === "runs" && path[2] === "verification" && method === "GET") {
    const run = await getRun(path[1]!);
    return Response.json({ checks: run.checks, outcome: run.outcome, receiptId: run.receipt?.id ?? null });
  }
  if (path[0] === "recoveries" && path[2] === "approve" && method === "POST") return Response.json(await decideRecovery(path[1]!, "approved"));
  if (path[0] === "recoveries" && path[2] === "reject" && method === "POST") return Response.json(await decideRecovery(path[1]!, "rejected"));
  if (method === "GET" && key === "receipts") return Response.json(await listReceipts());
  if (path[0] === "receipts" && path[1] && path.length === 2 && method === "GET") return Response.json(await getReceipt(path[1]));
  if (path[0] === "receipts" && path[2] === "export" && method === "GET") return exportReceipt(path[1]!, url.searchParams.get("format") ?? "json");
  if (method === "GET" && key === "benchmarks") {
    await requireSession();
    return Response.json(await prisma.benchmarkSuite.findMany({ include: { runs: true }, orderBy: { createdAt: "desc" }, take: 20 }));
  }
  if (method === "POST" && key === "benchmarks/run") return Response.json(await createBenchmark(await request.json()), { status: 201 });
  if (path[0] === "benchmarks" && path[1] && method === "GET") {
    await requireSession();
    const suite = await prisma.benchmarkSuite.findUnique({ where: { id: path[1] }, include: { runs: { orderBy: { createdAt: "asc" } } } });
    if (!suite) return jsonError(404, "not_found", "Benchmark not found.");
    return Response.json(suite);
  }
  if (method === "GET" && key === "ai/health") return Response.json(await otariHealth(readOtariConfig()));
  if (method === "GET" && key === "ai/models") return Response.json(await otariHealth(readOtariConfig()));
  if (method === "POST" && key === "ai/test") return testModel(await request.json());
  if (method === "GET" && key === "ai/roles") return Response.json(DEMO_ROLES);
  if (method === "POST" && key === "ai/capability") {
    const body = (await request.json().catch(() => ({}))) as { kind?: string };
    if (!body.kind) return jsonError(400, "missing_kind", "Name the capability to run.");
    return Response.json(await runCapability(body.kind));
  }
  if (method === "GET" && key === "ai/usage") return Response.json(await aiUsage(url));
  if (method === "GET" && key === "analytics/overview") {
    const range = dateRange(url);
    return Response.json({ range, ...(await overview(range.from, range.to)) });
  }
  if (method === "GET" && (key === "analytics/reliability" || key === "analytics/usage")) {
    const range = dateRange(url);
    const data = await overview(range.from, range.to);
    return Response.json(key.endsWith("usage") ? { range, models: data.models, aiCost: data.aiCost } : { range, reliability: data.reliability });
  }
  if (method === "POST" && key === "demo/reset") {
    const result = await resetPortal();
    if (url.searchParams.get("redirect") === "1") {
      return new Response(null, { status: 303, headers: { Location: "/demo?reset=1" } });
    }
    return Response.json(result);
  }
  if (method === "POST" && key === "demo/scenario") {
    const body = (await request.json()) as { scenario?: string };
    const origin = process.env.DEMO_PORTAL_ORIGIN ?? "http://127.0.0.1:4100";
    const response = await fetch(`${origin}/api/admin/scenario`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.PORTAL_ADMIN_TOKEN ?? ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: body.scenario }),
    });
    if (!response.ok) return jsonError(502, "portal_unavailable", "The demo portal rejected the scenario.");
    return Response.json(await response.json());
  }
  if (method === "GET" && key === "demo/scenarios") return Response.json({ scenarios: SCENARIOS, portal: await portalState() });
  if (method === "GET" && key === "settings") return Response.json(await currentSettings());
  if (method === "PATCH" && key === "settings") return saveSettings(await request.json());
  if (method === "GET" && key === "activity") return Response.json(await activity(url));
  if (method === "GET" && key === "integrations") return Response.json(await integrations());
  if (method === "GET" && key === "notifications") return Response.json(await notifications());
  return jsonError(404, "not_found", `No ${method} endpoint at /api/${key}.`);
}

async function streamRun(id: string) {
  await getRun(id);
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let last = 0;
      const send = async () => {
        if (closed) return;
        const run = await prisma.run.findFirst({ where: { id, workspaceId: DEMO_WORKSPACE_ID }, include: { steps: { orderBy: { sequence: "asc" } }, artifacts: { orderBy: { capturedAt: "desc" }, take: 1 } } });
        const events = await prisma.runEvent.findMany({ where: { runId: id, sequence: { gt: last } }, orderBy: { sequence: "asc" } });
        for (const event of events) {
          last = event.sequence;
          controller.enqueue(encoder.encode(`event: log\ndata: ${JSON.stringify(event)}\n\n`));
        }
        controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify({ status: run?.status, outcome: run?.outcome, steps: run?.steps, latestArtifact: run?.artifacts[0] ? { id: run.artifacts[0].id, capturedAt: run.artifacts[0].capturedAt, label: run.artifacts[0].label } : null })}\n\n`));
        if (run && ["VERIFIED", "FAILED", "BLOCKED", "UNVERIFIED", "OUTCOME_UNKNOWN", "CANCELLED"].includes(run.status)) {
          closed = true;
          controller.close();
        }
      };
      await send();
      const timer = setInterval(() => {
        send().catch(() => undefined);
      }, 700);
      setTimeout(() => {
        clearInterval(timer);
        if (!closed) controller.close();
      }, 120_000);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}

async function artifactResponse(runId: string, artifactId: string) {
  const artifact = await readArtifact(runId, artifactId);
  return new Response(artifact.bytes, {
    headers: {
      "Content-Type": artifact.mimeType,
      "Cache-Control": "private, max-age=60",
      "X-Captured-At": artifact.capturedAt.toISOString(),
    },
  });
}

async function exportReceipt(id: string, format: string) {
  const file = await receiptExport(id, format === "pdf" ? "pdf" : "json");
  return new Response(file.body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
    },
  });
}

async function testModel(body: unknown) {
  const config = readOtariConfig();
  const health = await otariHealth(config);
  if (health.status !== "connected") return Response.json(health, { status: 409 });
  const model = (body as { model?: string }).model || (await currentSettings()).ai.primaryModel || health.models[0];
  if (!model) return jsonError(409, "model_not_selected", "No model is available to test.");
  try {
    const result = await otariChat(config, {
      model,
      maxTokens: 64,
      metadata: { purpose: "connectivity_test" },
      messages: [
        { role: "system", content: "Reply with a JSON object {\"ok\":true} and nothing else." },
        { role: "user", content: "ping" },
      ],
    });
    await recordAiRequest({
      role: "connectivity_test",
      requestedModel: result.requestedModel,
      servedModel: result.servedModel,
      provider: result.provider,
      otariRequestId: result.requestId,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
      costUsd: result.usage.costUsd,
      pricingSource: result.usage.pricingSource,
      latencyMs: result.latencyMs,
      status: "completed",
    });
    return Response.json({ ok: true, requestId: result.requestId, servedModel: result.servedModel, usage: result.usage, content: result.content.slice(0, 500) });
  } catch (error) {
    await recordAiRequest({ role: "connectivity_test", requestedModel: model, status: "failed", error: error instanceof Error ? error.message : "failed" });
    return jsonError(502, "otari_failed", error instanceof Error ? error.message : "Otari test failed.");
  }
}

async function aiUsage(url: URL) {
  await requireSession();
  const range = dateRange(url);
  const rows = await prisma.aIRequest.findMany({ where: { createdAt: { gte: range.from, lte: range.to } }, orderBy: { createdAt: "desc" }, take: 200 });
  return { range, summary: aggregateCost(rows.map((row) => ({ costUsd: row.costUsd }))), items: rows };
}

async function saveSettings(body: unknown) {
  await requireSession();
  const parsed = SettingsSchema.parse(body);
  const ceiling = process.env.OTARI_MAX_REQUEST_COST_USD ? Number(process.env.OTARI_MAX_REQUEST_COST_USD) : null;
  const data = enforceSettings(parsed, Number.isFinite(ceiling) ? ceiling : null);
  await prisma.workspaceSetting.upsert({
    where: { workspaceId: DEMO_WORKSPACE_ID },
    update: { data: asJson(data) },
    create: { workspaceId: DEMO_WORKSPACE_ID, data: asJson(data) },
  });
  return Response.json(data);
}

async function activity(url: URL) {
  await requireSession();
  const type = url.searchParams.get("type") ?? "runs";
  if (type === "recoveries") return prisma.recoveryAttempt.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { run: { select: { workflowId: true, status: true } } } });
  if (type === "approvals") return prisma.approval.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  if (type === "otari") return prisma.aIRequest.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  if (type === "audit") return prisma.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const status = url.searchParams.get("status") ?? undefined;
  return prisma.run.findMany({
    where: { workspaceId: DEMO_WORKSPACE_ID, ...(status ? { status } : {}), ...(type === "failed" ? { status: "FAILED" } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { workflow: { select: { name: true } } },
  });
}

async function integrations() {
  const health = await systemHealth();
  const artifacts = await prisma.runArtifact.aggregate({ _sum: { byteSize: true }, _count: true });
  return {
    items: [
      { type: "otari", name: "Mozilla Otari", status: health.otari, detail: "Inference gateway. Secrets stay on the server." },
      { type: "browser", name: "Local browser runtime", status: health.worker, detail: "Playwright worker health from its heartbeat." },
      { type: "portal", name: "Northstar Vendor Portal", status: health.portal, detail: "Synthetic invoice target. No bank or payment network." },
      { type: "artifacts", name: "Local artifact storage", status: "local", detail: `${artifacts._count} files, ${artifacts._sum.byteSize ?? 0} bytes.` },
    ],
    roadmap: ["Hosted SSO", "External allowlisted domains", "Customer-managed artifact buckets"],
  };
}

async function notifications() {
  await requireSession();
  const [approvals, failures] = await Promise.all([
    prisma.approval.findMany({ where: { decision: "pending" }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.run.findMany({ where: { workspaceId: DEMO_WORKSPACE_ID, status: "FAILED" }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  return { approvals, failures };
}

async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await context.params;
    return await dispatch(request, request.method, path);
  } catch (error) {
    return handleError(error);
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
