---
title: Error classification
order: 7
---

# Error classification

UploadRescue cannot see your server. It only knows what your upload function throws. Every thrown value is mapped to an `UploadFailure`:

```ts
interface UploadFailure {
  kind: "file-too-large" | "network" | "timeout" | "auth" | "unsupported-type"
      | "rate-limited" | "server" | "invalid-file" | "cancelled" | "unknown";
  source: "validation" | "http" | "network" | "timeout" | "adapter" | "custom";
  message: string;          // user-facing
  status?: number;
  retryable: boolean;       // retrying the same file may succeed
  optimizable: boolean;     // a smaller file may succeed
  serverMaxSize?: number;   // limit announced by the server
  cause?: unknown;
}
```

## Built-in rules

| Signal | Kind | Retry same file | Optimize + retry |
| --- | --- | --- | --- |
| Client-side `maxSize` exceeded | `file-too-large` | — | ✓ |
| HTTP `413` | `file-too-large` | — | ✓ |
| 4xx whose body matches a size pattern* | `file-too-large` | — | ✓ |
| `sizeErrorStatuses` you configure | `file-too-large` | — | ✓ |
| No response (`TypeError: Failed to fetch`, `UploadNetworkError`) | `network` | ✓ | ✓ |
| Timeout, HTTP `408` / `504` | `timeout` | ✓ | ✓ |
| HTTP `401` / `403` | `auth` | never | never |
| HTTP `415`, type not in `acceptedTypes` | `unsupported-type` | never | never |
| HTTP `429` | `rate-limited` | never | never |
| HTTP `5xx` | `server` | never | never |
| Anything else | `unknown` | never | never |

\* `EntityTooLarge` (S3), `exceeded the maximum allowed size` (Supabase), `File size too large` (Cloudinary), `LIMIT_FILE_SIZE` (multer), `Payload Too Large`, `Request Entity Too Large`.

## Server-announced limits

If the server says how large a file may be, the optimizer targets exactly that size. Either convention works:

- Header: `X-Upload-Max-Size: 2097152`
- JSON body: `{ "maxSize": 2097152 }` (also `max_size`, `maxFileSize`, `limit`)

Without any known limit, the optimizer targets 60% of the rejected size and tries again (bounded by `optimization.maxAttempts`).

## Tuning the built-in classifier

```ts
import { createUploadRescue } from "@uploadrescue/core";

const rescue = createUploadRescue({
  upload: async (file) => file.name,
  errors: {
    sizeErrorStatuses: [400],           // your API uses 400 for oversize files
    sizeErrorPatterns: [/QUOTA_EXCEEDED/],
    retryableStatuses: [409],
  },
});
```

## Application-specific errors

Return a failure for errors you recognise and `null` for everything else:

```ts
import { UploadHttpError, createFailure, createUploadRescue } from "@uploadrescue/core";

const rescue = createUploadRescue({
  upload: async (file) => file.name,
  classifyError: (error) => {
    if (error instanceof UploadHttpError && error.body?.includes('"code":"ATTACHMENT_TOO_BIG"')) {
      return createFailure("file-too-large", { source: "custom", message: "Attachments must be under 10 MB." });
    }
    return null; // use the built-in rules
  },
});
```

`classifyError` is never consulted for timeouts raised by UploadRescue itself.

## Networks that close the connection

Some proxies reject large bodies by closing the connection instead of returning `413`. The browser then reports a network error. UploadRescue offers **Retry** first and **Compress & Retry** as the alternative for network failures, so users can still recover.
