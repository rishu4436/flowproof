import Link from "next/link";
import { getRun } from "@/server/runs";
import { StatusPill } from "@/components/proof";

export const dynamic = "force-dynamic";

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ left?: string; right?: string }> }) {
  const { left, right } = await searchParams;
  if (!left || !right) {
    return <div className="page"><h1>Compare runs</h1><p className="lede">Add ?left=run_id&right=run_id to the address.</p></div>;
  }
  const [a, b] = await Promise.all([getRun(left), getRun(right)]);
  const steps = new Set([...a.steps.map((step) => step.nodeId), ...b.steps.map((step) => step.nodeId)]);
  return (
    <div className="page">
      <div className="kicker">Replay</div>
      <h1>Run comparison</h1>
      <div className="split">
        <RunColumn run={a} />
        <RunColumn run={b} />
      </div>
      <table className="table">
        <thead><tr><th>Step</th><th>Left</th><th>Right</th></tr></thead>
        <tbody>
          {[...steps].map((nodeId) => {
            const leftStep = a.steps.find((step) => step.nodeId === nodeId);
            const rightStep = b.steps.find((step) => step.nodeId === nodeId);
            return <tr key={nodeId}><td>{leftStep?.name ?? rightStep?.name ?? nodeId}</td><td><StatusPill value={leftStep?.status ?? "absent"} /></td><td><StatusPill value={rightStep?.status ?? "absent"} /></td></tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}

function RunColumn({ run }: { run: Awaited<ReturnType<typeof getRun>> }) {
  const cost = run.aiRequests.reduce((sum, request) => sum + (request.costUsd ? Number(request.costUsd) : 0), 0);
  const unknown = run.aiRequests.filter((request) => !request.costUsd).length;
  return (
    <article className="panel">
      <Link href={`/runs/${run.id}`}>{run.id}</Link>
      <p><StatusPill value={run.outcome ?? run.status} /></p>
      <p className="mono">Duration {run.durationMs ?? "—"} ms</p>
      <p className="mono">Recoveries {run.recoveries.length}</p>
      <p className="mono">Known AI cost {cost.toFixed(6)} · {unknown} unpriced</p>
      <p>{run.errorSummary}</p>
    </article>
  );
}
