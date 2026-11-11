import { prisma } from "@flowproof/database";

async function main() {
  const id = process.argv[2];
  const suite = await prisma.benchmarkSuite.findUnique({
    where: { id },
    include: { runs: { orderBy: { createdAt: "asc" } } },
  });
  const job = await prisma.job.findFirst({ where: { payload: { path: ["suiteId"], equals: id } } }).catch(() => null);
  console.log(
    JSON.stringify(
      {
        status: suite?.status,
        rows: suite?.runs.map((run) => ({
          model: run.model,
          outcome: run.outcome,
          actual: run.actualOutcome,
          metrics: run.metrics,
        })),
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
