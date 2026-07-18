import { prisma } from "@bf/database";
import { getWorkerHealth, redisHealthy } from "@bf/queue";
import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  const redis = await redisHealthy();
  const workers = redis ? await getWorkerHealth() : [];
  return NextResponse.json(
    {
      ok: db && redis,
      db,
      redis,
      workers: workers.map((w) => ({ id: w.workerId, healthy: w.healthy })),
    },
    { status: db && redis ? 200 : 503 },
  );
}
