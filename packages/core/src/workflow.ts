import { z } from "zod";
import { parseAllowlist, PolicyError, substitutePortalOrigin, assertSafeNavigationUrl } from "./url-safety.js";

export const ACTION_TYPES = [
  "start",
  "open_website",
  "locate",
  "click",
  "type",
  "select",
  "extract",
  "wait_for",
  "branch",
  "validate_field",
  "verify_outcome",
  "approval",
  "ai_recovery",
  "end",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export const FAILURE_BEHAVIORS = ["fail", "recover", "skip"] as const;
export const ROLES = ["button", "link", "textbox", "combobox", "checkbox"] as const;

export const NodeDataSchema = z
  .object({
    name: z.string().min(1).max(120),
    url: z.string().max(500).optional(),
    label: z.string().max(200).optional(),
    semanticLabels: z.array(z.string().min(1).max(200)).max(8).optional(),
    role: z.enum(ROLES).optional(),
    targetName: z.string().max(200).optional(),
    semanticNames: z.array(z.string().min(1).max(200)).max(8).optional(),
    value: z.string().max(500).optional(),
    valueFrom: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/).optional(),
    timeoutMs: z.number().int().min(200).max(60_000).optional(),
    optional: z.boolean().optional(),
    failureBehavior: z.enum(FAILURE_BEHAVIORS).optional(),
    retryLimit: z.number().int().min(0).max(2).optional(),
    effect: z.enum(["read", "write"]).optional(),
    verification: z.enum(["none", "required"]).optional(),
    commitNames: z.array(z.string().min(1).max(200)).max(8).optional(),
    sensitive: z.boolean().optional(),
    variable: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/).optional(),
    equals: z.string().max(200).optional(),
    textAny: z.array(z.string().min(1).max(200)).max(8).optional(),
    strategy: z.enum(["trusted_api", "read_after_write", "dom_evidence", "expected_state", "composite", "human_review"]).optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();

export const WorkflowNodeSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
    type: z.enum(ACTION_TYPES),
    position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
    data: NodeDataSchema,
  })
  .strict();

export const WorkflowEdgeSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
    source: z.string().min(1),
    target: z.string().min(1),
    sourceHandle: z.enum(["true", "false"]).optional(),
  })
  .strict();

export const WorkflowDefinitionSchema = z
  .object({
    nodes: z.array(WorkflowNodeSchema).min(2).max(40),
    edges: z.array(WorkflowEdgeSchema).max(80),
  })
  .strict();

export const InputFieldSchema = z
  .object({
    key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),
    label: z.string().min(1).max(80),
    type: z.enum(["text", "select"]),
    required: z.boolean(),
    defaultValue: z.string().max(200).default(""),
    options: z.array(z.string().max(80)).max(12).optional(),
  })
  .strict();

export const InputSchema = z
  .object({
    fields: z.array(InputFieldSchema).max(20),
  })
  .strict();

export const VerificationPolicySchema = z
  .object({
    strategy: z.enum(["trusted_api", "read_after_write", "dom_evidence", "expected_state", "composite", "human_review"]),
    requireAuthoritative: z.boolean(),
    recordType: z.enum(["invoice", "customer", "none"]),
    matchFields: z.array(z.string().max(64)).max(16),
    domCannotOverrideApi: z.boolean(),
    onUnknownWrite: z.literal("outcome_unknown"),
  })
  .strict();

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
export type InputSchemaType = z.infer<typeof InputSchema>;
export type VerificationPolicy = z.infer<typeof VerificationPolicySchema>;

export interface ValidationIssue {
  code: string;
  message: string;
  nodeId?: string;
  severity: "error" | "warning";
}

const WRITE_TYPES = new Set<ActionType>(["click", "type", "select"]);

export function parseWorkflowDefinition(value: unknown): WorkflowDefinition {
  return WorkflowDefinitionSchema.parse(value);
}

export function validateWorkflow(
  definition: WorkflowDefinition,
  policy: VerificationPolicy,
  allowlistEntries: string[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodes = definition.nodes;
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) {
      issues.push({ code: "duplicate_node", message: `Node ${node.id} is duplicated.`, nodeId: node.id, severity: "error" });
    }
    ids.add(node.id);
  }
  const starts = nodes.filter((node) => node.type === "start");
  const ends = nodes.filter((node) => node.type === "end");
  if (starts.length !== 1) {
    issues.push({ code: "start_required", message: "A workflow needs exactly one Start node.", severity: "error" });
  }
  if (ends.length < 1) {
    issues.push({ code: "end_required", message: "A workflow needs at least one End node.", severity: "error" });
  }

  const outgoing = new Map<string, WorkflowEdge[]>();
  const incoming = new Map<string, number>();
  for (const edge of definition.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      issues.push({
        code: "dangling_edge",
        message: `Edge ${edge.id} points at a missing node.`,
        severity: "error",
      });
      continue;
    }
    if (edge.source === edge.target) {
      issues.push({ code: "self_edge", message: "A node cannot connect to itself.", nodeId: edge.source, severity: "error" });
    }
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge);
    outgoing.set(edge.source, list);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  for (const node of nodes) {
    const outs = outgoing.get(node.id) ?? [];
    if (node.type === "end" && outs.length > 0) {
      issues.push({ code: "end_outgoing", message: "End nodes cannot have outgoing connections.", nodeId: node.id, severity: "error" });
    }
    if (node.type === "start" && (incoming.get(node.id) ?? 0) > 0) {
      issues.push({ code: "start_incoming", message: "Start cannot have an incoming connection.", nodeId: node.id, severity: "error" });
    }
    if (node.type === "branch") {
      const handles = new Set(outs.map((edge) => edge.sourceHandle));
      if (!handles.has("true") || !handles.has("false") || outs.length !== 2) {
        issues.push({
          code: "branch_handles",
          message: "A branch needs exactly two outgoing connections, labeled true and false.",
          nodeId: node.id,
          severity: "error",
        });
      }
      if (!node.data.variable || node.data.equals === undefined) {
        issues.push({
          code: "branch_condition",
          message: "A branch needs a variable and a comparison value.",
          nodeId: node.id,
          severity: "error",
        });
      }
    } else if (node.type !== "end" && outs.length !== 1) {
      issues.push({
        code: "connection",
        message: `${node.data.name} needs exactly one outgoing connection.`,
        nodeId: node.id,
        severity: "error",
      });
    }
    issues.push(...validateNodeFields(node, allowlistEntries));
  }

  const start = starts[0];
  if (start) {
    const reachable = reachableSet(start.id, outgoing);
    for (const node of nodes) {
      if (!reachable.has(node.id)) {
        issues.push({
          code: "unreachable",
          message: `${node.data.name} is not reachable from Start.`,
          nodeId: node.id,
          severity: "error",
        });
      }
    }
    if (hasCycle(start.id, outgoing)) {
      issues.push({ code: "cycle", message: "The workflow contains a cycle. Keep the graph acyclic.", severity: "error" });
    }
    const writes = nodes.filter((node) => node.data.effect === "write" || (node.type === "click" && node.data.effect !== "read"));
    const hasWrite = writes.some((node) => node.data.effect === "write");
    if (hasWrite) {
      for (const node of writes.filter((item) => item.data.effect === "write")) {
        if (!everyPathReachesVerification(node.id, outgoing, nodes)) {
          issues.push({
            code: "write_without_verification",
            message: `${node.data.name} can change state, so every path after it must reach Verify outcome.`,
            nodeId: node.id,
            severity: "error",
          });
        }
      }
    }
  }

  if (policy.requireAuthoritative && policy.strategy === "dom_evidence") {
    issues.push({
      code: "policy",
      message: "Authoritative verification cannot be satisfied by DOM evidence alone.",
      severity: "error",
    });
  }
  if (policy.requireAuthoritative && !nodes.some((node) => node.type === "verify_outcome")) {
    issues.push({
      code: "verification_required",
      message: "This policy requires a Verify outcome step.",
      severity: "error",
    });
  }
  return issues;
}

export function validationErrors(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === "error");
}

function validateNodeFields(node: WorkflowNode, allowlistEntries: string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const data = node.data;
  if (node.type === "open_website") {
    if (!data.url) {
      issues.push({ code: "url_required", message: "Open website needs a URL.", nodeId: node.id, severity: "error" });
    } else if (!data.url.includes("{{portalOrigin}}")) {
      try {
        const allow = parseAllowlist(allowlistEntries.filter((entry) => !entry.includes("{{portalOrigin}}")));
        assertSafeNavigationUrl(data.url, allow);
      } catch (error) {
        const message = error instanceof PolicyError ? error.message : "The URL is not allowed.";
        issues.push({ code: "url_blocked", message, nodeId: node.id, severity: "error" });
      }
    } else if (!data.url.startsWith("{{portalOrigin}}/") && data.url !== "{{portalOrigin}}") {
      issues.push({
        code: "url_placeholder",
        message: "Portal URLs must start with {{portalOrigin}}/.",
        nodeId: node.id,
        severity: "error",
      });
    }
  }
  if ((node.type === "type" || node.type === "select" || node.type === "validate_field" || node.type === "locate") && !data.label && !data.targetName) {
    issues.push({
      code: "target_required",
      message: `${data.name} needs a label or target name.`,
      nodeId: node.id,
      severity: "error",
    });
  }
  if ((node.type === "type" || node.type === "select") && !data.value && !data.valueFrom) {
    issues.push({
      code: "value_required",
      message: `${data.name} needs a value.`,
      nodeId: node.id,
      severity: "error",
    });
  }
  if (node.type === "click" && !data.targetName && !data.label) {
    issues.push({ code: "click_target", message: "Click needs a target name.", nodeId: node.id, severity: "error" });
  }
  if (node.type === "wait_for" && (!data.textAny || data.textAny.length === 0)) {
    issues.push({ code: "wait_text", message: "Wait for condition needs at least one text match.", nodeId: node.id, severity: "error" });
  }
  if (node.type === "extract" && !data.variable) {
    issues.push({ code: "extract_variable", message: "Extract needs a variable name.", nodeId: node.id, severity: "error" });
  }
  if (data.notes && /<\s*script|eval\s*\(/i.test(data.notes)) {
    issues.push({ code: "prohibited_content", message: "Notes cannot contain scripts.", nodeId: node.id, severity: "error" });
  }
  if (data.value && /\{\{\s*constructor\s*\}\}/i.test(data.value)) {
    issues.push({ code: "prohibited_content", message: "That value is not allowed.", nodeId: node.id, severity: "error" });
  }
  return issues;
}

function reachableSet(start: string, outgoing: Map<string, WorkflowEdge[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    for (const edge of outgoing.get(current) ?? []) stack.push(edge.target);
  }
  return seen;
}

function hasCycle(start: string, outgoing: Map<string, WorkflowEdge[]>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const edge of outgoing.get(id) ?? []) {
      if (walk(edge.target)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return walk(start);
}

function everyPathReachesVerification(
  start: string,
  outgoing: Map<string, WorkflowEdge[]>,
  nodes: WorkflowNode[],
): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const walk = (id: string, seen: Set<string>): boolean => {
    const node = byId.get(id);
    if (!node) return false;
    if (id !== start && node.type === "verify_outcome") return true;
    if (node.type === "end") return false;
    const edges = outgoing.get(id) ?? [];
    if (edges.length === 0) return false;
    for (const edge of edges) {
      if (seen.has(edge.target)) return false;
      const next = new Set(seen);
      next.add(id);
      if (!walk(edge.target, next)) return false;
    }
    return true;
  };
  return walk(start, new Set());
}

export function nextNodeId(definition: WorkflowDefinition, nodeId: string, handle?: "true" | "false"): string | null {
  const edges = definition.edges.filter((edge) => edge.source === nodeId);
  if (handle) return edges.find((edge) => edge.sourceHandle === handle)?.target ?? null;
  return edges[0]?.target ?? null;
}

export function findStart(definition: WorkflowDefinition): WorkflowNode {
  const start = definition.nodes.find((node) => node.type === "start");
  if (!start) throw new PolicyError("start_required", "The workflow has no Start node.");
  return start;
}

export function resolveNavigationUrl(template: string, portalOrigin: string, allowlist: URL[]): URL {
  const substituted = substitutePortalOrigin(template, portalOrigin);
  return assertSafeNavigationUrl(substituted, allowlist);
}

export { WRITE_TYPES };
