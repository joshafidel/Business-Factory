import { prisma, type Prisma } from "@bf/database";
import { can } from "@bf/shared";
import { listingOptionsSchema, listingPropertySchema, trackEvent } from "@bf/workflows";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";
import { getOrgContext } from "@/lib/session";

/**
 * REST surface for Listing Video Factory projects (session-authenticated,
 * same permissions as the UI). Lets API clients script the full
 * photos-to-video flow alongside the existing /api/workflows endpoints.
 */

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  property: z.record(z.unknown()).default({}),
  /** API callers assert usage rights explicitly, like the UI checkbox. */
  rightsConfirmed: z.boolean().default(false),
  format: z.enum(["vertical", "landscape", "square"]).optional(),
  style: z.string().optional(),
  options: z.record(z.unknown()).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx.role, "workflows:execute")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await checkRateLimit(`lvf-create:${ctx.userId}`, 20, 60))) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof z.ZodError ? err.issues.map((i) => i.message).join("; ") : "Invalid body" },
      { status: 400 },
    );
  }
  const property = listingPropertySchema.parse(body.property);
  const project = await prisma.listingProject.create({
    data: {
      organizationId: ctx.organizationId,
      createdById: ctx.userId,
      name: body.name,
      property: property as Prisma.InputJsonValue,
      options: listingOptionsSchema.parse(body.options ?? {}) as Prisma.InputJsonValue,
      ...(body.format ? { format: body.format } : {}),
      ...(body.style ? { style: body.style } : {}),
      rightsConfirmedAt: body.rightsConfirmed ? new Date() : null,
    },
  });
  await trackEvent(ctx.organizationId, "lvf_projects_created");
  return NextResponse.json({ projectId: project.id }, { status: 201 });
}

export async function GET(): Promise<NextResponse> {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projects = await prisma.listingProject.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, name: true, status: true, format: true, style: true, updatedAt: true },
  });
  return NextResponse.json({ projects });
}
