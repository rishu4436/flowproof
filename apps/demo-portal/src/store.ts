import { centsToDecimal } from "@flowproof/core";
import type { ScenarioId } from "./scenarios.js";

export interface InvoiceRecord {
  id: string;
  vendor: string;
  purchaseOrder: string;
  amountCents: number;
  currency: string;
  paymentTerms: string;
  status: string;
  idempotencyKey: string | null;
  scenario: string | null;
  createdAt: string;
}

export interface CustomerRecord {
  id: string;
  name: string;
  email: string;
  note: string;
}

export interface PortalStore {
  getScenario(): Promise<ScenarioId>;
  setScenario(scenario: ScenarioId): Promise<void>;
  reset(): Promise<void>;
  listInvoices(): Promise<InvoiceRecord[]>;
  findInvoice(id: string): Promise<InvoiceRecord | null>;
  findByIdempotency(key: string): Promise<InvoiceRecord | null>;
  createInvoice(record: InvoiceRecord): Promise<InvoiceRecord>;
  getCustomer(id: string): Promise<CustomerRecord | null>;
  updateCustomer(id: string, note: string): Promise<CustomerRecord | null>;
  setWebhook(payload: unknown): Promise<void>;
  getWebhook(): Promise<unknown>;
}

export function memoryStore(): PortalStore {
  const invoices = new Map<string, InvoiceRecord>();
  let scenario: ScenarioId = "A";
  let webhook: unknown = null;
  const customers = new Map<string, CustomerRecord>([
    [
      "cust_northstar",
      {
        id: "cust_northstar",
        name: "Northstar Supplies",
        email: "ap@northstar-supplies.example",
        note: "Synthetic account. No external billing system is connected.",
      },
    ],
  ]);
  invoices.set("INV-1000", {
    id: "INV-1000",
    vendor: "Northstar Supplies",
    purchaseOrder: "PO-100",
    amountCents: 180000,
    currency: "USD",
    paymentTerms: "Net 30",
    status: "recorded",
    idempotencyKey: "seed_inv_1000",
    scenario: "seed",
    createdAt: new Date().toISOString(),
  });
  return {
    async getScenario() {
      return scenario;
    },
    async setScenario(next) {
      scenario = next;
      if (next === "F" && !invoices.has("INV-2041")) {
        invoices.set("INV-2041", {
          id: "INV-2041",
          vendor: "Northstar Supplies",
          purchaseOrder: "PO-991",
          amountCents: 245000,
          currency: "USD",
          paymentTerms: "Net 30",
          status: "recorded",
          idempotencyKey: "seed_duplicate_inv_2041",
          scenario: "F",
          createdAt: new Date().toISOString(),
        });
      }
    },
    async reset() {
      invoices.clear();
      invoices.set("INV-1000", {
        id: "INV-1000",
        vendor: "Northstar Supplies",
        purchaseOrder: "PO-100",
        amountCents: 180000,
        currency: "USD",
        paymentTerms: "Net 30",
        status: "recorded",
        idempotencyKey: "seed_inv_1000",
        scenario: "seed",
        createdAt: new Date().toISOString(),
      });
      const customer = customers.get("cust_northstar");
      if (customer) customer.note = "Synthetic account. No external billing system is connected.";
      scenario = "A";
      webhook = null;
    },
    async listInvoices() {
      return [...invoices.values()];
    },
    async findInvoice(id) {
      return invoices.get(id) ?? null;
    },
    async findByIdempotency(key) {
      return [...invoices.values()].find((invoice) => invoice.idempotencyKey === key) ?? null;
    },
    async createInvoice(record) {
      if (invoices.has(record.id)) throw new Error("duplicate");
      invoices.set(record.id, record);
      return record;
    },
    async getCustomer(id) {
      return customers.get(id) ?? null;
    },
    async updateCustomer(id, note) {
      const customer = customers.get(id);
      if (!customer) return null;
      customer.note = note;
      return customer;
    },
    async setWebhook(payload) {
      webhook = payload;
    },
    async getWebhook() {
      return webhook;
    },
  };
}

export function invoiceView(record: InvoiceRecord) {
  return {
    invoiceId: record.id,
    vendor: record.vendor,
    purchaseOrder: record.purchaseOrder,
    amount: centsToDecimal(record.amountCents),
    currency: record.currency,
    paymentTerms: record.paymentTerms,
    clientReference: record.idempotencyKey ?? "",
    status: record.status,
  };
}

