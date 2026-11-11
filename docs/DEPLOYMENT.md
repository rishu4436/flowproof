# Deployment

Run the web app, the worker, Postgres, and the demo portal as separate processes. Do not put Chromium inside a short-lived serverless function.

## Services

- **Web:** `pnpm --filter @flowproof/web start` after `pnpm --filter @flowproof/web build`. It needs `DATABASE_URL`, the session secret, portal tokens, and the Otari variables.
- **Worker:** `pnpm --filter @flowproof/worker start` on a machine with Playwright’s Chromium and the same database. Set `PLAYWRIGHT_NO_SANDBOX=1` only when the container requires it.
- **Portal:** `pnpm --filter @flowproof/demo-portal start`, bound to a private address. The worker must reach `DEMO_PORTAL_ORIGIN`. Inside Compose, that origin is the portal service name, not `localhost` on the web container.
- **Postgres:** persistent volume. `docker-compose.yml` is the local reference.
- **Artifacts:** a persistent directory from `ARTIFACT_DIR`, or a later replacement for the filesystem adapter. Screenshots are not stored in Postgres.

## Secrets

`FLOWPROOF_SESSION_SECRET`, `PORTAL_ADMIN_TOKEN`, `PORTAL_VERIFY_TOKEN`, and `OTARI_API_KEY` come from the environment. Do not commit `.env`.

## Networking

Allow the worker to open only the configured portal origin. Block metadata addresses in the application policy as well as at the network edge. If demo mode is disabled before a real identity provider exists, automation routes return 403.

## Local fallback used here

Docker Desktop was installed but its engine was not accepting connections. `scripts/pglite-server.mjs` served Postgres on `127.0.0.1:5432`. Prisma is pointed at it with `pgbouncer=true` so prepared-statement names are not reused on that socket server. A normal Postgres service does not need that parameter.
