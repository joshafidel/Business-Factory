-- CreateEnum
CREATE TYPE "PurchaseKind" AS ENUM ('ONE_TIME', 'SUBSCRIPTION');

-- CreateTable
CREATE TABLE "PurchaseRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "PurchaseKind" NOT NULL,
    "vendor" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amountMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "cadence" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "purchasedAt" TIMESTAMP(3),
    "isEstimate" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseRecord_organizationId_kind_idx" ON "PurchaseRecord"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRecord_organizationId_key_key" ON "PurchaseRecord"("organizationId", "key");

-- AddForeignKey
ALTER TABLE "PurchaseRecord" ADD CONSTRAINT "PurchaseRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
