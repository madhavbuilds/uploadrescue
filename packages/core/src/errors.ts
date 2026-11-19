/**
 * Explicit, typed error classes used across UploadRescue.
 *
 * Upload adapters (and developer-provided upload functions) should throw these
 * so the classifier can make reliable decisions instead of guessing.
 */

export type UploadRescueErrorCode =
  | "http-error"
  | "network-error"
  | "timeout"
  | "aborted"
  | "validation-failed"
  | "optimization-failed"
  | "invalid-transition"
  | "destroyed";

export class UploadRescueError extends Error {
  readonly code: UploadRescueErrorCode;

  constructor(code: UploadRescueErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UploadRescueError";
    this.code = code;
  }
}

export interface UploadHttpErrorInit {
  status: number;
  statusText?: string;
  /** Response body as text (truncated by adapters to a safe length). */
  body?: string;
  /** Lower-cased response headers. */
  headers?: Record<string, string>;
  url?: string;
  cause?: unknown;
}

/** Thrown when the server responded with a non-success HTTP status. */
export class UploadHttpError extends UploadRescueError {
  readonly status: number;
  readonly statusText: string;
  readonly body: string | undefined;
  readonly headers: Record<string, string>;
  readonly url: string | undefined;

  constructor(init: UploadHttpErrorInit) {
    super(
      "http-error",
      `Upload failed with HTTP ${init.status}${init.statusText ? ` ${init.statusText}` : ""}`,
      { cause: init.cause },
    );
    this.name = "UploadHttpError";
    this.status = init.status;
    this.statusText = init.statusText ?? "";
    this.body = init.body;
    this.headers = init.headers ?? {};
    this.url = init.url;
  }

  /** Builds an error from a fetch `Response`, reading at most `maxBodyBytes` of the body. */
  static async fromResponse(
    response: Response,
    maxBodyBytes = 64 * 1024,
  ): Promise<UploadHttpError> {
    let body: string | undefined;
    try {
      const text = await response.text();
      body = text.length > maxBodyBytes ? text.slice(0, maxBodyBytes) : text;
    } catch {
      body = undefined;
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return new UploadHttpError({
      status: response.status,
      statusText: response.statusText,
      body,
      headers,
      url: response.url || undefined,
    });
  }
}

/** Thrown when the request never received a response (offline, DNS, CORS, connection reset). */
export class UploadNetworkError extends UploadRescueError {
  constructor(message = "The upload could not reach the server.", options?: { cause?: unknown }) {
    super("network-error", message, options);
    this.name = "UploadNetworkError";
  }
}

/** Thrown when an upload attempt exceeded the configured timeout. */
export class UploadTimeoutError extends UploadRescueError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super("timeout", `The upload did not finish within ${Math.round(timeoutMs / 1000)} seconds.`);
    this.name = "UploadTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** Thrown when an operation was cancelled through an AbortSignal. */
export class UploadAbortedError extends UploadRescueError {
  constructor(message = "The operation was cancelled.") {
    super("aborted", message);
    this.name = "UploadAbortedError";
  }
}

export type OptimizationErrorReason =
  /** No registered engine can process this file type. */
  | "no-engine"
  /** An engine exists but refused this particular file (animated GIF, encrypted PDF, ...). */
  | "unsupported"
  /** The required browser capability (canvas, WebAssembly, ...) is unavailable. */
  | "environment"
  /** The file exceeds the engine's safe processing limits. */
  | "resource-limit"
  /** The engine produced an output that failed validation. */
  | "invalid-output"
  /** Processing was cancelled. */
  | "aborted"
  /** The engine failed unexpectedly (malformed input, decoder error, ...). */
  | "failed";

export class OptimizationError extends UploadRescueError {
  readonly reason: OptimizationErrorReason;
  readonly engine: string | undefined;

  constructor(
    reason: OptimizationErrorReason,
    message: string,
    options?: { cause?: unknown; engine?: string },
  ) {
    super("optimization-failed", message, options);
    this.name = "OptimizationError";
    this.reason = reason;
    this.engine = options?.engine;
  }
}

/** True for DOMException AbortError, UploadAbortedError and similar abort-shaped errors. */
export function isAbortError(error: unknown): boolean {
  if (error instanceof UploadAbortedError) return true;
  if (error instanceof OptimizationError) return error.reason === "aborted";
  if (typeof error === "object" && error !== null && "name" in error) {
    return (error as { name: unknown }).name === "AbortError";
  }
  return false;
}

/** Normalises any thrown value into an Error instance without losing the original. */
export function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  return new Error("Unknown error", { cause: error });
}
