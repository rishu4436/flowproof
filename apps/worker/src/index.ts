import { claimJob, completeJob, failJob, prisma } from "@flowproof/database";
import { isRunStatus, isTerminal, canTransition } from "@flowproof/core";
import { executeBenchmark } from "./benchmark.js";
import { executeRun, recoverStaleJobs } from "./engine.js";
import { heartbeat } from "./runtime.js";
import { transitionRun } from "@flowproof/database";

const workerId = process.env.WORKER_ID ?? "worker-local";
const pollMs = Number(process.env.WORKER_POLL_MS ?? 400);
let stopping = false;

async function loop() {
  await heartbeat("online", { workerId });
  while (!stopping) {
    await heartbeat("online", { workerId });
    await recoverStaleJobs().catch((error) => console.error("stale recovery failed", error));
    const job = await claimJob(workerId);
    if (!job) {
      await sleep(pollMs);
      continue;
    }
    try {
      if (job.type === "run" && job.runId) await executeRun(job.runId, job.id);
      else if (job.type === "benchmark") await executeBenchmark(job.id, job.payload as { suiteId?: string; scope?: "focused" | "full" });
      else throw new Error(`Unknown job type ${job.type}.`);
      await completeJob(job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Job failed";
      console.error(message);
      await failJob(job.id, message);
      if (job.runId) {
        const run = await prisma.run.findUnique({ where: { id: job.runId } });
        if (run && isRunStatus(run.status) && !isTerminal(run.status) && canTransition(run.status, "FAILED")) {
          await transitionRun(run.id, "FAILED", { endedAt: new Date(), outcome: "FAILED", errorSummary: message });
        }
      }
    }
  }
  await heartbeat("offline", { workerId });
  await prisma.$disconnect();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

loop().catch(async (error) => {
  console.error(error);
  await heartbeat("error", { message: error instanceof Error ? error.message : "worker failed" }).catch(() => undefined);
  process.exit(1);
});
