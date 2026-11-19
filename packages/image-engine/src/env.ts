import { PipelineError, hasOffscreenCanvas, offscreenEnv, type CanvasEnv } from "./pipeline";

/** Main-thread canvas environment: OffscreenCanvas when available, otherwise <canvas>. */
export function mainThreadEnv(): CanvasEnv {
  if (hasOffscreenCanvas()) return offscreenEnv();
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") {
    throw new PipelineError(
      "environment",
      "Image optimization requires a browser with canvas support.",
    );
  }
  return {
    async decode(blob) {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return { bitmap, width: bitmap.width, height: bitmap.height };
    },
    createCanvas(w, h) {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      return canvas;
    },
    context(canvas) {
      const ctx = (canvas as HTMLCanvasElement).getContext("2d");
      if (!ctx) throw new PipelineError("environment", "2D canvas is not available.");
      return ctx;
    },
    encode: (canvas, type, quality) =>
      new Promise<Blob>((resolve, reject) => {
        (canvas as HTMLCanvasElement).toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new PipelineError("failed", "Encoding failed.")),
          type,
          quality,
        );
      }),
  };
}

const encoderSupport = new Map<string, Promise<boolean>>();

/** Whether the browser's canvas can encode `type` (canvas silently falls back to PNG otherwise). */
export function canEncode(type: string): Promise<boolean> {
  let cached = encoderSupport.get(type);
  if (!cached) {
    cached = (async () => {
      try {
        const env = mainThreadEnv();
        const canvas = env.createCanvas(2, 2);
        // OffscreenCanvas.convertToBlob throws unless a rendering context exists.
        const ctx = env.context(canvas);
        ctx.fillRect(0, 0, 1, 1);
        const blob = await env.encode(canvas, type, 0.8);
        return blob.type === type;
      } catch {
        return false;
      }
    })();
    encoderSupport.set(type, cached);
  }
  return cached;
}
