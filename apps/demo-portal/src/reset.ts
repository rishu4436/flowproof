import { prisma } from "@flowproof/database";
import { prismaStore } from "./prisma-store.js";

await prismaStore().reset();
console.log("Reset Northstar demo data to scenario A.");
await prisma.$disconnect();
