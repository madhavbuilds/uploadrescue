# Contributing to UploadRescue

Thanks for helping! Bug reports, documentation fixes, new adapters and engines are all welcome.

## Ground rules

- Be respectful — see the [Code of Conduct](CODE_OF_CONDUCT.md).
- Security issues go through [SECURITY.md](SECURITY.md), never public issues.
- UploadRescue must never add telemetry, background network requests, or claims that aren't measured.

## Setup

Requirements: Node.js ≥ 20.11 and pnpm (via `corepack enable`).

```bash
pnpm install
pnpm build
pnpm test
pnpm exec playwright install   # once, for browser tests
pnpm test:e2e
pnpm dev                       # website + docs + playground at http://localhost:5173
```

## Repository layout

| Path                                 | Contents                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `packages/core`                      | Framework-free core. **No runtime dependencies** — keep it that way.                                        |
| `packages/react`, `packages/vanilla` | Integrations. Both render from `@uploadrescue/ui`'s `getRecoveryView`; put shared logic there, not in both. |
| `packages/*-engine`                  | Optimization engines implementing `OptimizationEngine`. Independently installable.                          |
| `packages/upload-adapters`           | Optional upload helpers. Provider SDKs are typed structurally, never added as dependencies.                 |
| `apps/website`                       | Site, docs renderer and playground (runs against package sources).                                          |
| `docs/`                              | Markdown documentation. TS/TSX code blocks are type-checked by `pnpm check:docs`.                           |
| `examples/`                          | Example apps with a real size-limited endpoint.                                                             |
| `tests/integration`                  | Recovery against a real local HTTP server.                                                                  |
| `tests/security`                     | Hostile inputs and privacy properties.                                                                      |
| `tests/browser`                      | Playwright tests (Chromium, Firefox, WebKit).                                                               |

## Making changes

1. Create a branch.
2. Add tests: unit tests next to the package (`packages/<name>/test`), browser tests for anything that needs real canvas/workers/WebAssembly.
3. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:docs` and, for UI or engine changes, `pnpm test:e2e`.
4. If you changed `packages/image-engine/src/pipeline.ts` or `worker-entry.ts`, run `pnpm --filter @uploadrescue/image-engine build` so the generated worker source is updated (CI checks it).
5. Add a changeset: `pnpm changeset` (choose patch/minor/major per [semver](https://semver.org)).
6. Open a pull request describing the behaviour change and how you tested it.

## Writing an engine

Implement `OptimizationEngine` from `@uploadrescue/core`:

- Never mutate the input; return `{ blob, type, notes?, details? }`.
- Observe `context.signal` and report progress with `context.onProgress`.
- Throw `OptimizationError` with an accurate `reason` (`unsupported`, `resource-limit`, `environment`, `failed`).
- Refuse inputs you can't process safely instead of guessing.
- Load heavy dependencies with dynamic `import()`.

The core validates outputs (type signature, size, limits), so engines don't need to.

## Releases

Maintainers merge the "Version Packages" PR opened by the release workflow; merging publishes to npm with provenance. See `.github/workflows/release.yml`.
