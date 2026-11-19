---
title: UI customization
order: 11
---

# UI customization

## Theme with CSS variables

```css
.ur-widget {
  --ur-accent: #0f766e;
  --ur-accent-text: #ffffff;
  --ur-radius: 6px;
  --ur-font: "IBM Plex Sans", system-ui, sans-serif;
}
```

Available tokens: `--ur-font`, `--ur-text`, `--ur-muted`, `--ur-bg`, `--ur-surface`, `--ur-border`, `--ur-border-strong`, `--ur-accent`, `--ur-accent-text`, `--ur-success`, `--ur-success-text`, `--ur-warning`, `--ur-warning-text`, `--ur-error`, `--ur-error-text`, `--ur-focus`, `--ur-radius`, `--ur-gap`.

`theme="light" | "dark" | "auto"` sets `data-theme`; `auto` follows `prefers-color-scheme`. The widget exposes `data-status` and `data-tone` attributes for state-specific styling.

## Text and localisation

```tsx
import { UploadRescue } from "@uploadrescue/react";

export const German = () => (
  <UploadRescue
    upload={async (file) => file.name}
    labels={{
      idleTitle: "Datei hochladen",
      tooLargeTitle: "Die Datei ist zu groß.",
      tooLargeWithLimit: (limit, actual) => `Maximal erlaubt: ${limit}. Ihre Datei: ${actual}.`,
      compressAndRetry: "Komprimieren & erneut hochladen",
      successTitle: "Upload erfolgreich.",
    }}
  />
);
```

See `DEFAULT_LABELS` for every key.

## Custom buttons and error content (React)

```tsx
import { UploadRescue } from "@uploadrescue/react";

export const Branded = () => (
  <UploadRescue
    upload={async (file) => file.name}
    renderButton={(action, onClick) => (
      <button className={action.variant === "primary" ? "btn btn-primary" : "btn"} onClick={onClick}>
        {action.label}
      </button>
    )}
    renderError={(view) => (
      <div role="alert" className="my-alert">
        <strong>{view.title}</strong> {view.description}
      </div>
    )}
  />
);
```

## Fully custom UI

Every integration derives its UI from `getRecoveryView(state)`, a pure function returning the title, description, stats, progress and actions for the current state. Use it to build your own UI with identical behaviour:

```tsx
import { UploadRescue } from "@uploadrescue/react";

export const Minimal = () => (
  <UploadRescue upload={async (file) => file.name}>
    {({ view, act }) => (
      <section aria-busy={view.busy}>
        <h3>{view.title}</h3>
        {view.description && <p>{view.description}</p>}
        {view.stats.map((s) => (
          <span key={s.id}>
            {s.label}: {s.value}{" "}
          </span>
        ))}
        {view.actions.map((a) => (
          <button key={a.id} onClick={() => act(a.id)}>
            {a.label}
          </button>
        ))}
      </section>
    )}
  </UploadRescue>
);
```

## Accessibility

The widgets target WCAG 2.2 AA:

- Real `<button>` elements with visible focus rings; focus stays in the action area as buttons change.
- State changes are announced through an `aria-live` region (assertive for errors).
- Progress uses `role="progressbar"` with `aria-valuenow`, or indeterminate when unknown.
- Text colours meet 4.5:1 contrast in light and dark themes; status is never conveyed by colour alone.
- Animations are disabled under `prefers-reduced-motion`.
