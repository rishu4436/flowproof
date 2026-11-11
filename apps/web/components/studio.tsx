"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRouter } from "next/navigation";

const palette = ["open_website", "locate", "click", "type", "select", "extract", "wait_for", "branch", "validate_field", "verify_outcome", "approval", "ai_recovery", "end"];

function StepNode({ data, selected }: NodeProps) {
  const issues = (data.issues as string[] | undefined) ?? [];
  return (
    <div className={`fp-node ${selected ? "is-selected" : ""} ${issues.length ? "is-bad" : ""}`}>
      <Handle type="target" position={Position.Top} />
      <small>{String(data.actionType ?? data.type ?? "")}</small>
      <strong>{String(data.name ?? "Step")}</strong>
      {issues[0] ? <small>{issues[0]}</small> : null}
      {data.actionType === "branch" || data.type === "branch" ? (
        <>
          <Handle id="true" type="source" position={Position.Bottom} style={{ left: "30%" }} />
          <Handle id="false" type="source" position={Position.Bottom} style={{ left: "70%" }} />
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} />
      )}
    </div>
  );
}

export function Studio({ workflow }: { workflow: { id: string; name: string; description: string; category: string; status: string; activeVersion: number; versions: Array<{ version: number; approved: boolean; definition: { nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>; edges: Edge[] }; inputSchema: { fields?: Array<{ key: string; label: string; type: string; required: boolean; defaultValue?: string; options?: string[] }> }; verificationPolicy: unknown }> } }) {
  const version = workflow.versions.find((item) => !item.approved) ?? workflow.versions[0];
  const initialNodes: Node[] = (version?.definition.nodes ?? []).map((node) => ({
    id: node.id,
    type: "step",
    position: node.position,
    data: { ...node.data, actionType: node.type, type: node.type },
  }));
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(version?.definition.edges ?? []);
  const [selected, setSelected] = useState<string | null>(initialNodes[0]?.id ?? null);
  const [history, setHistory] = useState<Array<{ nodes: Node[]; edges: Edge[] }>>([]);
  const [future, setFuture] = useState<Array<{ nodes: Node[]; edges: Edge[] }>>([]);
  const [message, setMessage] = useState("");
  const [objective, setObjective] = useState(workflow.description);
  const [running, setRunning] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries((version?.inputSchema.fields ?? []).map((field) => [field.key, field.defaultValue ?? ""])));
  const router = useRouter();
  const nodeTypes = useMemo(() => ({ step: StepNode }), []);
  const current = nodes.find((node) => node.id === selected);

  const snapshot = useCallback(() => {
    setHistory((items) => [...items.slice(-40), { nodes, edges }]);
    setFuture([]);
  }, [nodes, edges]);

  const onConnect = useCallback((connection: Connection) => {
    snapshot();
    setEdges((items) => addEdge({ ...connection, id: `e_${connection.source}_${connection.target}_${connection.sourceHandle ?? "next"}` }, items));
  }, [setEdges, snapshot]);

  function definition() {
    return {
      nodes: nodes.map((node) => ({
        id: node.id,
        type: String(node.data.actionType ?? node.data.type),
        position: node.position,
        data: { ...node.data, name: String(node.data.name ?? "Step") },
      })),
      edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, ...(edge.sourceHandle === "true" || edge.sourceHandle === "false" ? { sourceHandle: edge.sourceHandle } : {}) })),
    };
  }

  async function save(approve = false) {
    setMessage("");
    const response = await fetch(`/api/workflows/${workflow.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ definition: definition(), verificationPolicy: version?.verificationPolicy, inputSchema: version?.inputSchema }),
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error?.message ?? "Save failed");
      return;
    }
    if (approve) {
      const approved = await fetch(`/api/workflows/${workflow.id}/versions`, { method: "POST" });
      const approvedBody = await approved.json();
      if (!approved.ok) {
        const issue = approvedBody.error?.details?.[0]?.message ?? approvedBody.error?.message;
        setMessage(issue ?? "Approval failed");
        return;
      }
    }
    setMessage(approve ? "Approved version saved." : "Draft saved.");
    router.refresh();
  }

  async function plan() {
    setMessage("");
    const response = await fetch("/api/workflows/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objective, save: false }),
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error?.message ?? "AI planning is unavailable.");
      return;
    }
    snapshot();
    setNodes(body.definition.nodes.map((node: { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }) => ({ id: node.id, type: "step", position: node.position, data: { ...node.data, actionType: node.type } })));
    setEdges(body.definition.edges);
    setMessage(body.issues?.length ? "Otari returned a graph with validation issues. Review them before approval." : "Otari returned a graph. Approve it before running.");
  }

  async function run() {
    setRunning(true);
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowId: workflow.id, objective, requestedValues: values }),
    });
    const body = await response.json();
    setRunning(false);
    if (!response.ok) {
      setMessage(body.error?.message ?? "Run was not queued.");
      return;
    }
    router.push(`/runs/${body.id}`);
  }

  function updateSelected(patch: Record<string, unknown>) {
    if (!current) return;
    snapshot();
    setNodes((items) => items.map((node) => node.id === current.id ? { ...node, data: { ...node.data, ...patch } } : node));
  }

  return (
    <div>
      <div className="topbar" style={{ position: "static" }}>
        <input aria-label="Automation objective" value={objective} onChange={(event) => setObjective(event.target.value)} style={{ flex: 1, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", background: "var(--card)" }} />
        <button className="btn" onClick={plan}>Plan with Otari</button>
        <button className="btn" onClick={() => save(false)}>Save draft</button>
        <button className="btn" onClick={() => save(true)}>Approve</button>
        <button className="btn primary" disabled={running || workflow.activeVersion < 1} onClick={run}>{running ? "Queuing" : "Run approved"}</button>
      </div>
      {message ? <p className="lede" style={{ padding: "8px 12px" }}>{message}</p> : null}
      <div className="studio">
        <aside className="palette">
          <div className="kicker">Steps</div>
          {palette.map((type) => (
            <button key={type} className="btn ghost" draggable onDragStart={(event) => event.dataTransfer.setData("application/flowproof", type)} style={{ width: "100%", justifyContent: "flex-start" }}>
              {type.replaceAll("_", " ")}
            </button>
          ))}
          <div className="stack" style={{ marginTop: 12 }}>
            {(version?.inputSchema.fields ?? []).map((field) => (
              <label key={field.key} className="field">{field.label}
                {field.type === "select" ? (
                  <select value={values[field.key] ?? ""} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}>
                    {(field.options ?? []).map((option) => <option key={option}>{option}</option>)}
                  </select>
                ) : <input value={values[field.key] ?? ""} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} />}
              </label>
            ))}
          </div>
        </aside>
        <div className="canvas-wrap" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
          const type = event.dataTransfer.getData("application/flowproof");
          if (!type) return;
          snapshot();
          const id = `${type}_${Math.random().toString(36).slice(2, 7)}`;
          setNodes((items) => [...items, { id, type: "step", position: { x: 80, y: items.length * 40 }, data: { name: type.replaceAll("_", " "), actionType: type, type } }]);
        }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onSelectionChange={({ nodes: selectedNodes }) => setSelected(selectedNodes[0]?.id ?? null)}
            fitView
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Background />
            <MiniMap />
            <Controls />
          </ReactFlow>
        </div>
        <aside className="inspector">
          <div className="kicker">Inspector</div>
          {current ? (
            <div className="stack">
              <label className="field">Name<input value={String(current.data.name ?? "")} onChange={(event) => updateSelected({ name: event.target.value })} /></label>
              <label className="field">Action<input value={String(current.data.actionType ?? "")} readOnly /></label>
              <label className="field">Label<input value={String(current.data.label ?? "")} onChange={(event) => updateSelected({ label: event.target.value })} /></label>
              <label className="field">Target<input value={String(current.data.targetName ?? "")} onChange={(event) => updateSelected({ targetName: event.target.value })} /></label>
              <label className="field">Value from<input value={String(current.data.valueFrom ?? "")} onChange={(event) => updateSelected({ valueFrom: event.target.value })} /></label>
              <label className="field">Failure
                <select value={String(current.data.failureBehavior ?? "fail")} onChange={(event) => updateSelected({ failureBehavior: event.target.value })}>
                  <option value="fail">Fail</option>
                  <option value="recover">Recover</option>
                  <option value="skip">Skip</option>
                </select>
              </label>
              <div className="row">
                <button className="btn" onClick={() => { snapshot(); setHistory((items) => items.slice(0, -1)); const previous = history.at(-1); if (previous) { setFuture((items) => [{ nodes, edges }, ...items]); setNodes(previous.nodes); setEdges(previous.edges); } }}>Undo</button>
                <button className="btn danger" onClick={() => { snapshot(); setNodes((items) => items.filter((node) => node.id !== current.id)); setSelected(null); }}>Delete</button>
              </div>
            </div>
          ) : <p className="lede">Select a step.</p>}
          <p className="lede">Shortcuts: delete removes a step. Drag a step from the palette. Approve the graph before a run uses it.</p>
        </aside>
      </div>
    </div>
  );
}
