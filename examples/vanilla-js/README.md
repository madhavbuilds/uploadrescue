# UploadRescue — Vanilla JS example

Plain TypeScript (served by Vite) attaching UploadRescue to an existing `<input type="file">` and a drop area. The dev server's `POST /api/upload` rejects files over 1 MB with HTTP 413 and discards uploads.

```bash
pnpm install && pnpm build   # from the repository root
pnpm --filter @uploadrescue/example-vanilla dev
# open http://localhost:5175
```
