import Link from "next/link";
import { dateRange } from "@/server/http";
import { overview } from "@/server/analytics";
import { DistributionChart, TrendChart } from "@/components/charts";
import { StatusPill } from "@/components/proof";

export const dynamic = "force-dynamic";

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const range = dateRange(new URL(`http://flowproof.local/overview?${query.toString()}`));
  const data = await overview(range.from, range.to);
  const filters = ["24h", "7d", "30d"];
  return (
    <div className="page">
      <div className="spread">
        <div>
          <div className="kicker">Operations</div>
          <h1>Overview</h1>
          <p className="lede">Counts come from stored runs. An empty chart means the workspace has not executed anything in this range.</p>
        </div>
        <div className="row">
          {filters.map((item) => (
            <Link key={item} className={`btn ${range.range === item ? "primary" : ""}`} href={`/overview?range=${item}`}>{item}</Link>
          ))}
          <Link className="btn primary" href="/demo">Open Demo Lab</Link>
        </div>
      </div>
      <div className="grid-metrics">
        <Metric label="Workflows" value={data.workflows} />
        <Metric label="Runs" value={data.runs} />
        <Metric label="Verified" value={data.verified} />
        <Metric label="Failed" value={data.failed} />
        <Metric label="Unverified" value={data.unverified} />
        <Metric label="Blocked" value={data.blocked} />
        <Metric label="Unknown" value={data.unknown} />
        <Metric label="Cancelled" value={data.cancelled} />
        <Metric label="Recoveries" value={data.recoveryAttempts} />
        <Metric label="Recovery rate" value={data.recoverySuccessRate == null ? "—" : `${Math.round(data.recoverySuccessRate * 100)}%`} />
        <Metric label="Avg duration" value={data.averageDurationMs == null ? "—" : `${(data.averageDurationMs / 1000).toFixed(1)}s`} />
      </div>
      <div className="split" style={{ marginTop: 12 }}>
        <section className="panel">
          <h2>Execution trend</h2>
          <TrendChart data={data.trend} />
        </section>
        <section className="panel">
          <h2>Outcome distribution</h2>
          <DistributionChart data={data.distribution} />
        </section>
      </div>
      <div className="split" style={{ marginTop: 12 }}>
        <section className="panel">
          <h2>Reliability by workflow</h2>
          {data.reliability.length === 0 ? <p className="empty">Run a workflow to measure it.</p> : (
            <table className="table">
              <thead><tr><th>Workflow</th><th>Sample</th><th>Verified</th><th>Rate</th></tr></thead>
              <tbody>
                {data.reliability.map((item) => (
                  <tr key={item.id}><td><Link href={`/workflows/${item.id}`}>{item.name}</Link></td><td className="mono">{item.total}</td><td className="mono">{item.verified}</td><td className="mono">{item.rate == null ? "—" : `${Math.round(item.rate * 100)}%`}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="panel">
          <h2>Recent runs</h2>
          {data.recent.length === 0 ? <p className="empty">No runs in this range. <Link href="/demo">Start the invoice demo.</Link></p> : (
            <table className="table">
              <tbody>
                {data.recent.map((run) => (
                  <tr key={run.id}><td><Link href={`/runs/${run.id}`}>{run.workflow}</Link></td><td><StatusPill value={run.outcome ?? run.status} /></td><td className="mono">{new Date(run.createdAt).toLocaleString()}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="lede" style={{ marginTop: 12 }}>Otari requests in range: {data.otariRequests}. Known cost {data.aiCost.knownUsd} USD across {data.aiCost.knownCount} priced calls. {data.aiCost.unknownCount} calls have no reported cost.</p>
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="metric"><span className="kicker">{label}</span><b>{value}</b></div>;
}
