import { systemHealth } from "@/server/analytics";
import { StatusPill } from "@/components/proof";
import { prisma } from "@flowproof/database";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const health = await systemHealth();
  const artifacts = await prisma.runArtifact.aggregate({ _sum: { byteSize: true }, _count: true });
  const items = [
    ["Mozilla Otari", health.otari, "Server-side inference. The key stays in the environment."],
    ["Local browser runtime", health.worker, "Playwright heartbeat. Offline means the worker process is not updating."],
    ["Northstar Vendor Portal", health.portal, "Synthetic billing target on the loopback interface."],
    ["Local artifact storage", "local", `${artifacts._count} screenshots, ${artifacts._sum.byteSize ?? 0} bytes.`],
    ["Database", health.database, "PostgreSQL connectivity from this request."],
    ["Queue", health.queue, `${health.pendingJobs ?? 0} pending or running jobs.`],
  ] as const;
  return (
    <div className="page">
      <div className="kicker">Connections</div>
      <h1>Integrations</h1>
      <div className="cards">
        {items.map(([name, status, detail]) => (
          <article key={name} className="panel"><div className="spread"><h2>{name}</h2><StatusPill value={status} /></div><p>{detail}</p></article>
        ))}
      </div>
      <section className="panel" style={{ marginTop: 12 }}>
        <h2>Not connected</h2>
        <p>Hosted single sign-on, external customer domains, and cloud artifact buckets are not implemented. They are not shown as active integrations.</p>
      </section>
    </div>
  );
}
