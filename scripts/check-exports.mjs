// Verifies every published package: publint rules, and that the built ESM and
// CJS entry points actually load in Node (no browser globals at import time).
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { publint } from "publint";

const root = fileURLToPath(new URL("..", import.meta.url));
let failed = false;
for (const dir of readdirSync(join(root, "packages")).sort()) {
  const pkgDir = join(root, "packages", dir);
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const { messages } = await publint({ pkgDir, strict: true });
  const problems = messages.filter((m) => m.type !== "suggestion");
  const require = createRequire(join(pkgDir, "package.json"));
  let esm = "ok";
  let cjs = "ok";
  try {
    await import(pathToFileURL(join(pkgDir, pkg.exports["."].import.default)).href);
  } catch (e) {
    esm = `FAILED: ${e.message}`;
  }
  try {
    require(join(pkgDir, pkg.exports["."].require.default));
  } catch (e) {
    cjs = `FAILED: ${e.message}`;
  }
  const ok = problems.length === 0 && esm === "ok" && cjs === "ok";
  failed ||= !ok;
  console.log(
    `${ok ? "✓" : "✗"} ${pkg.name}  publint: ${problems.length ? problems.map((m) => m.code).join(", ") : "ok"}  esm: ${esm}  cjs: ${cjs}`,
  );
}
process.exit(failed ? 1 : 0);
