import Link from "next/link";
import { listRuns } from "@/server/runs";
import { StatusPill } from "@/components/proof";

export const dynamic = "force-dynamic";

export default async function RunsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const data = await listRuns(new URL(`http://flowproof.local/runs?${query.toString()}`));
  return (
    <div className="page">
      <div className="kicker">History</div>
      <h1>Runs</h1>
      <form className="row" action="/runs">
        <input name="workflowId" defaultValue={params.workflowId} placeholder="Workflow id" aria-label="Workflow id" />
        <select name="status" defaultValue={params.status ?? ""} aria-label="Status">
          <option value="">Any status</option>
          {["QUEUED", "RUNNING", "PAUSED_FOR_APPROVAL", "VERIFYING", "VERIFIED", "FAILED", "UNVERIFIED", "OUTCOME_UNKNOWN", "BLOCKED", "CANCELLED"].map((status) => <option key={status}>{status}</option>)}
        </select>
        <button className="btn">Filter</button>
      </form>
      <div className="panel">
        {data.items.length === 0 ? <p className="empty">No runs yet.</p> : (
          <table className="table">
            <thead><tr><th>Run</th><th>Workflow</th><th>Status</th><th>When</th><th></th></tr></thead>
            <tbody>
              {data.items.map((run) => (
                <tr key={run.id}>
                  <td className="mono"><Link href={`/runs/${run.id}`}>{run.id}</Link></td>
                  <td>{run.workflow.name}</td>
                  <td><StatusPill value={run.outcome ?? run.status} /></td>
                  <td className="mono">{run.createdAt.toLocaleString()}</td>
                  <td>{run.receipt ? <Link href={`/receipts/${run.receipt.id}`}>Receipt</Link> : "No receipt"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="lede">{data.total} runs. Compare two by opening /runs/compare?left=&right=.</p>
      </div>
    </div>
  );
}
