export interface PutOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface StoredObject {
  key: string;
  sizeBytes: number;
}

export interface ObjectInfo {
  key: string;
  sizeBytes: number;
  lastModified?: Date;
}

/**
 * S3-compatible storage abstraction. Assets in the DB reference
 * (driver, key) pairs; blobs never live in Postgres.
 */
export interface StorageAdapter {
  readonly driver: string;
  put(key: string, data: Buffer | Uint8Array | string, opts?: PutOptions): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(prefix: string): Promise<ObjectInfo[]>;
  /** URL a browser can fetch. Local driver returns an app-served path. */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}
