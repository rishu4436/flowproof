import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createPortal } from "./app.js";
import { planSubmission } from "./scenarios.js";
import { memoryStore } from "./store.js";

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe("submission plans", () => {
  const invoice = {
    invoiceId: "INV-2041",
    vendor: "Northstar Supplies",
    purchaseOrder: "PO-991",
    amount: "2450.00",
    currency: "USD",
    paymentTerms: "Net 30",
    clientReference: "run_key_123456",
  };

  it("keeps a success toast from becoming a stored invoice", () => {
    expect(planSubmission({ scenario: "E", invoice, existing: null, sameKey: null }).kind).toBe("false_success");
  });

  it("drops the response only after a plan to persist", () => {
    expect(planSubmission({ scenario: "G", invoice, existing: null, sameKey: null }).kind).toBe("persist_then_drop");
    expect(planSubmission({ scenario: "H", invoice, existing: null, sameKey: null }).kind).toBe("persist_confirmation_broken");
  });

  it("rejects a different idempotency key for an existing invoice", () => {
    const plan = planSubmission({
      scenario: "A",
      invoice,
      existing: {
        id: "INV-2041",
        vendor: "Northstar Supplies",
        purchaseOrder: "PO-991",
        amountCents: 245000,
        currency: "USD",
        paymentTerms: "Net 30",
        status: "recorded",
        idempotencyKey: "seed_duplicate_inv_2041",
        scenario: "F",
        createdAt: "2026-11-09T00:00:00.000Z",
      },
      sameKey: null,
    });
    expect(plan.kind).toBe("duplicate");
  });
});

describe("portal http", () => {
  it("stores a normal invoice and exposes it only to the verify token", async () => {
    const { base, verify } = await start();
    const page = await fetch(`${base}/invoices/new`);
    const html = await page.text();
    const cookie = (page.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";
    const submitted = await fetch(`${base}/invoices`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
      body: new URLSearchParams({
        csrf,
        invoiceId: "INV-2041",
        vendor: "Northstar Supplies",
        purchaseOrder: "PO-991",
        amount: "2450.00",
        currency: "USD",
        paymentTerms: "Net 30",
        clientReference: "run_key_123456",
      }),
    });
    expect(submitted.status).toBe(303);
    const hidden = await fetch(`${base}/api/verify/invoices/INV-2041`);
    expect(hidden.status).toBe(401);
    const verified = await fetch(`${base}/api/verify/invoices/INV-2041`, { headers: { Authorization: `Bearer ${verify}` } });
    expect(verified.status).toBe(200);
    const body = (await verified.json()) as { amount: string; clientReference: string };
    expect(body.amount).toBe("2450.00");
    expect(body.clientReference).toBe("run_key_123456");
  });

  it("shows success for scenario E without storing the invoice", async () => {
    const { base, admin, verify } = await start();
    await fetch(`${base}/api/admin/scenario`, {
      method: "POST",
      headers: { Authorization: `Bearer ${admin}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "E" }),
    });
    const page = await fetch(`${base}/invoices/new`);
    const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())?.[1] ?? "";
    const submitted = await fetch(`${base}/invoices`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: (page.headers.get("set-cookie") ?? "").split(";")[0] ?? "" },
      body: new URLSearchParams({
        csrf,
        invoiceId: "INV-2041",
        vendor: "Northstar Supplies",
        purchaseOrder: "PO-991",
        amount: "2450.00",
        currency: "USD",
        paymentTerms: "Net 30",
        clientReference: "run_key_false",
      }),
    });
    const text = await submitted.text();
    expect(text).toContain("Invoice submitted successfully");
    const verified = await fetch(`${base}/api/verify/invoices/INV-2041`, { headers: { Authorization: `Bearer ${verify}` } });
    expect(verified.status).toBe(404);
  });
});

async function start() {
  const admin = "admin-test-token";
  const verify = "verify-test-token";
  const handler = createPortal({ store: memoryStore(), adminToken: admin, verifyToken: verify });
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("port");
  return { base: `http://127.0.0.1:${address.port}`, admin, verify };
}
