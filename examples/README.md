# Examples

| Example                    | Stack                   | Port |
| -------------------------- | ----------------------- | ---- |
| [`react`](react)           | Vite + React 19         | 5174 |
| [`vanilla-js`](vanilla-js) | Vite + plain TypeScript | 5175 |
| [`nextjs`](nextjs)         | Next.js 15 App Router   | 3000 |

Each example has a **real** upload endpoint that rejects files over 1 MB with HTTP 413 (and reports the limit), so you can see the complete failure → optimization → retry → success workflow. Uploaded data is discarded.

Build the packages first: `pnpm install && pnpm build` from the repository root.
