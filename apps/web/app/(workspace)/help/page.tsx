import Link from "next/link";

const articles = [
  ["promise", "What FlowProof proves", "A browser action, a success message, and a saved business record are three different facts."],
  ["demo", "Run the invoice demo", "Open Demo Lab, choose scenario A, and start the vendor invoice workflow. The receipt appears after verification."],
  ["false-success", "False success", "Scenario E shows a success message and does not store the invoice. The authoritative check must fail."],
  ["recovery", "Recovery", "A changed label fails the original target. FlowProof can repair only a visible, authorized target. Otari is used when configured."],
  ["otari", "Connect Otari", "The Models page runs live Otari calls: three open-weight roles, a refused-model fallback, web search, web fetch, code execution, Qwen3Guard, the spend ceiling, and the invoice lookup tool. Each row keeps the request id and cost the gateway returned."],
  ["safety", "Safety limits", "Automation stays on the allowlisted demo origin. Uncertain writes are not submitted again."],
];

export default function HelpPage() {
  return (
    <div className="page">
      <div className="kicker">Documentation</div>
      <h1>Help</h1>
      <div className="cards">
        {articles.map(([slug, title, body]) => (
          <article key={slug} className="panel" id={slug}>
            <h2>{title}</h2>
            <p>{body}</p>
          </article>
        ))}
      </div>
      <p style={{ marginTop: 16 }}><Link href="/demo">Go to Demo Lab</Link></p>
    </div>
  );
}
