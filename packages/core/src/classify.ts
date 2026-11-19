import {
  OptimizationError,
  UploadAbortedError,
  UploadHttpError,
  UploadNetworkError,
  UploadTimeoutError,
  isAbortError,
} from "./errors";
import type { ValidationIssue } from "./validate";

export type UploadFailureKind =
  /** File exceeds a client-side or server-side size limit. Recoverable by optimization. */
  | "file-too-large"
  /** Request never got a response. Retryable; a smaller file may also help. */
  | "network"
  /** Request took too long. Retryable; a smaller file may also help. */
  | "timeout"
  /** 401 / 403 — never retried automatically. */
  | "auth"
  /** 415 or client-side type rejection — never retried. */
  | "unsupported-type"
  /** 429 — not retried automatically. */
  | "rate-limited"
  /** 5xx — unrelated to the file; not retried automatically. */
  | "server"
  /** Client-side validation failure that optimization cannot fix. */
  | "invalid-file"
  | "cancelled"
  | "unknown";

export type UploadFailureSource =
  "validation" | "http" | "network" | "timeout" | "adapter" | "custom";

export interface UploadFailure {
  kind: UploadFailureKind;
  source: UploadFailureSource;
  /** Human-readable explanation suitable for end users. */
  message: string;
  status?: number;
  /** Retrying the same file may succeed. */
  retryable: boolean;
  /** Retrying with an optimized (smaller) file may succeed. */
  optimizable: boolean;
  /** Size limit reported by the server (via header or JSON body), when available. */
  serverMaxSize?: number;
  /** The original thrown value. */
  cause?: unknown;
}

export interface ClassifyOptions {
  /** Extra HTTP statuses that mean "file too large" (e.g. `[400]` for some storage APIs). Default: `[413]`. */
  sizeErrorStatuses?: readonly number[];
  /** Response-body patterns that indicate a size rejection regardless of status. */
  sizeErrorPatterns?: readonly RegExp[];
  /** Extra statuses that are safe to retry unchanged. Default: `[408]`. */
  retryableStatuses?: readonly number[];
}

/**
 * Body patterns emitted by common storage backends for oversize uploads:
 * S3 (`EntityTooLarge`), Supabase ("exceeded the maximum allowed size"),
 * multer (`LIMIT_FILE_SIZE`), Cloudinary ("File size too large"), nginx.
 */
export const DEFAULT_SIZE_ERROR_PATTERNS: readonly RegExp[] = [
  /EntityTooLarge/,
  /PAYLOAD_TOO_LARGE/i,
  /payload too large/i,
  /request entity too large/i,
  /LIMIT_FILE_SIZE/,
  /file[ _-]?size[ _-]?too[ _-]?large/i,
  /file[ _-]too[ _-]large/i,
  /exceeded the maximum allowed size/i,
];

export function createFailure(
  kind: UploadFailureKind,
  init: Partial<Omit<UploadFailure, "kind">> & { message: string },
): UploadFailure {
  const defaults = FAILURE_DEFAULTS[kind];
  return {
    kind,
    source: init.source ?? "custom",
    message: init.message,
    retryable: init.retryable ?? defaults.retryable,
    optimizable: init.optimizable ?? defaults.optimizable,
    ...(init.status !== undefined ? { status: init.status } : {}),
    ...(init.serverMaxSize !== undefined ? { serverMaxSize: init.serverMaxSize } : {}),
    ...(init.cause !== undefined ? { cause: init.cause } : {}),
  };
}

const FAILURE_DEFAULTS: Record<UploadFailureKind, { retryable: boolean; optimizable: boolean }> = {
  "file-too-large": { retryable: false, optimizable: true },
  network: { retryable: true, optimizable: true },
  timeout: { retryable: true, optimizable: true },
  auth: { retryable: false, optimizable: false },
  "unsupported-type": { retryable: false, optimizable: false },
  "rate-limited": { retryable: false, optimizable: false },
  server: { retryable: false, optimizable: false },
  "invalid-file": { retryable: false, optimizable: false },
  cancelled: { retryable: false, optimizable: false },
  unknown: { retryable: false, optimizable: false },
};

function parsePositiveInt(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/**
 * Reads a size limit announced by the server. Supported conventions:
 * - `X-Upload-Max-Size: <bytes>` response header
 * - JSON body with `maxSize`, `max_size`, `maxFileSize` or `limit` (bytes)
 */
export function extractServerMaxSize(error: UploadHttpError): number | undefined {
  const header = parsePositiveInt(error.headers["x-upload-max-size"]);
  if (header) return header;
  if (!error.body) return undefined;
  try {
    const json: unknown = JSON.parse(error.body);
    if (json && typeof json === "object") {
      const record = json as Record<string, unknown>;
      for (const key of ["maxSize", "max_size", "maxFileSize", "limit"]) {
        const v = parsePositiveInt(record[key]);
        if (v) return v;
      }
      const nested = record.error;
      if (nested && typeof nested === "object") {
        const n = nested as Record<string, unknown>;
        return parsePositiveInt(n.maxSize) ?? parsePositiveInt(n.max_size);
      }
    }
  } catch {
    // Not JSON; fall through.
  }
  return undefined;
}

function classifyHttp(error: UploadHttpError, options: ClassifyOptions): UploadFailure {
  const { status } = error;
  const sizeStatuses = [413, ...(options.sizeErrorStatuses ?? [])];
  const patterns = options.sizeErrorPatterns ?? DEFAULT_SIZE_ERROR_PATTERNS;
  const bodyIndicatesSize = !!error.body && patterns.some((p) => p.test(error.body!));
  const base = { source: "http" as const, status, cause: error };

  if (sizeStatuses.includes(status) || (status >= 400 && status < 500 && bodyIndicatesSize)) {
    const serverMaxSize = extractServerMaxSize(error);
    return createFailure("file-too-large", {
      ...base,
      message: "The server rejected the file because it is too large.",
      ...(serverMaxSize !== undefined ? { serverMaxSize } : {}),
    });
  }
  if (status === 401 || status === 403) {
    return createFailure("auth", {
      ...base,
      message: "You are not allowed to upload this file. Please sign in again or contact support.",
    });
  }
  if (status === 415) {
    return createFailure("unsupported-type", {
      ...base,
      message: "The server does not accept this file type.",
    });
  }
  if (status === 429) {
    return createFailure("rate-limited", {
      ...base,
      message: "Too many uploads in a short time. Please wait a moment and try again.",
    });
  }
  if (status === 408 || status === 504 || (options.retryableStatuses ?? []).includes(status)) {
    return createFailure("timeout", { ...base, message: "The server took too long to respond." });
  }
  if (status >= 500) {
    return createFailure("server", {
      ...base,
      message: "The server could not process the upload. Please try again later.",
    });
  }
  return createFailure("unknown", {
    ...base,
    message: `The upload was rejected (HTTP ${status}).`,
  });
}

/**
 * Maps any thrown value to an {@link UploadFailure}. This is deliberately
 * conservative: only errors with a clear signal are marked retryable or
 * optimizable. Developers can extend it with `classifyError`.
 */
export function classifyUploadError(error: unknown, options: ClassifyOptions = {}): UploadFailure {
  if (error instanceof UploadHttpError) return classifyHttp(error, options);
  if (error instanceof UploadTimeoutError) {
    return createFailure("timeout", { source: "timeout", message: error.message, cause: error });
  }
  if (error instanceof UploadAbortedError || isAbortError(error)) {
    return createFailure("cancelled", {
      source: "adapter",
      message: "The upload was cancelled.",
      cause: error,
    });
  }
  if (error instanceof UploadNetworkError) {
    return createFailure("network", { source: "network", message: error.message, cause: error });
  }
  // `fetch` rejects with a TypeError when no response was received.
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) {
    return createFailure("network", {
      source: "network",
      message: "The upload could not reach the server. Check your connection and try again.",
      cause: error,
    });
  }
  if (error instanceof OptimizationError) {
    return createFailure("unknown", { source: "adapter", message: error.message, cause: error });
  }
  return createFailure("unknown", {
    source: "adapter",
    message: "The upload failed for an unknown reason.",
    cause: error,
  });
}

/** Converts a client-side validation issue into a failure. */
export function failureFromValidation(issue: ValidationIssue): UploadFailure {
  if (issue.code === "file-too-large") {
    return createFailure("file-too-large", { source: "validation", message: issue.message });
  }
  if (issue.code === "type-not-accepted" || issue.code === "type-mismatch") {
    return createFailure("unsupported-type", { source: "validation", message: issue.message });
  }
  return createFailure("invalid-file", { source: "validation", message: issue.message });
}
