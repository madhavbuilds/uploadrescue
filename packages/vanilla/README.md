# @uploadrescue/vanilla

Framework-free UploadRescue: attach to file inputs, drag and drop, events and an embeddable recovery widget.

```bash
pnpm add @uploadrescue/vanilla
```

## Usage

```ts
import { createUploadRescue } from "@uploadrescue/vanilla";
import "@uploadrescue/ui/styles.css";

const rescue = createUploadRescue({ maxSize: 2 * 1024 * 1024, upload: uploadFile });
rescue.attach("#upload-input", { dropzone: "#drop-area" });
rescue.on("success", ({ optimized }) => console.log("uploaded", optimized));
```

Documentation: https://github.com/madhavbuilds/uploadrescue/tree/main/docs · Source: https://github.com/madhavbuilds/uploadrescue

License: Apache-2.0
