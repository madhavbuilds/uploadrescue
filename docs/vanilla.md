---
title: Vanilla JavaScript
order: 5
---

# Vanilla JavaScript

```bash
pnpm add @uploadrescue/vanilla
```

## Attach to an existing input

```ts
import { createUploadRescue } from "@uploadrescue/vanilla";
import "@uploadrescue/ui/styles.css";

async function uploadFile(file: File) {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/api/upload", { method: "POST", body });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const rescue = createUploadRescue({
  maxSize: 2 * 1024 * 1024,
  upload: uploadFile,
});

rescue.attach("#upload-input");
```

The recovery widget is inserted right after the input and stays hidden until a file is selected.

> Tip: throw `UploadHttpError` (from `@uploadrescue/core`) or use an adapter so a `413` is recognised as a size failure. A plain `Error` is classified as `unknown` and is not retried.

## Render a full widget (with drop zone)

```ts
import { createUploadRescue } from "@uploadrescue/vanilla";
import { createXhrUpload } from "@uploadrescue/upload-adapters";

const rescue = createUploadRescue({
  upload: createXhrUpload({ url: "/api/upload" }),
  maxSize: 2 * 1024 * 1024,
  container: "#uploader",
  theme: "auto",
});
```

## Drag and drop onto your own element

```ts
import { createUploadRescue } from "@uploadrescue/vanilla";

const rescue = createUploadRescue({ upload: async (file: File) => file.name });
const detach = rescue.attach("#file", { dropzone: "#drop-area" });
// later: detach();
```

## Programmatic use and events

```ts
import { createUploadRescue } from "@uploadrescue/vanilla";

const rescue = createUploadRescue({ upload: async (file: File) => file.size, render: false });

rescue.on("state", (state) => console.log(state.status));
rescue.on("optimization", (result) => console.log(`${result.originalSize} → ${result.outputSize}`));
rescue.on("success", ({ result, optimized }) => console.log(result, optimized));
rescue.on("error", ({ failure }) => console.warn(failure?.kind));

const file = new File(["hello"], "hello.txt");
await rescue.select(file);
if (rescue.getState().recoveryAction) await rescue.recover();
rescue.destroy();
```

## API

| Method | Description |
| --- | --- |
| `attach(input, { dropzone? })` | Wire an `<input type="file">` (and optionally a drop zone). Returns a detach function. |
| `mount(container)` | Render the widget into an element (if `container` wasn't passed). |
| `select(file)` | Start a session for a file. |
| `recover()` | Run the offered recovery step. |
| `cancel()`, `reset()` | Cancel running work / return to idle. |
| `getState()` | Current `RecoveryState`. |
| `on(event, listener)` | `state`, `success`, `error`, `optimization`, `progress`. Returns an unsubscribe function. |
| `destroy()` | Remove listeners and DOM, cancel work. |
| `controller` | The underlying core controller. |
