/**
 * Security properties of the SDK as a whole.
 */
import { deflateSync, strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUploadRescue, inspectFile, optimizeFile, validateFile } from "@uploadrescue/core";
import { createArchiveEngine, crc32, writeZip } from "@uploadrescue/archive-engine";
import { createDocumentEngine } from "@uploadrescue/document-engine";
import { createPdfEngine } from "@uploadrescue/pdf-engine";

afterEach(() => vi.unstubAllGlobals());

const enc = new TextEncoder();
const MZ = [0x4d, 0x5a, 0x90, 0x00, 0x03]; // Windows executable header

describe("type spoofing", () => {
  it("rejects an executable renamed to .png for image-only uploads", async () => {
    const file = new File([new Uint8Array([...MZ, ...new Array(100).fill(0)])], "cute-cat.png", {
      type: "image/png",
    });
    const rescue = createUploadRescue({ upload: vi.fn(), acceptedTypes: ["image/*"] });
    // MZ is not a known signature, so detection falls back to the declared type...
    const info = await inspectFile(file);
    expect(info.detected.source).toBe("declared");
    // ...but a PDF disguised as PNG is caught by its signature.
    const pdf = new File([enc.encode("%PDF-1.7\n...")], "cute-cat.png", { type: "image/png" });
    const result = await validateFile(pdf, { acceptedTypes: ["image/*"] });
    expect(result.issues[0]!.code).toBe("type-not-accepted");
    const state = await rescue.select(pdf);
    expect(state.status).toBe("failed");
  });

  it("can reject any signature/extension mismatch", async () => {
    const zip = new File([zipSync({ "a.txt": strToU8("x") })], "photo.jpg", { type: "image/jpeg" });
    const result = await validateFile(zip, { rejectTypeMismatch: true });
    expect(result.issues.map((i) => i.code)).toContain("type-mismatch");
  });
});

describe("no automatic external transmission", () => {
  it("never makes network requests except through the developer's upload function", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("network disabled")));
    vi.stubGlobal("fetch", fetchSpy);
    const XhrSpy = vi.fn();
    vi.stubGlobal("XMLHttpRequest", XhrSpy);
    const upload = vi.fn(async (file: File) => {
      if (file.size > 10_000) throw Object.assign(new Error("too big"), { status: 413 });
      return "ok";
    });
    const rescue = createUploadRescue({
      upload,
      maxSize: 10_000,
      engines: [
        createPdfEngine(),
        createDocumentEngine({ recompress: async () => null }),
        createArchiveEngine(),
      ],
      recovery: { autoRetry: true },
    });
    const zip = new File(
      [zipSync({ "a.txt": strToU8("payload ".repeat(5000)) }, { level: 0 })],
      "a.zip",
      { type: "application/zip" },
    );
    const state = await rescue.select(zip);
    expect(state.status).toBe("success");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(XhrSpy).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledTimes(1);
  });
});

describe("hostile archives through the recovery flow", () => {
  function bombZip() {
    const zeros = new Uint8Array(30 * 1024 * 1024);
    return writeZip([
      {
        nameBytes: enc.encode("bomb.bin"),
        method: 8,
        data: deflateSync(zeros, { level: 9 }),
        crc32: crc32(zeros),
        uncompressedSize: zeros.length,
        modTime: 0,
        modDate: 0x21,
        utf8: true,
        versionMadeBy: 20,
        internalAttrs: 0,
        externalAttrs: 0,
      },
    ]);
  }

  it("refuses to expand a zip bomb and explains why", async () => {
    const rescue = createUploadRescue({
      upload: vi.fn(),
      maxSize: 1000,
      engines: [createArchiveEngine()],
    });
    await rescue.select(new File([bombZip()], "innocent.zip", { type: "application/zip" }));
    const state = await rescue.recover();
    expect(state.status).toBe("optimization-failed");
    expect(state.optimizationFailure?.reason).toBe("resource-limit");
  });

  it("refuses Office packages containing traversal paths", async () => {
    const evil = writeZip(
      ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "../../../../tmp/pwned"].map(
        (name) => {
          const data = enc.encode("<x/>");
          return {
            nameBytes: enc.encode(name),
            method: 0 as const,
            data,
            crc32: crc32(data),
            uncompressedSize: data.length,
            modTime: 0,
            modDate: 0x21,
            utf8: true,
            versionMadeBy: 20,
            internalAttrs: 0,
            externalAttrs: 0,
          };
        },
      ),
    );
    const file = new File([evil], "report.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    await expect(
      optimizeFile(file, { engines: [createDocumentEngine({ recompress: async () => null })] }),
    ).rejects.toMatchObject({
      name: "OptimizationError",
      message: expect.stringContaining("Unsafe entry path"),
    });
  });
});

describe("bounded work", () => {
  it("never retries indefinitely, even with autoRetry and a permanently failing server", async () => {
    const upload = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const rescue = createUploadRescue({ upload, recovery: { autoRetry: true, maxAttempts: 5 } });
    const state = await rescue.select(new File(["x"], "a.txt"));
    expect(state.status).toBe("failed");
    expect(upload).toHaveBeenCalledTimes(6);
  });
});
