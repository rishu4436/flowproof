"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface Scenario { id: string; name: string; summary: string }

export default function DemoPage() {
  return (
    <Suspense fallback={<div className="page"><h1>Demo Lab</h1><p className="lede">Loading scenarios…</p></div>}>
      <DemoLab />
    </Suspense>
  );
}

function DemoLab() {
  const router = useRouter();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [current, setCurrent] = useState("A");
  const params = useSearchParams();
  const [message, setMessage] = useState(params.get("reset") === "1" ? "Demo data reset to scenario A. INV-1000 remains as the lookup record." : "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/demo/scenarios").then((response) => response.json()).then((body) => {
      setScenarios(body.scenarios ?? []);
      if (body.portal?.scenario) setCurrent(body.portal.scenario);
      if (body.portal && body.portal.ok === false) setMessage("The Northstar portal is not responding. Start it with pnpm --filter @flowproof/demo-portal dev.");
    }).catch(() => setMessage("Could not read demo scenarios."));
  }, []);

  async function choose(id: string) {
    setBusy(true);
    const response = await fetch("/api/demo/scenario", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario: id }) });
    setBusy(false);
    if (!response.ok) { setMessage("The portal did not change scenario."); return; }
    setCurrent(id);
    setMessage(`Scenario ${id} is active on the portal.`);
  }

  async function run(scenario: string) {
    setBusy(true);
    setMessage(`Starting scenario ${scenario}…`);
    const invoiceId = scenario === "F" ? "INV-2041" : `INV-${scenario}DEMO`;
    await choose(scenario);
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId: "wf_invoice",
        scenario,
        objective: `Submit invoice ${invoiceId} for $2,450.00 under scenario ${scenario} and verify the saved record.`,
        requestedValues: { invoiceId, vendor: "Northstar Supplies", purchaseOrder: "PO-991", amount: "2450.00", currency: "USD", paymentTerms: "Net 30" },
      }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(body.error?.message ?? "Run was not queued."); return; }
    router.push(`/runs/${body.id}`);
  }

  return (
    <div className="page">
      <div className="kicker">Northstar</div>
      <h1>Demo Lab</h1>
      <p className="lede">These switches change the local vendor portal. They do not touch a bank, a payment network, or a production ledger. Active scenario: {current}.</p>
      {message ? <p className="panel">{message}</p> : null}
      <div className="row" style={{ margin: "12px 0" }}>
        <a className="btn" href={process.env.NEXT_PUBLIC_PORTAL_ORIGIN || "http://127.0.0.1:4100"} target="_blank" rel="noreferrer">Open portal</a>
        <form method="post" action="/api/demo/reset?redirect=1">
          <button className="btn" type="submit">Reset demo data</button>
        </form>
        <a className="btn" href="/workflows/wf_invoice">Edit invoice workflow</a>
      </div>
      <div className="cards">
        {scenarios.map((scenario) => (
          <article key={scenario.id} className="panel">
            <div className="kicker">{scenario.id}{scenario.id === current ? " · active" : ""}</div>
            <h2>{scenario.name}</h2>
            <p>{scenario.summary}</p>
            <div className="row">
              <button className="btn" disabled={busy} onClick={() => choose(scenario.id)}>Use scenario</button>
              <button className="btn primary" disabled={busy} onClick={() => run(scenario.id)}>Start test run</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
