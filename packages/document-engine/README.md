# @uploadrescue/document-engine

DOCX/XLSX/PPTX optimization for UploadRescue: embedded JPEG/PNG media are re-encoded in place and the package is re-deflated. XML, relationships, formulas and macros are preserved byte-for-byte and CRC-verified.

```bash
pnpm add @uploadrescue/document-engine
```

## Usage

```ts
import { createDocumentEngine } from "@uploadrescue/document-engine";

const engines = [createDocumentEngine({ maxImageDimension: 2400 })];
```

Documentation: https://github.com/madhavbuilds/uploadrescue/tree/main/docs · Source: https://github.com/madhavbuilds/uploadrescue

License: Apache-2.0
