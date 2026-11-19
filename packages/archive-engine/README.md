# @uploadrescue/archive-engine

Safe ZIP inspection and lossless repacking for UploadRescue. Entry-count, size, ratio, path-traversal, duplicate and overlapping-entry checks run before decompression; inflation is bounded and CRC-verified.

```bash
pnpm add @uploadrescue/archive-engine
```

## Usage

```ts
import { createArchiveEngine, inspectZip } from "@uploadrescue/archive-engine";

const engines = [createArchiveEngine({ limits: { maxEntries: 5000 } })];
const summary = await inspectZip(file);
```

Documentation: https://github.com/madhavbuilds/uploadrescue/tree/main/docs · Source: https://github.com/madhavbuilds/uploadrescue

License: Apache-2.0
