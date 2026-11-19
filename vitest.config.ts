import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

// Tests import workspace packages from source so no build is required.
const alias = readdirSync(`${root}packages`)
  .filter((dir) => existsSync(`${root}packages/${dir}/src/index.ts`))
  .map((dir) => ({
    find: new RegExp(`^@uploadrescue/${dir}$`),
    replacement: `${root}packages/${dir}/src/index.ts`,
  }));

const domPackages = ["react", "vanilla", "ui", "upload-adapters"];

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          include: [
            "packages/*/test/**/*.test.ts",
            "tests/integration/**/*.test.ts",
            "tests/security/**/*.test.ts",
          ],
          exclude: domPackages.map((p) => `packages/${p}/test/**`),
        },
      },
      {
        resolve: { alias },
        test: {
          name: "dom",
          environment: "happy-dom",
          include: domPackages.map((p) => `packages/${p}/test/**/*.test.{ts,tsx}`),
          exclude: ["**/*.ssr.test.tsx"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "ssr",
          environment: "node",
          include: ["packages/react/test/**/*.ssr.test.tsx"],
        },
      },
    ],
  },
});
