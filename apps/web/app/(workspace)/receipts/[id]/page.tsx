import Link from "next/link";
import { notFound } from "next/navigation";
import { getReceipt } from "@/server/runs";
import { StatusPill, VerificationMatrix } from "@/components/proof";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const receipt = await getReceipt(id);
    const canonical = receipt.canonical as {
      objective?: string;
      requested?: Record<string, string>;
      observed?: Record<string, string>;
      verified?: Record<string, string>;
      uncertainties?: string[];
      decisionNote?: string;
      integrity?: { statement?: string };
      models?: Array<{ role: string; requestedModel: string; otariRequestId: string | null; costUsd: string | null }>;
    };
    return (
      <div className="page">
        <div className="spread">
          <div>
            <div className="kicker">Outcome Receipt</div>
            <h1 className="mono" style={{ fontSize: 22 }}>{receipt.id}</h1>
          </div>
          <StatusPill value={receipt.decision} />
        </div>
        <p>{canonical.objective}</p>
        {canonical.decisionNote ? <p className="panel">{canonical.decisionNote}</p> : null}
        {(canonical.uncertainties ?? []).map((item) => <p key={item} className="panel">{item}</p>)}
        <p className={`pill ${receipt.hashMatches ? "verified" : "failed"}`}>{receipt.hashMatches ? "Canonical hash matches" : "Canonical hash does not match"}</p>
        <div className="split" style={{ marginTop: 12 }}>
          <section className="panel"><h2>Expected state</h2><Fields record={canonical.requested} /></section>
          <section className="panel"><h2>Verified state</h2><Fields record={canonical.verified} /></section>
        </div>
        <section className="panel" style={{ marginTop: 12 }}>
          <h2>Verification matrix</h2>
          <VerificationMatrix rows={receipt.run.checks} />
        </section>
        <section className="panel" style={{ marginTop: 12 }}>
          <h2>Evidence</h2>
          <div className="cards">
            {receipt.run.artifacts.map((artifact) => (
              <a key={artifact.id} href={`/api/runs/${receipt.runId}/artifacts/${artifact.id}`}>
                <img src={`/api/runs/${receipt.runId}/artifacts/${artifact.id}`} alt={artifact.label ?? "Screenshot"} style={{ width: "100%", borderRadius: 8 }} />
                <span className="mono">{artifact.capturedAt.toLocaleString()}</span>
              </a>
            ))}
          </div>
        </section>
        <section className="panel" style={{ marginTop: 12 }}>
          <h2>Model calls</h2>
          {canonical.models?.length ? canonical.models.map((model, index) => (
            <p key={`${model.role}-${index}`} className="mono">{model.role} · {model.requestedModel} · {model.otariRequestId ?? "no request id"} · {model.costUsd ?? "cost not reported"}</p>
          )) : <p>No Otari calls were recorded for this run.</p>}
          <p className="lede">{canonical.integrity?.statement}</p>
          <p className="mono">{receipt.integrityHash}</p>
          <div className="row">
            <a className="btn" href={`/api/receipts/${receipt.id}/export?format=json`}>Download JSON</a>
            <a className="btn" href={`/api/receipts/${receipt.id}/export?format=pdf`}>Download PDF</a>
            <Link className="btn" href={`/runs/${receipt.runId}`}>Open investigation</Link>
          </div>
        </section>
      </div>
    );
  } catch {
    notFound();
  }
}

function Fields({ record }: { record?: Record<string, string> }) {
  if (!record || Object.keys(record).length === 0) return <p>No values.</p>;
  return <div>{Object.entries(record).map(([key, value]) => <p key={key}><span className="kicker">{key}</span><br />{value || "—"}</p>)}</div>;
}
