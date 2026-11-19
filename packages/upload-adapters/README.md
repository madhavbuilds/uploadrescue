# @uploadrescue/upload-adapters

Optional upload functions for UploadRescue: fetch, XHR with progress, multipart, S3/R2 presigned PUT or POST, Supabase Storage, Firebase Storage and Cloudinary. Errors are thrown as typed `UploadHttpError`s so 413s and provider size errors are recognised. Provider SDKs are not dependencies.

```bash
pnpm add @uploadrescue/upload-adapters
```

## Usage

```ts
import { createXhrUpload, createS3PresignedUpload } from "@uploadrescue/upload-adapters";

const upload = createXhrUpload({ url: "/api/upload" });
const s3 = createS3PresignedUpload({
  getTarget: async (file) => (await fetch("/api/sign")).json(),
});
```

Documentation: https://github.com/madhavbuilds/uploadrescue/tree/main/docs · Source: https://github.com/madhavbuilds/uploadrescue

License: Apache-2.0
