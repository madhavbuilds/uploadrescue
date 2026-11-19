---
title: Installation
order: 2
---

# Installation

UploadRescue requires a modern browser (see [Browser compatibility](browser-compatibility)) and works with any bundler that supports ES modules and dynamic `import()` — Vite, webpack 5, Next.js, Rollup, esbuild, Parcel.

## React

```bash
pnpm add @uploadrescue/react
```

This includes the core and the image engine (loaded lazily on first use).

## Vanilla JavaScript

```bash
pnpm add @uploadrescue/vanilla
```

## Core only (custom UI)

```bash
pnpm add @uploadrescue/core
```

## Optional packages

```bash
pnpm add @uploadrescue/upload-adapters   # fetch / XHR / S3 / Supabase / Firebase / Cloudinary
pnpm add @uploadrescue/pdf-engine        # PDF
pnpm add @uploadrescue/document-engine   # DOCX / XLSX / PPTX
pnpm add @uploadrescue/archive-engine    # ZIP
pnpm add @uploadrescue/media-engine @ffmpeg/ffmpeg @ffmpeg/core   # MP4 / MOV / MP3 / WAV
```

`npm install` and `yarn add` work the same way.

## Styles

The React and Vanilla widgets use the stylesheet from `@uploadrescue/ui`:

```ts
import "@uploadrescue/ui/styles.css";
```

All visual values are CSS custom properties; see [UI customization](ui-customization).

## Module formats

Every package ships ES modules and CommonJS with TypeScript declarations, and is marked side-effect free (except the stylesheet) for tree shaking. `@uploadrescue/react` is marked `"use client"` for the Next.js App Router.
