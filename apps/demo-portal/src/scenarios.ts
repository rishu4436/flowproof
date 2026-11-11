import { moneyToCents } from "@flowproof/core";
import type { InvoiceRecord } from "./store.js";

export const SCENARIO_IDS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

export function isScenario(value: string): value is ScenarioId {
  return (SCENARIO_IDS as readonly string[]).includes(value);
}

export interface InvoiceInput {
  invoiceId: string;
  vendor: string;
  purchaseOrder: string;
  amount: string;
  currency: string;
  paymentTerms: string;
  clientReference: string;
}

export type SubmissionPlan =
  | { kind: "invalid"; message: string }
  | { kind: "idempotent"; invoice: InvoiceRecord }
  | { kind: "duplicate"; invoice: InvoiceRecord }
  | { kind: "false_success" }
  | { kind: "persist_then_drop" }
  | { kind: "persist_confirmation_broken" }
  | { kind: "persist" };

const CURRENCIES = new Set(["USD", "EUR"]);
const TERMS = new Set(["Net 15", "Net 30", "Net 45"]);

export function readInvoiceInput(body: Record<string, string>): { input?: InvoiceInput; message?: string } {
  const input: InvoiceInput = {
    invoiceId: (body.invoiceId ?? "").trim(),
    vendor: (body.vendor ?? "").trim(),
    purchaseOrder: (body.purchaseOrder ?? "").trim(),
    amount: (body.amount ?? "").trim(),
    currency: (body.currency ?? "").trim(),
    paymentTerms: (body.paymentTerms ?? "").trim(),
    clientReference: (body.clientReference ?? "").trim(),
  };
  if (!/^INV-[A-Z0-9-]{2,20}$/.test(input.invoiceId)) return { message: "Invoice ID must look like INV-2041." };
  if (input.vendor.length < 2 || input.vendor.length > 120) return { message: "Enter the vendor name." };
  if (!/^PO-[A-Z0-9-]{2,20}$/.test(input.purchaseOrder)) return { message: "Purchase order must look like PO-991." };
  const cents = moneyToCents(input.amount);
  if (cents == null || cents <= 0 || cents > 10_000_000) return { message: "Amount must be a positive demo value up to 100000.00." };
  if (!CURRENCIES.has(input.currency)) return { message: "Choose USD or EUR." };
  if (!TERMS.has(input.paymentTerms)) return { message: "Choose a payment term." };
  if (input.clientReference.length < 6 || input.clientReference.length > 80) return { message: "Client reference is required." };
  return { input };
}

export function planSubmission(input: {
  scenario: ScenarioId;
  invoice: InvoiceInput;
  existing: InvoiceRecord | null;
  sameKey: InvoiceRecord | null;
}): SubmissionPlan {
  if (input.sameKey && input.sameKey.id === input.invoice.invoiceId) {
    return { kind: "idempotent", invoice: input.sameKey };
  }
  if (input.existing) return { kind: "duplicate", invoice: input.existing };
  if (input.scenario === "E") return { kind: "false_success" };
  if (input.scenario === "G") return { kind: "persist_then_drop" };
  if (input.scenario === "H") return { kind: "persist_confirmation_broken" };
  return { kind: "persist" };
}

export function buttonLabel(scenario: ScenarioId, surface: "invoice" | "customer"): string {
  if (surface === "customer") return scenario === "B" ? "Update record" : "Save customer";
  if (scenario === "B") return "Send to accounts";
  if (scenario === "D") return "Review and submit";
  return "Submit invoice";
}

export function fieldLabels(scenario: ScenarioId): Record<keyof InvoiceInput, string> {
  if (scenario === "C") {
    return {
      invoiceId: "Bill number",
      vendor: "Supplier",
      purchaseOrder: "PO reference",
      amount: "Total due",
      currency: "Money unit",
      paymentTerms: "Terms",
      clientReference: "Client ref",
    };
  }
  return {
    invoiceId: "Invoice ID",
    vendor: "Vendor",
    purchaseOrder: "Purchase order",
    amount: "Amount",
    currency: "Currency",
    paymentTerms: "Payment terms",
    clientReference: "Client reference",
  };
}

export function fieldOrder(scenario: ScenarioId): Array<keyof InvoiceInput> {
  if (scenario === "C") {
    return ["amount", "currency", "vendor", "paymentTerms", "purchaseOrder", "invoiceId", "clientReference"];
  }
  return ["invoiceId", "vendor", "purchaseOrder", "amount", "currency", "paymentTerms", "clientReference"];
}
