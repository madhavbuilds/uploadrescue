import { PDFDocument, PDFName, type PDFNumber, PDFRawStream, StandardFonts } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { optimizeFile } from "@uploadrescue/core";
import { createPdfEngine, inspectPdf, readJpegFrame, type JpegRecompressor } from "../src";

function jpegWithFrame(width: number, height: number, size: number, components = 3) {
  const b = new Uint8Array(size);
  b.set([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0,
    17,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    components,
  ]);
  for (let i = 12; i < size; i += 1) b[i] = (i * 31) % 251;
  return b;
}

async function makePdf(options: { pages?: number; image?: boolean; incremental?: boolean } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < (options.pages ?? 3); i += 1) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Page ${i + 1} — UploadRescue test document`, { x: 50, y: 780, size: 14, font });
  }
  if (options.image) {
    const dict = doc.context.obj({
      Type: "XObject",
      Subtype: "Image",
      Width: 1600,
      Height: 1200,
      ColorSpace: "DeviceRGB",
      BitsPerComponent: 8,
      Filter: "DCTDecode",
    });
    doc.context.register(PDFRawStream.of(dict, jpegWithFrame(1600, 1200, 120_000)));
  }
  let bytes = await doc.save({ useObjectStreams: false });
  if (options.incremental) {
    // Simulate many incremental saves (each appends a full revision).
    for (let i = 0; i < 3; i += 1) {
      const again = await PDFDocument.load(bytes);
      again.setTitle(`Revision ${i}`);
      bytes = await again.save({ useObjectStreams: false });
      bytes = new Uint8Array([...bytes, ...new TextEncoder().encode("\n%%EOF\n")]);
    }
  }
  return new File([bytes], "doc.pdf", { type: "application/pdf" });
}

/** Minimal hand-written PDF whose trailer references an /Encrypt dictionary. */
function encryptedPdf() {
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >> endobj",
    "4 0 obj << /Filter /Standard /V 1 /R 2 /O (x) /U (y) /P -4 >> endobj",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const o of objects) {
    offsets.push(body.length);
    body += `${o}\n`;
  }
  const xref = body.length;
  body += `xref\n0 5\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer << /Size 5 /Root 1 0 R /Encrypt 4 0 R /ID [<00><00>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return new File([body], "locked.pdf", { type: "application/pdf" });
}

describe("readJpegFrame", () => {
  it("reads SOF dimensions and components", () => {
    expect(readJpegFrame(jpegWithFrame(640, 480, 64, 1))).toEqual({
      width: 640,
      height: 480,
      components: 1,
    });
  });
});

describe("inspectPdf", () => {
  it("reports pages, images and incremental updates", async () => {
    const info = await inspectPdf(await makePdf({ pages: 4, image: true, incremental: true }));
    expect(info).toMatchObject({
      pageCount: 4,
      encrypted: false,
      signed: false,
      images: 1,
      recompressibleImages: 1,
    });
    expect(info.incrementalUpdates).toBeGreaterThan(0);
  });

  it("detects encryption", async () => {
    expect((await inspectPdf(encryptedPdf())).encrypted).toBe(true);
  });

  it("rejects malformed files", async () => {
    await expect(inspectPdf(new Blob(["%PDF-1.7\n garbage garbage"]))).rejects.toMatchObject({
      reason: "failed",
    });
    await expect(inspectPdf(new Blob(["hello"]))).rejects.toThrow(/PDF header/);
  });
});

describe("pdf engine", () => {
  const recompress: JpegRecompressor = vi.fn(async () => ({
    data: jpegWithFrame(1000, 750, 30_000),
    width: 1000,
    height: 750,
    components: 3,
  }));

  it("re-encodes JPEG images, rewrites the file and keeps every page", async () => {
    const file = await makePdf({ pages: 5, image: true, incremental: true });
    const result = await optimizeFile(file, { engines: [createPdfEngine({ recompress })] });
    expect(result.changed).toBe(true);
    expect(result.outputSize).toBeLessThan(file.size);
    expect(recompress).toHaveBeenCalledOnce();
    const out = await PDFDocument.load(await result.file.arrayBuffer());
    expect(out.getPageCount()).toBe(5);
    const images = out.context
      .enumerateIndirectObjects()
      .map(([, o]) => o)
      .filter(
        (o): o is PDFRawStream =>
          o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
      );
    expect(images).toHaveLength(1);
    expect((images[0]!.dict.get(PDFName.of("Width")) as PDFNumber).asNumber()).toBe(1000);
    expect(images[0]!.contents.length).toBe(30_000);
  });

  it("refuses encrypted PDFs", async () => {
    await expect(
      optimizeFile(encryptedPdf(), { engines: [createPdfEngine({ recompress })] }),
    ).rejects.toMatchObject({
      reason: "unsupported",
      message: expect.stringContaining("Encrypted"),
    });
  });

  it("refuses signed PDFs unless explicitly allowed", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.context.register(
      doc.context.obj({ Type: "Sig", Filter: "Adobe.PPKLite", ByteRange: [0, 10, 20, 30] }),
    );
    const file = new File([await doc.save()], "signed.pdf", { type: "application/pdf" });
    expect((await inspectPdf(file)).signed).toBe(true);
    await expect(
      optimizeFile(file, { engines: [createPdfEngine({ recompress })] }),
    ).rejects.toMatchObject({
      reason: "unsupported",
    });
    const allowed = await optimizeFile(file, {
      engines: [createPdfEngine({ recompress, allowSignatureInvalidation: true })],
    });
    expect(allowed.engine).toBe("pdf");
  });

  it("reports no reduction honestly for already-compact PDFs", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const file = new File([await doc.save({ useObjectStreams: true })], "tiny.pdf", {
      type: "application/pdf",
    });
    const result = await optimizeFile(file, {
      engines: [createPdfEngine({ recompressImages: false })],
    });
    expect(result.changed).toBe(false);
    expect(result.file).toBe(file);
  });

  it("fails cleanly on malformed PDFs", async () => {
    const file = new File(["%PDF-1.7\n1 0 obj << /Type /Catalog"], "bad.pdf", {
      type: "application/pdf",
    });
    await expect(optimizeFile(file, { engines: [createPdfEngine()] })).rejects.toMatchObject({
      reason: "failed",
    });
  });
});
