import { prisma } from "@flowproof/database";

async function main() {
const id = process.argv[2];
const run = id
  ? await prisma.run.findUnique({ where: { id }, include: { steps: true, receipt: true } })
  : await prisma.run.findFirst({ orderBy: { createdAt: "desc" }, include: { steps: true, receipt: true } });
const job = run ? await prisma.job.findFirst({ where: { runId: run.id } }) : null;
console.log(
  JSON.stringify(
    {
      id: run?.id,
      status: run?.status,
      outcome: run?.outcome,
      error: run?.errorSummary,
      writeStarted: run?.writeStarted,
      steps: run?.steps.map((step) => ({ name: step.name, status: step.status, error: step.errorMessage })),
      receipt: run?.receipt?.decision,
      job: job?.status,
      jobError: job?.lastError,
    },
    null,
    2,
  ),
);
await prisma.$disconnect();
}

main();
