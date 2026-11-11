import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { flowproofPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.flowproofPrisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === "1" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.flowproofPrisma = prisma;

export function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export { Prisma };
