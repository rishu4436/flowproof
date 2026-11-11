import {
  createId,
  DEFAULT_SETTINGS,
  workflowTemplates,
  type WorkflowTemplate,
} from "@flowproof/core";
import { asJson, prisma } from "./client.js";

const WORKSPACE_ID = "ws_demo";
const USER_ID = "user_demo";

async function main() {
  await prisma.user.upsert({
    where: { id: USER_ID },
    update: { name: "Demo Operator", email: "demo@flowproof.local" },
    create: { id: USER_ID, name: "Demo Operator", email: "demo@flowproof.local" },
  });
  await prisma.workspace.upsert({
    where: { id: WORKSPACE_ID },
    update: { name: "FlowProof Demo" },
    create: { id: WORKSPACE_ID, name: "FlowProof Demo", timezone: "UTC" },
  });
  await prisma.membership.upsert({
    where: { userId_workspaceId: { userId: USER_ID, workspaceId: WORKSPACE_ID } },
    update: { role: "owner" },
    create: { id: "mem_demo", userId: USER_ID, workspaceId: WORKSPACE_ID, role: "owner" },
  });
  await prisma.workspaceSetting.upsert({
    where: { workspaceId: WORKSPACE_ID },
    update: {},
    create: { workspaceId: WORKSPACE_ID, data: asJson(DEFAULT_SETTINGS) },
  });

  for (const template of workflowTemplates()) {
    await upsertTemplate(template);
  }

  await prisma.integration.upsert({
    where: { workspaceId_type: { workspaceId: WORKSPACE_ID, type: "otari" } },
    update: {},
    create: { id: "int_otari", workspaceId: WORKSPACE_ID, type: "otari", status: "not_configured", config: asJson({ source: "environment" }) },
  });
  await prisma.integration.upsert({
    where: { workspaceId_type: { workspaceId: WORKSPACE_ID, type: "browser" } },
    update: {},
    create: { id: "int_browser", workspaceId: WORKSPACE_ID, type: "browser", status: "unknown", config: asJson({ runtime: "playwright" }) },
  });
  await prisma.integration.upsert({
    where: { workspaceId_type: { workspaceId: WORKSPACE_ID, type: "portal" } },
    update: {},
    create: { id: "int_portal", workspaceId: WORKSPACE_ID, type: "portal", status: "unknown", config: asJson({ name: "Northstar Vendor Portal" }) },
  });
  await prisma.integration.upsert({
    where: { workspaceId_type: { workspaceId: WORKSPACE_ID, type: "artifacts" } },
    update: {},
    create: { id: "int_artifacts", workspaceId: WORKSPACE_ID, type: "artifacts", status: "local", config: asJson({ driver: "filesystem" }) },
  });

  await prisma.portalControl.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", scenario: "A" },
  });
  await prisma.portalCustomer.upsert({
    where: { id: "cust_northstar" },
    update: {},
    create: {
      id: "cust_northstar",
      name: "Northstar Supplies",
      email: "ap@northstar-supplies.example",
      note: "Synthetic account. No external billing system is connected.",
    },
  });
  await prisma.portalInvoice.upsert({
    where: { id: "INV-1000" },
    update: {},
    create: {
      id: "INV-1000",
      vendor: "Northstar Supplies",
      purchaseOrder: "PO-100",
      amountCents: 180000,
      currency: "USD",
      paymentTerms: "Net 30",
      status: "recorded",
      idempotencyKey: "seed_inv_1000",
      scenario: "seed",
    },
  });

  console.log("Seeded FlowProof demo workspace, workflows, and Northstar baseline records.");
}

async function upsertTemplate(template: WorkflowTemplate) {
  await prisma.workflow.upsert({
    where: { id: template.id },
    update: {
      name: template.name,
      description: template.description,
      category: template.category,
      status: "active",
    },
    create: {
      id: template.id,
      workspaceId: WORKSPACE_ID,
      name: template.name,
      description: template.description,
      category: template.category,
      ownerId: USER_ID,
      status: "active",
      activeVersion: 1,
      environment: "demo",
    },
  });
  await prisma.workflowVersion.upsert({
    where: { workflowId_version: { workflowId: template.id, version: 1 } },
    update: {
      approved: true,
      definition: asJson(template.definition),
      verificationPolicy: asJson(template.verificationPolicy),
      inputSchema: asJson(template.inputSchema),
    },
    create: {
      id: createId("ver"),
      workflowId: template.id,
      version: 1,
      approved: true,
      definition: asJson(template.definition),
      verificationPolicy: asJson(template.verificationPolicy),
      inputSchema: asJson(template.inputSchema),
      createdById: USER_ID,
    },
  });
  await prisma.workflow.update({ where: { id: template.id }, data: { activeVersion: 1 } });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
