import { centsToDecimal } from "@flowproof/core";
import { buttonLabel, fieldLabels, fieldOrder, type InvoiceInput, type ScenarioId } from "./scenarios.js";
import type { CustomerRecord, InvoiceRecord } from "./store.js";

const SCENARIO_COPY: Record<ScenarioId, string> = {
  A: "Normal operation",
  B: "Changed button label",
  C: "Reordered form",
  D: "Review dialog",
  E: "False-positive success",
  F: "Duplicate invoice",
  G: "Ambiguous response",
  H: "Confirmation UI failed",
};

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} · Northstar Vendor Portal</title>
  <style>
    :root { color-scheme: light; --ink:#1b2a4a; --brass:#8d6b2f; --paper:#f4f1ea; --card:#fffdf8; --line:#e2d9c8; --good:#1f7a4d; --bad:#8d2f2f; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: Georgia, "Iowan Old Style", serif; background:var(--paper); color:var(--ink); }
    header { display:flex; justify-content:space-between; gap:16px; align-items:center; padding:16px 28px; background:#1b2a4a; color:#f4f1ea; }
    header a { color:#f4f1ea; text-decoration:none; font-family: "Segoe UI", sans-serif; font-size:13px; letter-spacing:.04em; }
    header strong { font-weight:600; letter-spacing:.08em; font-size:13px; text-transform:uppercase; }
    nav { display:flex; gap:16px; }
    main { max-width:980px; margin:0 auto; padding:28px 20px 64px; }
    h1 { font-size:32px; font-weight:500; margin:0 0 8px; }
    .lede { color:#5c5346; margin:0 0 20px; }
    .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
    .card, form.card, .notice { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:16px; }
    .card span, .metric span { display:block; font-family:"Segoe UI",sans-serif; font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:#74695a; }
    .metric strong { font-family:"Segoe UI",sans-serif; font-size:28px; }
    form { display:grid; gap:12px; }
    label { display:grid; gap:6px; font-family:"Segoe UI",sans-serif; font-size:13px; }
    input, select, textarea { font:inherit; padding:10px 12px; border:1px solid #cfc4b0; border-radius:6px; background:white; color:var(--ink); }
    button, .button { font-family:"Segoe UI",sans-serif; background:#1b2a4a; color:white; border:0; border-radius:6px; padding:10px 14px; cursor:pointer; text-decoration:none; display:inline-block; }
    button.secondary { background:transparent; color:var(--ink); border:1px solid #cfc4b0; }
    table { width:100%; border-collapse:collapse; background:white; }
    th, td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--line); font-family:"Segoe UI",sans-serif; font-size:14px; }
    .toast { background:#e7f6ee; border:1px solid #b7dfc8; color:var(--good); padding:12px 14px; border-radius:8px; font-family:"Segoe UI",sans-serif; }
    .error { background:#fbeaea; border:1px solid #ecc3c3; color:var(--bad); padding:12px 14px; border-radius:8px; font-family:"Segoe UI",sans-serif; }
    dialog { border:1px solid var(--line); border-radius:10px; padding:20px; max-width:420px; }
    dialog::backdrop { background:rgba(27,42,74,.35); }
    .row { display:flex; gap:8px; }
    @media (max-width:720px) { .grid { grid-template-columns:1fr; } header { flex-direction:column; align-items:flex-start; } }
  </style>
</head>
<body>
  <header>
    <strong>Northstar Vendor Portal</strong>
    <nav>
      <a href="/">Dashboard</a>
      <a href="/invoices">Invoices</a>
      <a href="/invoices/new">New invoice</a>
      <a href="/customers/cust_northstar">Customer</a>
      <a href="/settings">Demo controls</a>
    </nav>
  </header>
  <main>${body}</main>
</body>
</html>`;
}

export function dashboardHtml(input: { invoiceCount: number; scenario: ScenarioId }): string {
  return page(
    "Dashboard",
    `<h1>Accounts payable</h1>
     <p class="lede">Synthetic vendor billing for the FlowProof demonstration. Nothing here is a real payment.</p>
     <div class="grid">
       <div class="card metric"><span>Stored invoices</span><strong>${input.invoiceCount}</strong></div>
       <div class="card metric"><span>Active scenario</span><strong>${input.scenario}</strong></div>
       <div class="card metric"><span>Currency</span><strong>USD</strong></div>
     </div>
     <p class="lede" style="margin-top:18px">${escapeHtml(SCENARIO_COPY[input.scenario])}</p>`,
  );
}

export function invoiceListHtml(invoices: InvoiceRecord[]): string {
  const rows = invoices
    .map(
      (invoice) => `<tr>
        <td><a href="/invoices/${escapeAttr(invoice.id)}">${escapeHtml(invoice.id)}</a></td>
        <td>${escapeHtml(invoice.vendor)}</td>
        <td>${escapeHtml(centsToDecimal(invoice.amountCents))} ${escapeHtml(invoice.currency)}</td>
        <td>${escapeHtml(invoice.status)}</td>
      </tr>`,
    )
    .join("");
  return page(
    "Invoices",
    `<h1>Invoices</h1>
     <p class="lede"><a class="button" href="/invoices/new">New invoice</a></p>
     <label>Status for INV-1000
       <input aria-label="Status for INV-1000" readonly value="${escapeAttr(invoices.find((invoice) => invoice.id === "INV-1000")?.status ?? "missing")}" />
     </label>
     <table><thead><tr><th>Invoice</th><th>Vendor</th><th>Amount</th><th>Status</th></tr></thead><tbody>${rows || `<tr><td colspan="4">No invoices stored.</td></tr>`}</tbody></table>
     `,
  );
}

export function invoiceFormHtml(input: {
  scenario: ScenarioId;
  csrf: string;
  error?: string;
  values?: Partial<InvoiceInput>;
}): string {
  const labels = fieldLabels(input.scenario);
  const values = input.values ?? {};
  const fields = fieldOrder(input.scenario)
    .map((key) => renderField(key, labels[key], values[key] ?? ""))
    .join("");
  const label = buttonLabel(input.scenario, "invoice");
  const dialog =
    input.scenario === "D"
      ? `<dialog id="review">
          <h2>Review invoice</h2>
          <p>Confirm this synthetic invoice before it is stored.</p>
          <div class="row">
            <button type="submit" form="invoice-form">Confirm invoice</button>
            <button type="button" class="secondary" onclick="document.getElementById('review').close()">Back</button>
          </div>
        </dialog>
        <button type="button" onclick="document.getElementById('review').showModal()">${escapeHtml(label)}</button>`
      : `<button type="submit">${escapeHtml(label)}</button>`;
  return page(
    "New invoice",
    `<h1>New invoice</h1>
     <p class="lede">Scenario ${input.scenario}: ${escapeHtml(SCENARIO_COPY[input.scenario])}</p>
     ${input.error ? `<p class="error">${escapeHtml(input.error)}</p>` : ""}
     <form id="invoice-form" class="card" method="post" action="/invoices">
       <input type="hidden" name="csrf" value="${escapeAttr(input.csrf)}" />
       ${fields}
       ${dialog}
     </form>`,
  );
}

export function successHtml(message: string): string {
  return page("Submitted", `<h1>Invoice submitted</h1><p class="toast">${escapeHtml(message)}</p><p>Invoice submitted successfully.</p>`);
}

export function duplicateHtml(id: string): string {
  return page("Duplicate", `<h1>Duplicate invoice</h1><p class="error">Duplicate invoice ${escapeHtml(id)} already exists.</p>`);
}

export function confirmationHtml(invoice: InvoiceRecord): string {
  return page(
    "Confirmation",
    `<h1>Invoice submitted</h1>
     <p class="toast">Invoice submitted successfully.</p>
     <div class="card">
       <p>Invoice ID ${escapeHtml(invoice.id)}</p>
       <p>Vendor ${escapeHtml(invoice.vendor)}</p>
       <p>Amount ${escapeHtml(centsToDecimal(invoice.amountCents))} ${escapeHtml(invoice.currency)}</p>
       <p>Status ${escapeHtml(invoice.status)}</p>
     </div>`,
  );
}

export function confirmationBrokenHtml(id: string): string {
  return page(
    "Confirmation unavailable",
    `<h1>Confirmation could not be displayed</h1>
     <p class="error">The confirmation page failed for ${escapeHtml(id)}. Check the invoice list for the stored record.</p>`,
  );
}

export function detailHtml(invoice: InvoiceRecord): string {
  return page(
    invoice.id,
    `<h1>${escapeHtml(invoice.id)}</h1>
     <div class="card">
       <p>Vendor ${escapeHtml(invoice.vendor)}</p>
       <p>Purchase order ${escapeHtml(invoice.purchaseOrder)}</p>
       <p>Amount ${escapeHtml(centsToDecimal(invoice.amountCents))} ${escapeHtml(invoice.currency)}</p>
       <p>Terms ${escapeHtml(invoice.paymentTerms)}</p>
       <p>Status ${escapeHtml(invoice.status)}</p>
     </div>`,
  );
}

export function customerHtml(customer: CustomerRecord, scenario: ScenarioId, message?: string): string {
  return page(
    customer.name,
    `<h1>${escapeHtml(customer.name)}</h1>
     <p class="lede">${escapeHtml(customer.email)}</p>
     ${message ? `<p class="toast">${escapeHtml(message)}</p>` : ""}
     <form class="card" method="post" action="/customers/${escapeAttr(customer.id)}">
       <label>Account note
         <textarea name="note" rows="4">${escapeHtml(customer.note)}</textarea>
       </label>
       <label>Internal note
         <input name="unused" value="" />
       </label>
       <button type="submit">${escapeHtml(buttonLabel(scenario, "customer"))}</button>
     </form>`,
  );
}

export function settingsHtml(scenario: ScenarioId): string {
  const options = (Object.keys(SCENARIO_COPY) as ScenarioId[])
    .map((id) => `<option value="${id}" ${id === scenario ? "selected" : ""}>${id} — ${escapeHtml(SCENARIO_COPY[id])}</option>`)
    .join("");
  return page(
    "Demo controls",
    `<h1>Demo controls</h1>
     <p class="lede">These controls only affect the local synthetic portal.</p>
     <form class="card" method="post" action="/settings/scenario">
       <label>Scenario <select name="scenario">${options}</select></label>
       <button type="submit">Apply scenario</button>
     </form>
     <form method="post" action="/settings/reset" style="margin-top:12px">
       <button class="secondary" type="submit">Reset demo data</button>
     </form>`,
  );
}

export function messageHtml(title: string, message: string, statusClass = "error"): string {
  return page(title, `<h1>${escapeHtml(title)}</h1><p class="${statusClass}">${escapeHtml(message)}</p>`);
}

function renderField(key: keyof InvoiceInput, label: string, value: string): string {
  if (key === "currency") {
    return `<label>${escapeHtml(label)}<select name="currency" aria-label="${escapeAttr(label)}">${["USD", "EUR"]
      .map((option) => `<option ${option === value ? "selected" : ""}>${option}</option>`)
      .join("")}</select></label>`;
  }
  if (key === "paymentTerms") {
    return `<label>${escapeHtml(label)}<select name="paymentTerms" aria-label="${escapeAttr(label)}">${["Net 15", "Net 30", "Net 45"]
      .map((option) => `<option ${option === (value || "Net 30") ? "selected" : ""}>${option}</option>`)
      .join("")}</select></label>`;
  }
  return `<label>${escapeHtml(label)}<input name="${escapeAttr(key)}" aria-label="${escapeAttr(label)}" value="${escapeAttr(value)}" /></label>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
