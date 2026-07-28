-- CreateEnum
CREATE TYPE "ListingProjectStatus" AS ENUM ('DRAFT', 'RENDERING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ListingRenderKind" AS ENUM ('PREVIEW', 'FINAL');

-- CreateEnum
CREATE TYPE "ListingRenderStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "ListingProject" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT,
    "name" TEXT NOT NULL,
    "status" "ListingProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "property" JSONB NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'vertical',
    "style" TEXT NOT NULL DEFAULT 'fast-social',
    "options" JSONB,
    "script" JSONB,
    "scriptWarnings" JSONB,
    "socialPackage" JSONB,
    "brandProfileId" TEXT,
    "coverPhotoId" TEXT,
    "rightsConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingPhoto" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'interior',
    "roomLabel" TEXT,
    "note" TEXT,
    "isExcluded" BOOLEAN NOT NULL DEFAULT false,
    "isStaged" BOOLEAN NOT NULL DEFAULT false,
    "isAiEnhanced" BOOLEAN NOT NULL DEFAULT false,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingRender" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "ListingRenderKind" NOT NULL,
    "status" "ListingRenderStatus" NOT NULL DEFAULT 'QUEUED',
    "workflowRunId" TEXT,
    "videoAssetId" TEXT,
    "settings" JSONB NOT NULL,
    "error" TEXT,
    "costMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingRender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agentName" TEXT,
    "brokerage" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "licenseNumber" TEXT,
    "disclaimer" TEXT,
    "callToAction" TEXT,
    "primaryColor" TEXT,
    "logoAssetId" TEXT,
    "headshotAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListingProject_organizationId_updatedAt_idx" ON "ListingProject"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "ListingPhoto_projectId_order_idx" ON "ListingPhoto"("projectId", "order");

-- CreateIndex
CREATE INDEX "ListingPhoto_assetId_idx" ON "ListingPhoto"("assetId");

-- CreateIndex
CREATE INDEX "ListingRender_projectId_createdAt_idx" ON "ListingRender"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ListingRender_organizationId_status_idx" ON "ListingRender"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BrandProfile_organizationId_name_key" ON "BrandProfile"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "ListingProject" ADD CONSTRAINT "ListingProject_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingProject" ADD CONSTRAINT "ListingProject_brandProfileId_fkey" FOREIGN KEY ("brandProfileId") REFERENCES "BrandProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingPhoto" ADD CONSTRAINT "ListingPhoto_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ListingProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingPhoto" ADD CONSTRAINT "ListingPhoto_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingRender" ADD CONSTRAINT "ListingRender_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ListingProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingRender" ADD CONSTRAINT "ListingRender_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandProfile" ADD CONSTRAINT "BrandProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
