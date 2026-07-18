import { hydrateEnvFromDotfile } from "@bf/config";
import { PrismaClient } from "@prisma/client";

// Ensure DATABASE_URL is present for processes that don't load .env themselves.
hydrateEnvFromDotfile();

/**
 * Singleton Prisma client. In Next.js dev, module reloads would otherwise
 * exhaust the connection pool; the global stash prevents that.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type { PrismaClient };
