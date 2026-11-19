import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/coverage/**",
      "packages/image-engine/src/generated/**",
      "tests/docs/.generated/**",
      "apps/website/public/**",
      "playwright-report/**",
      "test-results/**",
      "examples/nextjs/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    // Tests, scripts, examples and the site may log.
    files: [
      "tests/**",
      "scripts/**",
      "examples/**",
      "benchmarks/**",
      "**/*.config.*",
      "packages/*/scripts/**",
    ],
    rules: { "no-console": "off" },
  },
);
