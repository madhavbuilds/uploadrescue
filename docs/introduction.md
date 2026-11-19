---
title: Introduction
order: 1
---

# Introduction

UploadRescue is an open-source SDK that detects failed file uploads, explains the failure to the user, optimizes the file in the browser when that can help, and retries **your own upload function** with the optimized file — without the user leaving the page.

It is not a storage service. You keep your existing upload endpoint, bucket or provider; UploadRescue wraps the function that sends the file.

## What it does

1. **Detects** failures: client-side size/type checks, HTTP `413`, provider-specific size errors (S3 `EntityTooLarge`, Supabase, Cloudinary, multer), network errors, timeouts, and anything your own classifier recognises.
2. **Explains** them with real numbers: *"Maximum allowed: 2 MB. Your file: 8.4 MB."*
3. **Optimizes** eligible files locally — images, PDFs, Office documents, ZIP archives, and (opt-in) audio/video — and validates the output against your limits.
4. **Retries** by calling your upload function again with the optimized `File` and a fresh context (so signed URLs can be regenerated).

## Principles

- **Privacy-first.** Files are processed in the browser. UploadRescue makes no network requests of its own and has no telemetry.
- **No API key, no backend.** Install the package and pass your upload function.
- **Honest.** Optimization is never reported as successful when the output is larger or still over the limit. Authentication, permission, unsupported-type and unrelated server errors are never retried automatically.
- **Bounded.** Every retry and optimization loop has a limit; everything is cancellable.

## Packages

| Package | Purpose |
| --- | --- |
| `@uploadrescue/core` | Detection, validation, classification, engine orchestration, recovery state machine. No dependencies. |
| `@uploadrescue/react` | `<UploadRescue />` component and hooks. |
| `@uploadrescue/vanilla` | Framework-free API: attach to inputs, drag and drop, widget. |
| `@uploadrescue/ui` | Shared view model, DOM renderer and CSS used by both integrations. |
| `@uploadrescue/upload-adapters` | Optional fetch, XHR, multipart, S3, Supabase, Firebase and Cloudinary adapters. |
| `@uploadrescue/image-engine` | JPEG, PNG, WebP, AVIF, static GIF and SVG. |
| `@uploadrescue/pdf-engine` | PDF inspection and conservative optimization. |
| `@uploadrescue/document-engine` | DOCX, XLSX, PPTX. |
| `@uploadrescue/archive-engine` | Safe ZIP inspection and repacking. |
| `@uploadrescue/media-engine` | Opt-in MP4, MOV, MP3, WAV via FFmpeg WebAssembly. |

Next: [Installation](installation) and [Quick start](quick-start).
