import type { InputSchemaType, VerificationPolicy, WorkflowDefinition, WorkflowEdge, WorkflowNode } from "./workflow.js";

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  objective: string;
  definition: WorkflowDefinition;
  verificationPolicy: VerificationPolicy;
  inputSchema: InputSchemaType;
}

const invoicePolicy: VerificationPolicy = {
  strategy: "composite",
  requireAuthoritative: true,
  recordType: "invoice",
  matchFields: ["invoiceId", "vendor", "purchaseOrder", "amount", "currency", "paymentTerms", "clientReference"],
  domCannotOverrideApi: true,
  onUnknownWrite: "outcome_unknown",
};

const customerPolicy: VerificationPolicy = {
  strategy: "trusted_api",
  requireAuthoritative: true,
  recordType: "customer",
  matchFields: ["customerId", "note"],
  domCannotOverrideApi: true,
  onUnknownWrite: "outcome_unknown",
};

const lookupPolicy: VerificationPolicy = {
  strategy: "trusted_api",
  requireAuthoritative: true,
  recordType: "invoice",
  matchFields: ["invoiceId", "status"],
  domCannotOverrideApi: true,
  onUnknownWrite: "outcome_unknown",
};

function edge(id: string, source: string, target: string, sourceHandle?: "true" | "false"): WorkflowEdge {
  return sourceHandle ? { id, source, target, sourceHandle } : { id, source, target };
}

function node(
  id: string,
  type: WorkflowNode["type"],
  name: string,
  x: number,
  y: number,
  data: Partial<WorkflowNode["data"]> = {},
): WorkflowNode {
  return { id, type, position: { x, y }, data: { name, ...data } };
}

export function workflowTemplates(): WorkflowTemplate[] {
  return [invoiceTemplate(), orderLookupTemplate(), formTemplate(), customerTemplate()];
}

function invoiceTemplate(): WorkflowTemplate {
  const nodes: WorkflowNode[] = [
    node("start", "start", "Start", 280, 0),
    node("open", "open_website", "Open vendor portal", 280, 110, {
      url: "{{portalOrigin}}/invoices/new",
      timeoutMs: 20000,
      failureBehavior: "fail",
    }),
    node("invoice", "type", "Invoice ID", 280, 220, {
      label: "Invoice ID",
      semanticLabels: ["Invoice ID", "Bill number"],
      role: "textbox",
      valueFrom: "invoiceId",
      failureBehavior: "recover",
    }),
    node("vendor", "type", "Vendor", 280, 330, {
      label: "Vendor",
      semanticLabels: ["Vendor", "Supplier"],
      role: "textbox",
      valueFrom: "vendor",
      failureBehavior: "recover",
    }),
    node("po", "type", "Purchase order", 280, 440, {
      label: "Purchase order",
      semanticLabels: ["Purchase order", "PO reference"],
      role: "textbox",
      valueFrom: "purchaseOrder",
      failureBehavior: "recover",
    }),
    node("amount", "type", "Amount", 280, 550, {
      label: "Amount",
      semanticLabels: ["Amount", "Total due"],
      role: "textbox",
      valueFrom: "amount",
      failureBehavior: "recover",
    }),
    node("currency", "select", "Currency", 280, 660, {
      label: "Currency",
      semanticLabels: ["Currency", "Money unit"],
      role: "combobox",
      valueFrom: "currency",
      failureBehavior: "recover",
    }),
    node("terms", "select", "Payment terms", 280, 770, {
      label: "Payment terms",
      semanticLabels: ["Payment terms", "Terms"],
      role: "combobox",
      valueFrom: "paymentTerms",
      failureBehavior: "recover",
    }),
    node("reference", "type", "Client reference", 280, 880, {
      label: "Client reference",
      semanticLabels: ["Client reference", "Client ref"],
      role: "textbox",
      valueFrom: "clientReference",
      failureBehavior: "recover",
    }),
    node("submit", "click", "Submit invoice", 280, 990, {
      role: "button",
      targetName: "Submit invoice",
      semanticNames: ["Submit invoice", "Send to accounts", "Review and submit"],
      effect: "write",
      commitNames: ["Submit invoice", "Send to accounts", "Confirm invoice"],
      failureBehavior: "recover",
      timeoutMs: 12000,
    }),
    node("confirm", "click", "Confirm when asked", 280, 1100, {
      role: "button",
      targetName: "Confirm invoice",
      semanticNames: ["Confirm invoice"],
      optional: true,
      effect: "write",
      commitNames: ["Confirm invoice"],
      failureBehavior: "skip",
      timeoutMs: 2500,
    }),
    node("wait", "wait_for", "Wait for a result", 280, 1210, {
      textAny: ["Invoice submitted", "Confirmation could not be displayed", "Duplicate invoice", "could not be saved"],
      timeoutMs: 8000,
      optional: true,
      failureBehavior: "skip",
    }),
    node("verify", "verify_outcome", "Verify saved invoice", 280, 1320, {
      strategy: "composite",
      verification: "required",
    }),
    node("end", "end", "End", 280, 1430),
  ];
  const order = ["start", "open", "invoice", "vendor", "po", "amount", "currency", "terms", "reference", "submit", "confirm", "wait", "verify", "end"];
  const edges = order.slice(0, -1).map((source, index) => edge(`e_${source}`, source, order[index + 1]!));
  return {
    id: "wf_invoice",
    name: "Vendor invoice submission",
    description: "Submit a synthetic invoice in the Northstar Vendor Portal and verify the saved record.",
    category: "finance",
    objective: "Open the vendor portal, submit invoice INV-2041 for $2,450.00, and verify that it was saved.",
    definition: { nodes, edges },
    verificationPolicy: invoicePolicy,
    inputSchema: {
      fields: [
        { key: "invoiceId", label: "Invoice ID", type: "text", required: true, defaultValue: "INV-2041" },
        { key: "vendor", label: "Vendor", type: "text", required: true, defaultValue: "Northstar Supplies" },
        { key: "purchaseOrder", label: "Purchase order", type: "text", required: true, defaultValue: "PO-991" },
        { key: "amount", label: "Amount", type: "text", required: true, defaultValue: "2450.00" },
        { key: "currency", label: "Currency", type: "select", required: true, defaultValue: "USD", options: ["USD", "EUR"] },
        { key: "paymentTerms", label: "Payment terms", type: "select", required: true, defaultValue: "Net 30", options: ["Net 15", "Net 30", "Net 45"] },
      ],
    },
  };
}

function orderLookupTemplate(): WorkflowTemplate {
  const nodes: WorkflowNode[] = [
    node("start", "start", "Start", 280, 0),
    node("open", "open_website", "Open invoice list", 280, 120, { url: "{{portalOrigin}}/invoices", timeoutMs: 20000 }),
    node("extract", "extract", "Read invoice status", 280, 250, {
      label: "Status for INV-1000",
      targetName: "INV-1000",
      role: "textbox",
      variable: "statusText",
      failureBehavior: "fail",
    }),
    node("branch", "branch", "Status says recorded", 280, 380, { variable: "statusText", equals: "recorded" }),
    node("verify_true", "verify_outcome", "Verify invoice record", 80, 520, { strategy: "trusted_api" }),
    node("verify_false", "verify_outcome", "Verify anyway", 480, 520, { strategy: "trusted_api" }),
    node("end", "end", "End", 280, 660),
  ];
  return {
    id: "wf_order",
    name: "Order status lookup",
    description: "Read a seeded invoice and compare the page with the authoritative record. This workflow does not submit a write.",
    category: "operations",
    objective: "Look up INV-1000 and verify its recorded status.",
    definition: {
      nodes,
      edges: [
        edge("e1", "start", "open"),
        edge("e2", "open", "extract"),
        edge("e3", "extract", "branch"),
        edge("e4", "branch", "verify_true", "true"),
        edge("e5", "branch", "verify_false", "false"),
        edge("e6", "verify_true", "end"),
        edge("e7", "verify_false", "end"),
      ],
    },
    verificationPolicy: lookupPolicy,
    inputSchema: {
      fields: [
        { key: "invoiceId", label: "Invoice ID", type: "text", required: true, defaultValue: "INV-1000" },
        { key: "status", label: "Expected status", type: "text", required: true, defaultValue: "recorded" },
      ],
    },
  };
}

function formTemplate(): WorkflowTemplate {
  const invoice = invoiceTemplate();
  return {
    ...invoice,
    id: "wf_form",
    name: "Form submission with confirmation",
    description: "A shorter invoice form run that still requires authoritative confirmation after submit.",
    category: "operations",
    objective: "Submit a confirmation form for INV-2048 and verify the saved invoice.",
    inputSchema: {
      fields: invoice.inputSchema.fields.map((field) =>
        field.key === "invoiceId" ? { ...field, defaultValue: "INV-2048" } : field,
      ),
    },
  };
}

function customerTemplate(): WorkflowTemplate {
  const nodes: WorkflowNode[] = [
    node("start", "start", "Start", 280, 0),
    node("open", "open_website", "Open customer record", 280, 120, {
      url: "{{portalOrigin}}/customers/cust_northstar",
      timeoutMs: 20000,
    }),
    node("note", "type", "Update account note", 280, 250, {
      label: "Account note",
      semanticLabels: ["Account note", "Internal note"],
      role: "textbox",
      valueFrom: "note",
      failureBehavior: "recover",
    }),
    node("save", "click", "Save customer", 280, 380, {
      role: "button",
      targetName: "Save customer",
      semanticNames: ["Save customer", "Update record"],
      effect: "write",
      commitNames: ["Save customer", "Update record"],
      failureBehavior: "recover",
    }),
    node("verify", "verify_outcome", "Verify customer note", 280, 510, { strategy: "trusted_api" }),
    node("end", "end", "End", 280, 640),
  ];
  const order = ["start", "open", "note", "save", "verify", "end"];
  return {
    id: "wf_customer",
    name: "Customer record update simulation",
    description: "Update a synthetic customer note and verify the saved value. No external system is contacted.",
    category: "operations",
    objective: "Update the Northstar Supplies account note and verify the saved text.",
    definition: {
      nodes,
      edges: order.slice(0, -1).map((source, index) => edge(`e_${source}`, source, order[index + 1]!)),
    },
    verificationPolicy: customerPolicy,
    inputSchema: {
      fields: [
        { key: "customerId", label: "Customer ID", type: "text", required: true, defaultValue: "cust_northstar" },
        { key: "note", label: "Account note", type: "text", required: true, defaultValue: "Preferred dock is Bay 4." },
      ],
    },
  };
}

export const SCENARIOS = [
  { id: "A", name: "Normal operation", summary: "The form submits and the invoice is stored." },
  { id: "B", name: "Changed button label", summary: "The submit button reads Send to accounts." },
  { id: "C", name: "Reordered form", summary: "Fields move and accessible labels change." },
  { id: "D", name: "Review dialog", summary: "A confirmation dialog appears before the invoice is stored." },
  { id: "E", name: "False-positive success", summary: "A success message appears, but the invoice is not stored." },
  { id: "F", name: "Duplicate invoice", summary: "INV-2041 already exists, so a second submit is rejected." },
  { id: "G", name: "Ambiguous response", summary: "The invoice is stored, then the response is dropped." },
  { id: "H", name: "Confirmation UI failed", summary: "The invoice is stored, but the confirmation page fails." },
] as const;

export type ScenarioId = (typeof SCENARIOS)[number]["id"];
