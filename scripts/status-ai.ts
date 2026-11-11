import { prisma } from "@flowproof/database";

async function main() {
  const rows = await prisma.aIRequest.findMany({
    where: { run: { benchmarkRun: { suiteId: process.argv[2] } } },
    orderBy: { createdAt: "asc" },
    select: { role: true, requestedModel: true, servedModel: true, otariRequestId: true, costUsd: true, status: true, error: true, runId: true },
  });
  console.log(JSON.stringify(rows, null, 2));
  await prisma.$disconnect();
}

main();
