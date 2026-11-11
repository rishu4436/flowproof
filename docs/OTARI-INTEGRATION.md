# Otari integration

All model calls go through the OpenAI-compatible Chat Completions API on the configured Otari base URL.

## Environment

- `OTARI_API_KEY`
- `OTARI_BASE_URL` (default `https://api.otari.ai/api/v1`)
- `OTARI_MODEL_PRIMARY`
- `OTARI_MODEL_REPAIR`
- `OTARI_MODEL_REVIEW`
- `OTARI_MAX_REQUEST_COST_USD`
- `OTARI_REQUEST_TIMEOUT_MS`

The EU gateway is `https://eu.api.otari.ai/api/v1`. A key for one region returns 421 on the other.

## Calls

| Use | Route |
| --- | --- |
| Health and model discovery | `GET /models` |
| Planning, repair, review, connectivity test | `POST /chat/completions` |

The client stores `Otari-Request-ID`, `Otari-Model`, and `Otari-Provider` when the gateway sends them. `usage.cost_usd` is stored only when present. Missing cost stays null.

Structured planning and repair responses are parsed as JSON and checked with Zod. One correction retry is allowed. Invalid proposals are not executed.

## Tools

Review can ask for `get_invoice_evidence` or `get_customer_evidence`. The application runs the tool itself, and only for the invoice or customer id already on that run. The tool is read-only.

The Models page can also ask the hosted gateway to run its own tools: `otari_web_search`, `otari_web_fetch`, and `otari_code_execution`. A completed call is counted only when the response includes that call in `otari_tool_calls`. The same page can ask Otari to call `POST /api/mcp` on `FLOWPROOF_PUBLIC_ORIGIN`, which reads one synthetic invoice and cannot submit or pay it.

Browser mutations stay inside the worker's own authorization checks.

## Disconnected mode

With no API key, health is `not_configured`. Planning returns a clear unavailable state. The invoice templates still run, and recovery can use accessible names that were authorized on the step. That path is labeled `deterministic`, not Otari.

## What has been observed

Live calls are stored as AI request rows with the Otari request id, served model, and `usage.cost_usd` when the gateway sends them. A missing cost stays null. The comparison suite `suite_049cdcc3d069ccfb699fe52e` called Qwen and Gemma for repair; both repair payloads failed schema checks, and the invoices were verified by the authorized locator. Do not treat a model reply as the business outcome.
