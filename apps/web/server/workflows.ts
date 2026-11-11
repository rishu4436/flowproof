import {
  DEFAULT_SETTINGS,
  InputSchema,
  SettingsSchema,
  VerificationPolicySchema,
  WorkflowDefinitionSchema,
  createId,
  enforceSettings,
  parseAllowlist,
  validationErrors,
  validateWorkflow,
  workflowTemplates,
  type WorkflowDefinition,
} from "@flowproof/core";
import { PlanProposalSchema, PLANNER_SYSTEM, completeStructured, otariConfigured, readOtariConfig } from "@flowproof/ai";
import { DEMO_WORKSPACE_ID, asJson, audit, prisma } from "@flowproof/database";
import { z } from "zod";
import { HttpError } from "./http";
import { requireSession } from "@/lib/session";
import { recordAiRequest } from "./ai-log";

const WriteWorkflow = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(600).default(""),
  category: z.enum(["finance", "operations", "demo", "general"]).default("general"),
  definition: WorkflowDefinitionSchema.optional(),
  verificationPolicy: VerificationPolicySchema.optional(),
  inputSchema: InputSchema.optional(),
});

export async function listWorkflows(url: URL) {
  await requireSession();
  const q = url.searchParams.get("q")?.trim();
  const status = url.searchParams.get("status");
  const category = url.searchParams.get("category");
  const sort = url.searchParams.get("sort") ?? "updated";
  const where = {
    workspaceId: DEMO_WORKSPACE_ID,
    ...(status ? { status } : { status: { not: "deleted" } }),
    ...(category ? { category } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { description: { contains: q, mode: "insensitive" as const } }] } : {}),
  };
  const workflows = await prisma.workflow.findMany({
    where,
    include: { versions: { orderBy: { version: "desc" }, take: 1 }, runs: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: sort === "name" ? { name: "asc" } : { updatedAt: "desc" },
  });
  const ids = workflows.map((workflow) => workflow.id);
  const runs = ids.length
    ? await prisma.run.groupBy({ by: ["workflowId", "outcome"], where: { workflowId: { in: ids } }, _count: { _all: true } })
    : [];
  return workflows.map((workflow) => {
    const related = runs.filter((run) => run.workflowId === workflow.id);
    const total = related.reduce((sum, run) => sum + run._count._all, 0);
    const verified = related.find((run) => run.outcome === "VERIFIED")?._count._all ?? 0;
    const last = workflow.runs[0];
    return {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      category: workflow.category,
      owner: "Demo Operator",
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
      version: workflow.activeVersion,
      status: workflow.status,
      environment: workflow.environment,
      lastRun: last ? { id: last.id, status: last.status, outcome: last.outcome, createdAt: last.createdAt } : null,
      verificationRate: total === 0 ? null : verified / total,
      sampleSize: total,
    };
  });
}

export async function getWorkflow(id: string) {
  await requireSession();
  const workflow = await prisma.workflow.findFirst({
    where: { id, workspaceId: DEMO_WORKSPACE_ID },
    include: { versions: { orderBy: { version: "desc" } } },
  });
  if (!workflow) throw new HttpError(404, "not_found", "Workflow not found.");
  return workflow;
}

export async function createWorkflow(body: unknown) {
  const session = await requireSession();
  const input = WriteWorkflow.parse(body);
  const template = workflowTemplates()[0];
  const definition = input.definition ?? template?.definition;
  const policy = input.verificationPolicy ?? template?.verificationPolicy;
  const schema = input.inputSchema ?? { fields: [] };
  if (!definition || !policy) throw new HttpError(422, "invalid_workflow", "A definition is required.");
  const id = createId("wf");
  const version = await prisma.$transaction(async (tx) => {
    await tx.workflow.create({
      data: {
        id,
        workspaceId: session.workspaceId,
        name: input.name,
        description: input.description,
        category: input.category,
        ownerId: session.userId,
        status: "draft",
        activeVersion: 0,
        environment: "demo",
      },
    });
    return tx.workflowVersion.create({
      data: {
        id: createId("ver"),
        workflowId: id,
        version: 1,
        approved: false,
        definition: asJson(definition),
        verificationPolicy: asJson(policy),
        inputSchema: asJson(schema),
        createdById: session.userId,
      },
    });
  });
  await audit({ actorId: session.userId, action: "workflow.created", targetType: "workflow", targetId: id });
  return { id, versionId: version.id };
}

export async function updateWorkflow(id: string, body: unknown) {
  const session = await requireSession();
  const workflow = await getWorkflow(id);
  const input = WriteWorkflow.partial().extend({ status: z.enum(["draft", "active", "archived"]).optional() }).parse(body);
  const draft = workflow.versions.find((version) => !version.approved) ?? workflow.versions[0];
  if (!draft) throw new HttpError(409, "missing_version", "The workflow has no version to edit.");
  if (draft.approved && (input.definition || input.verificationPolicy || input.inputSchema)) {
    const nextVersion = workflow.versions.reduce((max, version) => Math.max(max, version.version), 0) + 1;
    await prisma.workflowVersion.create({
      data: {
        id: createId("ver"),
        workflowId: id,
        version: nextVersion,
        approved: false,
        definition: asJson(input.definition ?? draft.definition),
        verificationPolicy: asJson(input.verificationPolicy ?? draft.verificationPolicy),
        inputSchema: asJson(input.inputSchema ?? draft.inputSchema),
        createdById: session.userId,
      },
    });
  } else {
    await prisma.workflowVersion.update({
      where: { id: draft.id },
      data: {
        ...(input.definition ? { definition: asJson(input.definition) } : {}),
        ...(input.verificationPolicy ? { verificationPolicy: asJson(input.verificationPolicy) } : {}),
        ...(input.inputSchema ? { inputSchema: asJson(input.inputSchema) } : {}),
      },
    });
  }
  await prisma.workflow.update({
    where: { id },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.category ? { category: input.category } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
  });
  await audit({ actorId: session.userId, action: "workflow.updated", targetType: "workflow", targetId: id });
  return getWorkflow(id);
}

export async function deleteWorkflow(id: string) {
  const session = await requireSession();
  await getWorkflow(id);
  await prisma.run.deleteMany({ where: { workflowId: id } });
  await prisma.workflow.delete({ where: { id } });
  await audit({ actorId: session.userId, action: "workflow.deleted", targetType: "workflow", targetId: id });
  return { ok: true };
}

export async function duplicateWorkflow(id: string) {
  const workflow = await getWorkflow(id);
  const version = workflow.versions.find((item) => item.version === workflow.activeVersion) ?? workflow.versions[0];
  if (!version) throw new HttpError(404, "not_found", "Nothing to duplicate.");
  return createWorkflow({
    name: `${workflow.name} copy`,
    description: workflow.description,
    category: workflow.category,
    definition: version.definition,
    verificationPolicy: version.verificationPolicy,
    inputSchema: version.inputSchema,
  });
}

export async function validateWorkflowById(id: string) {
  const workflow = await getWorkflow(id);
  const version = workflow.versions[0];
  if (!version) throw new HttpError(404, "not_found", "No version.");
  const definition = WorkflowDefinitionSchema.parse(version.definition);
  const policy = VerificationPolicySchema.parse(version.verificationPolicy);
  return { issues: validateWorkflow(definition, policy, allowEntries()), definition, policy };
}

export async function approveVersion(id: string) {
  const session = await requireSession();
  const result = await validateWorkflowById(id);
  const errors = validationErrors(result.issues);
  if (errors.length) throw new HttpError(422, "workflow_invalid", "Fix the workflow before approving it.", errors);
  const workflow = await getWorkflow(id);
  const draft = workflow.versions.find((version) => !version.approved) ?? workflow.versions[0];
  if (!draft) throw new HttpError(404, "not_found", "No draft.");
  await prisma.workflowVersion.update({ where: { id: draft.id }, data: { approved: true } });
  await prisma.workflow.update({ where: { id }, data: { activeVersion: draft.version, status: "active" } });
  await audit({ actorId: session.userId, action: "workflow.approved", targetType: "workflow", targetId: id, metadata: { version: draft.version } });
  return getWorkflow(id);
}

export async function generateWorkflow(body: unknown) {
  const session = await requireSession();
  const input = z.object({ objective: z.string().min(8).max(600), save: z.boolean().optional() }).parse(body);
  const config = readOtariConfig();
  if (!otariConfigured(config)) {
    throw new HttpError(503, "ai_not_configured", "AI planning is unavailable. Choose a hand-authored demo template instead.");
  }
  const settings = await currentSettings();
  const model = settings.ai.primaryModel || process.env.OTARI_MODEL_PRIMARY || "";
  if (!model) throw new HttpError(409, "model_not_selected", "Choose a primary Otari model before planning.");
  try {
    const result = await completeStructured(config, {
      model,
      schema: PlanProposalSchema,
      maxCalls: settings.ai.maxPlanningCalls,
      system: PLANNER_SYSTEM,
      metadata: { purpose: "plan" },
      user: input.objective,
    });
    for (const call of result.calls) {
      await recordAiRequest({
        role: "plan",
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
    const definition = planToDefinition(result.value);
    const policy = workflowTemplates()[0]!.verificationPolicy;
    const issues = validateWorkflow(definition, policy, allowEntries());
    let workflowId: string | null = null;
    if (input.save) {
      const created = await createWorkflow({
        name: result.value.name,
        description: result.value.description,
        category: result.value.category,
        definition,
        verificationPolicy: policy,
        inputSchema: { fields: [] },
      });
      workflowId = created.id;
    }
    return { proposal: result.value, definition, issues, workflowId, objective: input.objective };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    await recordAiRequest({
      role: "plan",
      requestedModel: model,
      status: "failed",
      error: error instanceof Error ? error.message : "Planning failed",
    });
    throw new HttpError(502, "ai_invalid_output", error instanceof Error ? error.message : "Otari did not return a usable plan.");
  }
}

export async function importWorkflow(body: unknown) {
  const input = z
    .object({
      name: z.string().min(1).max(120),
      description: z.string().max(600).default(""),
      category: z.enum(["finance", "operations", "demo", "general"]).default("general"),
      definition: WorkflowDefinitionSchema,
      verificationPolicy: VerificationPolicySchema,
      inputSchema: InputSchema,
    })
    .parse(body);
  const issues = validationErrors(validateWorkflow(input.definition, input.verificationPolicy, allowEntries()));
  if (issues.length) throw new HttpError(422, "workflow_invalid", "The imported workflow is not valid.", issues);
  return createWorkflow(input);
}

function planToDefinition(plan: { nodes: Array<{ id: string; type: WorkflowDefinition["nodes"][number]["type"]; name: string; url?: string; label?: string; targetName?: string; valueFrom?: string; effect?: "read" | "write" }> }): WorkflowDefinition {
  const nodes = plan.nodes.map((node, index) => ({
    id: node.id,
    type: node.type,
    position: { x: 280, y: index * 120 },
    data: {
      name: node.name,
      url: node.url,
      label: node.label,
      targetName: node.targetName,
      valueFrom: node.valueFrom,
      effect: node.effect,
      failureBehavior: node.effect === "write" ? ("recover" as const) : ("fail" as const),
    },
  }));
  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `e_${node.id}`,
    source: node.id,
    target: nodes[index + 1]!.id,
  }));
  return WorkflowDefinitionSchema.parse({ nodes, edges });
}

export async function currentSettings() {
  const row = await prisma.workspaceSetting.findUnique({ where: { workspaceId: DEMO_WORKSPACE_ID } });
  const parsed = SettingsSchema.safeParse(row?.data ?? DEFAULT_SETTINGS);
  const ceiling = process.env.OTARI_MAX_REQUEST_COST_USD ? Number(process.env.OTARI_MAX_REQUEST_COST_USD) : null;
  return enforceSettings(parsed.success ? parsed.data : DEFAULT_SETTINGS, Number.isFinite(ceiling) ? ceiling : null);
}

export function allowEntries() {
  const origin = process.env.DEMO_PORTAL_ORIGIN ?? "http://127.0.0.1:4100";
  const extra = (process.env.FLOWPROOF_ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  parseAllowlist([origin, ...extra]);
  return [origin, ...extra];
}
