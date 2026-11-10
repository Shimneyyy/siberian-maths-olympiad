import { PrismaPg } from "./pg-adapter";
import "server-only";
import { PrismaClient } from "@prisma/client";
const poolMax = Number(process.env.DATABASE_POOL_MAX || 20);
if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 50) throw new Error("DATABASE_POOL_MAX must be between 1 and 50");
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalForPrisma.prisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: poolMax }), transactionOptions: { maxWait: 3000 } });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
