import { describe, expect, it, vi } from "vitest";
import { optimizeFile } from "@uploadrescue/core";
import {
  bitrateForTarget,
  createMediaEngine,
  getMediaSupport,
  parseDuration,
  planMediaJob,
  type FFmpegLike,
} from "../src";

const enc = (s: string) => [...new TextEncoder().encode(s)];
const mp4Bytes = (size: number) => {
  const b = new Uint8Array(size);
  b.set([0, 0, 0, 0x18, ...enc("ftypisom"), 0, 0, 0, 0, ...enc("isomiso2")]);
  return b;
};
const mp4 = (size: number) => new File([mp4Bytes(size)], "clip.mp4", { type: "video/mp4" });

describe("planMediaJob", () => {
  it("targets a bitrate when duration and target size are known", () => {
    const plan = planMediaJob({
      mime: "video/mp4",
      durationSec: 60,
      targetSize: 10 * 1024 * 1024,
      quality: 0.8,
      preserveFormat: true,
      attempt: 0,
    });
    const total = bitrateForTarget(10 * 1024 * 1024, 60);
    expect(plan.args).toContain(`${total - 128}k`);
    expect(plan.outputType).toBe("video/mp4");
    expect(plan.args).toContain("+faststart");
  });

  it("uses CRF and smaller dimensions on later attempts", () => {
    const a0 = planMediaJob({
      mime: "video/quicktime",
      quality: 0.82,
      preserveFormat: true,
      attempt: 0,
    });
    const a1 = planMediaJob({
      mime: "video/quicktime",
      quality: 0.82,
      preserveFormat: true,
      attempt: 1,
    });
    expect(a0.outputName).toBe("output.mov");
    expect(a0.args.join(" ")).toContain("min(iw,1920)");
    expect(a1.args.join(" ")).toContain("min(iw,1280)");
    const crf = (p: typeof a0) => Number(p.args[p.args.indexOf("-crf") + 1]);
    expect(crf(a1)).toBeGreaterThan(crf(a0));
  });

  it("converts MOV to MP4 only when format changes are allowed", () => {
    expect(
      planMediaJob({ mime: "video/quicktime", quality: 0.8, preserveFormat: false, attempt: 0 })
        .outputType,
    ).toBe("video/mp4");
    expect(
      planMediaJob({
        mime: "video/quicktime",
        quality: 0.8,
        preserveFormat: false,
        attempt: 0,
        allowedOutputTypes: ["video/quicktime"],
      }).outputType,
    ).toBe("video/quicktime");
  });

  it("keeps WAV as WAV when preserving format, otherwise allows MP3", () => {
    const wav = planMediaJob({ mime: "audio/wav", quality: 0.8, preserveFormat: true, attempt: 2 });
    expect(wav.outputType).toBe("audio/wav");
    expect(wav.args).toEqual(expect.arrayContaining(["pcm_s16le", "-ac", "1"]));
    expect(
      planMediaJob({ mime: "audio/wav", quality: 0.8, preserveFormat: false, attempt: 0 })
        .outputType,
    ).toBe("audio/mpeg");
  });

  it("clamps MP3 bitrates", () => {
    const p = planMediaJob({
      mime: "audio/mpeg",
      durationSec: 600,
      targetSize: 100_000,
      quality: 0.8,
      preserveFormat: true,
      attempt: 0,
    });
    expect(p.args).toContain("32k");
  });

  it("parses FFmpeg durations", () => {
    expect(parseDuration("  Duration: 00:01:02.50, start: 0.000000, bitrate: 1205 kb/s")).toBe(
      62.5,
    );
    expect(parseDuration("no duration")).toBeUndefined();
  });
});

describe("getMediaSupport", () => {
  it("explains why media optimization is unavailable", () => {
    expect(getMediaSupport({}).reason).toMatch(/not configured/);
    expect(
      getMediaSupport({ loadFFmpeg: async () => fakeFFmpeg(1), maxInputSize: 10 }, 100).reason,
    ).toMatch(/too large/);
  });
});

function fakeFFmpeg(outputSize: number) {
  const files = new Map<string, Uint8Array>();
  const listeners: Record<string, Array<(e: never) => void>> = {};
  const instance: FFmpegLike & { calls: string[][]; terminated: boolean } = {
    calls: [],
    terminated: false,
    load: async () => true,
    on: (event: string, cb: (e: never) => void) => {
      (listeners[event] ??= []).push(cb);
    },
    off: (event: string, cb: (e: never) => void) => {
      listeners[event] = (listeners[event] ?? []).filter((x) => x !== cb);
    },
    writeFile: async (name, data) => files.set(name, data),
    readFile: async (name) => files.get(name) ?? new Uint8Array(),
    deleteFile: async (name) => files.delete(name),
    terminate: () => {
      instance.terminated = true;
    },
    exec: async (args) => {
      instance.calls.push(args);
      if (!args.includes("-y")) {
        listeners.log?.forEach((cb) =>
          cb({ message: "  Duration: 00:00:10.00, start: 0" } as never),
        );
        return 1;
      }
      listeners.progress?.forEach((cb) => cb({ progress: 0.5 } as never));
      files.set(args[args.length - 1]!, mp4Bytes(outputSize));
      return 0;
    },
  };
  return instance;
}

describe("media engine (with an injected FFmpeg)", () => {
  it("probes, encodes towards the target and returns a validated MP4", async () => {
    const ffmpeg = fakeFFmpeg(50_000);
    const engine = createMediaEngine({ loadFFmpeg: async () => ffmpeg });
    const result = await optimizeFile(mp4(200_000), { engines: [engine], targetSize: 60_000 });
    expect(result).toMatchObject({ changed: true, outputSize: 50_000, outputType: "video/mp4" });
    const encodeArgs = ffmpeg.calls[1]!;
    expect(encodeArgs).toContain("-b:v");
    expect(result.details?.durationSec).toBe(10);
  });

  it("terminates FFmpeg on cancellation", async () => {
    const ffmpeg = fakeFFmpeg(50_000);
    ffmpeg.exec = vi.fn(() => new Promise<number>(() => undefined));
    const engine = createMediaEngine({ loadFFmpeg: async () => ffmpeg });
    const controller = new AbortController();
    const run = optimizeFile(mp4(200_000), { engines: [engine], signal: controller.signal });
    await vi.waitFor(() => expect(ffmpeg.exec).toHaveBeenCalled());
    controller.abort();
    await expect(run).rejects.toMatchObject({ reason: "aborted" });
    expect(ffmpeg.terminated).toBe(true);
  });

  it("is skipped (not offered) when FFmpeg is not configured", async () => {
    await expect(optimizeFile(mp4(1000), { engines: [createMediaEngine()] })).rejects.toMatchObject(
      { reason: "unsupported" },
    );
  });
});
