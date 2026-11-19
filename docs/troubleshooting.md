---
title: Troubleshooting
order: 14
---

# Troubleshooting

### A 413 from my server is reported as "The upload failed for an unknown reason"

Your upload function threw a plain `Error`. Throw `UploadHttpError` (or use an adapter):

```ts
import { UploadHttpError } from "@uploadrescue/core";

export async function upload(file: File) {
  const response = await fetch("/api/upload", { method: "POST", body: file });
  if (!response.ok) throw await UploadHttpError.fromResponse(response);
  return response.json();
}
```

### Large uploads fail with a network error instead of 413

Some reverse proxies close the connection when the body exceeds the limit. Browsers report that as a network error. UploadRescue offers *Compress & Retry* as the alternative action for network failures. Setting `maxSize` to match your server's limit catches oversized files before uploading.

### The optimized file is still too large

The engine reports the real result. Options: lower `optimization.quality`, set `optimization.maxDimension`, allow format changes with `preserveFormat: false`, or raise `optimization.maxAttempts` so users can try stronger compression.

### PNG screenshots barely shrink

Canvas PNG encoding is lossless; only resizing reduces size. Allow `preserveFormat: false` so screenshots can become WebP (transparency is kept) or JPEG (only when fully opaque).

### "This browser cannot re-encode AVIF images"

Browsers decode AVIF but most cannot encode it from a canvas. Allow format conversion to optimize AVIF into WebP/JPEG.

### PDFs don't shrink

Text-only PDFs and PDFs whose images aren't JPEG often can't be reduced in the browser. Encrypted and signed PDFs are intentionally not modified.

### Media optimization never appears

The media engine is opt-in and needs self-hosted FFmpeg files. Check `getMediaSupport(options, file.size)` for the reason. With Vite, exclude `@ffmpeg/ffmpeg` and `@ffmpeg/util` from `optimizeDeps`.

### Content Security Policy errors mentioning `blob:`

Add `worker-src 'self' blob:`. Without it, image processing falls back to the main thread.

### Uploads keep running after the user cancels

Pass `context.signal` to `fetch`/XHR. UploadRescue stops waiting immediately either way, but only the signal stops the request.
