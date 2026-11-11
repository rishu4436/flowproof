import { createId } from "@flowproof/core";
import { asJson, prisma } from "@flowproof/database";

async function main() {
const scenario = process.argv[2] ?? "A";
const invoiceId = process.argv[3] ?? (scenario === "F" ? "INV-2041" : "INV-2041");
const origin = process.env.DEMO_PORTAL_ORIGIN ?? "http://127.0.0.1:4100";
const admin = process.env.PORTAL_ADMIN_TOKEN ?? "";
const scenarioResponse = await fetch(`${origin}/api/admin/scenario`, {
  method: "POST",
  headers: { Authorization: `Bearer ${admin}`, "Content-Type": "application/json" },
  body: JSON.stringify({ scenario }),
});
if (!scenarioResponse.ok) {
  console.error("scenario failed", scenarioResponse.status, await scenarioResponse.text());
  process.exit(1);
}
const workflow = await prisma.workflow.findUniqueOrThrow({ where: { id: "wf_invoice" } });
const version = await prisma.workflowVersion.findUniqueOrThrow({
  where: { workflowId_version: { workflowId: workflow.id, version: workflow.activeVersion } },
});
const idempotencyKey = createId("idem");
const run = await prisma.run.create({
  data: {
    id: createId("run"),
    workspaceId: "ws_demo",
    workflowId: workflow.id,
    workflowVersionId: version.id,
    status: "QUEUED",
    objective: `Submit ${invoiceId} for $2,450.00 and verify the saved invoice.`,
    requestedValues: asJson({
      invoiceId,
      vendor: "Northstar Supplies",
      purchaseOrder: "PO-991",
      amount: "2450.00",
      currency: "USD",
      paymentTerms: "Net 30",
      clientReference: idempotencyKey,
    }),
    environment: "demo",
    scenario,
    idempotencyKey,
  },
});
await prisma.job.create({
  data: { id: createId("job"), type: "run", payload: asJson({ runId: run.id }), status: "pending", runId: run.id },
});
console.log(JSON.stringify({ runId: run.id, scenario, invoiceId }));
await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
