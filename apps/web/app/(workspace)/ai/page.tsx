"use client";

import { useEffect, useState } from "react";
import { StatusPill } from "@/components/proof";

interface CallView {
  role: string;
  requestedModel: string;
  servedModel: string | null;
  requestId: string | null;
  costUsd: string | null;
  attemptCount: number | null;
  fallback: boolean | null;
  content: string;
  gatewayTools: Array<{ id: string; type: string; status: string; query?: string; url?: string; stdout?: string; output?: string; name?: string; sources?: Array<{ url?: string; title?: string }> }>;
  error?: string;
}

interface CapabilityResult {
  kind: string;
  ok: boolean;
  summary: string;
  calls: CallView[];
  notes: string[];
}

const STEPS: Array<{ kind: string; title: string; detail: string }> = [
  { kind: "catalog", title: "1. What this key can run", detail: "Reads Otari's tool list, guardrail profiles, and stored MCP servers. No model call." },
  { kind: "roles", title: "2. Three open-weight roles", detail: "Qwen plans, Gemma proposes a repair, Llama reviews. Verification is still deterministic." },
  { kind: "fallback", title: "3. Fallback after a refusal", detail: "Asks for a model id Otari does not have, then sends the job to Qwen." },
  { kind: "search", title: "4. Web search", detail: "Asks Qwen to search. Counts only if Otari reports a completed search." },
  { kind: "fetch", title: "5. Web fetch", detail: "Asks Qwen to fetch https://otari.ai through Otari." },
  { kind: "code", title: "6. Code execution", detail: "Asks Qwen to run print(23*19) in Otari's sandbox." },
  { kind: "guardrail", title: "7. Guard model", detail: "Sends a normal invoice sentence and a skip-verification instruction to Qwen3Guard." },
  { kind: "budget", title: "8. Spend ceiling", detail: "Shows the Otari key budget and refuses another call when known spend is above $0.000001." },
  { kind: "mcp", title: "9. Invoice lookup tool", detail: "Asks Otari to call this site's read-only lookup for INV-1000." },
];

export default function AiPage() {
  const [health, setHealth] = useState<{ status: string; message: string; models: string[] } | null>(null);
  const [usage, setUsage] = useState<{ summary?: { knownUsd: string; knownCount: number; unknownCount: number }; items?: Array<{ id: string; role: string; requestedModel: string; otariRequestId: string | null; costUsd: string | null; status: string; latencyMs: number | null }> } | null>(null);
  const [message, setMessage] = useState("");
  const [models, setModels] = useState<{ primaryModel: string; repairModel: string; reviewModel: string } | null>(null);
  const [results, setResults] = useState<Record<string, CapabilityResult>>({});
  const [running, setRunning] = useState<string | null>(null);
  async function load() {
    const [healthResponse, usageResponse, settingsResponse] = await Promise.all([fetch("/api/ai/health"), fetch("/api/ai/usage"), fetch("/api/settings")]);
    setHealth(await healthResponse.json());
    setUsage(await usageResponse.json());
    const settings = await settingsResponse.json();
    setModels(settings.ai ?? null);
  }
  useEffect(() => { void load(); }, []);

  async function run(kind: string) {
    setRunning(kind);
    const response = await fetch("/api/ai/capability", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
    const body = await response.json();
    setResults((current) => ({ ...current, [kind]: body }));
    setRunning(null);
    void load();
  }

  async function saveRoles() {
    const settingsResponse = await fetch("/api/settings");
    const settings = await settingsResponse.json();
    settings.ai.primaryModel = "alibaba/qwen3-30b-a3b";
    settings.ai.repairModel = "google/gemma-3-12b-it";
    settings.ai.reviewModel = "meta/llama-3.1-8b-instruct";
    const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
    setMessage(response.ok ? "Saved primary Qwen, repair Gemma, and review Llama for the worker." : "The role settings were not saved.");
    void load();
  }

  return (
    <div className="page">
      <div className="kicker">Mozilla Otari</div>
      <h1>Models</h1>
      {health ? <p><StatusPill value={health.status} /> {health.message}</p> : <p>Checking the gateway…</p>}
      <p className="lede">Click the steps in order while you record. Each model step is a real Otari call. The page shows the request id, served model, and cost only when Otari returns them.</p>
      <div className="grid-metrics">
        <div className="metric"><span className="kicker">Primary</span><b style={{ fontSize: 14 }}>{models?.primaryModel || "Not selected"}</b></div>
        <div className="metric"><span className="kicker">Repair</span><b style={{ fontSize: 14 }}>{models?.repairModel || "Not selected"}</b></div>
        <div className="metric"><span className="kicker">Review</span><b style={{ fontSize: 14 }}>{models?.reviewModel || "Not selected"}</b></div>
      </div>
      <p><button className="btn" onClick={() => void saveRoles()}>Use Qwen, Gemma, and Llama as the three roles</button></p>
      {STEPS.map((step) => {
        const result = results[step.kind];
        return (
          <article key={step.kind} className="panel" style={{ marginTop: 12 }}>
            <h2>{step.title}</h2>
            <p>{step.detail}</p>
            <button className="btn primary" disabled={running !== null || health?.status !== "connected"} onClick={() => void run(step.kind)}>
              {running === step.kind ? "Running on Otari…" : "Run this step"}
            </button>
            {result ? (
              <div style={{ marginTop: 12 }}>
                <p><StatusPill value={result.ok ? "completed" : "failed"} /> {result.summary}</p>
                {result.notes.map((note) => <p key={note}>{note}</p>)}
                {result.calls.map((call) => (
                  <div key={`${call.role}-${call.requestId ?? call.error ?? "row"}`} style={{ marginTop: 8 }}>
                    <p className="mono">{call.role} · requested {call.requestedModel} · served {call.servedModel ?? "unreported"} · {call.requestId ?? "no request id"} · cost {call.costUsd ?? "not reported"} · attempts {call.attemptCount ?? "unreported"} · fallback {call.fallback === null ? "unreported" : String(call.fallback)}</p>
                    {call.error ? <p>{call.error}</p> : null}
                    {call.content ? <p>{call.content}</p> : null}
                    {call.gatewayTools.map((tool) => (
                      <p key={tool.id} className="mono">{tool.type} {tool.status}{tool.name ? ` ${tool.name}` : ""}{tool.query ? ` query ${tool.query}` : ""}{tool.stdout ? ` stdout ${tool.stdout.trim()}` : ""}{tool.output ? ` output ${tool.output.slice(0, 300)}` : ""}{tool.sources?.length ? ` sources ${tool.sources.map((source) => source.url).filter(Boolean).join(", ")}` : ""}</p>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        );
      })}
      <div className="panel" style={{ marginTop: 12 }}>
        <h2>Connection check</h2>
        <button className="btn" disabled={!health || health.status !== "connected" || running !== null} onClick={async () => {
          const response = await fetch("/api/ai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: models?.primaryModel || health?.models?.[0] }) });
          const body = await response.json();
          setMessage(response.ok ? `Request ${body.requestId ?? "without an id"} served by ${body.servedModel ?? "unreported model"}. Cost ${body.usage?.costUsd ?? "not reported"}.` : body.error?.message);
          void load();
        }}>Test connection</button>
        {message ? <p>{message}</p> : null}
      </div>
      <div className="panel" style={{ marginTop: 12 }}>
        <h2>Recorded usage</h2>
        <p className="mono">Known cost {usage?.summary?.knownUsd ?? "0.000000"} from {usage?.summary?.knownCount ?? 0} priced calls. {usage?.summary?.unknownCount ?? 0} calls did not report cost.</p>
        <table className="table">
          <tbody>
            {(usage?.items ?? []).slice(0, 12).map((item) => (
              <tr key={item.id}><td>{item.role}</td><td className="mono">{item.requestedModel}</td><td className="mono">{item.otariRequestId ?? "—"}</td><td className="mono">{item.costUsd ?? "not reported"}</td><td>{item.status}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
