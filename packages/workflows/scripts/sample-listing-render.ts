/* eslint-disable no-console */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { hydrateEnvFromDotfile } from "@bf/config";

hydrateEnvFromDotfile();

/**
 * End-to-end smoke run for Listing Video Factory, no browser needed:
 * placeholder photos → install → project → script (mock agent) → render
 * workflow (mock TTS + ffmpeg) → verified MP4 written to OUT (or cwd).
 *
 *   pnpm --filter @bf/workflows exec tsx scripts/sample-listing-render.ts
 */
async function main(): Promise<void> {
  const { prisma } = await import("@bf/database");
  const { getStorage } = await import("@bf/storage");
  const workflows = await import("../src/index");
  const { resolveFfmpeg } = await import("../src/functions/media-utils");
  const {
    ensureListingFactoryInstalled,
    generateListingScript,
    listingOptionsSchema,
    listingPropertySchema,
    listingScriptSchema,
    renderSettingsSchema,
    RENDER_WORKFLOW_KEY,
    startWorkflowRun,
    advanceWorkflowRun,
  } = workflows as typeof workflows & {
    advanceWorkflowRun: (runId: string, enqueue: unknown) => Promise<void>;
  };

  const org = await prisma.organization.findUniqueOrThrow({ where: { slug: "factory-demo" } });
  console.log("→ installing module");
  await ensureListingFactoryInstalled(org.id);

  // Placeholder listing photos: distinct gradient frames from ffmpeg.
  const ffmpeg = resolveFfmpeg();
  const dir = mkdtempSync(path.join(os.tmpdir(), "lvf-sample-"));
  const rooms = [
    ["Exterior", "exterior"],
    ["Living room", "interior"],
    ["Kitchen", "interior"],
    ["Primary bedroom", "interior"],
    ["Bathroom", "interior"],
    ["Backyard", "exterior"],
  ] as const;
  const colors = ["0x7A9CC6", "0xC6AE7A", "0x8FBF8F", "0xB78FBF", "0xBF8F8F", "0x7ABFB4"];
  const photoFiles = rooms.map(([label], i) => {
    const file = path.join(dir, `photo${i}.jpg`);
    execFileSync(
      ffmpeg,
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `testsrc2=s=1600x1067:d=1`,
        "-f",
        "lavfi",
        "-i",
        `color=c=${colors[i]}@0.75:s=1600x1067:d=1`,
        "-filter_complex",
        "[0:v][1:v]overlay=0:0",
        "-frames:v",
        "1",
        file,
      ],
      { stdio: "ignore" },
    );
    console.log(`→ placeholder photo: ${label}`);
    return file;
  });

  const property = listingPropertySchema.parse({
    address: "12 Maple Street, Pittsburgh, PA",
    city: "Pittsburgh",
    state: "PA",
    price: "$459,000",
    beds: "3",
    baths: "2",
    sqft: "1,850",
    propertyType: "Single-family",
    description: "Renovated kitchen with quartz counters. Fenced backyard with a patio.",
    agentName: "Jordan Avery",
    brokerage: "Avery Realty Group",
    agentPhone: "(412) 555-0142",
    callToAction: "Book a private tour this weekend",
  });
  const project = await prisma.listingProject.create({
    data: {
      organizationId: org.id,
      name: "Sample: 12 Maple Street",
      property,
      options: listingOptionsSchema.parse({ targetSeconds: 35 }),
      style: "fast-social",
      format: "vertical",
      rightsConfirmedAt: new Date(),
    },
  });
  const storage = getStorage();
  for (let i = 0; i < photoFiles.length; i++) {
    const data = readFileSync(photoFiles[i]!);
    const stored = await storage.put(`${org.id}/${project.id}/sample-photo-${i}`, data, {
      contentType: "image/jpeg",
    });
    const asset = await prisma.asset.create({
      data: {
        organizationId: org.id,
        name: `Sample photo ${i + 1}`,
        type: "IMAGE",
        mimeType: "image/jpeg",
        storageDriver: storage.driver,
        storageKey: stored.key,
        sizeBytes: stored.sizeBytes,
        moduleKey: "listing-video-factory",
        source: "sample-script",
        approvalStatus: "PENDING_REVIEW",
      },
    });
    await prisma.listingPhoto.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        assetId: asset.id,
        order: i,
        category: rooms[i]![1],
        roomLabel: rooms[i]![0],
      },
    });
  }
  console.log(`→ project ${project.id} with ${photoFiles.length} photos`);

  console.log("→ generating script (mock agent unless ANTHROPIC_API_KEY is set)");
  const { script, warnings } = await generateListingScript({
    organizationId: org.id,
    projectId: project.id,
  });
  console.log(`   scenes: ${script.scenes.length}, warnings: ${warnings.length}`);

  const photos = await prisma.listingPhoto.findMany({
    where: { projectId: project.id, isExcluded: false },
    orderBy: { order: "asc" },
  });
  const settings = renderSettingsSchema.parse({
    kind: "final",
    format: "vertical",
    style: "fast-social",
    options: listingOptionsSchema.parse({ targetSeconds: 35 }),
    property,
    script: listingScriptSchema.parse(script),
    photoIds: photos.map((p) => p.id),
    overlays: [],
  });
  const render = await prisma.listingRender.create({
    data: { organizationId: org.id, projectId: project.id, kind: "FINAL", settings },
  });

  // Drive the workflow inline (what the queue/serverless dispatcher does).
  const pending: string[] = [];
  const enqueue = async (runId: string): Promise<void> => {
    pending.push(runId);
  };
  console.log("→ starting render workflow");
  const run = await startWorkflowRun({
    organizationId: org.id,
    workflowKey: RENDER_WORKFLOW_KEY,
    input: { renderId: render.id, projectId: project.id },
    triggeredBy: { kind: "api", id: "sample-script" },
    enqueueAdvance: enqueue,
  });
  await prisma.listingRender.update({ where: { id: render.id }, data: { workflowRunId: run.id } });
  let guard = 0;
  while (pending.length > 0 && guard++ < 50) {
    const runId = pending.shift()!;
    await advanceWorkflowRun(runId, enqueue);
  }

  const finalRun = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
  const finalRender = await prisma.listingRender.findUniqueOrThrow({ where: { id: render.id } });
  console.log(`→ run ${finalRun.status}, render ${finalRender.status}`);
  if (finalRender.status !== "COMPLETED" || !finalRender.videoAssetId) {
    console.error("Render failed:", finalRender.error, JSON.stringify(finalRun.error));
    process.exit(1);
  }
  const videoAsset = await prisma.asset.findUniqueOrThrow({
    where: { id: finalRender.videoAssetId },
  });
  const bytes = await storage.get(videoAsset.storageKey);
  const out = process.env.OUT ?? path.join(process.cwd(), "sample-listing-video.mp4");
  const fs = await import("node:fs");
  fs.writeFileSync(out, bytes);
  console.log(`→ wrote ${out} (${(bytes.length / 1024 / 1024).toFixed(2)} MB)`);
  // Print stream info for verification (ffmpeg -i writes to stderr).
  try {
    execFileSync(ffmpeg, ["-i", out], { stdio: ["ignore", "ignore", "inherit"] });
  } catch {
    // ffmpeg exits 1 when no output is given — expected.
  }
  rmSync(dir, { recursive: true, force: true });
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
