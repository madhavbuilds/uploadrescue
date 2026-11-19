import {
  createUploadRescue as createController,
  type OptimizationEngine,
  type OptimizationResult,
  type RecoveryState,
  type UploadFailure,
  type UploadProgress,
  type UploadRescueConfig,
  type UploadRescueController,
} from "@uploadrescue/core";
import {
  createDomWidget,
  defaultEngines,
  getRecoveryView,
  runViewAction,
  type DomWidget,
  type RecoveryLabels,
} from "@uploadrescue/ui";

export interface VanillaUploadRescueOptions<TResult = unknown> extends UploadRescueConfig<TResult> {
  /** Render the recovery widget into this element (selector or element). */
  container?: string | HTMLElement;
  labels?: Partial<RecoveryLabels>;
  theme?: "light" | "dark" | "auto";
  /** Accept attribute for the widget's own file picker. Defaults to `acceptedTypes`. */
  accept?: string;
  /** Accessible name of the widget. */
  label?: string;
  /** Set false to skip the built-in UI and render yourself from events. Default true. */
  render?: boolean;
}

export interface UploadRescueEvents<TResult> {
  state: RecoveryState<TResult>;
  success: { result: TResult; file: File; optimized: boolean };
  error: { error: Error; failure: UploadFailure | null };
  optimization: OptimizationResult;
  progress: UploadProgress;
}

export interface AttachOptions {
  /** Element that accepts dropped files (selector or element). */
  dropzone?: string | HTMLElement;
}

export interface UploadRescueInstance<TResult = unknown> {
  readonly controller: UploadRescueController<TResult>;
  /** Wire an existing `<input type="file">`. Returns a function that detaches it. */
  attach(target: string | HTMLInputElement, options?: AttachOptions): () => void;
  /** Render the widget into a container (if not given in options). */
  mount(container: string | HTMLElement): UploadRescueInstance<TResult>;
  select(file: File): Promise<RecoveryState<TResult>>;
  recover(): Promise<RecoveryState<TResult>>;
  cancel(): void;
  reset(): void;
  getState(): RecoveryState<TResult>;
  on<K extends keyof UploadRescueEvents<TResult>>(
    event: K,
    listener: (payload: UploadRescueEvents<TResult>[K]) => void,
  ): () => void;
  /** Remove listeners, DOM and cancel any running work. */
  destroy(): void;
}

function resolveElement<T extends HTMLElement>(target: string | T, name: string): T {
  if (typeof target !== "string") return target;
  const el = document.querySelector<T>(target);
  if (!el) throw new Error(`UploadRescue: ${name} "${target}" was not found.`);
  return el;
}

/**
 * Framework-free UploadRescue: wire file inputs and drop zones, render the
 * recovery widget, and subscribe to events.
 */
export function createUploadRescue<TResult = unknown>(
  options: VanillaUploadRescueOptions<TResult>,
): UploadRescueInstance<TResult> {
  const { container, labels, theme, accept, label, render = true, ...rest } = options;
  type Events = UploadRescueEvents<TResult>;
  const listeners: { [K in keyof Events]?: Set<(payload: Events[K]) => void> } = {};
  const emit = <K extends keyof Events>(event: K, payload: Events[K]) => {
    listeners[event]?.forEach((fn) => fn(payload));
  };

  const engines: OptimizationEngine[] = rest.engines ?? defaultEngines();
  const controller = createController<TResult>({
    ...rest,
    engines,
    onSuccess: (result, ctx) => {
      rest.onSuccess?.(result, ctx);
      emit("success", { result, file: ctx.file, optimized: ctx.optimized });
    },
    onError: (error, failure) => {
      rest.onError?.(error, failure);
      emit("error", { error, failure });
    },
    onOptimization: (original, optimized, result) => {
      rest.onOptimization?.(original, optimized, result);
      emit("optimization", result);
    },
    onProgress: (progress) => {
      rest.onProgress?.(progress);
      emit("progress", progress);
    },
  });

  let widget: DomWidget | null = null;
  const cleanups: Array<() => void> = [];
  const viewOptions = {
    ...(labels ? { labels } : {}),
    showRecoveryButton: rest.recovery?.showButton ?? true,
  };
  const select = (file: File) => controller.select(file);
  const swallow = (p: Promise<unknown> | void) => {
    if (p) p.catch(() => undefined);
  };

  const unsubscribe = controller.subscribe((state) => {
    widget?.update(getRecoveryView(state, viewOptions));
    emit("state", state);
  });

  const instance: UploadRescueInstance<TResult> = {
    controller,
    mount(target) {
      if (!render || widget) return instance;
      widget = createDomWidget(resolveElement(target, "container"), {
        onAction: (id) => {
          if (id !== "select")
            swallow(runViewAction(controller as UploadRescueController<unknown>, id));
        },
        onFiles: (files) => files[0] && swallow(select(files[0])),
        ...((accept ?? rest.acceptedTypes)
          ? { accept: accept ?? rest.acceptedTypes!.join(",") }
          : {}),
        ...(theme ? { theme } : {}),
        ...(label ? { label } : {}),
      });
      widget.update(getRecoveryView(controller.getState(), viewOptions));
      return instance;
    },
    attach(target, attachOptions = {}) {
      const input = resolveElement<HTMLInputElement>(target, "input");
      const onChange = () => {
        const file = input.files?.[0];
        if (file) swallow(select(file));
      };
      input.addEventListener("change", onChange);
      const detach: Array<() => void> = [() => input.removeEventListener("change", onChange)];

      if (attachOptions.dropzone) {
        const zone = resolveElement(attachOptions.dropzone, "dropzone");
        const over = (e: DragEvent) => {
          e.preventDefault();
          zone.dataset.dragging = "true";
        };
        const leave = () => delete zone.dataset.dragging;
        const drop = (e: DragEvent) => {
          e.preventDefault();
          delete zone.dataset.dragging;
          const file = e.dataTransfer?.files?.[0];
          if (file) swallow(select(file));
        };
        zone.addEventListener("dragover", over);
        zone.addEventListener("dragleave", leave);
        zone.addEventListener("drop", drop);
        detach.push(() => {
          zone.removeEventListener("dragover", over);
          zone.removeEventListener("dragleave", leave);
          zone.removeEventListener("drop", drop);
        });
      }

      // Without an explicit container, show the recovery widget right after the input.
      if (render && !widget && !container) {
        const host = document.createElement("div");
        host.className = "ur-attached";
        input.insertAdjacentElement("afterend", host);
        instance.mount(host);
        detach.push(() => host.remove());
      }
      const off = () => detach.splice(0).forEach((fn) => fn());
      cleanups.push(off);
      return off;
    },
    select,
    recover: () => controller.recover(),
    cancel: () => controller.cancel(),
    reset: () => controller.reset(),
    getState: () => controller.getState(),
    on(event, listener) {
      const map = listeners as Record<string, Set<(payload: never) => void> | undefined>;
      const set = (map[event] ??= new Set());
      set.add(listener as (payload: never) => void);
      return () => {
        set.delete(listener as (payload: never) => void);
      };
    },
    destroy() {
      unsubscribe();
      cleanups.splice(0).forEach((fn) => fn());
      widget?.destroy();
      widget = null;
      for (const key of Object.keys(listeners) as Array<keyof Events>) listeners[key]?.clear();
      controller.destroy();
    },
  };

  if (container) instance.mount(container);
  return instance;
}

export { getRecoveryView, DEFAULT_LABELS, type RecoveryLabels } from "@uploadrescue/ui";
export type {
  RecoveryState,
  UploadFailure,
  UploadRescueConfig,
  OptimizationResult,
} from "@uploadrescue/core";
