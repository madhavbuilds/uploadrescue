/**
 * Raster optimization pipeline. Self-contained (no imports from other
 * packages) because it is bundled into the Web Worker as well as used on the
 * main thread.
 */

export interface RasterJob {
  blob: Blob;
  inputType: string;
  /** Output types in priority order. */
  candidates: string[];
  quality: number;
  targetSize?: number;
  maxDimension?: number;
  attempt: number;
  /** Refuse to decode more than this many pixels. */
  maxPixels: number;
}

export interface RasterResult {
  blob: Blob;
  type: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  quality: number | null;
  hasAlpha: boolean;
  encodes: number;
  notes: string[];
}

export interface CanvasLike {
  width: number;
  height: number;
}

export interface CanvasEnv {
  decode(
    blob: Blob,
  ): Promise<{ bitmap: CanvasImageSource & { close?: () => void }; width: number; height: number }>;
  createCanvas(width: number, height: number): CanvasLike;
  context(canvas: CanvasLike): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  encode(canvas: CanvasLike, type: string, quality: number | undefined): Promise<Blob>;
}

export class PipelineError extends Error {
  readonly reason: "unsupported" | "resource-limit" | "aborted" | "environment" | "failed";
  constructor(reason: PipelineError["reason"], message: string) {
    super(message);
    this.name = "PipelineError";
    this.reason = reason;
  }
}

const LOSSY = new Set(["image/jpeg", "image/webp", "image/avif"]);
const ALPHA_CAPABLE_INPUT = new Set(["image/png", "image/webp", "image/avif", "image/gif"]);

export function isLossy(type: string): boolean {
  return LOSSY.has(type);
}

/** Minimum quality allowed for an attempt: 0.5, 0.35, 0.25 … */
export function qualityFloor(attempt: number, start: number): number {
  const floor = attempt <= 0 ? 0.5 : attempt === 1 ? 0.35 : 0.25;
  return Math.min(floor, start);
}

/** Smallest allowed scale (linear) for an attempt: 50% then 25%. */
export function scaleFloor(attempt: number): number {
  return attempt <= 0 ? 0.5 : 0.25;
}

export function initialScale(
  width: number,
  height: number,
  maxDimension: number | undefined,
  maxPixels: number,
): number {
  let scale = 1;
  if (maxDimension && maxDimension > 0)
    scale = Math.min(scale, maxDimension / Math.max(width, height));
  if (width * height * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (width * height));
  return Math.min(1, scale);
}

/** Scans alpha values (every pixel when ≤ 4 MP, otherwise a downscaled copy). */
function detectAlpha(
  env: CanvasEnv,
  bitmap: CanvasImageSource,
  width: number,
  height: number,
): boolean {
  const scale = Math.min(1, Math.sqrt(4_000_000 / (width * height)));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = env.createCanvas(w, h);
  const ctx = env.context(canvas);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! < 255) return true;
  }
  return false;
}

export async function runRasterPipeline(
  job: RasterJob,
  env: CanvasEnv,
  signal: { readonly aborted: boolean },
  onProgress: (ratio: number | null, stage?: string) => void,
): Promise<RasterResult> {
  const check = () => {
    if (signal.aborted) throw new PipelineError("aborted", "Optimization was cancelled.");
  };

  onProgress(0.02, "Decoding image");
  let decoded;
  try {
    decoded = await env.decode(job.blob);
  } catch (error) {
    throw new PipelineError(
      "failed",
      `The image could not be decoded: ${(error as Error)?.message ?? error}`,
    );
  }
  const { bitmap, width: sourceWidth, height: sourceHeight } = decoded;
  try {
    check();
    if (sourceWidth * sourceHeight > job.maxPixels * 4) {
      throw new PipelineError(
        "resource-limit",
        `The image is too large to process safely (${sourceWidth}×${sourceHeight}).`,
      );
    }
    const hasAlpha =
      ALPHA_CAPABLE_INPUT.has(job.inputType) && detectAlpha(env, bitmap, sourceWidth, sourceHeight);
    const candidates = job.candidates.filter((t) => !(hasAlpha && t === "image/jpeg"));
    if (candidates.length === 0) {
      throw new PipelineError(
        "unsupported",
        "The image has transparency, and the only allowed output format (JPEG) would remove it.",
      );
    }

    const startScale = initialScale(sourceWidth, sourceHeight, job.maxDimension, job.maxPixels);
    const minScale = Math.min(startScale, scaleFloor(job.attempt));
    const target = job.targetSize;
    const maxEncodes = target ? 24 : candidates.length;
    let encodes = 0;

    const render = (scale: number) => {
      const w = Math.max(1, Math.round(sourceWidth * scale));
      const h = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = env.createCanvas(w, h);
      const ctx = env.context(canvas);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      return { canvas, ctx, w, h };
    };

    const encodeAt = async (type: string, scale: number, quality: number | null) => {
      check();
      const { canvas, ctx, w, h } = render(scale);
      if (type === "image/jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(bitmap, 0, 0, w, h);
      const blob = await env.encode(canvas, type, quality ?? undefined);
      encodes += 1;
      onProgress(Math.min(0.95, 0.05 + (encodes / maxEncodes) * 0.9), "Compressing");
      if (blob.type !== type) {
        throw new PipelineError("environment", `This browser cannot encode ${type}.`);
      }
      return { blob, type, width: w, height: h, quality };
    };

    type Attempt = Awaited<ReturnType<typeof encodeAt>>;
    let best: Attempt | null = null;
    const consider = (a: Attempt) => {
      if (!best || a.blob.size < best.blob.size) best = a;
    };

    for (const type of candidates) {
      let scale = startScale;
      const lossy = isLossy(type);
      const qMax = lossy ? job.quality : null;
      const qMin = lossy ? qualityFloor(job.attempt, job.quality) : null;

      for (let step = 0; step < 6; step += 1) {
        const high = await encodeAt(type, scale, qMax);
        consider(high);
        if (!target || high.blob.size <= target) return finish(high);
        if (!lossy) {
          const next = Math.max(
            minScale,
            scale * Math.max(0.5, Math.sqrt(target / high.blob.size) * 0.95),
          );
          if (next >= scale - 1e-3) break;
          scale = next;
          continue;
        }
        const low = await encodeAt(type, scale, qMin);
        consider(low);
        if (low.blob.size <= target) {
          // Binary search for the highest quality that fits.
          let lo = qMin!;
          let hi = qMax!;
          let fit: Attempt = low;
          for (let i = 0; i < 5 && hi - lo > 0.02; i += 1) {
            const mid = (lo + hi) / 2;
            const a = await encodeAt(type, scale, mid);
            if (a.blob.size <= target) {
              fit = a;
              lo = mid;
            } else {
              hi = mid;
            }
          }
          return finish(fit);
        }
        const next = Math.max(
          minScale,
          scale * Math.max(0.5, Math.sqrt(target / low.blob.size) * 0.95),
        );
        if (next >= scale - 1e-3) break;
        scale = next;
      }
    }
    return finish(best!);

    function finish(a: Attempt): RasterResult {
      const notes: string[] = [];
      if (a.width !== sourceWidth || a.height !== sourceHeight) {
        notes.push(`Resized from ${sourceWidth}×${sourceHeight} to ${a.width}×${a.height}.`);
      }
      if (a.type !== job.inputType) notes.push(`Converted from ${job.inputType} to ${a.type}.`);
      if (a.quality !== null) notes.push(`Encoded at quality ${Math.round(a.quality * 100)}.`);
      notes.push("Image metadata (EXIF, GPS) was removed; orientation was applied to the pixels.");
      if (hasAlpha) notes.push("Transparency was preserved.");
      onProgress(1, "Done");
      return {
        blob: a.blob,
        type: a.type,
        width: a.width,
        height: a.height,
        sourceWidth,
        sourceHeight,
        quality: a.quality,
        hasAlpha,
        encodes,
        notes,
      };
    }
  } finally {
    decoded.bitmap.close?.();
  }
}

/** Canvas environment using OffscreenCanvas (workers and modern browsers). */
export function offscreenEnv(): CanvasEnv {
  return {
    async decode(blob) {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return { bitmap, width: bitmap.width, height: bitmap.height };
    },
    createCanvas: (w, h) => new OffscreenCanvas(w, h),
    context(canvas) {
      const ctx = (canvas as OffscreenCanvas).getContext("2d", { willReadFrequently: false });
      if (!ctx) throw new PipelineError("environment", "2D canvas is not available.");
      return ctx;
    },
    encode: (canvas, type, quality) =>
      (canvas as OffscreenCanvas).convertToBlob(
        quality === undefined ? { type } : { type, quality },
      ),
  };
}

export function hasOffscreenCanvas(): boolean {
  return (
    typeof OffscreenCanvas !== "undefined" &&
    typeof OffscreenCanvas.prototype.convertToBlob === "function" &&
    typeof createImageBitmap === "function"
  );
}
