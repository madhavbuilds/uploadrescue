# UploadRescue — React example

A Vite + React app whose dev server exposes `POST /api/upload`, a real endpoint that rejects files over 1 MB with HTTP 413 (see `../shared/upload-server.mjs`; nothing is stored).

```bash
pnpm install && pnpm build   # from the repository root
pnpm --filter @uploadrescue/example-react dev
# open http://localhost:5174 and upload an image larger than 1 MB
```

The component has no client-side `maxSize`, so the failure genuinely comes from the server. UploadRescue classifies the 413, compresses the image in the browser (targeting the `maxSize` the server reports in its JSON body), and calls the same `createXhrUpload` function again.
