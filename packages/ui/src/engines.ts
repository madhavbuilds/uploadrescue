import { lazyEngine, type OptimizationEngine } from "@uploadrescue/core";

/**
 * Engines used by the React and Vanilla integrations when none are passed:
 * the image engine, loaded with a dynamic import on first use so it is not
 * part of the initial bundle. Add PDF, document, archive or media engines
 * explicitly via the `engines` option.
 */
export function defaultEngines(): OptimizationEngine[] {
  return [
    lazyEngine({
      id: "image",
      supportedTypes: [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/avif",
        "image/gif",
        "image/svg+xml",
      ],
      load: () => import("@uploadrescue/image-engine").then((m) => m.createImageEngine()),
    }),
  ];
}
