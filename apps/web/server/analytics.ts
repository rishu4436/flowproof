import { aggregateCost, costPerVerified } from "@flowproof/core";
import { otariHealth, readOtariConfig } from "@flowproof/ai";
import { DEMO_WORKSPACE_ID, prisma } from "@flowproof/database";
import { requireSession } from "@/lib/session";
import { portalState } from "./runs";

export async function overview(from: Date, to: Date) {
  await requireSession();
  const runs = await prisma.run.findMany({
    where: { workspaceId: DEMO_WORKSPACE_ID, createdAt: { gte: from, lte: to } },
    include: { workflow: { select: { id: true, name: true } } },
  });
  const workflows = await prisma.workflow.count({ where: { workspaceId: DEMO_WORKSPACE_ID, status: { not: "archived" } } });
  const ai = await prisma.aIRequest.findMany({ where: { createdAt: { gte: from, lte: to } } });
  const recoveries = await prisma.recoveryAttempt.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { result: true } });
  const verified = runs.filter((run) => run.outcome === "VERIFIED").length;
  const failed = runs.filter((run) => run.outcome === "FAILED" || run.status === "FAILED").length;
  const unverified = runs.filter((run) => run.outcome === "UNVERIFIED").length;
  const blocked = runs.filter((run) => run.outcome === "BLOCKED").length;
  const unknown = runs.filter((run) => run.outcome === "OUTCOME_UNKNOWN").length;
  const cancelled = runs.filter((run) => run.outcome === "CANCELLED" || run.status === "CANCELLED").length;
  const durations = runs.map((run) => run.durationMs).filter((value): value is number => value != null);
  const applied = recoveries.filter((item) => item.result === "applied").length;
  const cost = aggregateCost(ai.map((item) => ({ costUsd: item.costUsd })));
  const days = new Map<string, { verified: number; failed: number; unverified: number; other: number }>();
  for (const run of runs) {
    const key = run.createdAt.toISOString().slice(0, 10);
    const bucket = days.get(key) ?? { verified: 0, failed: 0, unverified: 0, other: 0 };
    if (run.outcome === "VERIFIED") bucket.verified += 1;
    else if (run.outcome === "FAILED" || run.status === "FAILED") bucket.failed += 1;
    else if (run.outcome === "UNVERIFIED" || run.outcome === "OUTCOME_UNKNOWN") bucket.unverified += 1;
    else bucket.other += 1;
    days.set(key, bucket);
  }
  const reliabilityMap = new Map<string, { name: string; total: number; verified: number; failed: number }>();
  for (const run of runs) {
    const entry = reliabilityMap.get(run.workflowId) ?? { name: run.workflow.name, total: 0, verified: 0, failed: 0 };
    entry.total += 1;
    if (run.outcome === "VERIFIED") entry.verified += 1;
    if (run.outcome === "FAILED") entry.failed += 1;
    reliabilityMap.set(run.workflowId, entry);
  }
  const modelMap = new Map<string, { requests: number; promptTokens: number; completionTokens: number; costs: string[] }>();
  for (const request of ai) {
    const entry = modelMap.get(request.requestedModel) ?? { requests: 0, promptTokens: 0, completionTokens: 0, costs: [] };
    entry.requests += 1;
    entry.promptTokens += request.promptTokens ?? 0;
    entry.completionTokens += request.completionTokens ?? 0;
    if (request.costUsd) entry.costs.push(request.costUsd);
    modelMap.set(request.requestedModel, entry);
  }
  return {
    workflows,
    runs: runs.length,
    verified,
    failed,
    unverified,
    blocked,
    unknown,
    cancelled,
    recoveryAttempts: recoveries.length,
    recoverySuccessRate: recoveries.length === 0 ? null : applied / recoveries.length,
    averageDurationMs: durations.length === 0 ? null : Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    otariRequests: ai.length,
    aiCost: cost,
    costPerVerified: costPerVerified(cost.knownUsd, verified),
    trend: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, ...value })),
    distribution: [
      { name: "Verified", value: verified },
      { name: "Failed", value: failed },
      { name: "Blocked", value: blocked },
      { name: "Unverified", value: unverified },
      { name: "Outcome unknown", value: unknown },
      { name: "Cancelled", value: cancelled },
    ].filter((item) => item.value > 0),
    reliability: [...reliabilityMap.entries()].map(([id, value]) => ({
      id,
      ...value,
      rate: value.total === 0 ? null : value.verified / value.total,
    })),
    models: [...modelMap.entries()].map(([model, value]) => ({
      model,
      ...value,
      knownCostUsd: aggregateCost(value.costs.map((costUsd) => ({ costUsd }))).knownUsd,
      missingCost: value.requests - value.costs.length,
    })),
    recent: runs.slice(0, 8).map((run) => ({
      id: run.id,
      workflow: run.workflow.name,
      status: run.status,
      outcome: run.outcome,
      createdAt: run.createdAt,
      scenario: run.scenario,
    })),
  };
}

export async function systemHealth() {
  const [database, worker, portal] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => "online").catch(() => "offline"),
    workerHealth(),
    portalState().then((state) => (state.ok ? "online" : "offline")),
  ]);
  const queue = await prisma.job.count({ where: { status: { in: ["pending", "running"] } } }).catch(() => null);
  let otari: string = "not_configured";
  try {
    otari = (await otariHealth(readOtariConfig())).status;
  } catch {
    otari = "service_unavailable";
  }
  return { database, worker, queue: queue == null ? "offline" : "online", pendingJobs: queue, portal, otari };
}

async function workerHealth() {
  const beat = await prisma.serviceHeartbeat.findUnique({ where: { service: "worker" } }).catch(() => null);
  if (!beat) return "offline";
  return Date.now() - beat.updatedAt.getTime() < 15_000 ? beat.status : "offline";
}
