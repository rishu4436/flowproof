import type { ZodType } from "zod";

export type OtariHealthStatus =
  | "connected"
  | "authentication_failed"
  | "no_supported_models"
  | "rate_limited"
  | "budget_exceeded"
  | "service_unavailable"
  | "not_configured";

export interface OtariConfig {
  apiKey?: string;
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface OtariUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  costUsd: string | null;
  pricingSource: string | null;
}

export interface OtariChatResult {
  content: string;
  requestedModel: string;
  servedModel: string | null;
  provider: string | null;
  requestId: string | null;
  latencyMs: number;
  usage: OtariUsage;
  toolCalls: OtariToolCall[];
  gatewayTools: OtariGatewayToolCall[];
  attemptCount: number | null;
  fallback: boolean | null;
  rawStatus: number;
}

export interface OtariGatewayToolCall {
  id: string;
  type: string;
  status: string;
  query?: string;
  url?: string;
  code?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  server?: string;
  name?: string;
  output?: string;
  error?: string;
  sources?: Array<{ url?: string; title?: string }>;
}

export interface OtariToolCall {
  id: string;
  name: string;
  arguments: string;
}

export function readOtariConfig(env: NodeJS.ProcessEnv = process.env): OtariConfig {
  const timeout = Number(env.OTARI_REQUEST_TIMEOUT_MS ?? 30_000);
  return {
    apiKey: env.OTARI_API_KEY?.trim() || undefined,
    baseUrl: (env.OTARI_BASE_URL?.trim() || "https://api.otari.ai/api/v1").replace(/\/$/, ""),
    timeoutMs: Number.isFinite(timeout) ? timeout : 30_000,
  };
}

export function otariConfigured(config: OtariConfig): boolean {
  return Boolean(config.apiKey);
}

export async function otariHealth(config: OtariConfig): Promise<{
  status: OtariHealthStatus;
  models: string[];
  message: string;
}> {
  if (!config.apiKey) {
    return { status: "not_configured", models: [], message: "OTARI_API_KEY is not set. AI planning and recovery stay unavailable." };
  }
  try {
    const response = await configFetch(config, "/models", { method: "GET" });
    if (response.status === 401 || response.status === 403) {
      return { status: "authentication_failed", models: [], message: "Otari rejected the API key." };
    }
    if (response.status === 429) return { status: "rate_limited", models: [], message: "Otari rate limited the key." };
    if (response.status === 402) return { status: "budget_exceeded", models: [], message: "The Otari key budget is exhausted." };
    if (!response.ok) {
      return { status: "service_unavailable", models: [], message: `Otari models endpoint returned ${response.status}.` };
    }
    const models = parseModelIds(await response.json());
    if (models.length === 0) {
      return { status: "no_supported_models", models: [], message: "The gateway returned no model ids." };
    }
    return { status: "connected", models, message: `Discovered ${models.length} model${models.length === 1 ? "" : "s"}.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Otari could not be reached.";
    return { status: "service_unavailable", models: [], message };
  }
}

export async function otariChat(
  config: OtariConfig,
  input: {
    model: string;
    messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; toolCallId?: string }>;
    temperature?: number;
    maxTokens?: number;
    tools?: unknown[];
    mcpServers?: unknown[];
    json?: boolean;
    metadata?: Record<string, string>;
  },
): Promise<OtariChatResult> {
  if (!config.apiKey) {
    throw new OtariError("not_configured", "Otari is not configured.");
  }
  const started = Date.now();
  const send = (jsonMode: boolean) =>
    configFetch(config, "/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: input.model,
        messages: input.messages.map((message) =>
          message.role === "tool"
            ? { role: "tool", content: message.content, tool_call_id: message.toolCallId }
            : { role: message.role, content: message.content },
        ),
        temperature: input.temperature ?? 0.1,
        max_tokens: input.maxTokens ?? 2048,
        response_format: input.json === false || input.tools || input.mcpServers || !jsonMode ? undefined : { type: "json_object" },
        tools: input.tools,
        mcp_servers: input.mcpServers,
        metadata: input.metadata,
      }),
    });
  let response = await send(true);
  if (response.status === 400 && input.json !== false && !input.tools && !input.mcpServers) {
    const preview = await response.clone().text();
    if (preview.toLowerCase().includes("response_format")) response = await send(false);
  }
  const latencyMs = Date.now() - started;
  const requestId = response.headers.get("otari-request-id");
  const servedModel = response.headers.get("otari-model");
  const provider = response.headers.get("otari-provider");
  const attemptHeader = response.headers.get("otari-attempt-count");
  const fallbackHeader = response.headers.get("otari-fallback");
  const attemptCount = attemptHeader && Number.isFinite(Number(attemptHeader)) ? Number(attemptHeader) : null;
  const fallback = fallbackHeader === null ? null : fallbackHeader === "true";
  if (response.status === 401 || response.status === 403) throw new OtariError("authentication_failed", "Otari rejected the API key.", requestId);
  if (response.status === 429) throw new OtariError("rate_limited", "Otari rate limited the request.", requestId);
  if (response.status === 402) throw new OtariError("budget_exceeded", "Otari reported that the budget is exhausted.", requestId);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = body && typeof body === "object" ? (body as { error?: unknown; detail?: unknown }) : {};
    const detail = record.detail ?? record.error ?? body;
    throw new OtariError("service_unavailable", `Otari request failed (${response.status}): ${JSON.stringify(detail).slice(0, 500)}`, requestId);
  }
  const choice = (body as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }> }).choices?.[0]?.message;
  const usage = readUsage(body);
  return {
    content: choice?.content ?? "",
    requestedModel: input.model,
    servedModel,
    provider,
    requestId,
    latencyMs,
    usage,
    toolCalls: (choice?.tool_calls ?? []).flatMap((call) => {
      if (!call.id || !call.function?.name) return [];
      return [{ id: call.id, name: call.function.name, arguments: call.function.arguments ?? "{}" }];
    }),
    gatewayTools: readGatewayTools(body),
    attemptCount,
    fallback,
    rawStatus: response.status,
  };
}

export async function otariGet(config: OtariConfig, path: string): Promise<{ status: number; body: unknown }> {
  if (!config.apiKey) throw new OtariError("not_configured", "Otari is not configured.");
  const response = await configFetch(config, path.startsWith("/") ? path : `/${path}`, { method: "GET" });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

export async function completeStructured<T>(
  config: OtariConfig,
  input: {
    model: string;
    system: string;
    user: string;
    schema: ZodType<T>;
    maxCalls: number;
    metadata?: Record<string, string>;
  },
): Promise<{ value: T; calls: OtariChatResult[] }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: input.system },
    { role: "user", content: input.user },
  ];
  const calls: OtariChatResult[] = [];
  let lastIssue = "The model did not return JSON.";
  const attempts = Math.max(1, Math.min(3, input.maxCalls));
  for (let index = 0; index < attempts; index += 1) {
    const result = await otariChat(config, { model: input.model, messages, metadata: input.metadata });
    calls.push(result);
    const parsed = parseJsonContent(result.content);
    const checked = input.schema.safeParse(parsed);
    if (checked.success) return { value: checked.data, calls };
    lastIssue = checked.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
    messages.push({ role: "assistant", content: result.content.slice(0, 4000) });
    messages.push({
      role: "user",
      content: `The JSON failed validation (${lastIssue}). Return only a corrected JSON object. Do not include markdown.`,
    });
  }
  const invalid = new OtariError("invalid_output", lastIssue, calls.at(-1)?.requestId ?? null);
  invalid.calls = calls;
  throw invalid;
}

export class OtariError extends Error {
  calls: OtariChatResult[] = [];
  constructor(
    readonly status: OtariHealthStatus | "invalid_output",
    message: string,
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = "OtariError";
  }
}

export function parseJsonContent(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  return JSON.parse(trimmed);
}

export function parseModelIds(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const record = body as { data?: unknown; models?: unknown };
  const list = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];
  return list.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object" && "id" in item && typeof (item as { id: unknown }).id === "string") {
      return [(item as { id: string }).id];
    }
    return [];
  });
}

function readGatewayTools(body: unknown): OtariGatewayToolCall[] {
  if (!body || typeof body !== "object" || !("otari_tool_calls" in body)) return [];
  const calls = (body as { otari_tool_calls?: unknown }).otari_tool_calls;
  if (!Array.isArray(calls)) return [];
  return calls.flatMap((call) => {
    if (!call || typeof call !== "object") return [];
    const record = call as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.type !== "string") return [];
    const sources = Array.isArray(record.sources)
      ? record.sources.flatMap((source) => {
          if (!source || typeof source !== "object") return [];
          const item = source as { url?: unknown; title?: unknown };
          return [{ url: typeof item.url === "string" ? item.url : undefined, title: typeof item.title === "string" ? item.title : undefined }];
        })
      : undefined;
    return [
      {
        id: record.id,
        type: record.type,
        status: typeof record.status === "string" ? record.status : "unknown",
        query: typeof record.query === "string" ? record.query : undefined,
        url: typeof record.url === "string" ? record.url : undefined,
        code: typeof record.code === "string" ? record.code.slice(0, 2000) : undefined,
        stdout: typeof record.stdout === "string" ? record.stdout.slice(0, 2000) : undefined,
        stderr: typeof record.stderr === "string" ? record.stderr.slice(0, 2000) : undefined,
        exitCode: typeof record.exit_code === "number" ? record.exit_code : null,
        server: typeof record.server === "string" ? record.server : undefined,
        name: typeof record.name === "string" ? record.name : undefined,
        output: typeof record.output === "string" ? record.output.slice(0, 2000) : undefined,
        error: typeof record.error === "string" ? record.error.slice(0, 500) : undefined,
        sources,
      },
    ];
  });
}

function readUsage(body: unknown): OtariUsage {
  const usage = body && typeof body === "object" && "usage" in body ? (body as { usage?: Record<string, unknown> }).usage : undefined;
  const cost = usage?.cost_usd;
  return {
    promptTokens: numberOrNull(usage?.prompt_tokens),
    completionTokens: numberOrNull(usage?.completion_tokens),
    totalTokens: numberOrNull(usage?.total_tokens),
    costUsd: typeof cost === "string" || typeof cost === "number" ? String(cost) : null,
    pricingSource: typeof usage?.pricing_source === "string" ? usage.pricing_source : null,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function configFetch(config: OtariConfig, path: string, init: RequestInit): Promise<Response> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    return await fetchImpl(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new OtariError("service_unavailable", "The Otari request timed out.");
    }
    throw new OtariError("service_unavailable", error instanceof Error ? error.message : "The Otari request failed.");
  } finally {
    clearTimeout(timer);
  }
}
