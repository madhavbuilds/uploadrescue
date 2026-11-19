---
title: Configuration
order: 9
---

# Configuration

All integrations accept the same `UploadRescueConfig` (React takes it as props, Vanilla as options).

```ts
import { createUploadRescue } from "@uploadrescue/core";

const rescue = createUploadRescue({
  upload: async (file, context) => ({ name: file.name, attempt: context.attempt }),

  maxSize: 2 * 1024 * 1024,            // client-side limit (bytes)
  acceptedTypes: ["image/*", ".pdf"],  // matched against the content-detected type
  rejectTypeMismatch: false,           // reject files whose content contradicts their extension
  autoUpload: true,                    // upload right after select()
  timeout: 60_000,                     // per attempt (ms)

  engines: [],                         // optimization engines, tried in order

  optimization: {
    enabled: true,
    targetSize: 1_800_000,             // default: the effective size limit
    quality: 0.82,                     // initial quality for lossy formats, 0–1
    preserveFormat: true,              // false allows e.g. PNG → WebP
    maxAttempts: 2,                    // optimization runs per file (later = stronger)
    maxDimension: 4096,                // max width/height in px
  },

  recovery: {
    enabled: true,
    showButton: true,                  // show "Compress & Retry" in the widgets
    autoRetry: false,                  // recover automatically after a recoverable failure
    maxAttempts: 3,                    // retries per file
  },

  errors: { sizeErrorStatuses: [413] },
  classifyError: () => null,

  onSuccess: (result, { optimized, attempt }) => console.log(result, optimized, attempt),
  onError: (error, failure) => console.warn(failure?.kind ?? error.message),
  onOptimization: (original, optimized, result) => console.log(result.reduction),
  onProgress: (progress) => console.log(progress.phase, progress.ratio),
  onStateChange: (state) => console.log(state.status),
});
```

## Defaults

| Option | Default |
| --- | --- |
| `autoUpload` | `true` |
| `timeout` | none |
| `optimization.enabled` | `true` |
| `optimization.quality` | `0.82` |
| `optimization.preserveFormat` | `true` |
| `optimization.maxAttempts` | `2` |
| `recovery.enabled` | `true` |
| `recovery.showButton` | `true` |
| `recovery.autoRetry` | `false` |
| `recovery.maxAttempts` | `3` |
| `engines` | core: none · React/Vanilla: lazy image engine |

## Target size

The optimizer aims for the smallest of: `optimization.targetSize`, `maxSize`, and any limit the server announced. If none is known and the server rejected the file, it aims for 60% of the rejected size. The **hard** limit checked before retrying is `maxSize` / the server-announced limit only — `targetSize` is a goal, not a rejection rule.

## Accepted output types

When `acceptedTypes` is set, engines never convert to a format outside it. For example `acceptedTypes: ["image/png", "image/jpeg"]` with `preserveFormat: false` never produces WebP.

## Upload context

Your upload function receives a fresh `UploadContext` on every attempt:

| Field | Description |
| --- | --- |
| `attempt` | 1 for the first upload, 2+ for retries |
| `isRetry` | `attempt > 1` |
| `originalFile` | The file the user selected (never modified) |
| `optimization` | The `OptimizationResult` when uploading an optimized file |
| `signal` | Aborted on cancel, timeout, reset or new selection |
| `idempotencyKey` | Same for every attempt of one selected file |
| `attemptId` | Unique per attempt |
| `previousFailure` | The failure that triggered this retry |
| `reportProgress(loaded, total?)` | Report upload progress |
