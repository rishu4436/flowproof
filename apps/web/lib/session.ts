import { cookies } from "next/headers";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@flowproof/database";
import { decodeSession, demoToken, encodeSession, type SessionPayload } from "./session-token";

const COOKIE = "fp_session";

export function demoMode() {
  return process.env.FLOWPROOF_DEMO_MODE !== "false";
}

export { decodeSession, demoToken, encodeSession, type SessionPayload };

export async function readSession() {
  const jar = await cookies();
  return decodeSession(jar.get(COOKIE)?.value);
}

export async function requireSession() {
  const session = await readSession();
  if (session) return session;
  if (!demoMode()) {
    const error = new Error("Production automation is disabled until authentication is configured.");
    (error as Error & { status?: number }).status = 403;
    throw error;
  }
  return {
    userId: DEMO_USER_ID,
    workspaceId: DEMO_WORKSPACE_ID,
    name: "Demo Operator",
    exp: Date.now() + 1000 * 60 * 60,
  };
}
