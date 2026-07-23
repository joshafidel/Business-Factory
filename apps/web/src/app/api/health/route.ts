import { prisma } from "@bf/database";
import { getExecutionMode, getWorkerHealth, redisHealthy } from "@bf/queue";
import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  const inline = getExecutionMode() === "inline";
  const redis = inline ? false : await redisHealthy();
  const workers = redis ? await getWorkerHealth() : [];
  return NextResponse.json(
    {
      ok: db && (redis || inline),
      mode: inline ? "inline" : "queue",
      db,
      redis,
      workers: workers.map((w) => ({ id: w.workerId, healthy: w.healthy })),
    },
    { status: db && (redis || inline) ? 200 : 503 },
  );
}
