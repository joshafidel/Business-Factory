import { loadEnv } from "@bf/config";
import { LocalFsStorage } from "./local";
import { S3Storage } from "./s3";
import { type StorageAdapter } from "./types";

let cached: StorageAdapter | null = null;

/** Build the storage adapter selected by STORAGE_DRIVER. */
export function getStorage(): StorageAdapter {
  if (cached) return cached;
  const env = loadEnv();
  if (env.STORAGE_DRIVER === "s3") {
    if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
      throw new Error(
        "STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY",
      );
    }
    cached = new S3Storage({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  } else {
    // Serverless filesystems (Vercel/Lambda) are read-only except /tmp.
    // Falling back keeps the pipeline working, but /tmp is per-instance and
    // ephemeral — configure STORAGE_DRIVER=s3 for persistent assets in prod.
    const root =
      process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
        ? "/tmp/bf-storage"
        : env.STORAGE_LOCAL_ROOT;
    cached = new LocalFsStorage(root);
  }
  return cached;
}

/** For tests. */
export function resetStorageCache(): void {
  cached = null;
}
