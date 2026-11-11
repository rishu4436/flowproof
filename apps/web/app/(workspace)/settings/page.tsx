"use client";

import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    fetch("/api/settings").then((response) => response.json()).then(setSettings).catch(() => setMessage("Settings could not be loaded."));
  }, []);
  if (!settings) return <div className="page"><p>Loading settings…</p></div>;
  const general = settings.general as { workspaceName: string; timezone: string; theme: string };
  const execution = settings.execution as { defaultTimeoutMs: number; maxSteps: number; requireApprovalBeforeWrite: boolean; autoApproveSafeLocatorRepair: boolean };
  const ai = settings.ai as { primaryModel: string; repairModel: string; reviewModel: string; perRunBudgetUsd: number; maxRepairAttempts: number };
  const notifications = settings.notifications as { webhookUrl: string };
  return (
    <div className="page">
      <div className="kicker">Workspace</div>
      <h1>Settings</h1>
      <form className="panel stack" onSubmit={async (event) => {
        event.preventDefault();
        const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
        const body = await response.json();
        if (!response.ok) { setMessage(body.error?.message ?? "Settings were rejected."); return; }
        setSettings(body);
        setMessage("Settings saved. Server safety caps still win over higher values.");
      }}>
        <label className="field">Workspace name<input value={general.workspaceName} onChange={(event) => setSettings({ ...settings, general: { ...general, workspaceName: event.target.value } })} /></label>
        <label className="field">Timezone<input value={general.timezone} onChange={(event) => setSettings({ ...settings, general: { ...general, timezone: event.target.value } })} /></label>
        <label className="field">Theme
          <select value={general.theme} onChange={(event) => setSettings({ ...settings, general: { ...general, theme: event.target.value } })}>
            <option value="studio">Studio</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="field">Default timeout (ms)<input type="number" value={execution.defaultTimeoutMs} onChange={(event) => setSettings({ ...settings, execution: { ...execution, defaultTimeoutMs: Number(event.target.value) } })} /></label>
        <label className="field">Max steps<input type="number" value={execution.maxSteps} onChange={(event) => setSettings({ ...settings, execution: { ...execution, maxSteps: Number(event.target.value) } })} /></label>
        <label className="row"><input type="checkbox" checked={execution.requireApprovalBeforeWrite} onChange={(event) => setSettings({ ...settings, execution: { ...execution, requireApprovalBeforeWrite: event.target.checked } })} /> Require approval before a write</label>
        <label className="row"><input type="checkbox" checked={execution.autoApproveSafeLocatorRepair} onChange={(event) => setSettings({ ...settings, execution: { ...execution, autoApproveSafeLocatorRepair: event.target.checked } })} /> Auto-approve safe locator repairs</label>
        <label className="field">Primary model<input value={ai.primaryModel} onChange={(event) => setSettings({ ...settings, ai: { ...ai, primaryModel: event.target.value } })} /></label>
        <label className="field">Repair model<input value={ai.repairModel} onChange={(event) => setSettings({ ...settings, ai: { ...ai, repairModel: event.target.value } })} /></label>
        <label className="field">Review model<input value={ai.reviewModel} onChange={(event) => setSettings({ ...settings, ai: { ...ai, reviewModel: event.target.value } })} /></label>
        <label className="field">Per-run AI budget (USD)<input type="number" step="0.01" value={ai.perRunBudgetUsd} onChange={(event) => setSettings({ ...settings, ai: { ...ai, perRunBudgetUsd: Number(event.target.value) } })} /></label>
        <label className="field">Repair attempts (max 2)<input type="number" value={ai.maxRepairAttempts} onChange={(event) => setSettings({ ...settings, ai: { ...ai, maxRepairAttempts: Number(event.target.value) } })} /></label>
        <label className="field">Webhook URL<input value={notifications.webhookUrl} onChange={(event) => setSettings({ ...settings, notifications: { ...notifications, webhookUrl: event.target.value } })} placeholder="http://127.0.0.1:4100/api/hooks/flowproof" /></label>
        {message ? <p>{message}</p> : null}
        <div className="row">
          <button className="btn primary" type="submit">Save settings</button>
          <button className="btn" type="button" onClick={() => fetch("/api/settings").then((response) => response.json()).then(setSettings)}>Reload</button>
        </div>
      </form>
      <section className="panel" style={{ marginTop: 12 }}>
        <h2>Danger zone</h2>
        <p className="lede">Reset clears synthetic portal invoices and returns scenario A. Approved workflows stay.</p>
        <button className="btn danger" onClick={async () => {
          if (!window.confirm("Reset Northstar demo data?")) return;
          const response = await fetch("/api/demo/reset", { method: "POST" });
          setMessage(response.ok ? "Demo data reset." : "Reset failed.");
        }}>Reset demo data</button>
      </section>
    </div>
  );
}
