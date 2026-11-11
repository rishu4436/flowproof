import Link from "next/link";
import { prisma, DEMO_WORKSPACE_ID } from "@flowproof/database";
import { StatusPill } from "@/components/proof";

export const dynamic = "force-dynamic";

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type = "runs" } = await searchParams;
  const runs = type === "runs" || type === "failed" ? await prisma.run.findMany({ where: { workspaceId: DEMO_WORKSPACE_ID, ...(type === "failed" ? { status: "FAILED" } : {}) }, orderBy: { createdAt: "desc" }, take: 50, include: { workflow: true } }) : [];
  const recoveries = type === "recoveries" ? await prisma.recoveryAttempt.findMany({ orderBy: { createdAt: "desc" }, take: 50 }) : [];
  const approvals = type === "approvals" ? await prisma.approval.findMany({ orderBy: { createdAt: "desc" }, take: 50 }) : [];
  const ai = type === "otari" ? await prisma.aIRequest.findMany({ orderBy: { createdAt: "desc" }, take: 50 }) : [];
  const audit = type === "audit" ? await prisma.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: 50 }) : [];
  const tabs = ["runs", "failed", "recoveries", "approvals", "otari", "audit"];
  return (
    <div className="page">
      <div className="kicker">Observability</div>
      <h1>Activity</h1>
      <div className="row">{tabs.map((tab) => <Link key={tab} className={`btn ${type === tab ? "primary" : ""}`} href={`/activity?type=${tab}`}>{tab}</Link>)}</div>
      <div className="panel" style={{ marginTop: 12 }}>
        {runs.map((run) => <p key={run.id}><Link href={`/runs/${run.id}`}>{run.workflow.name}</Link> <StatusPill value={run.outcome ?? run.status} /> <span className="mono">{run.createdAt.toLocaleString()}</span></p>)}
        {recoveries.map((item) => <p key={item.id}><Link href={`/runs/${item.runId}`}>{item.failureCategory}</Link> · {item.source} · {item.result ?? item.approvalState}</p>)}
        {approvals.map((item) => <p key={item.id}>{item.scope} · {item.decision} {item.runId ? <Link href={`/runs/${item.runId}`}>run</Link> : null}</p>)}
        {ai.map((item) => <p key={item.id} className="mono">{item.runId ? <Link href={`/runs/${item.runId}`}>{item.role}</Link> : item.role} · {item.requestedModel} · {item.otariRequestId ?? "no request id"} · {item.costUsd ?? "cost not reported"}</p>)}
        {audit.map((item) => <p key={item.id}>{item.action} · {item.targetType === "run" ? <Link href={`/runs/${item.targetId}`}>{item.targetId}</Link> : <span className="mono">{item.targetId}</span>}</p>)}
        {runs.length + recoveries.length + approvals.length + ai.length + audit.length === 0 ? <p className="empty">Nothing recorded for this view.</p> : null}
      </div>
    </div>
  );
}
