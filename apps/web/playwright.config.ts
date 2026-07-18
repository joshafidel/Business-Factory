import { defineConfig } from "@playwright/test";

/**
 * E2E tests drive the real stack: Next.js web app + background worker +
 * Postgres + Redis. Prereqs: `pnpm infra:up && pnpm db:migrate && pnpm db:seed`.
 * Both servers are started automatically (reused when already running).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 1,
  workers: 1, // approval flows mutate shared seed state; keep serial
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    // In environments with a system-provided Chromium (e.g. CI images that
    // preinstall browsers), point Playwright at it instead of downloading.
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
  webServer: [
    {
      command: "pnpm dev",
      url: "http://localhost:3000/sign-in",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @bf/worker dev",
      cwd: "../..",
      url: "http://localhost:3010",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
