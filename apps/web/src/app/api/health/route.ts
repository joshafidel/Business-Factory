import { prisma } from "@bf/database";
import { getExecutionMode, getWorkerHealth, redisHealthy } from "@bf/queue";
import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  let db = false;
  let dbError: string | null = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch (err) {
    db = false;
    // Sanitized diagnostic: never include credentials from connection strings.
    dbError = String(err instanceof Error ? err.message : err)
      .replace(/\/\/[^@\s]+@/g, "//***@")
      .slice(0, 300);
  }
  const inline = getExecutionMode() === "inline";
  const redis = inline ? false : await redisHealthy();
  const workers = redis ? await getWorkerHealth() : [];
  return NextResponse.json(
    {
      ok: db && (redis || inline),
      mode: inline ? "inline" : "queue",
      db,
      dbError,
      redis,
      workers: workers.map((w) => ({ id: w.workerId, healthy: w.healthy })),
    },
    { status: db && (redis || inline) ? 200 : 503 },
  );
}
