---
title: Security
order: 12
---

# Security model

UploadRescue runs in your users' browsers and handles files they choose. Its goal is to never make that situation worse.

## What UploadRescue does

- **No network traffic of its own.** The only requests are the ones your upload function makes. No telemetry, no CDN fetches (the media engine requires you to host FFmpeg yourself).
- **No persistence.** Files are held in memory only for the current session; nothing is written to `localStorage`, IndexedDB or disk.
- **Content-based type detection.** Accepted types are checked against magic bytes, not just the extension or `File.type`. Mismatches are flagged and can be rejected (`rejectTypeMismatch`).
- **SVG sanitization.** SVGs are parsed with `DOMParser` (inert documents: scripts never run, resources never load). Scripts, event handlers, `foreignObject`, `javascript:` URLs, external references, `@import` and DOCTYPE entity declarations are removed.
- **Safe ZIP handling** (archives and Office files): entry count, per-entry and total uncompressed size, compression-ratio limits, path traversal (`..`, absolute paths, drive letters), duplicate names, overlapping entries, encrypted entries and ZIP64 are all rejected **before** decompression; decompression is bounded and CRC-verified. Nothing is extracted to disk.
- **Resource limits.** Image pixel budgets, maximum input sizes per engine, device-memory checks for media.
- **Isolation.** Image processing runs in a dedicated Web Worker when available; FFmpeg runs in its own worker. Cancelling terminates them.
- **No code execution.** No `eval`, no dynamic code from file contents. The image worker is built from a static, bundled source string.
- **Conservative transformations.** Encrypted PDFs are never modified; signed PDFs and Office documents are refused unless you opt in; macros and document structure are preserved byte-for-byte.

## What UploadRescue does not do

- **It does not make malicious files safe.** Compressing or re-encoding a file is not malware scanning. Always validate and scan uploads on your server.
- **It is not access control.** Client-side checks can be bypassed; enforce size and type limits on the server too.
- **It cannot see your server.** It classifies only what your upload function throws.

## Content Security Policy

The image engine starts its worker from a `blob:` URL. Allow it with `worker-src 'self' blob:`; if blocked, processing falls back to the main thread automatically. The media engine needs `wasm-unsafe-eval` (WebAssembly) in `script-src`, `blob:` in `script-src`/`worker-src` (or `useBlobURLs: false`), and access to your self-hosted FFmpeg files.

## Reporting vulnerabilities

Please follow [SECURITY.md](https://github.com/madhavbuilds/uploadrescue/blob/main/SECURITY.md). Do not open public issues for security reports.
