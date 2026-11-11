import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { mkdirSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve("data/pglite");
mkdirSync(dataDir, { recursive: true });
const db = new PGlite(dataDir);
await db.waitReady;
const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 5432, maxConnections: 20 });
await server.start();
console.log("PGlite listening on 127.0.0.1:5432");
