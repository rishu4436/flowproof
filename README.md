# FlowProof

Automation you can prove.

FlowProof runs browser workflows against a controlled vendor portal, records what the browser actually did, and decides the outcome from an authoritative read of the saved record. A success message is evidence. It is not proof.

## What is running locally

| Service | URL |
| --- | --- |
| Web app | http://127.0.0.1:3000 |
| Northstar Vendor Portal | http://127.0.0.1:4100 |
| Postgres | `127.0.0.1:5432` (embedded PGlite in this session; Docker Compose is also provided) |
| Worker | background process, no public port |

Verified in this workspace, with Otari **not** configured:

- Scenario A, invoice `INV-2041`, run `run_425a22085217b086a7efe67b`: browser submit, portal record saved, receipt `VERIFIED`.
- Scenario E, invoice `INV-EFALSE`, run `run_acca589a61eba17ff0ed3955`: the page said success, the invoice was not stored, receipt `FAILED`.
- Scenario B, invoice `INV-B2042`, run `run_b84eca55d199532e11ede86c`: the original “Submit invoice” button was missing, a deterministic repair clicked the authorized “Send to accounts” button, receipt `VERIFIED`.

The analytics API reported 3 runs, 2 verified, 1 failed. Otari health was `not_configured`.

## Stack

Next.js, React, TypeScript, Tailwind, Playwright, Prisma, PostgreSQL, Zod. Inference is Mozilla Otari’s OpenAI-compatible API and is not called unless `OTARI_API_KEY` is set.

## Setup

```powershell
pnpm install
pnpm --filter @flowproof/worker exec playwright install chromium
copy .env.example .env
```

Postgres, pick one:

```powershell
docker compose up -d
```

If the Docker engine is not running, the embedded server used for this session is:

```powershell
node scripts/pglite-server.mjs
```

Then:

```powershell
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm dev` starts the web app, the worker, and the Northstar portal. Start Postgres first.

## Environment

See `.env.example`. Secrets stay in the environment. The demo portal and verification APIs use `PORTAL_ADMIN_TOKEN` and `PORTAL_VERIFY_TOKEN`. Leave `OTARI_API_KEY` empty for the offline demo. Set it, plus `OTARI_BASE_URL=https://api.otari.ai/api/v1`, to enable planning, repair, and review. Choose model ids from the Models page after discovery. Do not invent model ids.

## Demo

1. Open http://127.0.0.1:3000 and go to Demo Lab.
2. Scenario A submits `INV-2041` and verifies the stored invoice.
3. Scenario E shows a success message and does not store the invoice. The receipt must not be `VERIFIED`.
4. Scenario B renames the submit button. The original click fails, then a recorded repair runs.
5. Scenario G stores the invoice and drops the response. The worker must not click submit again.

Details are in `docs/DEMO-GUIDE.md`.

## Tests

```powershell
pnpm test
pnpm typecheck
```

`pnpm test` ran 24 tests: workflow validation, state transitions, URL policy, verification rules, receipt hashing, recovery limits, the Otari client against mocked HTTP, and the portal’s false-success behavior. All 24 passed. Default tests do not call Otari and do not need a browser.

## Docs

- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/OTARI-INTEGRATION.md`
- `docs/DEMO-GUIDE.md`
- `docs/BENCHMARKS.md`
- `docs/DEPLOYMENT.md`
- `docs/KNOWN-LIMITATIONS.md`
- `docs/HACKATHON-EVIDENCE.md`
