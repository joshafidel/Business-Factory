import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LocalFsStorage } from "../local";

const root = mkdtempSync(path.join(os.tmpdir(), "bf-storage-"));
const storage = new LocalFsStorage(root);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("LocalFsStorage", () => {
  it("puts, gets, lists, and deletes", async () => {
    const stored = await storage.put("org1/run1/file.txt", "hello world");
    expect(stored.sizeBytes).toBe(11);
    expect((await storage.get("org1/run1/file.txt")).toString()).toBe("hello world");
    expect(await storage.exists("org1/run1/file.txt")).toBe(true);

    const listed = await storage.list("org1");
    expect(listed.map((o) => o.key)).toContain("org1/run1/file.txt");

    await storage.delete("org1/run1/file.txt");
    expect(await storage.exists("org1/run1/file.txt")).toBe(false);
  });

  it("blocks path traversal", async () => {
    await storage.put("safe.txt", "ok");
    // Traversal segments are stripped, so the write lands inside the root.
    const stored = await storage.put("../../etc/passwd-probe", "nope");
    expect(stored.key).toBe("../../etc/passwd-probe");
    const listed = await storage.list("");
    for (const obj of listed) {
      expect(path.resolve(root, obj.key).startsWith(path.resolve(root))).toBe(true);
    }
  });

  it("returns an app-served signed URL", async () => {
    expect(await storage.getSignedUrl("a/b.txt")).toContain("/api/assets/raw?key=");
  });
});
