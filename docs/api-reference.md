---
title: API reference
order: 15
---

# API reference

## @uploadrescue/core

### Controller

| Export | Description |
| --- | --- |
| `createUploadRescue(config)` | Returns an `UploadRescueController`. |
| `controller.select(file)` | Start a session (cancels any running one). Resolves with the resulting state. |
| `controller.upload()` | Upload the selected file (with `autoUpload: false`). |
| `controller.recover(action?)` | Run `state.recoveryAction` (or the allowed `alternativeAction`). |
| `controller.cancel()` | Abort running work → `cancelled`. |
| `controller.reset()` | Return to `idle`. |
| `controller.getState()` | Current immutable `RecoveryState`. |
| `controller.subscribe(listener)` | Returns an unsubscribe function. |
| `controller.updateConfig(config)` | Replace configuration (used by React to keep callbacks fresh). |
| `controller.destroy()` | Cancel work and remove listeners. |

### Types

`UploadRescueConfig`, `OptimizationConfig`, `RecoveryConfig`, `UploadFunction`, `UploadContext`, `UploadProgress`, `RecoveryState`, `RecoveryStatus`, `RecoveryAction`, `RecoveryEvent`, `OptimizationFailure`, `UploadFailure`, `UploadFailureKind`, `ClassifyOptions`, `FileInfo`, `DetectedType`, `ValidationRules`, `ValidationIssue`, `OptimizationEngine`, `OptimizationOptions`, `OptimizationContext`, `EngineOutput`, `OptimizationResult`.

### Functions

| Export | Description |
| --- | --- |
| `inspectFile(file)` | Name, size, declared type, content-detected type, mismatch flag. Reads ≤ 72 KB. |
| `detectFileType(blob)` / `sniffMime(bytes)` | Magic-byte detection. |
| `validateFile(file, rules)` / `validateFileInfo(info, rules)` | Size/type validation. |
| `classifyUploadError(error, options?)` | Map a thrown value to an `UploadFailure`. |
| `createFailure(kind, init)` | Build a failure (for `classifyError`). |
| `extractServerMaxSize(httpError)` | Read `X-Upload-Max-Size` / JSON limits. |
| `optimizeFile(file, { engines, ... })` | Run and validate an optimization. |
| `findEngine(engines, file, info)` | First engine able to process a file. |
| `lazyEngine({ id, supportedTypes, load })` | Load an engine on first use. |
| `formatBytes`, `formatPercent`, `reductionRatio` | Formatting helpers. |
| `matchesAccept`, `normalizeMime`, `getExtension`, … | MIME helpers. |
| `TRANSITIONS`, `canTransition`, `assertTransition` | State machine definition. |

### Errors

`UploadRescueError` (base, with `code`), `UploadHttpError` (`status`, `statusText`, `body`, `headers`, `url`, `static fromResponse(response)`), `UploadNetworkError`, `UploadTimeoutError`, `UploadAbortedError`, `OptimizationError` (`reason`, `engine`), `isAbortError(error)`.

## @uploadrescue/react

`UploadRescue` (component), `useUploadRescue(options)`, `useUploadRecovery(controller)`, `useFileOptimization(options?)`. Re-exports `createUploadRescue`, `getRecoveryView`, `DEFAULT_LABELS` and the main types.

## @uploadrescue/vanilla

`createUploadRescue(options)` → `{ attach, mount, select, recover, cancel, reset, getState, on, destroy, controller }`.

## @uploadrescue/ui

`getRecoveryView(state, options?)`, `createDomWidget(container, options)`, `runViewAction(controller, id)`, `downloadFile(blob, name?)`, `defaultEngines()`, `DEFAULT_LABELS`, `TONE_ICONS`, and `@uploadrescue/ui/styles.css`.

## @uploadrescue/upload-adapters

`createFetchUpload`, `createXhrUpload`, `createMultipartUpload`, `xhrRequest`, `createS3PresignedUpload`, `createSupabaseUpload`, `createFirebaseUpload`, `createCloudinaryUpload`, `normalizeSupabaseError`, `normalizeFirebaseError`.

## Engines

| Package | Exports |
| --- | --- |
| `@uploadrescue/image-engine` | `createImageEngine(options?)`, `sanitizeSvg`, `recompressImage`, `outputCandidates`, `parseImageHeader`, `canEncode` |
| `@uploadrescue/pdf-engine` | `createPdfEngine(options?)`, `inspectPdf(file)`, `readJpegFrame` |
| `@uploadrescue/document-engine` | `createDocumentEngine(options?)`, `inspectOoxml(bytes)` |
| `@uploadrescue/archive-engine` | `createArchiveEngine(options?)`, `inspectZip(file)`, `readZipDirectory`, `extractEntry`, `repackZip`, `writeZip`, `assertSafeEntryName`, `crc32`, `ArchiveError`, `DEFAULT_ZIP_LIMITS` |
| `@uploadrescue/media-engine` | `createMediaEngine(options)`, `getMediaSupport`, `planMediaJob`, `parseDuration` |

Every export ships TypeScript declarations with inline documentation.
