import { extensionForMime, matchesAccept } from "@uploadrescue/core";

export const MEDIA_TYPES = ["video/mp4", "video/quicktime", "audio/mpeg", "audio/wav"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export interface MediaPlanInput {
  mime: MediaType;
  /** Seconds, if known (from probing). Enables bitrate targeting. */
  durationSec?: number;
  targetSize?: number;
  quality: number;
  preserveFormat: boolean;
  attempt: number;
  maxDimension?: number;
  allowedOutputTypes?: readonly string[];
}

export interface MediaPlan {
  inputName: string;
  outputName: string;
  outputType: string;
  args: string[];
  description: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function allowed(type: string, list?: readonly string[]): boolean {
  return (
    !list || list.length === 0 || matchesAccept(type, `x.${extensionForMime(type) ?? ""}`, list)
  );
}

/** Bitrate (kbit/s) that fits `targetSize` bytes over `durationSec`, with 5% container overhead. */
export function bitrateForTarget(targetSize: number, durationSec: number): number {
  return Math.floor(((targetSize * 8) / durationSec / 1000) * 0.95);
}

/**
 * Builds FFmpeg arguments for one optimization attempt. Pure function so the
 * decisions can be unit-tested without WebAssembly.
 */
export function planMediaJob(input: MediaPlanInput): MediaPlan {
  const ext = extensionForMime(input.mime) ?? "bin";
  const inputName = `input.${ext}`;
  const a = input.attempt;
  const duration = input.durationSec && input.durationSec > 0 ? input.durationSec : undefined;

  if (input.mime === "video/mp4" || input.mime === "video/quicktime") {
    const outputType =
      input.preserveFormat || !allowed("video/mp4", input.allowedOutputTypes)
        ? input.mime
        : "video/mp4";
    const outExt = extensionForMime(outputType) ?? "mp4";
    const maxDim = input.maxDimension ?? [1920, 1280, 854][Math.min(a, 2)]!;
    const audioKbps = a === 0 ? 128 : a === 1 ? 96 : 64;
    const args = [
      "-i",
      inputName,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
    ];
    let description: string;
    if (input.targetSize && duration) {
      const total = bitrateForTarget(input.targetSize, duration);
      const video = Math.max(100, total - audioKbps);
      args.push("-b:v", `${video}k`, "-maxrate", `${video}k`, "-bufsize", `${video * 2}k`);
      description = `H.264 at ${video} kbit/s`;
    } else {
      const crf = clamp(Math.round(23 + (1 - input.quality) * 15) + a * 3, 18, 40);
      args.push("-crf", String(crf));
      description = `H.264 CRF ${crf}`;
    }
    args.push(
      "-vf",
      `scale=w='min(iw,${maxDim})':h='min(ih,${maxDim})':force_original_aspect_ratio=decrease:force_divisible_by=2`,
      "-c:a",
      "aac",
      "-b:a",
      `${audioKbps}k`,
      "-movflags",
      "+faststart",
      `output.${outExt}`,
    );
    return {
      inputName,
      outputName: `output.${outExt}`,
      outputType,
      args,
      description: `${description}, max ${maxDim}px`,
    };
  }

  if (
    input.mime === "audio/mpeg" ||
    (input.mime === "audio/wav" &&
      !input.preserveFormat &&
      allowed("audio/mpeg", input.allowedOutputTypes))
  ) {
    let kbps = [128, 96, 64][Math.min(a, 2)]!;
    if (input.quality < 0.6) kbps = Math.min(kbps, 96);
    if (input.targetSize && duration)
      kbps = clamp(bitrateForTarget(input.targetSize, duration), 32, kbps);
    return {
      inputName,
      outputName: "output.mp3",
      outputType: "audio/mpeg",
      args: ["-i", inputName, "-vn", "-c:a", "libmp3lame", "-b:a", `${kbps}k`, "output.mp3"],
      description: `MP3 at ${kbps} kbit/s`,
    };
  }

  // WAV kept as WAV: 16-bit PCM, then lower sample rate, then mono.
  const rate = a === 0 ? 44100 : 22050;
  const channels = a >= 2 ? 1 : 2;
  return {
    inputName,
    outputName: "output.wav",
    outputType: "audio/wav",
    args: [
      "-i",
      inputName,
      "-vn",
      "-c:a",
      "pcm_s16le",
      "-ar",
      String(rate),
      "-ac",
      String(channels),
      "output.wav",
    ],
    description: `16-bit PCM WAV, ${rate} Hz, ${channels === 1 ? "mono" : "stereo"}`,
  };
}

/** Parses `Duration: 00:01:02.50` from FFmpeg log output. */
export function parseDuration(log: string): number | undefined {
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(log);
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
