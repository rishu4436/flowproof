import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

interface Rpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { name?: string; arguments?: { invoiceId?: string } };
}

export async function POST(request: NextRequest) {
  const expected = process.env.PORTAL_VERIFY_TOKEN ?? "";
  const header = request.headers.get("authorization") ?? "";
  if (!expected || header !== `Bearer ${expected}`) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "unauthorized" } }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as Rpc | null;
  if (!body || body.jsonrpc !== "2.0" || !body.method) {
    return Response.json({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32600, message: "Invalid request" } }, { status: 400 });
  }
  if (body.method === "notifications/initialized" || body.method === "initialized") {
    return new Response(null, { status: 202 });
  }
  if (body.method === "initialize") {
    return rpc(body.id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "flowproof-invoices", version: "0.1.0" },
    });
  }
  if (body.method === "ping") return rpc(body.id, {});
  if (body.method === "tools/list") {
    return rpc(body.id, {
      tools: [
        {
          name: "lookup_invoice",
          description: "Read one synthetic Northstar invoice. This does not submit, pay, or change the invoice.",
          inputSchema: {
            type: "object",
            properties: { invoiceId: { type: "string", description: "Invoice id, for example INV-1000." } },
            required: ["invoiceId"],
            additionalProperties: false,
          },
        },
      ],
    });
  }
  if (body.method === "tools/call" && body.params?.name === "lookup_invoice") {
    const invoiceId = body.params.arguments?.invoiceId?.trim();
    if (!invoiceId || !/^INV-[A-Za-z0-9-]+$/.test(invoiceId)) {
      return rpc(body.id, { content: [{ type: "text", text: "invoiceId must look like INV-1000." }], isError: true });
    }
    const origin = process.env.DEMO_PORTAL_ORIGIN ?? "http://127.0.0.1:4100";
    const response = await fetch(`${origin}/api/verify/invoices/${encodeURIComponent(invoiceId)}`, {
      headers: { Authorization: `Bearer ${expected}` },
    });
    const text = (await response.text()).slice(0, 4000);
    return rpc(body.id, { content: [{ type: "text", text }], isError: !response.ok });
  }
  return rpcError(body.id, -32601, "Method not found");
}

function rpc(id: Rpc["id"], result: unknown) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(id: Rpc["id"], code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status: 200 });
}
