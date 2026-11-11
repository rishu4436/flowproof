export function StatusPill({ value }: { value?: string | null }) {
  const status = (value ?? "unknown").toLowerCase();
  const tone = status.includes("verified") ? "verified" : status.includes("fail") || status.includes("block") ? "failed" : status.includes("unknown") || status.includes("unverified") || status.includes("paused") ? "unknown" : "neutral";
  return <span className={`pill ${tone}`}>{value ?? "Unknown"}</span>;
}

export function ProofRail({ stages }: { stages: Array<{ name: string; state: "done" | "bad" | "wait" | "idle"; detail?: string }> }) {
  return (
    <div className="proof-rail" aria-label="Proof rail">
      {stages.map((stage) => (
        <div key={stage.name} className={`stage ${stage.state}`}>
          <div className="kicker">{stage.name}</div>
          <div>{stage.detail ?? "Waiting"}</div>
        </div>
      ))}
    </div>
  );
}

export function VerificationMatrix({ rows }: { rows: Array<{ name: string; expected?: unknown; observed?: unknown; source?: string; result?: string; authoritative?: boolean }> }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Requirement</th>
          <th>Expected</th>
          <th>Observed</th>
          <th>Evidence</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name}>
            <td>{row.name}{row.authoritative ? "" : " · supporting"}</td>
            <td className="mono">{preview(row.expected)}</td>
            <td className="mono">{preview(row.observed)}</td>
            <td>{row.source}</td>
            <td><StatusPill value={row.result} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RecoveryDiff({ recovery }: { recovery: { diagnosis?: string; uncertainty?: string | null; approvalState?: string; changesWriteBehavior?: boolean; source?: string; proposal?: unknown } }) {
  const proposal = recovery.proposal as { name?: string; label?: string; type?: string } | undefined;
  return (
    <div className="panel">
      <div className="split">
        <div>
          <div className="kicker">Failed action</div>
          <p>{recovery.diagnosis}</p>
        </div>
        <div>
          <div className="kicker">Proposed repair</div>
          <p className="mono">{proposal?.type} {proposal?.name || proposal?.label || "No target"}</p>
        </div>
      </div>
      <p className="lede">{recovery.uncertainty}</p>
      <div className="row">
        <StatusPill value={recovery.approvalState} />
        <span className="mono">{recovery.source}</span>
        {recovery.changesWriteBehavior ? <span className="pill unknown">Changes write behavior</span> : <span className="pill neutral">Same authorized values</span>}
      </div>
    </div>
  );
}

function preview(value: unknown) {
  if (!value || typeof value !== "object") return "—";
  return Object.entries(value as Record<string, unknown>)
    .slice(0, 4)
    .map(([key, item]) => `${key}: ${String(item)}`)
    .join(" · ");
}
