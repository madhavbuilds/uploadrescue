---
title: React
order: 4
---

# React integration

`@uploadrescue/react` supports React 18 and 19, React Strict Mode, and server rendering (the module touches no browser globals at import time).

## Component

```tsx
import { UploadRescue } from "@uploadrescue/react";
import { createPdfEngine } from "@uploadrescue/pdf-engine";
import { createImageEngine } from "@uploadrescue/image-engine";

const engines = [createImageEngine(), createPdfEngine()];

export function DocumentUpload({ upload }: { upload: (file: File) => Promise<unknown> }) {
  return (
    <UploadRescue
      upload={upload}
      maxSize={5 * 1024 * 1024}
      acceptedTypes={["image/*", "application/pdf"]}
      engines={engines}
      optimization={{ quality: 0.8, preserveFormat: true }}
      recovery={{ autoRetry: true, maxAttempts: 2 }}
      theme="auto"
      labels={{ compressAndRetry: "Shrink and try again" }}
    />
  );
}
```

`onUpload` is an alias of `upload`. When `engines` is omitted, the image engine is used and loaded with a dynamic `import()` the first time it is needed.

| Prop | Description |
| --- | --- |
| `upload` / `onUpload` | Your upload function. Required unless `controller` is passed. |
| all `UploadRescueConfig` options | `maxSize`, `acceptedTypes`, `engines`, `optimization`, `recovery`, `timeout`, `classifyError`, callbacks… see [Configuration](configuration). |
| `controller` | Use an existing controller (controlled mode). |
| `accept` | `accept` attribute for the picker (defaults to `acceptedTypes`). |
| `labels` | Override any text. |
| `theme` | `"light"`, `"dark"` or `"auto"` (default). |
| `className`, `style`, `label` | Styling and accessible name. |
| `children` | Render function `({ state, view, act, api }) => ReactNode` replacing the whole UI. |
| `renderButton` | `(action, onClick) => ReactNode` for custom buttons. |
| `renderError` | `(view, state) => ReactNode` for custom error/warning content. |

## Hooks

### `useUploadRescue(options)`

Creates a controller tied to the component. The latest options (including callbacks) apply on every render; running work is cancelled on unmount.

```tsx
import { useUploadRescue } from "@uploadrescue/react";

export function CustomUploader({ upload }: { upload: (file: File) => Promise<unknown> }) {
  const { state, select, recover, cancel, reset } = useUploadRescue({ upload, maxSize: 1024 * 1024 });

  return (
    <div>
      <input type="file" onChange={(e) => e.target.files?.[0] && select(e.target.files[0])} />
      <p>Status: {state.status}</p>
      {state.recoveryAction === "optimize" && <button onClick={() => recover()}>Compress & Retry</button>}
      {state.status === "optimizing" && <button onClick={cancel}>Cancel</button>}
      {state.status === "success" && <button onClick={reset}>Upload another</button>}
    </div>
  );
}
```

### `useUploadRecovery(controller)`

Subscribes to a controller you created yourself (for example shared between components, or created outside React):

```tsx
import { createUploadRescue } from "@uploadrescue/core";
import { UploadRescue, useUploadRecovery } from "@uploadrescue/react";

const controller = createUploadRescue({ upload: async (file) => file.name });

function Status() {
  const { state } = useUploadRecovery(controller);
  return <span>{state.status}</span>;
}

export function Page() {
  return (
    <>
      <UploadRescue controller={controller} />
      <Status />
    </>
  );
}
```

### `useFileOptimization(options?)`

Optimizes without uploading — useful for previews:

```tsx
import { useFileOptimization } from "@uploadrescue/react";

export function Preview() {
  const { optimize, status, result, cancel } = useFileOptimization();
  return (
    <div>
      <input type="file" onChange={(e) => e.target.files?.[0] && optimize(e.target.files[0], { targetSize: 500_000 })} />
      {status === "optimizing" && <button onClick={cancel}>Cancel</button>}
      {result && <p>{result.originalSize} → {result.outputSize} bytes</p>}
    </div>
  );
}
```

## Next.js

The package is marked `"use client"`, so the component can be rendered directly from Server Components. See `examples/nextjs` for an App Router example with a route handler that enforces a size limit.
