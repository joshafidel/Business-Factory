import { defineConfig } from "vitest/config";

// Playwright owns e2e/**; vitest must not collect those specs.
export default defineConfig({
  test: {
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
    passWithNoTests: true,
  },
});
