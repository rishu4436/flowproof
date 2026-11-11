"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ProofRail, RecoveryDiff, StatusPill, VerificationMatrix } from "./proof";

interface RunView {
  id: string;
  status: string;
  outcome?: string | null;
  objective: string;
  scenario?: string | null;
  requestedValues: Record<string, string>;
  steps: Array<{ id: string; name: string; status: string; actionType: string; durationMs?: number | null; errorMessage?: string | null; errorType?: string | null }>;
  events: Array<{ id: string; sequence: number; type: string; payload: unknown; createdAt: string }>;
  artifacts: Array<{ id: string; label?: string | null; capturedAt: string; href?: string }>;
  recoveries: Array<{ id: string; diagnosis: string; uncertainty?: string | null; approvalState: string; changesWriteBehavior: boolean; source: string; proposal: unknown; result?: string | null }>;
  checks: Array<{ id: string; name: string; expected?: unknown; observed?: unknown; source: string; result: string; authoritative: boolean; details?: string | null }>;
  approvals?: Array<{ id: string; scope: string; decision: string; note?: string | null }>;
  receipt?: { id: string } | null;
  errorSummary?: string | null;
}

export function Console({ initial }: { initial: RunView }) {
  const [run, setRun] = useState(initial);
  const [index, setIndex] = useState(0);
  const [shot, setShot] = useState(initial.artifacts.at(-1) ?? null);

  useEffect(() => {
    const source = new EventSource(`/api/runs/${initial.id}/stream`);
    source.addEventListener("status", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { status: string; outcome?: string; steps?: RunView["steps"]; latestArtifact?: { id: string; capturedAt: string; label?: string } | null };
      setRun((current) => ({ ...current, status: data.status, outcome: data.outcome ?? current.outcome, steps: data.steps ?? current.steps }));
      if (data.latestArtifact) setShot({ ...data.latestArtifact, href: `/api/runs/${initial.id}/artifacts/${data.latestArtifact.id}` });
      if (data.status === "PAUSED_FOR_APPROVAL") {
        fetch(`/api/runs/${initial.id}`).then((response) => response.json()).then(setRun).catch(() => undefined);
      }
    });
    source.addEventListener("log", () => {
      fetch(`/api/runs/${initial.id}`).then((response) => response.json()).then(setRun).catch(() => undefined);
    });
    return () => source.close();
  }, [initial.id]);

  const event = run.events[index];
  const failureIndex = run.events.findIndex((item) => {
    if (item.type.includes("failed") || item.type.includes("blocked")) return true;
    const payload = item.payload as { verdict?: string } | null;
    return payload?.verdict === "FAILED" || payload?.verdict === "BLOCKED" || payload?.verdict === "UNVERIFIED";
  });
  const recoveryIndex = run.events.findIndex((item) => item.type.startsWith("recovery"));
  const verifyIndex = run.events.findIndex((item) => item.type.includes("verified") || item.type.includes("verification"));

  async function act(path: string) {
    await fetch(path, { method: "POST" });
    const fresh = await fetch(`/api/runs/${run.id}`).then((response) => response.json());
    setRun(fresh);
  }

  return (
    <div className="console">
      <aside className="palette">
        <div className="spread"><div className="kicker">Steps</div><StatusPill value={run.outcome ?? run.status} /></div>
        {run.steps.map((step) => (
          <div key={step.id} className="fp-node" style={{ width: "auto", marginTop: 8 }}>
            <small>{step.actionType} · {step.durationMs ?? "—"} ms</small>
            <strong>{step.name}</strong>
            <StatusPill value={step.status} />
            {step.errorMessage ? <p>{step.errorMessage}</p> : null}
          </div>
        ))}
        <ProofRail stages={rail(run)} />
      </aside>
      <section className="page">
        <div className="spread">
          <h1 style={{ fontSize: 22 }}>{run.objective}</h1>
          <div className="row">
            <button className="btn" onClick={() => act(`/api/runs/${run.id}/pause`)}>Pause</button>
            <button className="btn" onClick={() => act(`/api/runs/${run.id}/resume`)}>Resume</button>
            <button className="btn danger" onClick={() => act(`/api/runs/${run.id}/cancel`)}>Stop</button>
            {run.receipt ? <Link className="btn primary" href={`/receipts/${run.receipt.id}`}>Receipt</Link> : null}
          </div>
        </div>
        <div className="shot">
          {shot?.href ? <img src={shot.href} alt={shot.label ?? "Browser screenshot"} /> : <p>No screenshot captured yet. This viewer shows captured frames, not a live video.</p>}
        </div>
        <p className="mono">{shot ? `Captured ${new Date(shot.capturedAt).toLocaleString()} · ${shot.label ?? "Screenshot"}` : "Waiting for the first capture."}</p>
        <div className="row">
          <button className="btn" onClick={() => setIndex((value) => Math.max(0, value - 1))}>Previous</button>
          <button className="btn" onClick={() => setIndex((value) => Math.min(run.events.length - 1, value + 1))}>Next</button>
          <button className="btn" disabled={failureIndex < 0} onClick={() => setIndex(Math.max(0, failureIndex))}>Jump to failure</button>
          <button className="btn" disabled={recoveryIndex < 0} onClick={() => setIndex(Math.max(0, recoveryIndex))}>Jump to recovery</button>
          <button className="btn" disabled={verifyIndex < 0} onClick={() => setIndex(Math.max(0, verifyIndex))}>Jump to verification</button>
        </div>
        <input type="range" min={0} max={Math.max(0, run.events.length - 1)} value={Math.min(index, Math.max(0, run.events.length - 1))} onChange={(event) => setIndex(Number(event.target.value))} />
        {event ? <pre className="panel mono">{`${event.type}\n${JSON.stringify(event.payload, null, 2)}`}</pre> : <p className="empty">Events appear here as the worker records them.</p>}
      </section>
      <aside className="inspector">
        <div className="kicker">Inspector</div>
        <p>{run.errorSummary}</p>
        <p className="mono">Scenario {run.scenario ?? "current portal"}</p>
        {run.status === "PAUSED_FOR_APPROVAL" ? (
          <div className="panel">
            <p>Paused before the next step.</p>
            <button className="btn primary" onClick={() => act(`/api/runs/${run.id}/resume`)}>Resume</button>
          </div>
        ) : null}
        {(run.approvals ?? []).filter((approval) => approval.decision === "pending" && approval.scope !== "operator_pause").map((approval) => (
          <p key={approval.id}>Waiting for {approval.scope}{approval.note ? `: ${approval.note}` : ""}</p>
        ))}
        {run.recoveries.map((recovery) => (
          <div key={recovery.id}>
            <RecoveryDiff recovery={recovery} />
            {recovery.approvalState === "pending" ? (
              <div className="row">
                <button className="btn primary" onClick={() => act(`/api/recoveries/${recovery.id}/approve`)}>Approve repair</button>
                <button className="btn danger" onClick={() => act(`/api/recoveries/${recovery.id}/reject`)}>Reject</button>
              </div>
            ) : null}
          </div>
        ))}
        {run.checks.length ? <VerificationMatrix rows={run.checks} /> : <p className="lede">Verification has not run yet.</p>}
      </aside>
    </div>
  );
}

function rail(run: RunView): Array<{ name: string; state: "done" | "bad" | "wait" | "idle"; detail?: string }> {
  const terminal = ["VERIFIED", "FAILED", "BLOCKED", "UNVERIFIED", "OUTCOME_UNKNOWN", "CANCELLED"].includes(run.status);
  const bad = run.outcome === "FAILED" || run.outcome === "BLOCKED";
  return [
    { name: "Requested", state: "done", detail: run.objective },
    { name: "Planned", state: "done", detail: "Approved workflow" },
    { name: "Executed", state: run.steps.some((step) => step.status === "running") ? "wait" : run.steps.length ? "done" : "idle", detail: `${run.steps.length} steps` },
    { name: "Observed", state: run.artifacts.length ? "done" : "idle", detail: run.artifacts.length ? `${run.artifacts.length} captures` : "No capture" },
    { name: "Verified", state: !terminal ? "idle" : bad ? "bad" : run.outcome === "VERIFIED" ? "done" : "wait", detail: run.outcome ?? run.status },
  ];
}
