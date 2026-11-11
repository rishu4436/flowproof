import { createId } from "@flowproof/core";
import { asJson, prisma } from "@flowproof/database";

async function main() {
  const models = ["alibaba/qwen3-30b-a3b", "google/gemma-3-12b-it"];
  const suite = await prisma.benchmarkSuite.create({
    data: {
      id: createId("suite"),
      name: "Qwen vs Gemma repair on scenario B",
      status: "queued",
      config: asJson({ scope: "models", models }),
    },
  });
  await prisma.job.create({
    data: {
      id: createId("job"),
      type: "benchmark",
      status: "pending",
      payload: asJson({ suiteId: suite.id, scope: "models", models }),
    },
  });
  console.log(suite.id);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
