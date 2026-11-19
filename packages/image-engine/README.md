# @uploadrescue/image-engine

Browser image optimization for UploadRescue: JPEG, PNG, WebP, AVIF (where the browser can encode it), static GIF and SVG. Runs in a Web Worker with OffscreenCanvas when available. Preserves transparency and animation, strips metadata, sanitizes SVG.

```bash
pnpm add @uploadrescue/image-engine
```

## Usage

```ts
import { createImageEngine, sanitizeSvg } from "@uploadrescue/image-engine";

const engines = [createImageEngine({ maxPixels: 40_000_000 })];
```

CSP: allow `worker-src 'self' blob:` (falls back to the main thread otherwise).

Documentation: https://github.com/madhavbuilds/uploadrescue/tree/main/docs · Source: https://github.com/madhavbuilds/uploadrescue

License: Apache-2.0
