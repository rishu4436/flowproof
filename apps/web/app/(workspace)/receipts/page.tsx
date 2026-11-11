import Link from "next/link";
import { listReceipts } from "@/server/runs";
import { StatusPill } from "@/components/proof";

export const dynamic = "force-dynamic";

export default async function ReceiptsPage() {
  const receipts = await listReceipts();
  return (
    <div className="page">
      <div className="kicker">Evidence</div>
      <h1>Outcome Receipts</h1>
      <div className="panel">
        {receipts.length === 0 ? <p className="empty">Receipts are created only after a run reaches verification.</p> : (
          <table className="table">
            <thead><tr><th>Receipt</th><th>Decision</th><th>Objective</th><th>When</th></tr></thead>
            <tbody>
              {receipts.map((receipt) => (
                <tr key={receipt.id}>
                  <td className="mono"><Link href={`/receipts/${receipt.id}`}>{receipt.id}</Link></td>
                  <td><StatusPill value={receipt.decision} /></td>
                  <td>{receipt.run.objective}</td>
                  <td className="mono">{receipt.createdAt.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
