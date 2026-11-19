import {
  createUploadRescue,
  optimizeFile,
  type OptimizationEngine,
  type OptimizationOptions,
  type OptimizationResult,
  type RecoveryAction,
  type RecoveryState,
  type UploadFunction,
  type UploadRescueConfig,
  type UploadRescueController,
} from "@uploadrescue/core";
import { defaultEngines } from "@uploadrescue/ui";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

export interface UploadRecoveryApi<TResult> {
  state: RecoveryState<TResult>;
  controller: UploadRescueController<TResult>;
  /** Start a new upload session for `file`. */
  select: (file: File) => Promise<RecoveryState<TResult>>;
  /** Upload the selected file (only needed with `autoUpload: false`). */
  upload: () => Promise<RecoveryState<TResult>>;
  /** Run the offered recovery step (or a specific allowed one). */
  recover: (action?: RecoveryAction) => Promise<RecoveryState<TResult>>;
  cancel: () => void;
  reset: () => void;
}

/**
 * Subscribes to an existing controller (created with `createUploadRescue` or
 * `useUploadRescue`). Safe during SSR: the server snapshot is the current state.
 */
export function useUploadRecovery<TResult>(
  controller: UploadRescueController<TResult>,
): UploadRecoveryApi<TResult> {
  const subscribe = useCallback((cb: () => void) => controller.subscribe(cb), [controller]);
  const getSnapshot = useCallback(() => controller.getState(), [controller]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(
    () => ({
      state,
      controller,
      select: (file: File) => controller.select(file),
      upload: () => controller.upload(),
      recover: (action?: RecoveryAction) => controller.recover(action),
      cancel: () => controller.cancel(),
      reset: () => controller.reset(),
    }),
    [state, controller],
  );
}

export type UseUploadRescueOptions<TResult> = Omit<UploadRescueConfig<TResult>, "upload"> & {
  upload?: UploadFunction<TResult>;
  /** Alias of `upload`. */
  onUpload?: UploadFunction<TResult>;
};

function toConfig<TResult>(
  options: UseUploadRescueOptions<TResult>,
  engines: OptimizationEngine[],
): UploadRescueConfig<TResult> {
  const { onUpload, upload, ...rest } = options;
  const fn = upload ?? onUpload;
  if (!fn) throw new TypeError("UploadRescue: provide an `upload` (or `onUpload`) function.");
  return { ...rest, upload: fn, engines: options.engines ?? engines };
}

/**
 * Creates a controller bound to the component's lifetime. The latest options
 * (including callbacks) are applied on every render; in-flight work is
 * cancelled on unmount. Works under React Strict Mode.
 */
export function useUploadRescue<TResult = unknown>(
  options: UseUploadRescueOptions<TResult>,
): UploadRecoveryApi<TResult> {
  const [fallbackEngines] = useState(defaultEngines);
  const [controller] = useState(() =>
    createUploadRescue<TResult>(toConfig(options, fallbackEngines)),
  );
  useEffect(() => {
    controller.updateConfig(toConfig(options, fallbackEngines));
  });
  useEffect(() => () => controller.cancel(), [controller]);
  return useUploadRecovery(controller);
}

export type FileOptimizationStatus = "idle" | "optimizing" | "done" | "error" | "cancelled";

export interface FileOptimizationState {
  status: FileOptimizationStatus;
  result: OptimizationResult | null;
  error: Error | null;
  progress: number | null;
  stage: string | null;
}

export interface UseFileOptimizationOptions {
  /** Engines to use. Default: the lazy image engine. */
  engines?: OptimizationEngine[];
}

/**
 * Standalone optimization without uploading — e.g. to preview savings.
 * Only one optimization runs at a time; starting a new one cancels the previous.
 */
export function useFileOptimization(options: UseFileOptimizationOptions = {}) {
  const [fallbackEngines] = useState(defaultEngines);
  const engines = options.engines ?? fallbackEngines;
  const [state, setState] = useState<FileOptimizationState>({
    status: "idle",
    result: null,
    error: null,
    progress: null,
    stage: null,
  });
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    if (!controllerRef.current) return;
    controllerRef.current.abort();
    controllerRef.current = null;
    setState((s) =>
      s.status === "optimizing" ? { ...s, status: "cancelled", progress: null } : s,
    );
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const optimize = useCallback(
    async (
      file: File,
      opts: Partial<OptimizationOptions> = {},
    ): Promise<OptimizationResult | null> => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setState({ status: "optimizing", result: null, error: null, progress: null, stage: null });
      try {
        const result = await optimizeFile(file, {
          ...opts,
          engines,
          signal: controller.signal,
          onProgress: (progress, stage) => {
            if (!controller.signal.aborted)
              setState((s) => ({ ...s, progress, stage: stage ?? s.stage }));
          },
        });
        if (controller.signal.aborted) return null;
        setState({ status: "done", result, error: null, progress: 1, stage: null });
        return result;
      } catch (error) {
        if (controller.signal.aborted) return null;
        setState({
          status: "error",
          result: null,
          error: error as Error,
          progress: null,
          stage: null,
        });
        return null;
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [engines],
  );

  return { ...state, optimize, cancel };
}
