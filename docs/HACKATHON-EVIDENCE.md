# Hackathon evidence

## Otari

The client lives in `packages/ai`. It calls `GET /models` and `POST /chat/completions` on the configured Otari base URL, records `Otari-Request-ID` when the gateway sends it, and stores `usage.cost_usd` only when present.

Live calls are recorded on AI request rows. Costs and request ids are stored only when Otari returns them. This file does not invent a commit hash.

Mocked client tests in `packages/ai/src/otari.test.ts` passed, including authentication failure, request-id capture, and the absence of a fabricated cost.

## Demo steps that were executed

1. Embedded Postgres, portal on http://127.0.0.1:4100, worker, and web on http://127.0.0.1:3000.
2. Scenario A run `run_425a22085217b086a7efe67b` reached `VERIFIED` with a stored invoice and a receipt.
3. Scenario E run `run_acca589a61eba17ff0ed3955` reached `FAILED` after a success message with no stored invoice.
4. Scenario B run `run_b84eca55d199532e11ede86c` failed the original button, applied one deterministic recovery, and reached `VERIFIED`.
5. `pnpm test` — 24 passed.
6. HTTP checks returned 200 for `/`, `/overview`, `/workflows`, `/workflows/wf_invoice`, `/demo`, and the failed run page.

## Not claimed

No repository URL, demo video, customer quote, or benchmark percentage is attached. Add those only after they exist.
