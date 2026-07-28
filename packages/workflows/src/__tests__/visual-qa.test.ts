import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseQaVerdict } from "@bf/providers";
import { describe, expect, it } from "vitest";
import { downscaleForQa, extractQaFrames, resolveFfmpeg } from "../functions/media-utils";

describe("QA verdict parsing", () => {
  it("parses a clean JSON verdict", () => {
    const v = parseQaVerdict(
      '{"score": 82, "criticalDefects": ["second trunk"], "minorIssues": ["soft focus"]}',
    );
    expect(v).toEqual({ score: 82, criticalDefects: ["second trunk"], minorIssues: ["soft focus"] });
  });

  it("tolerates prose around the JSON and clamps the score", () => {
    const v = parseQaVerdict('Here is my verdict:\n{"score": 250, "criticalDefects": []}\nDone.');
    expect(v?.score).toBe(100);
    expect(v?.criticalDefects).toEqual([]);
    expect(v?.minorIssues).toEqual([]);
  });

  it("returns null for garbage", () => {
    expect(parseQaVerdict("no json here")).toBeNull();
  });
});

describe("QA frame extraction", () => {
  const makeClip = (): Buffer => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "qa-test-"));
    const out = path.join(dir, "clip.mp4");
    execFileSync(
      resolveFfmpeg(),
      ["-y", "-f", "lavfi", "-i", "testsrc=size=320x480:rate=12:duration=3", "-pix_fmt", "yuv420p", out],
      { stdio: ["ignore", "ignore", "pipe"], timeout: 60_000 },
    );
    const buf = readFileSync(out);
    rmSync(dir, { recursive: true, force: true });
    return buf;
  };

  it("samples the requested number of PNG frames from a clip", () => {
    const frames = extractQaFrames(makeClip(), 4);
    expect(frames).toHaveLength(4);
    for (const f of frames) {
      expect(f.subarray(1, 4).toString()).toBe("PNG");
      expect(f.length).toBeGreaterThan(500);
    }
  });

  it("downscales a still to QA size", () => {
    const still = extractQaFrames(makeClip(), 1)[0] as Buffer;
    const small = downscaleForQa(still);
    expect(small.subarray(1, 4).toString()).toBe("PNG");
  });
});
