import { assertTransition, createId, isRunStatus, type RunStatus } from "@flowproof/core";
import { asJson, prisma, Prisma } from "./client.js";

export async function appendEvent(runId: string, type: string, payload: unknown) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.run.update({
      where: { id: runId },
      data: { eventSeq: { increment: 1 } },
      select: { eventSeq: true },
    });
    return tx.runEvent.create({
      data: {
        id: createId("evt"),
        runId,
        sequence: run.eventSeq,
        type,
        payload: asJson(payload),
      },
    });
  });
}

export async function transitionRun(runId: string, to: RunStatus, patch: Prisma.RunUpdateInput = {}) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.run.findUnique({ where: { id: runId } });
    if (!run) throw new Error(`Run ${runId} was not found.`);
    if (!isRunStatus(run.status)) throw new Error(`Run ${runId} has an unknown status.`);
    if (run.status === to) return run;
    assertTransition(run.status, to);
    return tx.run.update({ where: { id: runId }, data: { status: to, ...patch } });
  });
}

export async function audit(input: {
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: unknown;
}) {
  return prisma.auditEvent.create({
    data: {
      id: createId("aud"),
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata === undefined ? undefined : asJson(input.metadata),
    },
  });
}
