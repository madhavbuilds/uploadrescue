# @uploadrescue/ui

Shared presentation layer for UploadRescue: `getRecoveryView(state)` (state → title, description, real stats, actions), a safe DOM renderer, default lazy engines, and accessible, themable CSS (`@uploadrescue/ui/styles.css`).

```bash
pnpm add @uploadrescue/ui
```

## Usage

```ts
import { getRecoveryView } from "@uploadrescue/ui";

const view = getRecoveryView(controller.getState());
// view.title, view.description, view.stats, view.progress, view.actions
```

Theme with CSS variables such as `--ur-accent`, `--ur-radius` and `--ur-font`.

Documentation: https://github.com/madhavbuilds/uploadrescue/tree/main/docs · Source: https://github.com/madhavbuilds/uploadrescue

License: Apache-2.0
