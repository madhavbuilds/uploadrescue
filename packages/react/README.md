# @uploadrescue/react

React component and hooks for UploadRescue. React 18/19, Strict Mode, SSR and Next.js App Router compatible.

```bash
pnpm add @uploadrescue/react
```

## Usage

```tsx
import { UploadRescue } from "@uploadrescue/react";
import "@uploadrescue/ui/styles.css";

<UploadRescue
  maxSize={2 * 1024 * 1024}
  onUpload={uploadFile}
  recovery={{ enabled: true, showButton: true, autoRetry: true }}
/>;
```

Hooks: `useUploadRescue(options)`, `useUploadRecovery(controller)`, `useFileOptimization()`. The image engine is used by default and loaded lazily.

Documentation: https://github.com/madhavbuilds/uploadrescue/tree/main/docs · Source: https://github.com/madhavbuilds/uploadrescue

License: Apache-2.0
