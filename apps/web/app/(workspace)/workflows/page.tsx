import Link from "next/link";
import { listWorkflows } from "@/server/workflows";
import { StatusPill } from "@/components/proof";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const workflows = await listWorkflows(new URL(`http://flowproof.local/workflows?${query.toString()}`));
  return (
    <div className="page">
      <div className="spread">
        <div>
          <div className="kicker">Library</div>
          <h1>Workflows</h1>
        </div>
        <form className="row" action="/workflows">
          <input name="q" defaultValue={params.q} placeholder="Search" aria-label="Search workflows" />
          <select name="category" defaultValue={params.category ?? ""} aria-label="Category">
            <option value="">All categories</option>
            <option value="finance">Finance</option>
            <option value="operations">Operations</option>
          </select>
          <select name="status" defaultValue={params.status ?? ""} aria-label="Status">
            <option value="">Active and draft</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
          <button className="btn">Filter</button>
          <Link className="btn primary" href="/workflows/new">New workflow</Link>
        </form>
      </div>
      <div className="panel">
        {workflows.length === 0 ? <p className="empty">No workflows match. <Link href="/demo">Create the invoice demo.</Link></p> : (
          <table className="table">
            <thead><tr><th>Name</th><th>Category</th><th>Version</th><th>Status</th><th>Last outcome</th><th>Verification</th><th></th></tr></thead>
            <tbody>
              {workflows.map((workflow) => (
                <tr key={workflow.id}>
                  <td><Link href={`/workflows/${workflow.id}`}>{workflow.name}</Link><div className="lede">{workflow.description}</div></td>
                  <td>{workflow.category}</td>
                  <td className="mono">v{workflow.version}</td>
                  <td><StatusPill value={workflow.status} /></td>
                  <td><StatusPill value={workflow.lastRun?.outcome ?? workflow.lastRun?.status ?? "none"} /></td>
                  <td className="mono">{workflow.verificationRate == null ? "No sample" : `${Math.round(workflow.verificationRate * 100)}% of ${workflow.sampleSize}`}</td>
                  <td className="row"><Link href={`/runs?workflowId=${workflow.id}`}>History</Link><a href={`/api/workflows/${workflow.id}`}>Export</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
