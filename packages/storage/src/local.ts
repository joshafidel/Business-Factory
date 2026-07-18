import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type ObjectInfo,
  type PutOptions,
  type StorageAdapter,
  type StoredObject,
} from "./types";

/**
 * Local filesystem storage for development. Keys are sanitized to stay inside
 * the root directory (no traversal). Signed URLs resolve to the web app's
 * /api/assets/raw route which streams from disk after an auth check.
 */
export class LocalFsStorage implements StorageAdapter {
  readonly driver = "local";

  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const safe = path
      .normalize(key)
      .replace(/^(\.\.(\/|\\|$))+/, "")
      .replace(/^[/\\]+/, "");
    const full = path.resolve(this.root, safe);
    if (!full.startsWith(path.resolve(this.root))) {
      throw new Error(`Storage key escapes root: ${key}`);
    }
    return full;
  }

  async put(
    key: string,
    data: Buffer | Uint8Array | string,
    _opts?: PutOptions,
  ): Promise<StoredObject> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
    await fs.writeFile(full, buf);
    return { key, sizeBytes: buf.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix: string): Promise<ObjectInfo[]> {
    const dir = this.resolve(prefix);
    const results: ObjectInfo[] = [];
    const walk = async (current: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else {
          const stat = await fs.stat(full);
          results.push({
            key: path.relative(path.resolve(this.root), full).split(path.sep).join("/"),
            sizeBytes: stat.size,
            lastModified: stat.mtime,
          });
        }
      }
    };
    await walk(dir);
    return results;
  }

  async getSignedUrl(key: string): Promise<string> {
    return `/api/assets/raw?key=${encodeURIComponent(key)}`;
  }
}
