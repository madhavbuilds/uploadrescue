// Type-checks every ```ts / ```tsx block in docs/*.md against the package sources.
// Fails CI when documentation drifts from the implementation.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "tests/docs/.generated");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let count = 0;
for (const doc of readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md"))) {
  const md = readFileSync(join(root, "docs", doc), "utf8");
  const blocks = [...md.matchAll(/```(ts|tsx)\n([\s\S]*?)```/g)];
  blocks.forEach((m, i) => {
    const file = join(out, `${doc.replace(/\.md$/, "")}-${i + 1}.tsx`);
    writeFileSync(file, `// Extracted from docs/${doc}\n${m[2]}\nexport {};\n`);
    count += 1;
  });
}
// README snippets use a few placeholder names; declare the ones a snippet doesn't define itself.
const README_GLOBALS = {
  uploadFile: 'declare const uploadFile: import("@uploadrescue/core").UploadFunction<unknown>;',
  file: "declare const file: File;",
  render: "declare function render(state: unknown): void;",
  supabase:
    'declare const supabase: { storage: import("@uploadrescue/upload-adapters").SupabaseStorageLike };',
  storage: "declare const storage: unknown;",
  ref: "declare function ref(storage: unknown, path: string): string;",
  uploadBytesResumable:
    'declare function uploadBytesResumable(ref: string, data: Blob, metadata?: { contentType?: string }): import("@uploadrescue/upload-adapters").FirebaseUploadTaskLike;',
};
const readme = readFileSync(join(root, "README.md"), "utf8");
[...readme.matchAll(/```(ts|tsx)\n([\s\S]*?)```/g)].forEach((m, i) => {
  const code = m[2];
  const preamble = Object.entries(README_GLOBALS)
    .filter(
      ([name]) =>
        new RegExp(`\\b${name}\\b`).test(code) &&
        !new RegExp(`(?:\\b(?:const|let|function)\\s+${name}\\b|import[^;]*\\b${name}\\b)`).test(
          code,
        ),
    )
    .map(([, decl]) => decl)
    .join("\n");
  writeFileSync(
    join(out, `README-${i + 1}.tsx`),
    `// Extracted from README.md\n${code}\n${preamble}\nexport {};\n`,
  );
  count += 1;
});
console.log(`Extracted ${count} snippets; type-checking…`);
try {
  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    ["-p", join(root, "tests/docs/tsconfig.json")],
    { stdio: "inherit" },
  );
  console.log("All documentation snippets type-check.");
} catch {
  console.error("Documentation snippets failed to type-check (see errors above).");
  process.exit(1);
}
