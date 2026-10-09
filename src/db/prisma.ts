import { PrismaPg } from "@prisma/adapter-pg";
import "server-only";

import { serverEnv } from "@/config/env.server";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: serverEnv.DATABASE_URL });
  // The post pipeline waits 20-40s on AI/image calls between database calls,
  // so the pooled connection is stale and a reconnect (~1.6s measured) can
  // exceed Prisma's 2s default wait for a transaction to start.
  return new PrismaClient({
    adapter,
    transactionOptions: { maxWait: 10_000, timeout: 20_000 },
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
