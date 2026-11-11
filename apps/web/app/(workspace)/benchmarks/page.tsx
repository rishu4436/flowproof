"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusPill } from "@/components/proof";

interface Suite { id: string; name: string; status: string; createdAt: string; runs: Array<{ id: string; scenario: string; approach: string; outcome: string; actualOutcome: string | null; incorrectSuccess: boolean }> }

export default function BenchmarksPage() {
  const [suites, setSuites] = useState<Suite[]>([]);
  const [message, setMessage] = useState("");
  async function load() {
    const response = await fetch("/api/benchmarks");
    setSuites(await response.json());
  }
  useEffect(() => { void load(); }, []);
  async function start(scope: "focused" | "full") {
    setMessage("Queuing measured runs. Results appear only after the worker finishes them.");
    const response = await fetch("/api/benchmarks/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: scope === "full" ? "Full invoice scenarios" : "Focused A/B/E", scope }) });
    const body = await response.json();
    if (!response.ok) { setMessage(body.error?.message ?? "Could not queue the benchmark."); return; }
    window.location.href = `/benchmarks/${body.id}`;
  }
  return (
    <div className="page">
      <div className="kicker">Measurement</div>
      <h1>Benchmark Lab</h1>
      <p className="lede">The baseline uses the original labels and treats a success message as success. FlowProof requires the authoritative invoice. Sample sizes are the runs in each suite. Nothing here is an industry claim.</p>
      <div className="row">
        <button className="btn primary" onClick={() => start("focused")}>Run focused A, B, E</button>
        <button className="btn" onClick={() => start("full")}>Run all eight scenarios</button>
      </div>
      {message ? <p>{message}</p> : null}
      {suites.length === 0 ? <p className="empty">No benchmark has been run in this workspace.</p> : suites.map((suite) => (
        <article key={suite.id} className="panel" style={{ marginTop: 12 }}>
          <div className="spread"><Link href={`/benchmarks/${suite.id}`}>{suite.name}</Link><StatusPill value={suite.status} /></div>
          <p className="mono">{suite.runs.length} measured rows · {suite.runs.filter((run) => run.incorrectSuccess).length} incorrect success declarations</p>
        </article>
      ))}
    </div>
  );
}
