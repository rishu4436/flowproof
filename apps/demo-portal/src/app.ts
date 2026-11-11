import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { moneyToCents } from "@flowproof/core";
import {
  confirmationBrokenHtml,
  confirmationHtml,
  customerHtml,
  dashboardHtml,
  detailHtml,
  duplicateHtml,
  invoiceFormHtml,
  invoiceListHtml,
  messageHtml,
  settingsHtml,
  successHtml,
} from "./html.js";
import { isScenario, planSubmission, readInvoiceInput, type ScenarioId } from "./scenarios.js";
import { invoiceView, type InvoiceRecord, type PortalStore } from "./store.js";

export interface PortalOptions {
  store: PortalStore;
  adminToken: string;
  verifyToken: string;
}

export function createPortal(options: PortalOptions) {
  return async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const method = req.method ?? "GET";
      if (method === "GET" && url.pathname === "/api/health") {
        const scenario = await options.store.getScenario();
        return json(res, 200, { ok: true, service: "northstar-vendor-portal", scenario });
      }
      if (url.pathname.startsWith("/api/admin")) return handleAdmin(req, res, url, options);
      if (url.pathname.startsWith("/api/verify")) return handleVerify(req, res, url, options);
      if (url.pathname === "/api/hooks/flowproof" && method === "POST") return handleHook(req, res, options);
      if (method === "GET") return handleGet(req, res, url, options);
      if (method === "POST") return handlePost(req, res, url, options);
      return text(res, 405, "Method not allowed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Portal error";
      return text(res, 500, message);
    }
  };
}

export function listenPortal(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>, host: string, port: number) {
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  return new Promise<ReturnType<typeof createServer>>((resolve) => {
    server.listen(port, host, () => resolve(server));
  });
}

async function handleGet(req: IncomingMessage, res: ServerResponse, url: URL, options: PortalOptions) {
  const scenario = await options.store.getScenario();
  if (url.pathname === "/") {
    const invoices = await options.store.listInvoices();
    return html(res, 200, dashboardHtml({ invoiceCount: invoices.length, scenario }));
  }
  if (url.pathname === "/invoices") return html(res, 200, invoiceListHtml(await options.store.listInvoices()));
  if (url.pathname === "/invoices/new") {
    const csrf = issueCsrf(res);
    return html(res, 200, invoiceFormHtml({ scenario, csrf }));
  }
  if (url.pathname === "/settings") {
    if (!isLoopback(req)) return html(res, 403, messageHtml("Restricted", "Demo controls are available from this machine only."));
    return html(res, 200, settingsHtml(scenario));
  }
  const invoiceMatch = url.pathname.match(/^\/invoices\/([^/]+)$/);
  if (invoiceMatch?.[1] && invoiceMatch[1] !== "new") {
    const invoice = await options.store.findInvoice(decodeURIComponent(invoiceMatch[1]));
    if (!invoice) return html(res, 404, messageHtml("Not found", "That invoice is not stored."));
    return html(res, 200, detailHtml(invoice));
  }
  const confirmation = url.pathname.match(/^\/invoices\/([^/]+)\/confirmation$/);
  if (confirmation?.[1]) {
    const invoice = await options.store.findInvoice(decodeURIComponent(confirmation[1]));
    if (!invoice) return html(res, 404, messageHtml("Not found", "That invoice is not stored."));
    if (scenario === "H") return html(res, 500, confirmationBrokenHtml(invoice.id));
    return html(res, 200, confirmationHtml(invoice));
  }
  const customer = url.pathname.match(/^\/customers\/([^/]+)$/);
  if (customer?.[1]) {
    const record = await options.store.getCustomer(decodeURIComponent(customer[1]));
    if (!record) return html(res, 404, messageHtml("Not found", "That customer is not stored."));
    return html(res, 200, customerHtml(record, scenario));
  }
  return html(res, 404, messageHtml("Not found", "That page does not exist."));
}

async function handlePost(req: IncomingMessage, res: ServerResponse, url: URL, options: PortalOptions) {
  const body = await readBody(req);
  const scenario = await options.store.getScenario();
  if (url.pathname === "/settings/scenario" || url.pathname === "/settings/reset") {
    if (!isLoopback(req)) return html(res, 403, messageHtml("Restricted", "Demo controls are available from this machine only."));
    if (url.pathname === "/settings/reset") {
      await options.store.reset();
      return redirect(res, "/settings");
    }
    const next = body.scenario ?? "";
    if (!isScenario(next)) return html(res, 422, messageHtml("Invalid scenario", "Choose a scenario from A to H."));
    await options.store.setScenario(next);
    return redirect(res, "/settings");
  }
  const customer = url.pathname.match(/^\/customers\/([^/]+)$/);
  if (customer?.[1]) {
    const note = (body.note ?? "").trim();
    if (note.length < 3 || note.length > 240) return html(res, 422, messageHtml("Invalid note", "Enter a note between 3 and 240 characters."));
    const updated = await options.store.updateCustomer(decodeURIComponent(customer[1]), note);
    if (!updated) return html(res, 404, messageHtml("Not found", "That customer is not stored."));
    return html(res, 200, customerHtml(updated, scenario, "Customer note saved."));
  }
  if (url.pathname !== "/invoices") return html(res, 404, messageHtml("Not found", "That action does not exist."));
  if (!body.csrf || body.csrf !== readCookie(req, "ns_csrf")) {
    return html(res, 403, messageHtml("Blocked", "The form session was missing. Open the new invoice page again."));
  }
  const parsed = readInvoiceInput(body);
  if (!parsed.input) {
    const csrf = issueCsrf(res);
    return html(res, 422, invoiceFormHtml({ scenario, csrf, error: parsed.message, values: body }));
  }
  const existing = await options.store.findInvoice(parsed.input.invoiceId);
  const sameKey = await options.store.findByIdempotency(parsed.input.clientReference);
  const plan = planSubmission({ scenario, invoice: parsed.input, existing, sameKey });
  if (plan.kind === "invalid") return html(res, 422, messageHtml("Invalid", plan.message));
  if (plan.kind === "duplicate") return html(res, 409, duplicateHtml(plan.invoice.id));
  if (plan.kind === "false_success") return html(res, 200, successHtml("Invoice submitted successfully."));
  if (plan.kind === "idempotent") return redirect(res, `/invoices/${encodeURIComponent(plan.invoice.id)}/confirmation`);
  const saved = await saveInvoice(options.store, parsed.input, scenario);
  if (plan.kind === "persist_then_drop") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "x-northstar-result": "dropped" });
    res.write("<!doctype html><title>Response lost</title><p>The server dropped the response after saving.</p>");
    req.socket.destroy();
    return;
  }
  if (plan.kind === "persist_confirmation_broken") return redirect(res, `/invoices/${encodeURIComponent(saved.id)}/confirmation`);
  return redirect(res, `/invoices/${encodeURIComponent(saved.id)}/confirmation`);
}

async function handleVerify(req: IncomingMessage, res: ServerResponse, url: URL, options: PortalOptions) {
  if (!authorized(req, options.verifyToken)) return json(res, 401, { error: "unauthorized" });
  if ((req.method ?? "GET") !== "GET") return json(res, 405, { error: "method_not_allowed" });
  const key = url.searchParams.get("idempotencyKey");
  if (url.pathname === "/api/verify/invoices" && key) {
    const invoice = await options.store.findByIdempotency(key);
    if (!invoice) return json(res, 404, { error: "not_found" });
    return json(res, 200, invoiceView(invoice));
  }
  const match = url.pathname.match(/^\/api\/verify\/invoices\/([^/]+)$/);
  if (match?.[1]) {
    const invoice = await options.store.findInvoice(decodeURIComponent(match[1]));
    if (!invoice) return json(res, 404, { error: "not_found" });
    return json(res, 200, invoiceView(invoice));
  }
  const customer = url.pathname.match(/^\/api\/verify\/customers\/([^/]+)$/);
  if (customer?.[1]) {
    const record = await options.store.getCustomer(decodeURIComponent(customer[1]));
    if (!record) return json(res, 404, { error: "not_found" });
    return json(res, 200, { customerId: record.id, name: record.name, email: record.email, note: record.note });
  }
  return json(res, 404, { error: "not_found" });
}

async function handleAdmin(req: IncomingMessage, res: ServerResponse, url: URL, options: PortalOptions) {
  if (!authorized(req, options.adminToken)) return json(res, 401, { error: "unauthorized" });
  if (req.method === "GET" && url.pathname === "/api/admin/state") {
    return json(res, 200, {
      scenario: await options.store.getScenario(),
      invoices: await options.store.listInvoices(),
      webhook: await options.store.getWebhook(),
    });
  }
  if (req.method === "POST" && url.pathname === "/api/admin/reset") {
    await options.store.reset();
    return json(res, 200, { ok: true, scenario: "A" });
  }
  if (req.method === "POST" && url.pathname === "/api/admin/scenario") {
    const body = await readJson(req);
    const scenario = String(body.scenario ?? "");
    if (!isScenario(scenario)) return json(res, 422, { error: "invalid_scenario" });
    await options.store.setScenario(scenario);
    return json(res, 200, { ok: true, scenario });
  }
  return json(res, 404, { error: "not_found" });
}

async function handleHook(req: IncomingMessage, res: ServerResponse, options: PortalOptions) {
  if (!authorized(req, options.adminToken)) return json(res, 401, { error: "unauthorized" });
  const body = await readJson(req);
  await options.store.setWebhook(body);
  return json(res, 202, { ok: true });
}

async function saveInvoice(store: PortalStore, input: { invoiceId: string; vendor: string; purchaseOrder: string; amount: string; currency: string; paymentTerms: string; clientReference: string }, scenario: ScenarioId): Promise<InvoiceRecord> {
  const cents = moneyToCents(input.amount);
  if (cents == null) throw new Error("amount");
  return store.createInvoice({
    id: input.invoiceId,
    vendor: input.vendor,
    purchaseOrder: input.purchaseOrder,
    amountCents: cents,
    currency: input.currency,
    paymentTerms: input.paymentTerms,
    status: "recorded",
    idempotencyKey: input.clientReference,
    scenario,
    createdAt: new Date().toISOString(),
  });
}

function issueCsrf(res: ServerResponse): string {
  const csrf = randomBytes(16).toString("hex");
  res.setHeader("Set-Cookie", `ns_csrf=${csrf}; HttpOnly; SameSite=Lax; Path=/`);
  return csrf;
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? "";
  return header === `Bearer ${token}` && token.length > 0;
}

function isLoopback(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function readBody(req: IncomingMessage): Promise<Record<string, string>> {
  const raw = await readRaw(req);
  const params = new URLSearchParams(raw);
  const body: Record<string, string> = {};
  for (const [key, value] of params.entries()) body[key] = value;
  return body;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readRaw(req);
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

function readRaw(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 20_000) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function html(res: ServerResponse, status: number, body: string) {
  if (res.writableEnded || res.socket?.destroyed) return;
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'", "x-northstar-result": "complete" });
  res.end(body);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(body));
}

function text(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

function redirect(res: ServerResponse, location: string) {
  res.writeHead(303, { Location: location, "x-northstar-result": "complete" });
  res.end();
}
