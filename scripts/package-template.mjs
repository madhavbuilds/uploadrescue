// Generates shared package scaffolding (package.json fields, tsconfig, tsup config).
// Usage: node scripts/package-template.mjs <dir> '<json overrides>'
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [dir, overridesJson = "{}"] = process.argv.slice(2);
const o = JSON.parse(overridesJson);
const name = o.name;
const entries = o.entries ?? ["index"];

const exportsMap = {};
for (const entry of entries) {
  const key = entry === "index" ? "." : `./${entry}`;
  exportsMap[key] = {
    import: { types: `./dist/${entry}.d.ts`, default: `./dist/${entry}.js` },
    require: { types: `./dist/${entry}.d.cts`, default: `./dist/${entry}.cjs` },
  };
}
for (const [k, v] of Object.entries(o.extraExports ?? {})) exportsMap[k] = v;
exportsMap["./package.json"] = "./package.json";

const pkg = {
  name,
  version: "0.1.0",
  description: o.description,
  license: "Apache-2.0",
  type: "module",
  sideEffects: o.sideEffects ?? false,
  main: "./dist/index.cjs",
  module: "./dist/index.js",
  types: "./dist/index.d.ts",
  exports: exportsMap,
  files: ["dist", "README.md", ...(o.files ?? [])],
  repository: {
    type: "git",
    url: "git+https://github.com/madhavbuilds/uploadrescue.git",
    directory: dir,
  },
  homepage: "https://github.com/madhavbuilds/uploadrescue#readme",
  bugs: "https://github.com/madhavbuilds/uploadrescue/issues",
  keywords: ["upload", "file-upload", "compression", "retry", "recovery", ...(o.keywords ?? [])],
  publishConfig: { access: "public", provenance: true },
  scripts: {
    build: o.buildScript ?? "tsup",
    typecheck: "tsc --noEmit",
    ...(o.scripts ?? {}),
  },
  ...(o.dependencies ? { dependencies: o.dependencies } : {}),
  ...(o.peerDependencies ? { peerDependencies: o.peerDependencies } : {}),
  ...(o.peerDependenciesMeta ? { peerDependenciesMeta: o.peerDependenciesMeta } : {}),
  ...(o.devDependencies ? { devDependencies: o.devDependencies } : {}),
};
writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

writeFileSync(
  join(dir, "tsconfig.json"),
  JSON.stringify(
    {
      extends: "../../tsconfig.base.json",
      compilerOptions: { rootDir: "src", outDir: "dist", ...(o.tsCompilerOptions ?? {}) },
      include: ["src"],
    },
    null,
    2,
  ) + "\n",
);

if (!existsSync(join(dir, "tsup.config.ts"))) {
  const entryObj = Object.fromEntries(
    entries.map((e) => [e, `src/${e}.ts${o.tsx?.includes(e) ? "x" : ""}`]),
  );
  writeFileSync(
    join(dir, "tsup.config.ts"),
    `import { defineConfig } from "tsup";

export default defineConfig({
  entry: ${JSON.stringify(entryObj)},
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "es2022",${o.banner ? `\n  banner: { js: ${JSON.stringify(o.banner)} },` : ""}
});
`,
  );
}
