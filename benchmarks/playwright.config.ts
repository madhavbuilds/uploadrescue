import { defineConfig, devices } from "@playwright/test";

/** Run with: pnpm bench (Chromium; writes benchmarks/image-performance.md). */
export default defineConfig({
  testDir: ".",
  testMatch: "*.bench.ts",
  timeout: 300_000,
  workers: 1,
  reporter: "list",
  use: { trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm exec vite --config tests/browser/harness/vite.config.ts",
    port: 5176,
    reuseExistingServer: true,
    cwd: "..",
  },
});
