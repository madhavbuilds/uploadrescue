import { describe, expect, it } from "vitest";
import {
  detectFileType,
  formatBytes,
  formatPercent,
  inspectFile,
  matchesAccept,
  reductionRatio,
  sniffMime,
  validateFile,
} from "../src";
import { JPEG_SIG, PDF_SIG, PNG_SIG, makeFile } from "./helpers";

const enc = (s: string) => [...new TextEncoder().encode(s)];

describe("formatBytes", () => {
  it("uses binary units and trims trailing zeros", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2 MB");
    expect(formatBytes(8.4 * 1024 * 1024)).toBe("8.4 MB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(-1)).toBe("–");
  });

  it("computes reduction ratios", () => {
    expect(reductionRatio(100, 20)).toBeCloseTo(0.8);
    expect(reductionRatio(100, 120)).toBe(0);
    expect(formatPercent(reductionRatio(8.4, 1.7))).toBe("79.8%");
  });
});

describe("sniffMime", () => {
  const cases: Array<[string, number[], string]> = [
    ["jpeg", JPEG_SIG, "image/jpeg"],
    ["png", PNG_SIG, "image/png"],
    ["gif", enc("GIF89a"), "image/gif"],
    ["webp", [...enc("RIFF"), 0, 0, 0, 0, ...enc("WEBPVP8 ")], "image/webp"],
    ["wav", [...enc("RIFF"), 0, 0, 0, 0, ...enc("WAVEfmt ")], "audio/wav"],
    ["pdf", PDF_SIG, "application/pdf"],
    ["mp3 id3", enc("ID3\u0003"), "audio/mpeg"],
    ["mp4", [0, 0, 0, 0x18, ...enc("ftypisom"), 0, 0, 0, 0, ...enc("isomiso2")], "video/mp4"],
    ["mov", [0, 0, 0, 0x14, ...enc("ftypqt  "), 0, 0, 0, 0, ...enc("qt  ")], "video/quicktime"],
    ["avif", [0, 0, 0, 0x1c, ...enc("ftypavif"), 0, 0, 0, 0, ...enc("avifmif1")], "image/avif"],
    [
      "svg",
      enc('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      "image/svg+xml",
    ],
    ["gzip", [0x1f, 0x8b, 8], "application/gzip"],
  ];
  it.each(cases)("detects %s", (_label, bytes, mime) => {
    expect(sniffMime(new Uint8Array(bytes))).toBe(mime);
  });

  it("distinguishes OOXML from plain zip", () => {
    const docx = new Uint8Array([
      0x50,
      0x4b,
      3,
      4,
      ...enc("[Content_Types].xml...word/document.xml"),
    ]);
    const xlsx = new Uint8Array([
      0x50,
      0x4b,
      3,
      4,
      ...enc("[Content_Types].xml...xl/workbook.xml"),
    ]);
    const zip = new Uint8Array([0x50, 0x4b, 3, 4, ...enc("readme.txt")]);
    expect(sniffMime(docx)).toContain("wordprocessingml");
    expect(sniffMime(xlsx)).toContain("spreadsheetml");
    expect(sniffMime(zip)).toBe("application/zip");
  });

  it("returns null for unknown content", () => {
    expect(sniffMime(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
    expect(sniffMime(new Uint8Array(enc("hello world")))).toBeNull();
  });
});

describe("detectFileType / inspectFile", () => {
  it("prefers content signature over extension", async () => {
    const file = makeFile(100, "holiday.jpg", "image/jpeg", PDF_SIG);
    const detected = await detectFileType(file);
    expect(detected).toMatchObject({
      mime: "application/pdf",
      source: "signature",
      category: "pdf",
    });
    const info = await inspectFile(file);
    expect(info.typeMismatch).toBe(true);
  });

  it("falls back to declared type, then extension", async () => {
    const declared = makeFile(10, "notes", "text/plain", enc("hello"));
    expect((await detectFileType(declared)).source).toBe("declared");
    const ext = makeFile(10, "notes.csv", "", enc("a,b,c"));
    expect(await detectFileType(ext)).toMatchObject({ mime: "text/csv", source: "extension" });
    const none = makeFile(10, "blob", "", [1, 2, 3]);
    expect(await detectFileType(none)).toMatchObject({ category: "unknown", source: "none" });
  });

  it("does not flag compatible containers as mismatches", async () => {
    const mov = makeFile(64, "clip.mov", "video/quicktime", [0, 0, 0, 0x14, ...enc("ftypisom")]);
    expect((await inspectFile(mov)).typeMismatch).toBe(false);
  });
});

describe("matchesAccept", () => {
  it("supports wildcards, MIME types and extensions", () => {
    expect(matchesAccept("image/png", "a.png", ["image/*"])).toBe(true);
    expect(matchesAccept("image/jpeg", "a.jpeg", [".jpg"])).toBe(true);
    expect(matchesAccept("application/pdf", "a.pdf", ["application/pdf"])).toBe(true);
    expect(matchesAccept("application/pdf", "a.pdf", ["image/*", ".png"])).toBe(false);
    expect(matchesAccept("image/jpeg", "a.jpg", ["image/jpg"])).toBe(true);
  });
});

describe("validateFile", () => {
  it("reports too-large as optimizable", async () => {
    const result = await validateFile(makeFile(3000, "a.png", "image/png"), { maxSize: 2048 });
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatchObject({
      code: "file-too-large",
      optimizable: true,
      limit: 2048,
      actual: 3000,
    });
    expect(result.issues[0]!.message).toBe(
      "Your file is too large. Maximum allowed: 2 KB. Your file: 2.9 KB.",
    );
  });

  it("rejects a disguised file using its content type", async () => {
    const disguised = makeFile(100, "photo.png", "image/png", PDF_SIG);
    const result = await validateFile(disguised, { acceptedTypes: ["image/*"] });
    expect(result.issues.map((i) => i.code)).toEqual(["type-not-accepted"]);
  });

  it("rejects empty files and optional mismatches", async () => {
    expect((await validateFile(new File([], "e.txt"), {})).issues[0]!.code).toBe("file-empty");
    const mismatch = makeFile(100, "a.jpg", "image/jpeg", PNG_SIG);
    const result = await validateFile(mismatch, { rejectTypeMismatch: true });
    expect(result.issues.map((i) => i.code)).toContain("type-mismatch");
  });
});
