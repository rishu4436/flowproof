# Security

## Threat model

The browser worker can navigate, type, and click. The main risks are server-side request forgery, an model-proposed action outside the user's objective, a repeated uncertain write, and leaked secrets in logs or screenshots.

## Allowed actions

Workflows may only use the fixed action types in `packages/core`. There is no step that evaluates JavaScript or shell. Model output is JSON validated by Zod. A proposed click or field must match an element actually present on the page.

## Domain controls

`DEMO_PORTAL_ORIGIN` is allowlisted. Extra origins come only from `FLOWPROOF_ALLOWED_ORIGINS`. Every navigation and routed request is checked again. `file:`, credentialed URLs, and metadata hosts are rejected. A public hostname that resolves to a private address is rejected. Loopback is allowed only when the allowlist itself names localhost or `127.0.0.1`.

The demo portal binds to `127.0.0.1` by default. Verification and admin JSON routes require bearer tokens. The HTML settings page accepts changes only from a loopback connection.

## Writes

A commit click is marked `writeStarted` before the click. If the HTTP response is not observed, the worker does not click again. It reads the saved record by idempotency key. If that read fails, the run ends `OUTCOME_UNKNOWN`. A crash during an uncertain write follows the same rule.

Duplicate invoice ids are rejected by the portal unless the same idempotency key is replayed.

## Data handling

Logs redact bearer tokens and common secret assignments. Password inputs are blurred before screenshots. Artifact downloads check that the file stays inside `ARTIFACT_DIR` and require the demo session.

## Authentication

`FLOWPROOF_DEMO_MODE=true` issues a local signed session for the seeded workspace. If demo mode is off and no session exists, API automation returns 403. This build does not include a hosted identity provider. Do not point it at production systems in that state.

## Production limitations

This is a local demonstration. It is not a penetration test, and it is not a multi-tenant production control plane. Hosted SSO, customer network policy, and external domain onboarding are not implemented.
