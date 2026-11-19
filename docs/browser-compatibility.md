---
title: Browser compatibility
order: 13
---

# Browser compatibility

The core, React and Vanilla packages target ES2022 browsers: Chrome/Edge 94+, Firefox 93+, Safari 15.4+.

| Capability | Chrome / Edge | Firefox | Safari |
| --- | --- | --- | --- |
| Core recovery flow | ✓ | ✓ | ✓ |
| JPEG / PNG re-encoding | ✓ | ✓ | ✓ |
| WebP output | ✓ | ✓ | — (canvas cannot encode WebP; JPEG/PNG used) |
| AVIF output | — | — | — |
| Image processing in a Web Worker | ✓ | ✓ | 16.4+ (falls back to main thread) |
| SVG sanitization | ✓ | ✓ | ✓ |
| PDF / Office / ZIP | ✓ | ✓ | ✓ |
| Media (FFmpeg.wasm) | ✓ | ✓ | ✓ (slower) |

Encoder support is detected at runtime by encoding a tiny canvas; UploadRescue never assumes a format is available. When an engine cannot run, the widget states that optimization isn't available rather than failing silently.

The automated browser test suite runs on Chromium, Firefox and WebKit via Playwright.

## Server-side rendering

All packages can be imported on the server. Browser APIs are only touched when a file is processed.
