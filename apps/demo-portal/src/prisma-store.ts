import { prisma } from "@flowproof/database";
import { isScenario, type ScenarioId } from "./scenarios.js";
import type { InvoiceRecord, PortalStore } from "./store.js";

export function prismaStore(): PortalStore {
  return {
    async getScenario() {
      const control = await prisma.portalControl.findUnique({ where: { id: "default" } });
      const scenario = control?.scenario ?? "A";
      return isScenario(scenario) ? scenario : "A";
    },
    async setScenario(scenario: ScenarioId) {
      await prisma.portalControl.upsert({
        where: { id: "default" },
        update: { scenario },
        create: { id: "default", scenario },
      });
      if (scenario === "F") {
        await prisma.portalInvoice.upsert({
          where: { id: "INV-2041" },
          update: {},
          create: {
            id: "INV-2041",
            vendor: "Northstar Supplies",
            purchaseOrder: "PO-991",
            amountCents: 245000,
            currency: "USD",
            paymentTerms: "Net 30",
            status: "recorded",
            idempotencyKey: "seed_duplicate_inv_2041",
            scenario: "F",
          },
        });
      }
    },
    async reset() {
      await prisma.portalInvoice.deleteMany();
      await prisma.portalInvoice.create({
        data: {
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
      await prisma.portalCustomer.upsert({
        where: { id: "cust_northstar" },
        update: { note: "Synthetic account. No external billing system is connected." },
        create: {
          id: "cust_northstar",
          name: "Northstar Supplies",
          email: "ap@northstar-supplies.example",
          note: "Synthetic account. No external billing system is connected.",
        },
      });
      await prisma.portalControl.upsert({
        where: { id: "default" },
        update: { scenario: "A" },
        create: { id: "default", scenario: "A" },
      });
    },
    async listInvoices() {
      const rows = await prisma.portalInvoice.findMany({ orderBy: { createdAt: "desc" } });
      return rows.map(toInvoice);
    },
    async findInvoice(id: string) {
      const row = await prisma.portalInvoice.findUnique({ where: { id } });
      return row ? toInvoice(row) : null;
    },
    async findByIdempotency(key: string) {
      const row = await prisma.portalInvoice.findUnique({ where: { idempotencyKey: key } });
      return row ? toInvoice(row) : null;
    },
    async createInvoice(record: InvoiceRecord) {
      const row = await prisma.portalInvoice.create({
        data: {
          id: record.id,
          vendor: record.vendor,
          purchaseOrder: record.purchaseOrder,
          amountCents: record.amountCents,
          currency: record.currency,
          paymentTerms: record.paymentTerms,
          status: record.status,
          idempotencyKey: record.idempotencyKey,
          scenario: record.scenario,
        },
      });
      return toInvoice(row);
    },
    async getCustomer(id: string) {
      const row = await prisma.portalCustomer.findUnique({ where: { id } });
      return row ? { id: row.id, name: row.name, email: row.email, note: row.note } : null;
    },
    async updateCustomer(id: string, note: string) {
      const existing = await prisma.portalCustomer.findUnique({ where: { id } });
      if (!existing) return null;
      const row = await prisma.portalCustomer.update({ where: { id }, data: { note } });
      return { id: row.id, name: row.name, email: row.email, note: row.note };
    },
    async setWebhook(payload: unknown) {
      await prisma.portalControl.upsert({
        where: { id: "default" },
        update: { lastWebhook: payload as object },
        create: { id: "default", scenario: "A", lastWebhook: payload as object },
      });
    },
    async getWebhook() {
      const control = await prisma.portalControl.findUnique({ where: { id: "default" } });
      return control?.lastWebhook ?? null;
    },
  };
}

function toInvoice(row: {
  id: string;
  vendor: string;
  purchaseOrder: string;
  amountCents: number;
  currency: string;
  paymentTerms: string;
  status: string;
  idempotencyKey: string | null;
  scenario: string | null;
  createdAt: Date;
}): InvoiceRecord {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

