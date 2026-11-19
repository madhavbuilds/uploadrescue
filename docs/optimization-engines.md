---
title: Optimization engines
order: 8
---

# Optimization engines

Engines are independent packages that implement one interface. The core picks the first engine whose `supportedTypes` match the file's **content-detected** type and whose `canProcess` accepts it.

```ts
import { createUploadRescue } from "@uploadrescue/core";
import { createImageEngine } from "@uploadrescue/image-engine";
import { createPdfEngine } from "@uploadrescue/pdf-engine";
import { createDocumentEngine } from "@uploadrescue/document-engine";
import { createArchiveEngine } from "@uploadrescue/archive-engine";

const rescue = createUploadRescue({
  upload: async (file) => file.name,
  engines: [createImageEngine(), createPdfEngine(), createDocumentEngine(), createArchiveEngine()],
});
```

## Guarantees enforced by the core

For every engine, `optimizeFile` (used by the recovery flow):

- never modifies the original `File`;
- rejects empty outputs and outputs whose magic bytes don't match the claimed type;
- discards outputs that are not smaller (`changed: false`, never reported as success);
- re-validates the output against `maxSize` and `acceptedTypes` before any retry;
- measures size, reduction and duration itself;
- stays cancellable even if an engine ignores its `AbortSignal`.

## Image engine

`@uploadrescue/image-engine` — JPEG, PNG, WebP, AVIF, GIF, SVG.

- Runs in a Web Worker with `OffscreenCanvas` when available (cancelling terminates the worker); falls back to the main thread otherwise, e.g. when a Content-Security-Policy blocks `blob:` workers.
- Searches for the **highest quality** that fits the target size, then downscales in steps (never below 50% of the original dimensions on the first attempt, 25% on later attempts).
- **Transparency** is detected from the pixels; transparent images are never converted to JPEG.
- **Animation** (animated GIF, APNG, animated WebP) is detected from the file structure; animated images are never rasterized.
- Static GIFs can only be converted (to WebP/PNG) when `preserveFormat: false`, because browsers have no GIF encoder.
- AVIF output depends on the browser's canvas encoder (most browsers cannot encode AVIF); with `preserveFormat: true` such files are reported as unsupported.
- **Metadata** (EXIF, GPS) is removed by re-encoding; orientation is applied to the pixels first.
- **SVG** is parsed with `DOMParser` (inert: nothing executes or loads), sanitized (scripts, event handlers, `foreignObject`, `javascript:` and external URLs, `@import`) and minified. `sanitizeSvg` is exported for standalone use.
- Inputs above 4× `maxPixels` (default 40 MP) are refused to protect memory.

## PDF engine

`@uploadrescue/pdf-engine` — uses [pdf-lib](https://pdf-lib.js.org), loaded on first use.

- Re-encodes embedded JPEG images (8-bit DeviceRGB/DeviceGray, no decode arrays) when that saves at least 10%, capped at 2000 px by default.
- Rewrites the file with object streams, which also collapses incremental updates.
- Preserves text, fonts, vector content, form fields and document metadata; output must parse and have the same page count.
- **Refuses** encrypted PDFs, and signed PDFs unless `allowSignatureInvalidation: true`.
- Limitations: images using Flate/JBIG2/JPX, CMYK and ICC-based JPEGs are left unchanged; scanned PDFs whose pages are not JPEG gain little; text-only PDFs often cannot be made smaller. Compression is never guaranteed.

## Document engine

`@uploadrescue/document-engine` — DOCX, XLSX, PPTX and macro-enabled variants.

- Validates the package (`[Content_Types].xml`, `_rels/.rels`, main part) using the safe ZIP reader.
- Re-encodes embedded JPEG/PNG media **in the same format under the same name**, so relationships stay valid; re-deflates the package.
- XML parts, relationships, styles, formulas, macros (`vbaProject.bin`) and embedded objects are copied byte-for-byte and CRC-verified.
- Signed packages are refused unless `allowSignatureInvalidation: true`.
- Documents without images usually shrink very little.

## Archive engine

`@uploadrescue/archive-engine` — ZIP.

- Recompresses each entry with maximum deflate and keeps the smaller of the new and original encodings. Contents are never modified.
- Enforces entry count, per-entry and total uncompressed size, compression ratio, path safety, duplicate names and overlapping entries **before** decompressing; inflates in 16 KB input chunks so entries that lie about their size are stopped early.
- Refuses encrypted entries and ZIP64. Nothing is written to disk. Extra fields (e.g. extended timestamps) are dropped.

## Media engine (opt-in)

`@uploadrescue/media-engine` — MP4, MOV, MP3, WAV with [FFmpeg.wasm](https://ffmpegwasm.netlify.app).

FFmpeg's core is ~30 MB. UploadRescue never downloads it from a CDN by itself: you host the files and pass their URLs.

```ts
import { createMediaEngine } from "@uploadrescue/media-engine";

// Copy node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.{js,wasm} to /public/ffmpeg/
export const media = createMediaEngine({
  coreURL: "/ffmpeg/ffmpeg-core.js",
  wasmURL: "/ffmpeg/ffmpeg-core.wasm",
});
```

- Loaded lazily on the first matching file; cancelling terminates FFmpeg.
- By default the core files are fetched from your URLs and handed to FFmpeg as `blob:` URLs, which avoids bundler dev servers rewriting the worker's import. This needs `blob:` in `script-src`/`worker-src`; pass `useBlobURLs: false` to use the URLs directly.
- Video: H.264/AAC with `+faststart`; bitrate is computed from the target size and the probed duration, otherwise CRF. Later attempts reduce resolution (1920 → 1280 → 854 px).
- Audio: MP3 bitrate reduction; WAV stays WAV (16-bit PCM, lower sample rate, then mono) unless format changes are allowed, in which case it becomes MP3.
- `getMediaSupport(options, fileSize)` explains why media optimization is unavailable (no WebAssembly, not configured, file too large, low device memory).
- In-browser encoding is slow (often slower than real time for HD video). Inputs over 200 MB are refused by default.
- Vite users: add `optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] }`.

## Unknown files

Files without a matching engine are validated and can be retried after transient failures, but are never transformed. The UI states that optimization isn't available for the file.

## Lazy loading

Wrap any engine with `lazyEngine` so its code is only downloaded when a matching file needs optimization:

```ts
import { lazyEngine } from "@uploadrescue/core";

export const pdf = lazyEngine({
  id: "pdf",
  supportedTypes: ["application/pdf"],
  load: () => import("@uploadrescue/pdf-engine").then((m) => m.createPdfEngine()),
});
```

## Writing an engine

```ts
import type { OptimizationEngine } from "@uploadrescue/core";

export const jsonMinifier: OptimizationEngine = {
  id: "json",
  supportedTypes: ["application/json"],
  canProcess: (file) => file.size < 50 * 1024 * 1024,
  async optimize(file, _options, context) {
    context.onProgress(null, "Minifying");
    const minified = JSON.stringify(JSON.parse(await file.text()));
    return { blob: new Blob([minified]), type: "application/json", notes: ["Whitespace removed."] };
  },
};
```

Throw `OptimizationError` with a reason (`unsupported`, `resource-limit`, `environment`, `failed`) to give users an accurate message.
