/**
 * Header-level image inspection. Reads dimensions, animation and alpha hints
 * without decoding pixels, so resource limits can be enforced up front.
 */

export interface ImageHeader {
  format: "png" | "jpeg" | "gif" | "webp" | "unknown";
  width: number;
  height: number;
  /** True for animated GIF, APNG and animated WebP. */
  animated: boolean;
  /** True when the format/header declares an alpha channel or transparency. Undefined when unknown. */
  mayHaveAlpha: boolean | undefined;
  /** Number of frames counted (GIF only; 1 for still formats). */
  frames: number;
}

const u16be = (b: Uint8Array, o: number) => ((b[o]! << 8) | b[o + 1]!) >>> 0;
const u32be = (b: Uint8Array, o: number) =>
  ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u16le = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8)) >>> 0;
const u24le = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16)) >>> 0;
const tag = (b: Uint8Array, o: number) =>
  String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);

const UNKNOWN: ImageHeader = {
  format: "unknown",
  width: 0,
  height: 0,
  animated: false,
  mayHaveAlpha: undefined,
  frames: 1,
};

export function parsePng(b: Uint8Array): ImageHeader {
  if (b.length < 33 || tag(b, 12) !== "IHDR") return UNKNOWN;
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  const colorType = b[25]!;
  let mayHaveAlpha = colorType === 4 || colorType === 6;
  let animated = false;
  let offset = 8;
  while (offset + 8 <= b.length) {
    const length = u32be(b, offset);
    const type = tag(b, offset + 4);
    if (type === "acTL") animated = true;
    if (type === "tRNS") mayHaveAlpha = true;
    if (type === "IDAT" || type === "IEND") break;
    offset += 12 + length;
  }
  return { format: "png", width, height, animated, mayHaveAlpha, frames: animated ? 2 : 1 };
}

export function parseJpeg(b: Uint8Array): ImageHeader {
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) {
      o += 1;
      continue;
    }
    const marker = b[o + 1]!;
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7) ||
      marker === 0xff
    ) {
      o += marker === 0xff ? 1 : 2;
      continue;
    }
    const length = u16be(b, o + 2);
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return {
        format: "jpeg",
        height: u16be(b, o + 5),
        width: u16be(b, o + 7),
        animated: false,
        mayHaveAlpha: false,
        frames: 1,
      };
    }
    if (marker === 0xda) break; // start of scan without SOF: malformed
    o += 2 + length;
  }
  return { ...UNKNOWN, format: "jpeg", mayHaveAlpha: false };
}

/** Walks GIF blocks and counts image frames (stops at 2). */
export function parseGif(b: Uint8Array): ImageHeader {
  if (b.length < 13) return UNKNOWN;
  const width = u16le(b, 6);
  const height = u16le(b, 8);
  let o = 13;
  const flags = b[10]!;
  if (flags & 0x80) o += 3 * 2 ** ((flags & 0x07) + 1);
  let frames = 0;
  let transparent = false;
  const skipSubBlocks = () => {
    while (o < b.length) {
      const size = b[o]!;
      o += 1;
      if (size === 0) return;
      o += size;
    }
  };
  while (o < b.length && frames < 2) {
    const block = b[o]!;
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = b[o + 1]!;
      if (label === 0xf9 && (b[o + 3]! & 0x01) === 1) transparent = true;
      o += 2;
      skipSubBlocks();
    } else if (block === 0x2c) {
      frames += 1;
      const localFlags = b[o + 9]!;
      o += 10;
      if (localFlags & 0x80) o += 3 * 2 ** ((localFlags & 0x07) + 1);
      o += 1; // LZW minimum code size
      skipSubBlocks();
    } else {
      break; // corrupt
    }
  }
  // If we ran out of data before the trailer, we cannot prove the GIF is still.
  const truncated = o >= b.length && frames < 2;
  return {
    format: "gif",
    width,
    height,
    animated: frames > 1 || truncated,
    mayHaveAlpha: transparent,
    frames: Math.max(frames, 1),
  };
}

export function parseWebp(b: Uint8Array): ImageHeader {
  if (b.length < 30 || tag(b, 0) !== "RIFF" || tag(b, 8) !== "WEBP") return UNKNOWN;
  const chunk = tag(b, 12);
  if (chunk === "VP8X") {
    const flags = b[20]!;
    return {
      format: "webp",
      width: u24le(b, 24) + 1,
      height: u24le(b, 27) + 1,
      animated: (flags & 0x02) !== 0,
      mayHaveAlpha: (flags & 0x10) !== 0,
      frames: (flags & 0x02) !== 0 ? 2 : 1,
    };
  }
  if (chunk === "VP8L") {
    const b0 = b[21]!;
    const b1 = b[22]!;
    const b2 = b[23]!;
    const b3 = b[24]!;
    return {
      format: "webp",
      width: 1 + (b0 | ((b1 & 0x3f) << 8)),
      height: 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)),
      animated: false,
      mayHaveAlpha: ((b3 >> 4) & 0x01) === 1,
      frames: 1,
    };
  }
  if (chunk === "VP8 ") {
    return {
      format: "webp",
      width: u16le(b, 26) & 0x3fff,
      height: u16le(b, 28) & 0x3fff,
      animated: false,
      mayHaveAlpha: false,
      frames: 1,
    };
  }
  return { ...UNKNOWN, format: "webp" };
}

export function parseImageHeader(bytes: Uint8Array, mime: string): ImageHeader {
  switch (mime) {
    case "image/png":
      return parsePng(bytes);
    case "image/jpeg":
      return parseJpeg(bytes);
    case "image/gif":
      return parseGif(bytes);
    case "image/webp":
      return parseWebp(bytes);
    default:
      return UNKNOWN;
  }
}

/** Bytes needed to parse the header. GIF needs the whole file to count frames. */
export function headerBytesFor(mime: string, size: number): number {
  if (mime === "image/gif") return Math.min(size, 32 * 1024 * 1024);
  if (mime === "image/jpeg") return Math.min(size, 256 * 1024);
  return Math.min(size, 64 * 1024);
}
