import { describe, expect, it } from "vitest";
import { PlanProposalSchema, RecoveryProposalSchema } from "./schemas.js";
import { otariChat, otariHealth, parseJsonContent, parseModelIds, readOtariConfig } from "./otari.js";

describe("otari client", () => {
  it("reports a clear disconnected state without a key", async () => {
    const health = await otariHealth(readOtariConfig({}));
    expect(health.status).toBe("not_configured");
  });

  it("parses model ids and records the request id and cost only when present", async () => {
    expect(parseModelIds({ data: [{ id: "openai/gpt-oss-20b" }, { id: "other" }] })).toEqual([
      "openai/gpt-oss-20b",
      "other",
    ]);
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("example-model");
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "{\"ok\":true}" } }],
          usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16, cost_usd: "0.000120", pricing_source: "deployment" },
        }),
        { status: 200, headers: { "Otari-Request-ID": "req_123", "Otari-Model": "example-model", "Otari-Provider": "example" } },
      );
    };
    const result = await otariChat(
      { apiKey: "test-key", baseUrl: "https://api.otari.ai/api/v1", timeoutMs: 1000, fetchImpl },
      { model: "example-model", messages: [{ role: "user", content: "ping" }] },
    );
    expect(result.requestId).toBe("req_123");
    expect(result.usage.costUsd).toBe("0.000120");
    expect(result.servedModel).toBe("example-model");
    expect(result.gatewayTools).toEqual([]);
    expect(result.fallback).toBeNull();
  });

  it("keeps Otari gateway tool calls and fallback headers that the response actually sent", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "437" } }],
          usage: { cost_usd: "0.000010", pricing_source: "deployment" },
          otari_tool_calls: [
            { id: "otari_ci_1", type: "code_execution", status: "completed", code: "print(23*19)", stdout: "437\n", exit_code: 0 },
          ],
        }),
        { status: 200, headers: { "Otari-Attempt-Count": "2", "Otari-Fallback": "true", "Otari-Request-ID": "req_fb" } },
      );
    const result = await otariChat(
      { apiKey: "test-key", baseUrl: "https://api.otari.ai/api/v1", timeoutMs: 1000, fetchImpl },
      { model: "example-model", messages: [{ role: "user", content: "compute" }], tools: [{ type: "otari_code_execution" }] },
    );
    expect(result.requestId).toBe("req_fb");
    expect(result.attemptCount).toBe(2);
    expect(result.fallback).toBe(true);
    expect(result.gatewayTools[0]).toMatchObject({ type: "code_execution", status: "completed", stdout: "437\n" });
  });

  it("does not invent a cost when usage omits it", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 1 } }), { status: 200 });
    const result = await otariChat(
      { apiKey: "test-key", baseUrl: "https://api.otari.ai/api/v1", timeoutMs: 1000, fetchImpl },
      { model: "example-model", messages: [{ role: "user", content: "ping" }] },
    );
    expect(result.usage.costUsd).toBeNull();
  });

  it("rejects recovery JSON that adds fields or omits the write flag", () => {
    expect(
      RecoveryProposalSchema.safeParse({
        failureCategory: "element_not_found",
        diagnosis: "The original button is gone.",
        proposedAction: { type: "click", role: "button", name: "Send to accounts" },
        candidateTarget: { role: "button", name: "Send to accounts", reason: "Same submit intent." },
        uncertainty: "The label changed.",
        evidence: ["Visible button Send to accounts"],
        expectedEffect: "Opens the submit action.",
        changesWriteBehavior: false,
        script: "click()",
      }).success,
    ).toBe(false);
    expect(parseJsonContent("```json\n{\"name\":\"Invoice\"}\n```")).toEqual({ name: "Invoice" });
    expect(PlanProposalSchema.safeParse({ name: "x", description: "y", category: "finance", objective: "z", nodes: [], notes: [] }).success).toBe(
      false,
    );
  });

  it("maps authentication failure", async () => {
    const fetchImpl: typeof fetch = async () => new Response("no", { status: 401 });
    const health = await otariHealth({ apiKey: "bad", baseUrl: "https://api.otari.ai/api/v1", timeoutMs: 1000, fetchImpl });
    expect(health.status).toBe("authentication_failed");
  });
});
