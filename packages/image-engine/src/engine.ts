import {
  OptimizationError,
  extensionForMime,
  matchesAccept,
  type EngineOutput,
  type OptimizationContext,
  type OptimizationEngine,
  type OptimizationOptions,
} from "@uploadrescue/core";
import { canEncode, mainThreadEnv } from "./env";
import { WORKER_SOURCE } from "./generated/worker-source";
import { headerBytesFor, parseImageHeader } from "./inspect";
import {
  PipelineError,
  hasOffscreenCanvas,
  runRasterPipeline,
  type RasterJob,
  type RasterResult,
} from "./pipeline";
import { sanitizeSvg } from "./svg";
import type { WorkerRequest, WorkerResponse } from "./worker-entry";

export const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/svg+xml",
] as const;

export interface ImageEngineOptions {
  /** Process in a Web Worker when supported (falls back automatically). Default true. */
  useWorker?: boolean;
  /** Maximum output pixels; larger images are downscaled. Inputs above 4× this are refused. Default 40 MP. */
  maxPixels?: number;
  /** Minify SVGs (comments, editor metadata, whitespace). Default true. */
  minifySvg?: boolean;
}

const DEFAULT_MAX_PIXELS = 40_000_000;

/**
 * Output formats to try, in priority order.
 * - `preserveFormat`: only the input format.
 * - otherwise: formats that typically compress better, never JPEG for
 *   transparent images (filtered later once pixels are inspected).
 */
export function outputCandidates(
  inputType: string,
  preserveFormat: boolean,
  allowedOutputTypes?: readonly string[],
): string[] {
  let list: string[];
  if (preserveFormat) list = [inputType];
  else {
    switch (inputType) {
      case "image/jpeg":
        list = ["image/jpeg", "image/webp"];
        break;
      case "image/png":
        list = ["image/webp", "image/jpeg", "image/png"];
        break;
      case "image/webp":
        list = ["image/webp", "image/jpeg"];
        break;
      case "image/avif":
        list = ["image/avif", "image/webp", "image/jpeg"];
        break;
      case "image/gif":
        list = ["image/webp", "image/png"];
        break;
      default:
        list = [inputType];
    }
  }
  if (allowedOutputTypes && allowedOutputTypes.length > 0) {
    list = list.filter((t) =>
      matchesAccept(t, `file.${extensionForMime(t) ?? ""}`, allowedOutputTypes),
    );
  }
  return [...new Set(list)];
}

let workerUrl: string | null = null;
function getWorkerUrl(): string {
  // One small (~4 KB) Blob URL for the page lifetime, reused by every job.
  workerUrl ??= URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
  return workerUrl;
}

function workerSupported(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof URL.createObjectURL === "function" &&
    hasOffscreenCanvas()
  );
}

let jobId = 0;

/** Runs the pipeline in a dedicated worker. Aborting terminates the worker immediately. */
function runInWorker(
  job: RasterJob,
  ctx: Pick<OptimizationContext, "signal" | "onProgress">,
): Promise<RasterResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(getWorkerUrl());
    } catch (error) {
      reject(
        new PipelineError("environment", `Web Worker unavailable: ${(error as Error).message}`),
      );
      return;
    }
    const id = ++jobId;
    const finish = () => {
      ctx.signal.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      finish();
      reject(new PipelineError("aborted", "Optimization was cancelled."));
    };
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.id !== id) return;
      if (msg.type === "progress") ctx.onProgress(msg.ratio, msg.stage);
      else if (msg.type === "result") {
        finish();
        resolve(msg.result);
      } else {
        finish();
        reject(new PipelineError(msg.reason, msg.message));
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish();
      reject(
        new PipelineError(
          "environment",
          `Image worker failed: ${event.message || "unknown error"}`,
        ),
      );
    };
    const request: WorkerRequest = { id, job };
    worker.postMessage(request);
  });
}

/** Runs a raster job in a worker when possible, otherwise (or on environment failure) on the main thread. */
export async function runRasterJob(
  job: RasterJob,
  ctx: Pick<OptimizationContext, "signal" | "onProgress">,
  useWorker = true,
): Promise<{ result: RasterResult; worker: boolean }> {
  if (useWorker && workerSupported()) {
    try {
      return { result: await runInWorker(job, ctx), worker: true };
    } catch (error) {
      if (!(error instanceof PipelineError) || error.reason !== "environment") throw error;
      // Fall through: e.g. CSP blocks blob: workers, or the worker lacks an encoder.
    }
  }
  return {
    result: await runRasterPipeline(job, mainThreadEnv(), ctx.signal, ctx.onProgress),
    worker: false,
  };
}

function toOptimizationError(error: unknown): OptimizationError {
  if (error instanceof OptimizationError) return error;
  if (error instanceof PipelineError)
    return new OptimizationError(error.reason, error.message, { cause: error, engine: "image" });
  return new OptimizationError("failed", "The image could not be processed.", {
    cause: error,
    engine: "image",
  });
}

async function readHeader(file: Blob, mime: string) {
  const bytes = new Uint8Array(await file.slice(0, headerBytesFor(mime, file.size)).arrayBuffer());
  return parseImageHeader(bytes, mime);
}

/**
 * Browser image optimizer: JPEG, PNG, WebP, AVIF (where the browser can
 * encode it), static GIF (converted only when format changes are allowed) and
 * SVG (sanitized + minified).
 *
 * Rules: animated images are never rasterized; transparent images are never
 * converted to JPEG; outputs are never larger than inputs.
 */
export function createImageEngine(options: ImageEngineOptions = {}): OptimizationEngine {
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS;

  return {
    id: "image",
    supportedTypes: IMAGE_TYPES,

    async canProcess(file, info) {
      const mime = info.detected.mime;
      if (mime === "image/svg+xml") return typeof DOMParser !== "undefined";
      if (!(IMAGE_TYPES as readonly string[]).includes(mime)) return false;
      if (typeof createImageBitmap !== "function") return false;
      const header = await readHeader(file, mime);
      return !header.animated;
    },

    async optimize(
      file: File,
      opts: OptimizationOptions,
      ctx: OptimizationContext,
    ): Promise<EngineOutput> {
      const mime = ctx.info.detected.mime;
      if (mime === "image/svg+xml") return optimizeSvg(file, options.minifySvg ?? true);

      const header = await readHeader(file, mime);
      if (header.animated) {
        throw new OptimizationError(
          "unsupported",
          "Animated images are not optimized, so the animation is preserved.",
          {
            engine: "image",
          },
        );
      }
      if (header.width * header.height > maxPixels * 4) {
        throw new OptimizationError(
          "resource-limit",
          `The image is too large to process safely in the browser (${header.width}×${header.height}).`,
          { engine: "image" },
        );
      }

      const wanted = outputCandidates(mime, opts.preserveFormat, opts.allowedOutputTypes);
      const candidates: string[] = [];
      for (const type of wanted) if (await canEncode(type)) candidates.push(type);
      if (candidates.length === 0) {
        const ext = (extensionForMime(mime) ?? mime).toUpperCase();
        throw new OptimizationError(
          "unsupported",
          opts.preserveFormat
            ? `This browser cannot re-encode ${ext} images. Allow format conversion to optimize this file.`
            : "None of the allowed output formats can be encoded by this browser.",
          { engine: "image" },
        );
      }

      const job: RasterJob = {
        blob: file,
        inputType: mime,
        candidates,
        quality: opts.quality,
        attempt: opts.attempt,
        maxPixels,
        ...(opts.targetSize !== undefined ? { targetSize: opts.targetSize } : {}),
        ...(opts.maxDimension !== undefined ? { maxDimension: opts.maxDimension } : {}),
      };
      try {
        const { result, worker } = await runRasterJob(job, ctx, options.useWorker ?? true);
        return {
          blob: result.blob,
          type: result.type,
          notes: result.notes,
          details: {
            width: result.width,
            height: result.height,
            sourceWidth: result.sourceWidth,
            sourceHeight: result.sourceHeight,
            quality: result.quality,
            hasAlpha: result.hasAlpha,
            encodes: result.encodes,
            worker,
          },
        };
      } catch (error) {
        throw toOptimizationError(error);
      }
    },
  };
}

async function optimizeSvg(file: File, minify: boolean): Promise<EngineOutput> {
  let processed;
  try {
    processed = sanitizeSvg(await file.text(), { minify });
  } catch (error) {
    throw new OptimizationError("failed", (error as Error).message, {
      cause: error,
      engine: "image",
    });
  }
  const notes = [minify ? "Removed comments, editor metadata and whitespace." : "Sanitized SVG."];
  if (processed.removedElements || processed.removedAttributes) {
    notes.push(
      `Removed ${processed.removedElements} unsafe or unneeded element(s) and ${processed.removedAttributes} attribute(s).`,
    );
  }
  return {
    blob: new Blob([processed.svg], { type: "image/svg+xml" }),
    type: "image/svg+xml",
    notes,
    details: {
      removedElements: processed.removedElements,
      removedAttributes: processed.removedAttributes,
    },
  };
}

export interface RecompressOptions {
  quality?: number;
  maxDimension?: number;
  signal?: AbortSignal;
  useWorker?: boolean;
}

/**
 * Re-encodes an embedded image in the same format (used by the PDF and
 * Office engines). Returns null when the result would not be smaller, or the
 * image has transparency that JPEG cannot hold.
 */
export async function recompressImage(
  blob: Blob,
  type: "image/jpeg" | "image/png",
  options: RecompressOptions = {},
): Promise<Blob | null> {
  if (!(await canEncode(type))) return null;
  const job: RasterJob = {
    blob,
    inputType: type,
    candidates: [type],
    quality: options.quality ?? 0.75,
    attempt: 0,
    maxPixels: DEFAULT_MAX_PIXELS,
    ...(options.maxDimension !== undefined ? { maxDimension: options.maxDimension } : {}),
  };
  try {
    const { result } = await runRasterJob(
      job,
      { signal: options.signal ?? new AbortController().signal, onProgress: () => undefined },
      options.useWorker ?? true,
    );
    return result.blob.size < blob.size ? result.blob : null;
  } catch (error) {
    if (error instanceof PipelineError && error.reason === "aborted")
      throw toOptimizationError(error);
    return null;
  }
}
