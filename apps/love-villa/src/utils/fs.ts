import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export function readJsonIfExists<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  return readJson<T>(file);
}

export function writeJson(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

export function writeText(file: string, value: string): void {
  ensureDir(path.dirname(file));
  writeFileSync(file, value.endsWith("\n") ? value : value + "\n");
}

export function episodeId(n: number): string {
  return `episode-${String(n).padStart(3, "0")}`;
}
