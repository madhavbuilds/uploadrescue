import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
// @ts-expect-error -- plain JS helper shared by the examples
import { uploadServerPlugin } from "../shared/upload-server.mjs";

export default defineConfig({
  plugins: [react(), uploadServerPlugin({ limit: 1024 * 1024 })],
});
