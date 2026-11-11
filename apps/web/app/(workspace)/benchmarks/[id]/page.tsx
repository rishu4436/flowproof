"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StatusPill } from "@/components/proof";

interface Row { id: string; scenario: string; approach: string; model: string | null; outcome: string; actualOutcome: string | null; incorrectSuccess: boolean; metrics: { invoiceId?: string; durationMs?: number; recoveryAttempts?: number; knownCostUsd?: string[] } }

export default function BenchmarkDetailPage() {
  const params = useParams<{ id: string }>();
  const [suite, setSuite] = useState<{ name: string; status: string; runs: Row[] } | null>(null);
  useEffect(() => {
    const load = () => fetch(`/api/benchmarks/${params.id}`).then((response) => response.json()).then(setSuite);
    void load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [params.id]);
  if (!suite) return <div className="page">Loading measured results…</div>;
  const flow = suite.runs.filter((run) => run.approach === "flowproof");
  const verified = flow.filter((run) => run.actualOutcome === "VERIFIED").length;
  return (
    <div className="page">
      <div className="kicker">Sample size {suite.runs.length}</div>
      <h1>{suite.name}</h1>
      <p><StatusPill value={suite.status} /> FlowProof authoritative successes in this suite: {verified} of {flow.length || 0}.</p>
      <table className="table">
        <thead><tr><th>Scenario</th><th>Approach</th><th>Model</th><th>Invoice</th><th>Declared</th><th>Authoritative</th><th>Incorrect success</th><th>Duration</th><th>Cost</th></tr></thead>
        <tbody>
          {suite.runs.map((run) => (
            <tr key={run.id}>
              <td>{run.scenario}</td>
              <td>{run.approach}</td>
              <td className="mono">{run.model ?? "—"}</td>
              <td className="mono">{run.metrics?.invoiceId ?? "—"}</td>
              <td><StatusPill value={run.outcome} /></td>
              <td><StatusPill value={run.actualOutcome} /></td>
              <td>{run.incorrectSuccess ? "Yes" : "No"}</td>
              <td className="mono">{run.metrics?.durationMs ?? "—"}</td>
              <td className="mono">{run.metrics?.knownCostUsd?.filter(Boolean).join(", ") || "not reported"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {suite.runs.length === 0 ? <p className="empty">The worker has not recorded a scenario yet.</p> : null}
    </div>
  );
}
