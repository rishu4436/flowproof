"use client";

import { useState } from "react";
import { ProofRail, StatusPill } from "./proof";

const tabs = ["Workflow", "Recovery", "Receipt"] as const;

export function LandingPreview() {
  const [tab, setTab] = useState<(typeof tabs)[number]>("Receipt");
  return (
    <div className="panel" aria-label="Sample product preview">
      <div className="spread">
        <span className="pill unknown">Sample preview. Not an execution record.</span>
        <div className="row">
          {tabs.map((item) => (
            <button key={item} className={`btn ${tab === item ? "primary" : "ghost"}`} onClick={() => setTab(item)}>{item}</button>
          ))}
        </div>
      </div>
      {tab === "Workflow" ? (
        <div style={{ marginTop: 12 }}>
          {["Open portal", "Enter INV-2041", "Submit invoice", "Verify saved record"].map((step, index) => (
            <div key={step} className="fp-node" style={{ marginBottom: 8 }}>
              <small>0{index + 1}</small>
              {step}
            </div>
          ))}
        </div>
      ) : null}
      {tab === "Recovery" ? (
        <div className="split" style={{ marginTop: 12 }}>
          <div><div className="kicker">Failed</div><p>Button “Submit invoice” was not on the page.</p></div>
          <div><div className="kicker">Proposed</div><p>Click “Send to accounts”. Same invoice values. Approval required if the write changes.</p></div>
        </div>
      ) : null}
      {tab === "Receipt" ? (
        <div style={{ marginTop: 12 }}>
          <div className="spread"><strong>INV-2041</strong><StatusPill value="VERIFIED" /></div>
          <div className="split" style={{ marginTop: 10 }}>
            <div><div className="kicker">Expected</div><p>$2,450.00 · Net 30</p></div>
            <div><div className="kicker">Verified</div><p>$2,450.00 · stored</p></div>
          </div>
          <div style={{ marginTop: 10 }}>
            <ProofRail stages={[
              { name: "Requested", state: "done", detail: "INV-2041" },
              { name: "Planned", state: "done", detail: "Approved graph" },
              { name: "Executed", state: "done", detail: "Playwright" },
              { name: "Observed", state: "done", detail: "Confirmation text" },
              { name: "Verified", state: "done", detail: "Portal record" },
            ]} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
