---
title: Recovery workflow
order: 10
---

# Recovery workflow

The controller is an explicit state machine. Every transition is listed in `TRANSITIONS`; anything else throws `UploadRescueError("invalid-transition")`.

```
idle → file-selected → validating → uploading → success
                           │            │
                           ▼            ▼
                       upload-failed ◄──┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
     recovery-available               failed
        │          │
        │ retry    │ optimize
        │          ▼
        │      optimizing ──► optimization-failed ──► (stronger attempt | choose another file)
        │          │
        │          ▼
        │   optimization-complete
        ▼          │
     retrying ◄────┘ ──► success | upload-failed (bounded loop)

Any active state ──cancel()──► cancelled
```

| Status | Meaning |
| --- | --- |
| `idle` | Nothing selected. |
| `file-selected` | A file is selected (waiting for `upload()` when `autoUpload: false`). |
| `validating` | Reading the file signature and checking rules. |
| `uploading` | First upload attempt. |
| `upload-failed` | Transient: the failure is being classified. |
| `recovery-available` | `recoveryAction` is `"optimize"` or `"retry"`; call `recover()`. |
| `optimizing` | An engine is running. |
| `optimization-complete` | Output validated; retry starts immediately. |
| `optimization-failed` | No reduction, still over the limit, unsupported, or failed. `recoveryAction` is `"optimize"` if a stronger attempt is allowed. |
| `retrying` | Upload function called again. |
| `success` / `failed` / `cancelled` | Terminal until a new `select()` or `reset()`. |

## Guarantees

- **One operation at a time.** Concurrent `recover()` calls share a single run; selecting a new file cancels the previous one.
- **No infinite loops.** Retries are capped by `recovery.maxAttempts`, optimization runs by `optimization.maxAttempts`, and `autoRetry` obeys both.
- **Stale results are ignored.** Results that arrive after cancel/reset/new selection never change state.
- **Original preserved.** `state.originalFile` is the untouched input; optimizations always start from it (not from a previous output).
- **Only validated files are retried.** An optimized file is uploaded only if it is smaller and passes `maxSize` (including server-announced limits) and `acceptedTypes`.

## When optimization is not enough

```
Original:        8.4 MB
Maximum allowed: 2 MB
Optimized:       3.1 MB
```

The state becomes `optimization-failed` with `reason: "target-not-reached"`. The UI explains that the file is still too large and offers *Try stronger compression* (if attempts remain), *Download optimized file*, and *Choose another file*. It never shows success.

## History

`state.history` records every validation, upload and optimization of the current file with timestamps, outcome, failure and sizes — useful for logging or support tickets.

## Headless usage

```ts
import { createUploadRescue } from "@uploadrescue/core";

const rescue = createUploadRescue({ upload: async (file) => file.name, maxSize: 1_000_000 });
const unsubscribe = rescue.subscribe((state) => console.log(state.status, state.failure?.message));

const file = new File(["data"], "data.txt");
let state = await rescue.select(file);
while (state.recoveryAction) {
  state = await rescue.recover();
}
unsubscribe();
rescue.destroy();
```
