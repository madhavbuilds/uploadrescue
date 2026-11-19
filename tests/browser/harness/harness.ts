// Exposes the real packages (from source) to Playwright tests.
import * as core from "@uploadrescue/core";
import * as image from "@uploadrescue/image-engine";
import * as pdf from "@uploadrescue/pdf-engine";
import * as document from "@uploadrescue/document-engine";
import * as archive from "@uploadrescue/archive-engine";
import * as media from "@uploadrescue/media-engine";
import * as pdfLib from "pdf-lib";
import * as fflate from "fflate";

declare global {
  interface Window {
    UR: typeof api;
  }
}

/** Draws a photo-like image (gradients + noise) and encodes it at maximum quality. */
async function makeImage(
  width: number,
  height: number,
  type: string,
  options: { alpha?: boolean; quality?: number } = {},
): Promise<File> {
  const canvas = Object.assign(globalThis.document.createElement("canvas"), { width, height });
  const ctx = canvas.getContext("2d")!;
  if (options.alpha) ctx.clearRect(0, 0, width, height);
  const g = ctx.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, "#0ea5e9");
  g.addColorStop(0.5, "#f59e0b");
  g.addColorStop(1, "#10b981");
  ctx.fillStyle = g;
  if (options.alpha) ctx.fillRect(width * 0.1, height * 0.1, width * 0.8, height * 0.8);
  else ctx.fillRect(0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height);
  let seed = 42;
  for (let i = 0; i < data.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const n = (seed % 48) - 24;
    data.data[i] = Math.max(0, Math.min(255, data.data[i]! + n));
    data.data[i + 1] = Math.max(0, Math.min(255, data.data[i + 1]! + n));
  }
  ctx.putImageData(data, 0, 0);
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), type, options.quality ?? 1),
  );
  return new File([blob], `generated.${type.split("/")[1]}`, { type });
}

/** Reads the alpha of the centre and corner pixels of an image file. */
async function alphaAt(
  file: Blob,
): Promise<{ corner: number; centre: number; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const canvas = Object.assign(globalThis.document.createElement("canvas"), {
    width: bitmap.width,
    height: bitmap.height,
  });
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const corner = ctx.getImageData(0, 0, 1, 1).data[3]!;
  const centre = ctx.getImageData(bitmap.width >> 1, bitmap.height >> 1, 1, 1).data[3]!;
  return { corner, centre, width: bitmap.width, height: bitmap.height };
}

/** 16-bit stereo PCM WAV with a sine tone. */
function makeWav(seconds: number, rate = 44100): File {
  const samples = seconds * rate;
  const buffer = new ArrayBuffer(44 + samples * 4);
  const v = new DataView(buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + samples * 4, true);
  w(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, samples * 4, true);
  for (let i = 0; i < samples; i += 1) {
    const s = Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000);
    v.setInt16(44 + i * 4, s, true);
    v.setInt16(46 + i * 4, s, true);
  }
  return new File([buffer], "tone.wav", { type: "audio/wav" });
}

const api = {
  core,
  image,
  pdf,
  document,
  archive,
  media,
  pdfLib,
  fflate,
  makeImage,
  alphaAt,
  makeWav,
};
window.UR = api;
globalThis.document.getElementById("ready")!.textContent = "ready";
