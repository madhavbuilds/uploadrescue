import { raceWithSignal, throwIfAborted } from "./abort";
import { reductionRatio } from "./bytes";
import { detectFileType, inspectFile, type FileInfo } from "./detect";
import { OptimizationError, isAbortError } from "./errors";
import {
  OOXML_TYPES,
  extensionForMime,
  matchesAccept,
  normalizeMime,
  replaceExtension,
} from "./mime";

export interface OptimizationOptions {
  /** Desired maximum output size in bytes. Engines try to reach it but may not. */
  targetSize?: number;
  /** Encoder quality in [0, 1] for lossy formats. */
  quality: number;
  /** Keep the original file format. When false, engines may convert (e.g. PNG → WebP). */
  preserveFormat: boolean;
  /** Output MIME types the destination accepts. Engines must not emit anything else. */
  allowedOutputTypes?: readonly string[];
  /** Maximum width/height for visual media, in pixels. */
  maxDimension?: number;
  /**
   * 0-based optimization attempt for this file. Engines should become more
   * aggressive on later attempts (lower quality floor, smaller dimensions).
   */
  attempt: number;
}

export interface OptimizationContext {
  signal: AbortSignal;
  info: FileInfo;
  /** Report progress in [0, 1], or null when progress is indeterminate. */
  onProgress: (ratio: number | null, stage?: string) => void;
}

/** What an engine returns. The orchestrator measures and validates it. */
export interface EngineOutput {
  blob: Blob;
  /** MIME type of `blob`. */
  type: string;
  /** Human-readable notes, e.g. "Resized to 1920×1080", "Metadata removed". */
  notes?: string[];
  details?: Record<string, unknown>;
}

export interface OptimizationEngine {
  /** Stable identifier, e.g. "image". */
  readonly id: string;
  /** MIME patterns (`image/*`, `application/pdf`) this engine may handle. */
  readonly supportedTypes: readonly string[];
  /** Fine-grained check (animated GIF, encrypted PDF, ...). */
  canProcess(file: File, info: FileInfo): boolean | Promise<boolean>;
  optimize(
    file: File,
    options: OptimizationOptions,
    context: OptimizationContext,
  ): Promise<EngineOutput>;
}

export interface OptimizationResult {
  /** The untouched input. */
  original: File;
  /** The output file, or `original` when no reduction was achieved. */
  file: File;
  engine: string;
  originalSize: number;
  outputSize: number;
  savedBytes: number;
  /** Fraction of bytes saved in [0, 1]. */
  reduction: number;
  durationMs: number;
  outputType: string;
  /** True when the engine produced a smaller, validated output. */
  changed: boolean;
  targetSize?: number;
  /** True when no target was set or `outputSize <= targetSize`. */
  withinTarget: boolean;
  notes: string[];
  details?: Record<string, unknown>;
}

export interface OptimizeFileOptions extends Partial<OptimizationOptions> {
  engines: readonly OptimizationEngine[];
  signal?: AbortSignal;
  info?: FileInfo;
  onProgress?: (ratio: number | null, stage?: string) => void;
}

function supports(engine: OptimizationEngine, info: FileInfo): boolean {
  return matchesAccept(info.detected.mime, info.name, engine.supportedTypes);
}

/** Returns the first engine that declares support for and accepts this file. */
export async function findEngine(
  engines: readonly OptimizationEngine[],
  file: File,
  info: FileInfo,
): Promise<OptimizationEngine | null> {
  for (const engine of engines) {
    if (!supports(engine, info)) continue;
    try {
      if (await engine.canProcess(file, info)) return engine;
    } catch {
      // A failing capability check means "cannot process".
    }
  }
  return null;
}

const now = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

/**
 * Runs the matching engine and validates its output:
 * - the original file is never modified;
 * - output must be non-empty and its content signature must match its claimed type;
 * - outputs that are not smaller than the input are discarded (`changed: false`).
 */
export async function optimizeFile(
  file: File,
  options: OptimizeFileOptions,
): Promise<OptimizationResult> {
  const signal = options.signal ?? new AbortController().signal;
  throwIfAborted(signal);
  const info = options.info ?? (await inspectFile(file));
  const engine = await findEngine(options.engines, file, info);
  if (!engine) {
    const supportedSomewhere = options.engines.some((e) => supports(e, info));
    throw new OptimizationError(
      supportedSomewhere ? "unsupported" : "no-engine",
      supportedSomewhere
        ? "This file cannot be optimized safely (for example animated, encrypted or signed files)."
        : `Optimization is not available for this file type (${info.detected.extension || info.detected.mime}).`,
    );
  }

  const engineOptions: OptimizationOptions = {
    quality: clampQuality(options.quality ?? 0.82),
    preserveFormat: options.preserveFormat ?? true,
    attempt: options.attempt ?? 0,
    ...(options.targetSize !== undefined ? { targetSize: options.targetSize } : {}),
    ...(options.allowedOutputTypes ? { allowedOutputTypes: options.allowedOutputTypes } : {}),
    ...(options.maxDimension !== undefined ? { maxDimension: options.maxDimension } : {}),
  };

  const started = now();
  let output: EngineOutput;
  try {
    throwIfAborted(signal);
    // Racing against the signal keeps cancellation responsive even if an
    // engine does not observe its signal.
    output = await raceWithSignal(
      engine.optimize(file, engineOptions, {
        signal,
        info,
        onProgress: options.onProgress ?? (() => undefined),
      }),
      signal,
    );
  } catch (error) {
    if (signal.aborted || isAbortError(error)) {
      throw new OptimizationError("aborted", "Optimization was cancelled.", {
        cause: error,
        engine: engine.id,
      });
    }
    if (error instanceof OptimizationError) throw error;
    throw new OptimizationError("failed", `The ${engine.id} engine could not process this file.`, {
      cause: error,
      engine: engine.id,
    });
  }
  throwIfAborted(signal);
  const durationMs = Math.round(now() - started);

  const outputType = normalizeMime(output.type);
  await validateOutput(output, outputType, engine.id);

  const changed = output.blob.size < file.size;
  const outFile = changed ? toOutputFile(file, output.blob, outputType) : file;
  const outputSize = outFile.size;
  return {
    original: file,
    file: outFile,
    engine: engine.id,
    originalSize: file.size,
    outputSize,
    savedBytes: file.size - outputSize,
    reduction: reductionRatio(file.size, outputSize),
    durationMs,
    outputType: changed ? outputType : normalizeMime(file.type || info.detected.mime),
    changed,
    ...(engineOptions.targetSize !== undefined ? { targetSize: engineOptions.targetSize } : {}),
    withinTarget: engineOptions.targetSize === undefined || outputSize <= engineOptions.targetSize,
    notes: changed
      ? (output.notes ?? [])
      : [...(output.notes ?? []), "No size reduction was possible."],
    ...(output.details ? { details: output.details } : {}),
  };
}

async function validateOutput(
  output: EngineOutput,
  outputType: string,
  engineId: string,
): Promise<void> {
  if (!(output.blob instanceof Blob) || output.blob.size === 0) {
    throw new OptimizationError("invalid-output", "The optimizer produced an empty file.", {
      engine: engineId,
    });
  }
  const detected = await detectFileType(output.blob);
  if (detected.source === "signature" && normalizeMime(detected.mime) !== outputType) {
    // ZIP-based formats are sniffed heuristically: accept OOXML outputs that sniff
    // as generic ZIP or as a sibling OOXML type (e.g. .docx vs macro-enabled .docm).
    const isOoxml = (m: string) => OOXML_TYPES.includes(m);
    const zipCompatible =
      (detected.mime === "application/zip" && isOoxml(outputType)) ||
      (isOoxml(detected.mime) && isOoxml(outputType));
    if (!zipCompatible) {
      throw new OptimizationError(
        "invalid-output",
        `The optimizer output (${detected.mime}) does not match the expected type (${outputType}).`,
        { engine: engineId },
      );
    }
  }
}

function toOutputFile(original: File, blob: Blob, type: string): File {
  const sameType = normalizeMime(original.type) === type;
  const ext = extensionForMime(type);
  const name = sameType || !ext ? original.name : replaceExtension(original.name, ext);
  return new File([blob], name, { type, lastModified: original.lastModified });
}

function clampQuality(q: number): number {
  if (!Number.isFinite(q)) return 0.82;
  return Math.min(1, Math.max(0.05, q));
}

export interface LazyEngineDefinition {
  id: string;
  supportedTypes: readonly string[];
  load: () => Promise<OptimizationEngine>;
}

export interface LazyEngine extends OptimizationEngine {
  /** Loads the underlying engine ahead of time. */
  preload(): Promise<OptimizationEngine>;
  readonly loaded: boolean;
}

/**
 * Wraps an engine so its implementation (and heavy dependencies such as
 * pdf-lib or FFmpeg) is only downloaded when a matching file needs processing.
 */
export function lazyEngine(definition: LazyEngineDefinition): LazyEngine {
  let promise: Promise<OptimizationEngine> | null = null;
  let instance: OptimizationEngine | null = null;
  const load = (): Promise<OptimizationEngine> => {
    if (!promise) {
      promise = definition.load().then(
        (engine) => {
          instance = engine;
          return engine;
        },
        (error: unknown) => {
          promise = null;
          throw new OptimizationError(
            "environment",
            `Failed to load the ${definition.id} engine.`,
            {
              cause: error,
              engine: definition.id,
            },
          );
        },
      );
    }
    return promise;
  };
  return {
    id: definition.id,
    supportedTypes: definition.supportedTypes,
    get loaded() {
      return instance !== null;
    },
    preload: load,
    // Loading happens here (not at registration) so the heavy module is only
    // fetched once a matching file actually needs optimization.
    async canProcess(file, info) {
      const engine = instance ?? (await load());
      return engine.canProcess(file, info);
    },
    async optimize(file, options, context) {
      const engine = await load();
      if (!(await engine.canProcess(file, context.info))) {
        throw new OptimizationError("unsupported", "This file cannot be optimized safely.", {
          engine: definition.id,
        });
      }
      return engine.optimize(file, options, context);
    },
  };
}
