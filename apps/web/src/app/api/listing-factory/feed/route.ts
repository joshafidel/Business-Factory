import { prisma, type Prisma } from "@bf/database";
import { can } from "@bf/shared";
import {
  getListingFeed,
  listingOptionsSchema,
  listingPropertySchema,
  trackEvent,
} from "@bf/workflows";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { attachListingPhotos, downloadListingPhotos } from "@/lib/lvf-photos";
import { checkRateLimit } from "@/lib/rate-limit";
import { getOrgContext } from "@/lib/session";

export const maxDuration = 120;

/** Search the connected MLS feed for active listings to make videos from. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await checkRateLimit(`lvf-feed:${ctx.userId}`, 30, 60))) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const feed = getListingFeed();
  try {
    const listings = await feed.searchListings({ q, limit: 12 });
    return NextResponse.json({
      isDemo: feed.isDemo,
      listings: listings.map((l) => ({
        mlsId: l.mlsId,
        address: l.address,
        city: l.city,
        state: l.state,
        price: l.price,
        beds: l.beds,
        baths: l.baths,
        sqft: l.sqft,
        photoCount: l.photos.length,
        coverPhoto: l.photos[0] ?? null,
        agentName: l.agentName,
        brokerage: l.brokerage,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message?.slice(0, 200) }, { status: 502 });
  }
}

/** Import a feed listing as a ready-to-render project (API twin of the UI). */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx.role, "workflows:execute")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await checkRateLimit(`lvf-import:${ctx.userId}`, 10, 60))) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }
  let mlsId: string;
  try {
    mlsId = z.object({ mlsId: z.string().min(1) }).parse(await request.json()).mlsId;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const feed = getListingFeed();
  const listing = await feed.getListing(mlsId);
  if (!listing)
    return NextResponse.json({ error: "Listing not found in the feed" }, { status: 404 });
  const property = listingPropertySchema.parse({
    address: [listing.address, listing.city, listing.state].filter(Boolean).join(", "),
    city: listing.city,
    state: listing.state,
    price: listing.price,
    beds: listing.beds,
    baths: listing.baths,
    sqft: listing.sqft,
    mlsNumber: listing.listingId,
    description: listing.description,
    agentName: listing.agentName,
    brokerage: listing.brokerage,
    agentPhone: listing.agentPhone,
    agentEmail: listing.agentEmail,
  });
  const project = await prisma.listingProject.create({
    data: {
      organizationId: ctx.organizationId,
      createdById: ctx.userId,
      name: `${listing.address}${feed.isDemo ? " (sample feed)" : ""}`.slice(0, 120),
      property: property as Prisma.InputJsonValue,
      options: listingOptionsSchema.parse({}) as Prisma.InputJsonValue,
      rightsConfirmedAt: new Date(),
    },
  });
  const incoming = await downloadListingPhotos(listing.photos);
  const { created } = await attachListingPhotos(ctx.organizationId, project, incoming);
  await trackEvent(ctx.organizationId, "lvf_projects_created");
  await trackEvent(ctx.organizationId, "lvf_feed_imports");
  return NextResponse.json({ projectId: project.id, photoCount: created.length }, { status: 201 });
}
