import { deflateSync, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { inspectFile, optimizeFile } from "@uploadrescue/core";
import {
  ArchiveError,
  DEFAULT_ZIP_LIMITS,
  assertSafeEntryName,
  crc32,
  createArchiveEngine,
  extractEntry,
  inspectZip,
  readZipDirectory,
  repackZip,
  writeZip,
  type ZipWriteEntry,
} from "../src";

const enc = new TextEncoder();
function entry(name: string, data: Uint8Array, opts: Partial<ZipWriteEntry> = {}): ZipWriteEntry {
  return {
    nameBytes: enc.encode(name),
    method: 0,
    data,
    crc32: crc32(data),
    uncompressedSize: data.length,
    modTime: 0,
    modDate: 0x21,
    utf8: true,
    versionMadeBy: 20,
    internalAttrs: 0,
    externalAttrs: 0,
    ...opts,
  };
}

function sampleZip(level: 0 | 1 = 0) {
  const text = strToU8("The quick brown fox jumps over the lazy dog. ".repeat(2000));
  return zipSync(
    {
      "readme.txt": text,
      "docs/": new Uint8Array(0),
      "docs/a.json": strToU8(JSON.stringify({ a: [1, 2, 3] })),
    },
    { level },
  );
}

describe("crc32", () => {
  it("matches the reference value", () => {
    expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("assertSafeEntryName", () => {
  it.each(["../evil.sh", "a/../../b", "/etc/passwd", "C:/Windows/x", "..\\x", "a\0b", ""])(
    "rejects %j",
    (name) => {
      expect(() => assertSafeEntryName(name)).toThrow(ArchiveError);
    },
  );
  it.each(["a.txt", "dir/sub/file.xml", "..hidden", "a..b/c"])("accepts %j", (name) => {
    expect(() => assertSafeEntryName(name)).not.toThrow();
  });
});

describe("readZipDirectory / extractEntry", () => {
  it("reads archives produced by another implementation", () => {
    const bytes = sampleZip(1);
    const entries = readZipDirectory(bytes);
    expect(entries.map((e) => e.name)).toEqual(["readme.txt", "docs/", "docs/a.json"]);
    const text = new TextDecoder().decode(extractEntry(bytes, entries[0]!));
    expect(text.startsWith("The quick brown fox")).toBe(true);
  });

  it("rejects non-zip and truncated input", () => {
    expect(() => readZipDirectory(enc.encode("not a zip file at all, definitely"))).toThrow(
      /end-of-central-directory/,
    );
    const bytes = sampleZip();
    expect(() => readZipDirectory(bytes.slice(0, bytes.length - 30))).toThrow(ArchiveError);
  });

  it("rejects too many entries before decompressing", () => {
    const files = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [`f${i}.txt`, strToU8("x")]),
    );
    expect(() =>
      readZipDirectory(zipSync(files), { ...DEFAULT_ZIP_LIMITS, maxEntries: 10 }),
    ).toThrow(/50 entries/);
  });

  it("rejects path traversal entries", () => {
    const bytes = writeZip([
      entry("ok.txt", enc.encode("ok")),
      entry("../../evil.sh", enc.encode("rm -rf /")),
    ]);
    expect(() => readZipDirectory(bytes)).toThrow(expect.objectContaining({ code: "unsafe-path" }));
  });

  it("rejects duplicate entries", () => {
    const bytes = writeZip([entry("a.txt", enc.encode("1")), entry("a.txt", enc.encode("2"))]);
    expect(() => readZipDirectory(bytes)).toThrow(
      expect.objectContaining({ code: "duplicate-entry" }),
    );
  });

  it("rejects compression bombs by declared ratio", () => {
    const zeros = new Uint8Array(20 * 1024 * 1024);
    const deflated = deflateSync(zeros, { level: 9 });
    const bytes = writeZip([
      entry("bomb.bin", deflated, {
        method: 8,
        crc32: crc32(zeros),
        uncompressedSize: zeros.length,
      }),
    ]);
    expect(() => readZipDirectory(bytes)).toThrow(
      expect.objectContaining({ code: "ratio-exceeded" }),
    );
  });

  it("stops inflating entries that lie about their size (bounded memory)", () => {
    const zeros = new Uint8Array(20 * 1024 * 1024);
    const deflated = deflateSync(zeros, { level: 9 });
    // Declares 1 KB uncompressed: passes the ratio check, then overflows while inflating.
    const bytes = writeZip([
      entry("liar.bin", deflated, { method: 8, crc32: 0, uncompressedSize: 1024 }),
    ]);
    const [e] = readZipDirectory(bytes);
    expect(() => extractEntry(bytes, e!)).toThrow(
      expect.objectContaining({ code: "ratio-exceeded" }),
    );
  });

  it("rejects overlapping entries (non-recursive zip bombs)", () => {
    const data = enc.encode("shared payload");
    const bytes = writeZip([entry("a.txt", data), entry("b.txt", data)]);
    // Point the second central directory record at the first local header.
    const dv = new DataView(bytes.buffer);
    const eocd = bytes.length - 22;
    const cdOffset = dv.getUint32(eocd + 16, true);
    const secondCd = cdOffset + 46 + "a.txt".length;
    dv.setUint32(secondCd + 42, 0, true);
    expect(() => readZipDirectory(bytes)).toThrow(/overlap/);
  });

  it("rejects encrypted entries and enforces total size", () => {
    const bytes = writeZip([entry("secret.txt", enc.encode("xxxxxxxxxxxx"))]);
    // Set the encryption flag in both headers.
    const dv = new DataView(bytes.buffer);
    dv.setUint16(6, 0x0801, true);
    const cd = dv.getUint32(bytes.length - 22 + 16, true);
    dv.setUint16(cd + 8, 0x0801, true);
    const [e] = readZipDirectory(bytes);
    expect(() => extractEntry(bytes, e!)).toThrow(expect.objectContaining({ code: "encrypted" }));
    expect(() =>
      readZipDirectory(sampleZip(), { ...DEFAULT_ZIP_LIMITS, maxTotalUncompressed: 1000 }),
    ).toThrow(/too large/);
  });

  it("detects CRC mismatches", () => {
    const bytes = writeZip([entry("a.txt", enc.encode("hello"), { crc32: 1234 })]);
    const [e] = readZipDirectory(bytes);
    expect(() => extractEntry(bytes, e!)).toThrow(
      expect.objectContaining({ code: "crc-mismatch" }),
    );
  });
});

describe("repackZip", () => {
  it("shrinks stored archives and preserves every entry byte-for-byte", async () => {
    const input = sampleZip(0);
    const { bytes, stats } = await repackZip(input);
    expect(bytes.length).toBeLessThan(input.length);
    expect(stats.recompressed).toBeGreaterThan(0);
    const before = unzipSync(input);
    const after = unzipSync(bytes);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    for (const name of Object.keys(before)) expect(after[name]).toEqual(before[name]);
  });

  it("keeps already-optimal entries and a stored leading mimetype", async () => {
    const mimetype = enc.encode("application/epub+zip");
    const input = writeZip([
      entry("mimetype", mimetype),
      entry("content.txt", enc.encode("x".repeat(5000))),
    ]);
    const { bytes } = await repackZip(input);
    const entries = readZipDirectory(bytes);
    expect(entries[0]).toMatchObject({ name: "mimetype", method: 0 });
    expect(entries[1]!.method).toBe(8);
  });

  it("applies transforms and verifies the result", async () => {
    const input = sampleZip(1);
    const { bytes, stats } = await repackZip(input, {
      transform: async (e, data) => (e.name === "readme.txt" ? data.subarray(0, 10) : null),
    });
    expect(stats.transformed).toBe(1);
    expect(new TextDecoder().decode(unzipSync(bytes)["readme.txt"])).toBe("The quick ");
  });
});

describe("archive engine", () => {
  it("optimizes a ZIP through the core orchestrator", async () => {
    const file = new File([sampleZip(0)], "bundle.zip", { type: "application/zip" });
    expect((await inspectFile(file)).detected.mime).toBe("application/zip");
    const result = await optimizeFile(file, { engines: [createArchiveEngine()] });
    expect(result.changed).toBe(true);
    expect(result.engine).toBe("archive");
    expect(result.reduction).toBeGreaterThan(0.5);
  });

  it("maps unsafe archives to resource-limit / failed errors", async () => {
    const zeros = new Uint8Array(20 * 1024 * 1024);
    const bomb = writeZip([
      entry("bomb.bin", deflateSync(zeros, { level: 9 }), {
        method: 8,
        crc32: crc32(zeros),
        uncompressedSize: zeros.length,
      }),
    ]);
    const file = new File([bomb], "bomb.zip", { type: "application/zip" });
    await expect(optimizeFile(file, { engines: [createArchiveEngine()] })).rejects.toMatchObject({
      reason: "resource-limit",
    });
  });

  it("summarises archives without extracting", async () => {
    const info = await inspectZip(new Blob([sampleZip(1)]));
    expect(info).toMatchObject({ entries: 3, files: 2, directories: 1, encryptedEntries: 0 });
  });
});
