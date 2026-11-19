---
title: Quick start
order: 3
---

# Quick start

This takes about five minutes. You need an existing upload endpoint (or any async function that uploads a `File`).

## 1. Install

```bash
pnpm add @uploadrescue/react @uploadrescue/upload-adapters
```

## 2. Render the component

```tsx
import { UploadRescue } from "@uploadrescue/react";
import { createXhrUpload } from "@uploadrescue/upload-adapters";
import "@uploadrescue/ui/styles.css";

// Your existing endpoint. Non-2xx responses become typed errors.
const uploadFile = createXhrUpload({ url: "/api/upload" });

export function AvatarUpload() {
  return (
    <UploadRescue
      maxSize={2 * 1024 * 1024}
      acceptedTypes={["image/*"]}
      onUpload={uploadFile}
      recovery={{ enabled: true, showButton: true, autoRetry: false }}
      onSuccess={(result) => console.log("Uploaded", result)}
    />
  );
}
```

## 3. Try it

Select an image larger than 2 MB. You will see:

- *"Your file is too large. Maximum allowed: 2 MB. Your file: 8.4 MB."*
- A **Compress & Retry Upload** button.
- Optimization progress, then the real before/after sizes.
- `uploadFile` is called again with the optimized file, and the widget shows *"Upload completed successfully."*

If the server rejects a file with HTTP `413` (even when it passed the client-side check), the same recovery flow starts.

## Use your own upload function

You do not need the adapters. Any function works — throw on failure:

```ts
import { UploadHttpError, type UploadFunction } from "@uploadrescue/core";

export const uploadFile: UploadFunction<{ url: string }> = async (file, context) => {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/api/upload", { method: "POST", body, signal: context.signal });
  if (!response.ok) throw await UploadHttpError.fromResponse(response);
  return response.json();
};
```

Throwing `UploadHttpError` lets UploadRescue tell a `413` apart from a `401`. Passing `context.signal` makes cancellation and timeouts abort the request.

## Next steps

- [React integration](react) — hooks, controlled mode, custom rendering.
- [Upload adapters](upload-adapters) — S3, Supabase, Firebase, Cloudinary.
- [Optimization engines](optimization-engines) — add PDF, Office, ZIP and media support.
