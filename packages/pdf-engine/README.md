# @uploadrescue/pdf-engine

PDF inspection and conservative optimization for UploadRescue using pdf-lib (loaded on first use): JPEG image re-encoding and object-stream rewrite. Encrypted PDFs are never modified; signed PDFs only with `allowSignatureInvalidation`. Compression is not guaranteed.

```bash
pnpm add @uploadrescue/pdf-engine
```

## Usage

```ts
import { createPdfEngine, inspectPdf } from "@uploadrescue/pdf-engine";

const engines = [createPdfEngine({ maxImageDimension: 2000 })];
const info = await inspectPdf(file); // pageCount, encrypted, signed, images…
```

Documentation: https://github.com/madhavbuilds/uploadrescue/tree/main/docs · Source: https://github.com/madhavbuilds/uploadrescue

License: Apache-2.0
