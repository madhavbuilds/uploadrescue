import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");
const packages = join(root, "packages");

export default defineConfig({
  root: here,
  // Reuse the self-hosted FFmpeg core copied by the website build.
  publicDir: join(root, "apps/website/public"),
  resolve: {
    alias: [
      ...readdirSync(packages).map((dir) => ({
        find: new RegExp(`^@uploadrescue/${dir}$`),
        replacement: join(packages, dir, "src/index.ts"),
      })),
      { find: /^pdf-lib$/, replacement: join(packages, "pdf-engine/node_modules/pdf-lib") },
      { find: /^fflate$/, replacement: join(packages, "archive-engine/node_modules/fflate") },
    ],
  },
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] },
  server: { port: 5176, strictPort: true, fs: { allow: [root] } },
});
