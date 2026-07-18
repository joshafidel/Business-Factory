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
      throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY");
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
    cached = new LocalFsStorage(env.STORAGE_LOCAL_ROOT);
  }
  return cached;
}

/** For tests. */
export function resetStorageCache(): void {
  cached = null;
}
