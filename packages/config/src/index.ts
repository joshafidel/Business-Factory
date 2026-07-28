import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Load the repo-root .env into process.env for processes that don't do it
 * themselves (worker, seed scripts, tests). Existing variables always win;
 * this never overrides real environment configuration.
 */
export function hydrateEnvFromDotfile(): void {
  if (process.env.__BF_ENV_HYDRATED === "1") return;
  process.env.__BF_ENV_HYDRATED = "1";
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate)) {
      for (const line of fs.readFileSync(candidate, "utf8").split("\n")) {
        const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
        if (!match) continue;
        const key = match[1] as string;
        let value = (match[2] as string).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/**
 * Server-side environment configuration, validated once at startup.
 * Never import this from client components — it will throw at build time
 * because the variables are not exposed to the browser (by design).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().url().or(z.string().startsWith("postgresql://")),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  /**
   * How workflow steps execute:
   *  - "queue": BullMQ jobs processed by the separate worker (default when
   *    REDIS_URL is explicitly configured)
   *  - "inline": steps run in-process right after the triggering request —
   *    no Redis or worker needed. Used for serverless-only deployments
   *    (e.g. Vercel without a worker host). Schedules and long DELAY steps
   *    require the worker and are unavailable inline.
   */
  EXECUTION_MODE: z.enum(["queue", "inline"]).optional(),

  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 chars"),
  AUTH_URL: z.string().optional(),

  SECRET_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "SECRET_ENCRYPTION_KEY must be 32 bytes hex (openssl rand -hex 32)"),

  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  // YouTube publishing (Zoo Shorts). All three must be set to enable uploads.
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_REFRESH_TOKEN: z.string().optional(),

  // Higgsfield image-to-video animation (Zoo Shorts). Both keys plus
  // APP_BASE_URL (a publicly reachable deployment URL so Higgsfield can
  // fetch scene images) are required to enable animated clips.
  HIGGSFIELD_API_KEY: z.string().optional(),
  HIGGSFIELD_SECRET: z.string().optional(),
  /** Higgsfield model tier: dop-lite (cheap living-photo) | dop-preview | dop-turbo. */
  HIGGSFIELD_MODEL: z.string().optional(),
  APP_BASE_URL: z.string().url().optional(),

  // fal.ai (optional): higher-quality image-to-video motion (Kling tier).
  // When set, the zoo pipeline prefers it over Higgsfield for scene motion.
  FAL_KEY: z.string().optional(),

  // ElevenLabs: expressive narration voices + Eleven Music (real sung songs
  // with custom lyrics, commercially licensed). Set the API key to upgrade
  // both voice and music; voice id optional (defaults to a warm female voice).
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),

  // Picsart (Listing Video Factory, optional): image enhancement and
  // conservative AI image-to-video motion. Absent key = deterministic
  // motion only; nothing breaks.
  PICSART_API_KEY: z.string().optional(),

  // MLS listing feed via SimplyRETS (Listing Video Factory). Credentials
  // come from a licensed MLS/IDX feed; without them the public sample feed
  // is used and clearly labeled as such.
  SIMPLYRETS_USERNAME: z.string().optional(),
  SIMPLYRETS_PASSWORD: z.string().optional(),

  STORAGE_DRIVER: z.enum(["local", "s3", "db"]).default("local"),
  STORAGE_LOCAL_ROOT: z.string().default(".data/storage"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  WORKER_HEALTH_PORT: z.coerce.number().int().default(3010),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Vercel database integrations inject POSTGRES_URL / POSTGRES_PRISMA_URL
 * rather than DATABASE_URL. Normalize so Prisma and the app find the DB
 * regardless of which integration created it.
 */
export function normalizeDatabaseUrl(): void {
  if (!process.env.DATABASE_URL) {
    const fallback =
      process.env.POSTGRES_PRISMA_URL ??
      process.env.POSTGRES_URL ??
      process.env.POSTGRES_URL_NON_POOLING;
    if (fallback) process.env.DATABASE_URL = fallback;
  }
}

/** Parse and cache process.env. Throws a readable error listing every missing var. */
export function loadEnv(overrides?: Partial<Record<keyof Env, string>>): Env {
  if (cached && !overrides) return cached;
  hydrateEnvFromDotfile();
  normalizeDatabaseUrl();
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (!overrides) cached = parsed.data;
  return parsed.data;
}

/** For tests: reset the cached env. */
export function resetEnvCache(): void {
  cached = null;
}
