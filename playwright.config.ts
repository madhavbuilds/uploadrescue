import { defineConfig, devices } from "@playwright/test";

const reuse = !process.env.CI;

export default defineConfig({
  testDir: "tests/browser",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // Traces capture large image/network payloads; only keep them in CI.
  use: { trace: process.env.CI ? "retain-on-failure" : "off", screenshot: "off", video: "off" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: "pnpm exec vite --config tests/browser/harness/vite.config.ts",
      port: 5176,
      reuseExistingServer: reuse,
    },
    {
      command: "pnpm --filter @uploadrescue/example-react dev",
      port: 5174,
      reuseExistingServer: reuse,
    },
    {
      command: "pnpm --filter @uploadrescue/example-vanilla dev",
      port: 5175,
      reuseExistingServer: reuse,
    },
    {
      command: "pnpm --filter @uploadrescue/website dev --port 5173 --strictPort",
      port: 5173,
      reuseExistingServer: reuse,
    },
  ],
});
