import { Prisma } from "@prisma/client";

/**
 * Retry only Prisma P2034 (transaction write conflict/deadlock). Failed
 * transactions are rolled back by PostgreSQL, so retrying this code is safe.
 * We deliberately do not retry ambiguous connection failures to avoid duplicate
 * ticket/comment creation.
 */
export async function withTransactionRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retryable || attempt === attempts) throw error;
      const delay = 50 * 2 ** (attempt - 1) + Math.floor(Math.random() * 50);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
