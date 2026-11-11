import { prisma } from "./client.js";

export interface ClaimedJob {
  id: string;
  type: string;
  payload: unknown;
  runId: string | null;
  attempts: number;
}

export async function claimJob(workerId: string): Promise<ClaimedJob | null> {
  const rows = await prisma.$queryRaw<ClaimedJob[]>`
    WITH claimed AS (
      SELECT id FROM jobs
      WHERE status = 'pending' AND "availableAt" <= NOW()
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE jobs AS job
    SET status = 'running',
        "lockedAt" = NOW(),
        "lockedBy" = ${workerId},
        attempts = attempts + 1,
        "updatedAt" = NOW()
    FROM claimed
    WHERE job.id = claimed.id
    RETURNING job.id, job.type, job.payload, job."runId" AS "runId", job.attempts
  `;
  return rows[0] ?? null;
}

export async function completeJob(id: string) {
  await prisma.job.update({ where: { id }, data: { status: "completed", lockedAt: null } });
}

export async function failJob(id: string, error: string) {
  await prisma.job.update({
    where: { id },
    data: { status: "failed", lastError: error.slice(0, 500), lockedAt: null },
  });
}

export async function touchJob(id: string) {
  await prisma.job.update({ where: { id }, data: { lockedAt: new Date() } });
}

export async function requeueJob(id: string) {
  await prisma.job.update({
    where: { id },
    data: { status: "pending", lockedAt: null, lockedBy: null, availableAt: new Date() },
  });
}
