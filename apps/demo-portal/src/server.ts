import { createPortal, listenPortal } from "./app.js";
import { prismaStore } from "./prisma-store.js";

const port = Number(process.env.PORTAL_PORT ?? 4100);
const host = process.env.PORTAL_HOST ?? "127.0.0.1";
const adminToken = process.env.PORTAL_ADMIN_TOKEN ?? "";
const verifyToken = process.env.PORTAL_VERIFY_TOKEN ?? "";

if (!adminToken || !verifyToken) {
  console.error("PORTAL_ADMIN_TOKEN and PORTAL_VERIFY_TOKEN are required.");
  process.exit(1);
}

const handler = createPortal({ store: prismaStore(), adminToken, verifyToken });
const server = await listenPortal(handler, host, port);
console.log(`Northstar Vendor Portal listening on http://${host}:${port}`);

process.on("SIGINT", () => server.close());
process.on("SIGTERM", () => server.close());
