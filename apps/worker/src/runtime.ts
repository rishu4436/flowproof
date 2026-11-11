import { lookup } from "node:dns/promises";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_SETTINGS,
  SettingsSchema,
  artifactRoot,
  assertResolvedAddresses,
  assertSafeNavigationUrl,
  createId,
  enforceSettings,
  isIpLiteral,
  parseAllowlist,
  redactText,
  sha256,
  type WorkspaceSettings,
} from "@flowproof/core";
import { asJson, prisma, DEMO_WORKSPACE_ID } from "@flowproof/database";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export function portalOrigin(): string {
  return (process.env.DEMO_PORTAL_ORIGIN ?? "http://127.0.0.1:4100").replace(/\/$/, "");
}

export function allowlist(): URL[] {
  const extra = (process.env.FLOWPROOF_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return parseAllowlist([portalOrigin(), ...extra]);
}

export { artifactRoot };

export async function loadSettings(): Promise<WorkspaceSettings> {
  const row = await prisma.workspaceSetting.findUnique({ where: { workspaceId: DEMO_WORKSPACE_ID } });
  const parsed = SettingsSchema.safeParse(row?.data ?? DEFAULT_SETTINGS);
  const ceiling = process.env.OTARI_MAX_REQUEST_COST_USD ? Number(process.env.OTARI_MAX_REQUEST_COST_USD) : null;
  return enforceSettings(parsed.success ? parsed.data : DEFAULT_SETTINGS, Number.isFinite(ceiling) ? ceiling : null);
}

export async function assertResolvable(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIpLiteral(host)) return;
  const addresses = await lookup(host, { all: true });
  assertResolvedAddresses(
    host,
    addresses.map((item) => ({ address: item.address, family: item.family === 6 ? 6 : 4 })),
    allowlist(),
  );
}

export async function openBrowser(): Promise<{ browser: Browser; context: BrowserContext; page: Page; close: () => Promise<void> }> {
  const browser = await chromium.launch({
    headless: true,
    args: process.env.PLAYWRIGHT_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-dev-shm-usage"] : ["--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    acceptDownloads: false,
    locale: "en-US",
  });
  const allowed = allowlist();
  await context.route("**/*", async (route) => {
    const target = route.request().url();
    if (target === "about:blank") {
      await route.continue();
      return;
    }
    try {
      assertSafeNavigationUrl(target, allowed);
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  return {
    browser,
    context,
    page,
    close: async () => {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
}

export interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  candidates: Array<{ role: string; name: string }>;
}

export async function readSnapshot(page: Page): Promise<PageSnapshot> {
  const raw = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll("button, a, input, select, textarea, [role]")).slice(0, 80);
    const candidates = elements.flatMap((element) => {
      const input = element as HTMLInputElement;
      const tag = element.tagName.toLowerCase();
      const explicit = element.getAttribute("role");
      const role =
        explicit ||
        (tag === "button" || (tag === "input" && ["submit", "button"].includes(input.type))
          ? "button"
          : tag === "select"
            ? "combobox"
            : tag === "a"
              ? "link"
              : tag === "textarea" || tag === "input"
                ? "textbox"
                : "");
      if (!role) return [];
      const labelled = input.labels?.[0]?.innerText ?? "";
      const name = (element.getAttribute("aria-label") || labelled || (element as HTMLElement).innerText || "").replace(/\s+/g, " ").trim();
      if (!name) return [];
      return [{ role, name: name.slice(0, 160) }];
    });
    return {
      url: location.href,
      title: document.title,
      text: (document.body?.innerText ?? "").replace(/\s+/g, " ").slice(0, 4000),
      candidates,
    };
  });
  return { ...raw, text: redactText(raw.text) };
}

export async function saveScreenshot(page: Page, runId: string, label: string, maxBytes: number) {
  await page.addStyleTag({ content: "input[type=password]{filter:blur(8px) !important}" }).catch(() => undefined);
  const buffer = await page.screenshot({ type: "jpeg", quality: 55, animations: "disabled" });
  if (buffer.length > maxBytes) {
    return null;
  }
  const id = createId("art");
  const directory = path.join(artifactRoot(), runId);
  await mkdir(directory, { recursive: true });
  const storagePath = path.join(directory, `${id}.jpg`);
  await writeFile(storagePath, buffer);
  const capturedAt = new Date();
  await prisma.runArtifact.create({
    data: {
      id,
      runId,
      kind: "screenshot",
      storagePath,
      checksum: sha256(buffer),
      mimeType: "image/jpeg",
      byteSize: buffer.length,
      label,
      capturedAt,
    },
  });
  return { id, capturedAt: capturedAt.toISOString() };
}

export async function verifyFetch(pathname: string): Promise<{ status: number; body: Record<string, string> | null }> {
  const token = process.env.PORTAL_VERIFY_TOKEN ?? "";
  try {
    const response = await fetch(`${portalOrigin()}${pathname}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404) return { status: 404, body: null };
    if (!response.ok) return { status: response.status, body: null };
    const body = (await response.json()) as Record<string, string>;
    return { status: response.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

export async function recordAi(input: {
  runId?: string;
  role: string;
  requestedModel: string;
  servedModel?: string | null;
  provider?: string | null;
  otariRequestId?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  costUsd?: string | null;
  pricingSource?: string | null;
  latencyMs?: number | null;
  status: string;
  error?: string | null;
}) {
  await prisma.aIRequest.create({
    data: {
      id: createId("air"),
      runId: input.runId,
      workspaceId: DEMO_WORKSPACE_ID,
      role: input.role,
      requestedModel: input.requestedModel,
      servedModel: input.servedModel ?? null,
      provider: input.provider ?? null,
      otariRequestId: input.otariRequestId ?? null,
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      totalTokens: input.totalTokens ?? null,
      costUsd: input.costUsd ?? null,
      pricingSource: input.pricingSource ?? null,
      latencyMs: input.latencyMs ?? null,
      status: input.status,
      error: input.error ?? null,
    },
  });
}

export async function heartbeat(status: string, details: unknown) {
  await prisma.serviceHeartbeat.upsert({
    where: { service: "worker" },
    update: { status, details: asJson(details) },
    create: { service: "worker", status, details: asJson(details) },
  });
}
