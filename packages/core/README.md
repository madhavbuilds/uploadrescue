# @uploadrescue/core

Framework-independent core of UploadRescue: content-based file detection, validation, upload failure classification, optimization orchestration with output validation, and a bounded recovery state machine. Zero runtime dependencies.

```bash
pnpm add @uploadrescue/core
```

## Usage

```ts
import { createUploadRescue, UploadHttpError } from "@uploadrescue/core";

const rescue = createUploadRescue({
  maxSize: 2 * 1024 * 1024,
  engines: [], // add engines from @uploadrescue/*-engine
  upload: async (file, context) => {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body, signal: context.signal });
    if (!res.ok) throw await UploadHttpError.fromResponse(res);
    return res.json();
  },
});

rescue.subscribe((state) => console.log(state.status));
const state = await rescue.select(file);
if (state.recoveryAction) await rescue.recover();
```

Documentation: https://github.com/madhavbuilds/uploadrescue/tree/main/docs · Source: https://github.com/madhavbuilds/uploadrescue

License: Apache-2.0
