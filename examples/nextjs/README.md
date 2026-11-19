# UploadRescue — Next.js (App Router) example

- `app/api/upload/route.ts` — route handler that returns `413 { maxSize }` for files over 1 MB.
- `app/uploader.tsx` — client component using `<UploadRescue>` with `autoRetry`.
- `app/page.tsx` — Server Component rendering the uploader (the React package is marked `"use client"`).

```bash
pnpm install && pnpm build   # from the repository root
pnpm --filter @uploadrescue/example-nextjs dev
# open http://localhost:3000
```
