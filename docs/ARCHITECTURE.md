# Architecture

FlowProof separates planning, browser execution, and outcome judgment.

## Components

- `apps/web` serves the product UI and the HTTP API. It creates run records and queue jobs. It does not launch Chromium.
- `apps/worker` claims PostgreSQL jobs and runs one isolated Playwright browser context per execution.
- `apps/demo-portal` is the Northstar Vendor Portal. It owns invoice and customer records.
- `packages/core` holds validation, the run state machine, URL policy, verification rules, receipt hashing, and workflow templates.
- `packages/ai` talks only to an OpenAI-compatible Otari base URL.
- `packages/database` holds the Prisma schema, the job claim query, and the seed.

## Data flow

1. A person approves a workflow version and submits an objective with requested values.
2. The API writes a `runs` row in `QUEUED`, an objective approval, and a `jobs` row.
3. The worker claims the job with `FOR UPDATE SKIP LOCKED`.
4. Playwright opens the allowlisted portal, performs the graph, and stores step events and screenshots.
5. Verification calls the portal's token-protected read API. It does not read the portal tables directly.
6. `evaluateEvidence` chooses `VERIFIED`, `FAILED`, `UNVERIFIED`, `BLOCKED`, or `OUTCOME_UNKNOWN`.
7. A canonical receipt and SHA-256 hash are stored. The hash detects later edits of that JSON. It is not a third-party signature.

## State machine

`QUEUED → STARTING → RUNNING` can pause for approval, enter `RECOVERING`, or move to `VERIFYING`. Only `VERIFYING` can become `VERIFIED`, `FAILED`, `UNVERIFIED`, `BLOCKED`, or `OUTCOME_UNKNOWN`. A completed click does not set `VERIFIED` by itself.

## Recovery

The original accessible name is tried first. On failure, the worker captures a bounded accessible snapshot. If Otari is configured, its proposal must match a visible candidate and a Zod schema. Otherwise a deterministic match against names already authorized on the step can be applied. A repair that changes the write, or an unlisted target, waits for approval. A write whose response was lost is not clicked again.

## Browser runtime

Each run gets a new browser context. Navigation is checked against the explicit origin allowlist before and during requests. Metadata addresses are rejected. Downloads are disabled. The context is closed in a `finally` block.
