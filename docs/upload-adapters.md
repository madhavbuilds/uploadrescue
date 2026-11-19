---
title: Upload adapters
order: 6
---

# Upload adapters

Adapters are optional factories that return an upload function. Each one throws typed errors (`UploadHttpError`, `UploadNetworkError`, `UploadAbortedError`) so failures are classified correctly, honours `context.signal` for cancellation, and is invoked again — with a fresh context — on every retry.

```bash
pnpm add @uploadrescue/upload-adapters
```

None of the provider SDKs are dependencies: the adapters accept your client objects/functions.

## fetch

```ts
import { createFetchUpload } from "@uploadrescue/upload-adapters";

export const upload = createFetchUpload<{ id: string }>({
  url: "/api/upload",
  method: "POST",
  body: "multipart", // or "raw" to send the file as the request body
  fieldName: "file",
  fields: (file) => ({ originalName: file.name }),
  headers: { "x-csrf-token": "token" },
  idempotencyHeader: "Idempotency-Key", // opt-in: sends context.idempotencyKey
});
```

`fetch` cannot report upload progress. Use the XHR adapter when you need a progress bar.

## XMLHttpRequest (with progress) and multipart

```ts
import { createMultipartUpload, createXhrUpload } from "@uploadrescue/upload-adapters";

export const withProgress = createXhrUpload({ url: "/api/upload", withCredentials: true });
export const multipart = createMultipartUpload({ url: "/api/upload", fieldName: "attachment" });
```

## AWS S3 (and R2, MinIO) presigned uploads

`getTarget` runs for every attempt, so you can sign a new URL for the optimized file's size and type.

```ts
import { createS3PresignedUpload } from "@uploadrescue/upload-adapters";

export const upload = createS3PresignedUpload({
  getTarget: async (file) => {
    const res = await fetch("/api/sign-upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: file.name, type: file.type, size: file.size }),
    });
    // { url, method?: "PUT" | "POST", fields?, headers?, key? }
    return res.json();
  },
});
```

S3 rejects oversize presigned POSTs with HTTP 400 `EntityTooLarge`; this is recognised as a size failure.

## Supabase Storage

```ts
import { createClient } from "@supabase/supabase-js";
import { createSupabaseUpload } from "@uploadrescue/upload-adapters";

const supabase = createClient("https://project.supabase.co", "public-anon-key");

export const upload = createSupabaseUpload({
  storage: supabase.storage,
  bucket: "avatars",
  path: (file, context) => `users/42/${context.idempotencyKey}-${file.name}`,
  upsert: true,
});
```

supabase-js does not accept an `AbortSignal`; cancelling stops UploadRescue from waiting, but the request may still finish in the background.

## Firebase Storage

```ts
import { getStorage, ref, uploadBytesResumable } from "firebase/storage";
import { createFirebaseUpload } from "@uploadrescue/upload-adapters";

const storage = getStorage();

export const upload = createFirebaseUpload({
  uploadBytesResumable,
  getRef: (file) => ref(storage, `uploads/${file.name}`),
});
```

Progress and cancellation are supported. Size limits enforced in Firebase Security Rules surface as `storage/unauthorized` — indistinguishable from a permission error — so set `maxSize` on the client to get size recovery.

## Cloudinary

```ts
import { createCloudinaryUpload } from "@uploadrescue/upload-adapters";

// Unsigned
export const unsigned = createCloudinaryUpload({ cloudName: "demo", uploadPreset: "unsigned_preset" });

// Signed: your server returns { signature, timestamp, apiKey, params? } per attempt
export const signed = createCloudinaryUpload({
  cloudName: "demo",
  getSignature: async () => (await fetch("/api/cloudinary-signature")).json(),
});
```

## Writing your own

Any `(file, context) => Promise<result>` works. Recommended:

- Throw `UploadHttpError` for HTTP failures (`await UploadHttpError.fromResponse(response)`).
- Pass `context.signal` to your request.
- Call `context.reportProgress(loaded, total)` if you can.
- Generate per-attempt credentials inside the function, not outside it.
