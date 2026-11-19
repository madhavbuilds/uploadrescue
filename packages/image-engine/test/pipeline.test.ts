import { describe, expect, it } from "vitest";
import { outputCandidates } from "../src/engine";
import { parseGif, parseJpeg, parsePng, parseWebp } from "../src/inspect";
import {
  qualityFloor,
  runRasterPipeline,
  scaleFloor,
  type CanvasEnv,
  type CanvasLike,
} from "../src/pipeline";

// ------------------------------------------------------------ header parsing

const enc = (s: string) => [...new TextEncoder().encode(s)];
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
function pngChunk(type: string, data: number[] = []) {
  return [...u32(data.length), ...enc(type), ...data, 0, 0, 0, 0];
}
function png(colorType: number, extra: number[][] = []) {
  const ihdr = [...u32(640), ...u32(480), 8, colorType, 0, 0, 0];
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk("IHDR", ihdr),
    ...extra.flat(),
    ...pngChunk("IDAT", [1, 2, 3]),
    ...pngChunk("IEND"),
  ]);
}

function gif(frames: number, transparent = false) {
  const header = [...enc("GIF89a"), 10, 0, 20, 0, 0x80, 0, 0, ...new Array(6).fill(0)]; // 2-colour GCT
  const body: number[] = [];
  for (let i = 0; i < frames; i += 1) {
    body.push(0x21, 0xf9, 4, transparent ? 1 : 0, 0, 0, 0, 0); // graphic control ext
    body.push(0x2c, 0, 0, 0, 0, 10, 0, 20, 0, 0); // image descriptor
    body.push(2, 2, 0x4c, 0x01, 0); // LZW min size + one sub-block + terminator
  }
  return new Uint8Array([...header, ...body, 0x3b]);
}

describe("image header parsing", () => {
  it("reads PNG dimensions, alpha and APNG animation", () => {
    expect(parsePng(png(2))).toMatchObject({
      width: 640,
      height: 480,
      mayHaveAlpha: false,
      animated: false,
    });
    expect(parsePng(png(6)).mayHaveAlpha).toBe(true);
    expect(parsePng(png(2, [pngChunk("tRNS", [0, 0])])).mayHaveAlpha).toBe(true);
    expect(parsePng(png(6, [pngChunk("acTL", [0, 0, 0, 2, 0, 0, 0, 0])])).animated).toBe(true);
  });

  it("counts GIF frames to detect animation", () => {
    expect(parseGif(gif(1))).toMatchObject({ width: 10, height: 20, animated: false, frames: 1 });
    expect(parseGif(gif(3))).toMatchObject({ animated: true });
    expect(parseGif(gif(1, true)).mayHaveAlpha).toBe(true);
    // Truncated GIFs cannot be proven still, so they are treated as animated.
    expect(parseGif(gif(1).slice(0, 30)).animated).toBe(true);
  });

  it("reads JPEG SOF dimensions", () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x01, 0xe0, 0x02, 0x80, 3, 0, 0, 0,
    ]);
    expect(parseJpeg(jpeg)).toMatchObject({ width: 640, height: 480, animated: false });
  });

  it("reads WebP VP8X flags", () => {
    const b = new Uint8Array(30);
    b.set(enc("RIFF"), 0);
    b.set(enc("WEBP"), 8);
    b.set(enc("VP8X"), 12);
    b[20] = 0x12; // animation + alpha
    b[24] = 99; // width-1 = 99
    b[27] = 49; // height-1 = 49
    expect(parseWebp(b)).toMatchObject({
      width: 100,
      height: 50,
      animated: true,
      mayHaveAlpha: true,
    });
  });
});

// ------------------------------------------------------------ candidates

describe("outputCandidates", () => {
  it("keeps the format when preserving it", () => {
    expect(outputCandidates("image/png", true)).toEqual(["image/png"]);
  });
  it("prefers better-compressing formats when conversion is allowed", () => {
    expect(outputCandidates("image/png", false)).toEqual(["image/webp", "image/jpeg", "image/png"]);
    expect(outputCandidates("image/gif", false)).toEqual(["image/webp", "image/png"]);
  });
  it("only emits formats the destination accepts", () => {
    expect(outputCandidates("image/png", false, ["image/png", "image/jpeg"])).toEqual([
      "image/jpeg",
      "image/png",
    ]);
    expect(outputCandidates("image/png", false, [".png"])).toEqual(["image/png"]);
  });
});

// ------------------------------------------------------------ pipeline

interface FakeCanvas extends CanvasLike {
  alpha: boolean;
}

/** Deterministic encoder: size ∝ pixels × quality-factor; PNG is 3× JPEG. */
function fakeEnv(
  options: { alpha?: boolean; source?: [number, number]; unsupported?: string[] } = {},
): CanvasEnv & { encodes: Array<{ type: string; w: number; q?: number }> } {
  const [sw, sh] = options.source ?? [4000, 3000];
  const encodes: Array<{ type: string; w: number; q?: number }> = [];
  return {
    encodes,
    async decode() {
      return { bitmap: {} as CanvasImageSource, width: sw, height: sh };
    },
    createCanvas: (w, h) => ({ width: w, height: h, alpha: options.alpha ?? false }) as FakeCanvas,
    context: (canvas) =>
      ({
        clearRect() {},
        fillRect() {},
        drawImage() {},
        set fillStyle(_v: string) {},
        set imageSmoothingEnabled(_v: boolean) {},
        set imageSmoothingQuality(_v: string) {},
        getImageData: () => {
          const data = new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(255);
          if ((canvas as FakeCanvas).alpha) data[3] = 0;
          return { data };
        },
      }) as unknown as CanvasRenderingContext2D,
    async encode(canvas, type, quality) {
      encodes.push({ type, w: canvas.width, ...(quality !== undefined ? { q: quality } : {}) });
      const factor = type === "image/png" ? 1.5 : 0.1 + (quality ?? 1) * 0.4;
      const size = Math.round(canvas.width * canvas.height * factor * 0.1);
      const outType = options.unsupported?.includes(type) ? "image/png" : type;
      return new Blob([new Uint8Array(size)], { type: outType });
    },
  };
}

const job = (over: Partial<Parameters<typeof runRasterPipeline>[0]> = {}) => ({
  blob: new Blob([new Uint8Array(10)]),
  inputType: "image/jpeg",
  candidates: ["image/jpeg"],
  quality: 0.82,
  attempt: 0,
  maxPixels: 40_000_000,
  ...over,
});
const signal = { aborted: false };
const noop = () => undefined;

describe("runRasterPipeline", () => {
  it("encodes once when there is no target size", async () => {
    const env = fakeEnv();
    const r = await runRasterPipeline(job(), env, signal, noop);
    expect(env.encodes).toHaveLength(1);
    expect(r).toMatchObject({ width: 4000, height: 3000, quality: 0.82 });
  });

  it("finds the highest quality that fits the target without resizing", async () => {
    const env = fakeEnv();
    // q=0.82 → 0.428 × 1.2M px ≈ 513 KB; q=0.5 → 360 KB. Target 450 KB is in between.
    const r = await runRasterPipeline(job({ targetSize: 450_000 }), env, signal, noop);
    expect(r.blob.size).toBeLessThanOrEqual(450_000);
    expect(r.width).toBe(4000);
    expect(r.quality!).toBeGreaterThan(0.5);
    expect(r.quality!).toBeLessThan(0.82);
  });

  it("downscales when quality alone cannot reach the target", async () => {
    const env = fakeEnv();
    const r = await runRasterPipeline(job({ targetSize: 150_000 }), env, signal, noop);
    expect(r.blob.size).toBeLessThanOrEqual(150_000);
    expect(r.width).toBeLessThan(4000);
    expect(r.width / r.height).toBeCloseTo(4 / 3, 2);
    expect(r.notes.join(" ")).toContain("Resized from 4000×3000");
  });

  it("respects the minimum scale and returns the smallest result when the target is unreachable", async () => {
    const env = fakeEnv();
    const r = await runRasterPipeline(job({ targetSize: 1_000 }), env, signal, noop);
    expect(r.width).toBe(Math.round(4000 * scaleFloor(0)));
    expect(r.blob.size).toBeGreaterThan(1_000);
  });

  it("allows smaller sizes on later attempts", () => {
    expect(qualityFloor(1, 0.82)).toBeLessThan(qualityFloor(0, 0.82));
    expect(scaleFloor(1)).toBeLessThan(scaleFloor(0));
  });

  it("never converts transparent images to JPEG", async () => {
    const env = fakeEnv({ alpha: true });
    const r = await runRasterPipeline(
      job({ inputType: "image/png", candidates: ["image/jpeg", "image/png"] }),
      env,
      signal,
      noop,
    );
    expect(r.type).toBe("image/png");
    expect(r.hasAlpha).toBe(true);
    expect(env.encodes.every((e) => e.type !== "image/jpeg")).toBe(true);
    await expect(
      runRasterPipeline(
        job({ inputType: "image/png", candidates: ["image/jpeg"] }),
        fakeEnv({ alpha: true }),
        signal,
        noop,
      ),
    ).rejects.toMatchObject({ reason: "unsupported" });
  });

  it("applies maxDimension", async () => {
    const r = await runRasterPipeline(job({ maxDimension: 1000 }), fakeEnv(), signal, noop);
    expect([r.width, r.height]).toEqual([1000, 750]);
  });

  it("refuses images far beyond the pixel budget", async () => {
    await expect(
      runRasterPipeline(
        job({ maxPixels: 1_000_000 }),
        fakeEnv({ source: [10000, 10000] }),
        signal,
        noop,
      ),
    ).rejects.toMatchObject({ reason: "resource-limit" });
  });

  it("reports encoders that silently fall back to PNG", async () => {
    await expect(
      runRasterPipeline(
        job({ candidates: ["image/webp"] }),
        fakeEnv({ unsupported: ["image/webp"] }),
        signal,
        noop,
      ),
    ).rejects.toMatchObject({ reason: "environment" });
  });

  it("stops when aborted", async () => {
    await expect(
      runRasterPipeline(job(), fakeEnv(), { aborted: true }, noop),
    ).rejects.toMatchObject({ reason: "aborted" });
  });
});
