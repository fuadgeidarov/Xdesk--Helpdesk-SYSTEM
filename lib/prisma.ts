import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const transactionMaxWait = positiveInt(process.env.DB_TRANSACTION_MAX_WAIT_MS, 10_000);
const transactionTimeout = positiveInt(process.env.DB_TRANSACTION_TIMEOUT_MS, 15_000);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    transactionOptions: {
      maxWait: transactionMaxWait,
      timeout: transactionTimeout,
    },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
