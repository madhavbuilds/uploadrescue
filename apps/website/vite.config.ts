import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const packages = join(here, "../../packages");

// The site always runs against the current package sources.
const alias = [
  { find: "@uploadrescue/ui/styles.css", replacement: join(packages, "ui/src/styles.css") },
  ...readdirSync(packages).map((dir) => ({
    find: new RegExp(`^@uploadrescue/${dir}$`),
    replacement: join(packages, dir, "src/index.ts"),
  })),
];

/** Self-hosts the FFmpeg core for the playground's media engine (never loaded from a CDN). */
function ffmpegCore(): Plugin {
  return {
    name: "uploadrescue:ffmpeg-core",
    buildStart() {
      // @ffmpeg/core doesn't export package.json; resolve through node_modules directly.
      const source = join(here, "node_modules/@ffmpeg/core/dist/esm");
      const target = join(here, "public/ffmpeg");
      if (!existsSync(join(target, "ffmpeg-core.wasm"))) {
        mkdirSync(target, { recursive: true });
        cpSync(source, target, { recursive: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), ffmpegCore()],
  resolve: { alias },
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] },
  build: { target: "es2022", chunkSizeWarningLimit: 900 },
  worker: { format: "es" },
});
