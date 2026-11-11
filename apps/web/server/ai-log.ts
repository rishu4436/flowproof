import { createId } from "@flowproof/core";
import { DEMO_WORKSPACE_ID, prisma } from "@flowproof/database";

export async function recordAiRequest(input: {
  runId?: string;
  role: string;
  requestedModel: string;
  servedModel?: string | null;
  provider?: string | null;
  otariRequestId?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  costUsd?: string | null;
  pricingSource?: string | null;
  latencyMs?: number | null;
  status: string;
  error?: string | null;
}) {
  return prisma.aIRequest.create({
    data: {
      id: createId("air"),
      workspaceId: DEMO_WORKSPACE_ID,
      runId: input.runId,
      role: input.role,
      requestedModel: input.requestedModel,
      servedModel: input.servedModel ?? null,
      provider: input.provider ?? null,
      otariRequestId: input.otariRequestId ?? null,
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      totalTokens: input.totalTokens ?? null,
      costUsd: input.costUsd ?? null,
      pricingSource: input.pricingSource ?? null,
      latencyMs: input.latencyMs ?? null,
      status: input.status,
      error: input.error ?? null,
    },
  });
}
