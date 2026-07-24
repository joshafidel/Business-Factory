import { prisma } from "@bf/database";
import { type ObjectInfo, type PutOptions, type StorageAdapter, type StoredObject } from "./types";

/**
 * Postgres-backed blob storage (driver "db"). Used automatically on
 * serverless deployments without S3 so generated media survives across
 * function instances — /tmp does not. Blobs are modest (images, short MP4s)
 * and prunable once published externally; move to S3/R2 when volume grows.
 */
export class DbStorage implements StorageAdapter {
  readonly driver = "db";

  async put(
    key: string,
    data: Buffer | Uint8Array | string,
    opts?: PutOptions,
  ): Promise<StoredObject> {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
    await prisma.storageBlob.upsert({
      where: { key },
      create: { key, data: buf, mimeType: opts?.contentType, sizeBytes: buf.byteLength },
      update: { data: buf, mimeType: opts?.contentType, sizeBytes: buf.byteLength },
    });
    return { key, sizeBytes: buf.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    const blob = await prisma.storageBlob.findUnique({ where: { key } });
    if (!blob) throw new Error(`Blob not found: ${key}`);
    return Buffer.from(blob.data);
  }

  async delete(key: string): Promise<void> {
    await prisma.storageBlob.deleteMany({ where: { key } });
  }

  async exists(key: string): Promise<boolean> {
    return (await prisma.storageBlob.count({ where: { key } })) > 0;
  }

  async list(prefix: string): Promise<ObjectInfo[]> {
    const blobs = await prisma.storageBlob.findMany({
      where: { key: { startsWith: prefix } },
      select: { key: true, sizeBytes: true, createdAt: true },
    });
    return blobs.map((b) => ({ key: b.key, sizeBytes: b.sizeBytes, lastModified: b.createdAt }));
  }

  async getSignedUrl(key: string): Promise<string> {
    return `/api/assets/raw?key=${encodeURIComponent(key)}`;
  }
}
