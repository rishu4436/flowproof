"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewWorkflowPage() {
  const router = useRouter();
  const [name, setName] = useState("Untitled workflow");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="page">
      <div className="kicker">Library</div>
      <h1>New workflow</h1>
      <form className="panel stack" onSubmit={async (event) => {
        event.preventDefault();
        const response = await fetch("/api/workflows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description, category: "general" }) });
        const body = await response.json();
        if (!response.ok) { setError(body.error?.message ?? "Could not create the workflow."); return; }
        router.push(`/workflows/${body.id}`);
      }}>
        <label className="field">Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="field">Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        {error ? <p>{error}</p> : null}
        <button className="btn primary" type="submit">Create draft</button>
      </form>
    </div>
  );
}
