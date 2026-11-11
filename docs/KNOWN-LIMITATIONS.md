# Known limitations

- Otari calls are real when `OTARI_API_KEY` is set, and the client tests still use mocked HTTP. Health reports `not_configured` only when the key is empty.
- Changed-button recovery can ask Otari for a repair. Invalid model JSON is rejected and is not executed. An authorized visible name can still be clicked without a model.
- The invoice MCP tool is read-only. Otari can call it only when `FLOWPROOF_PUBLIC_ORIGIN` is a public https URL this process serves. Stored workspace MCP servers are whatever `GET /mcp/servers` returns for the key. Hosted guardrail profiles are whatever `GET /tool-settings/guardrails/profiles` returns. The Models page shows those answers instead of assuming they are configured.
- There is no hosted user directory. Demo mode signs a local session. Turning demo mode off disables automation rather than opening it.
- The browser may automate only the allowlisted demo origin. There is no customer domain onboarding UI that can widen that list by itself.
- Benchmark suites record each row's invoice, outcome, and known cost. Do not quote a success percentage that is not on that suite page.
- Scenario G and H were implemented in the portal and unit-tested at the planning layer. They were not executed in a browser during this session.
- Password blurring is the screenshot redaction. Other sensitive text can still appear in a capture if a page prints it.
- The workflow editor supports drag, connect, inspect, save, and approve. Undo history is limited to inspector and palette edits. It is desktop-first; narrower widths stack the panels.
- PGlite is a development fallback. It needed `pgbouncer=true`. Use Docker Postgres for anything beyond a local demo.
- This is not a production multi-tenant control plane and it does not move money.
