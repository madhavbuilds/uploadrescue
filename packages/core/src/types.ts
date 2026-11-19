import type { ClassifyOptions, UploadFailure } from "./classify";
import type { FileInfo } from "./detect";
import type { OptimizationEngine, OptimizationResult } from "./engines";
import type { OptimizationErrorReason } from "./errors";
import type { RecoveryStatus } from "./state";

export interface UploadContext {
  /** 1-based upload attempt number for the current file session. */
  attempt: number;
  isRetry: boolean;
  /** The file the user originally selected (never modified). */
  originalFile: File;
  /** Present when `file` is an optimized version of `originalFile`. */
  optimization: OptimizationResult | null;
  /** Aborted on cancel, timeout, reset or destroy. Pass it to fetch/XHR. */
  signal: AbortSignal;
  /** Stable for every attempt of the same selected file. Send it to your server to deduplicate. */
  idempotencyKey: string;
  /** Unique per attempt. */
  attemptId: string;
  /** The failure that caused this retry, if any. */
  previousFailure: UploadFailure | null;
  /** Report upload progress in bytes. */
  reportProgress: (loaded: number, total?: number) => void;
}

/**
 * Your existing upload logic. Throw (ideally an `UploadHttpError`) on failure.
 * It is invoked again — with a fresh context — for every retry, so signed
 * URLs can be regenerated per attempt.
 */
export type UploadFunction<TResult = unknown> = (
  file: File,
  context: UploadContext,
) => Promise<TResult>;

export interface UploadProgress {
  phase: "upload" | "optimize";
  /** Progress in [0, 1], or null when indeterminate. */
  ratio: number | null;
  loaded?: number;
  total?: number;
  attempt: number;
  stage?: string;
}

export interface OptimizationConfig {
  /** Default true. */
  enabled?: boolean;
  /** Desired output size. Defaults to the effective size limit. */
  targetSize?: number;
  /** Initial encoder quality in [0, 1]. Default 0.82. */
  quality?: number;
  /** Keep the original format. Default true. */
  preserveFormat?: boolean;
  /** Optimization runs per selected file (later runs are more aggressive). Default 2. */
  maxAttempts?: number;
  /** Maximum image/video width or height in pixels. */
  maxDimension?: number;
}

export interface RecoveryConfig {
  /** Default true. */
  enabled?: boolean;
  /** Show the "Compress & Retry" button in UI integrations. Default true. */
  showButton?: boolean;
  /** Start recovery automatically after a recoverable failure. Default false. */
  autoRetry?: boolean;
  /** Maximum recovery attempts (retries) per selected file. Default 3. */
  maxAttempts?: number;
}

export interface ClassifyContext {
  file: File;
  attempt: number;
}

export interface SuccessContext {
  file: File;
  originalFile: File;
  optimized: boolean;
  attempt: number;
}

export interface UploadRescueConfig<TResult = unknown> {
  /** Your upload function. Required. */
  upload: UploadFunction<TResult>;
  /** Client-side size limit in bytes. */
  maxSize?: number;
  /** `accept`-style patterns, matched against the content-detected type. */
  acceptedTypes?: string[];
  /** Reject files whose content contradicts their extension. Default false. */
  rejectTypeMismatch?: boolean;
  /** Start uploading immediately after `select()`. Default true. */
  autoUpload?: boolean;
  /** Per-attempt upload timeout in milliseconds. */
  timeout?: number;
  /** Optimization engines, tried in order. */
  engines?: OptimizationEngine[];
  optimization?: OptimizationConfig;
  recovery?: RecoveryConfig;
  /** Tunes the built-in error classifier. */
  errors?: ClassifyOptions;
  /**
   * Custom classification for application-specific errors. Return null or
   * undefined to fall back to the built-in classifier.
   */
  classifyError?: (error: unknown, context: ClassifyContext) => UploadFailure | null | undefined;
  onSuccess?: (result: TResult, context: SuccessContext) => void;
  /** Called for every failed upload attempt and every failed optimization. */
  onError?: (error: Error, failure: UploadFailure | null) => void;
  onOptimization?: (original: File, optimized: File, result: OptimizationResult) => void;
  onProgress?: (progress: UploadProgress) => void;
  onStateChange?: (state: RecoveryState<TResult>) => void;
}

export type RecoveryAction = "optimize" | "retry";

export type OptimizationFailureReason =
  | OptimizationErrorReason
  /** Output was smaller but still above the size limit. */
  | "target-not-reached"
  /** Output was not smaller than the input. */
  | "no-reduction"
  /** Output violates other client-side rules (e.g. a converted type is not accepted). */
  | "rejected-output";

export interface OptimizationFailure {
  reason: OptimizationFailureReason;
  message: string;
}

export interface RecoveryEvent {
  id: string;
  type: "validation" | "upload" | "optimization";
  attempt: number;
  startedAt: number;
  endedAt: number;
  fileName: string;
  fileSize: number;
  outcome: "success" | "failure" | "cancelled";
  failure?: UploadFailure;
  optimization?: Pick<
    OptimizationResult,
    "engine" | "originalSize" | "outputSize" | "durationMs" | "withinTarget" | "changed"
  >;
  message?: string;
}

export interface RecoveryState<TResult = unknown> {
  status: RecoveryStatus;
  originalFile: File | null;
  fileInfo: FileInfo | null;
  /** File used for the latest (or next) upload attempt: original or optimized. */
  activeFile: File | null;
  failure: UploadFailure | null;
  optimization: OptimizationResult | null;
  optimizationFailure: OptimizationFailure | null;
  progress: UploadProgress | null;
  /** The recovery step `recover()` will perform, or null when none is possible. */
  recoveryAction: RecoveryAction | null;
  /** A secondary option (e.g. "optimize" when "retry" is primary for network failures). */
  alternativeAction: RecoveryAction | null;
  attempts: { uploads: number; recoveries: number; optimizations: number };
  maxRecoveryAttempts: number;
  /** Effective size limit: the stricter of `maxSize` and any server-reported limit. */
  maxSize: number | null;
  result: TResult | undefined;
  /** Terminal error (status `failed`). */
  error: Error | null;
  history: readonly RecoveryEvent[];
  /** Same as `UploadContext.idempotencyKey` for the current file. */
  sessionId: string | null;
}

export type RecoveryListener<TResult = unknown> = (state: RecoveryState<TResult>) => void;
