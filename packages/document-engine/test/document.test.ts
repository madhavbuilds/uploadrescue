import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { inspectFile, optimizeFile } from "@uploadrescue/core";
import { createDocumentEngine, inspectOoxml, type MediaRecompressor } from "../src";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`;
const RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="officeDocument" Target="word/document.xml"/></Relationships>`;
const DOC = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${"<w:p><w:r><w:t>Paragraph</w:t></w:r></w:p>".repeat(500)}</w:body></w:document>`;

function fakeJpeg(size: number) {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < size; i += 1) b[i] = (i * 7919) % 256; // incompressible-ish
  return b;
}

function docx(extra: Record<string, Uint8Array> = {}) {
  return zipSync(
    {
      "[Content_Types].xml": strToU8(CONTENT_TYPES),
      "_rels/.rels": strToU8(RELS),
      "word/document.xml": strToU8(DOC),
      "word/_rels/document.xml.rels": strToU8(RELS),
      "word/media/image1.jpeg": fakeJpeg(200_000),
      "word/media/diagram.emf": fakeJpeg(1000),
      ...extra,
    },
    { level: 0 },
  );
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("inspectOoxml", () => {
  it("validates structure and lists media", () => {
    const { info } = inspectOoxml(docx());
    expect(info).toMatchObject({ kind: "word", hasMacros: false, signed: false });
    expect(info.media.map((m) => m.name)).toEqual([
      "word/media/image1.jpeg",
      "word/media/diagram.emf",
    ]);
  });

  it("detects macros and signatures", () => {
    const { info } = inspectOoxml(
      docx({
        "word/vbaProject.bin": new Uint8Array([1, 2, 3]),
        "_xmlsignatures/sig1.xml": strToU8("<sig/>"),
      }),
    );
    expect(info.hasMacros).toBe(true);
    expect(info.signed).toBe(true);
  });

  it("rejects packages without the required parts", () => {
    expect(() => inspectOoxml(zipSync({ "a.txt": strToU8("x") }))).toThrow(/Content_Types/);
    expect(() =>
      inspectOoxml(
        zipSync({ "[Content_Types].xml": strToU8(CONTENT_TYPES), "_rels/.rels": strToU8(RELS) }),
      ),
    ).toThrow(/main document part/);
  });
});

describe("document engine", () => {
  const halve: MediaRecompressor = vi.fn(async (data) =>
    data.slice(0, Math.floor(data.length / 2)),
  );

  it("re-encodes JPEG media, re-deflates XML, and leaves everything else byte-identical", async () => {
    const input = docx({ "word/vbaProject.bin": new Uint8Array([9, 9, 9]) });
    const file = new File([input], "report.docx", { type: DOCX_MIME });
    // A VBA project makes the content sniff as macro-enabled; the declared type is kept.
    expect((await inspectFile(file)).detected.mime).toContain("macroEnabled");
    const result = await optimizeFile(file, {
      engines: [createDocumentEngine({ recompress: halve })],
    });
    expect(result.changed).toBe(true);
    expect(result.outputType).toBe(DOCX_MIME);
    expect(result.file.name).toBe("report.docx");

    const before = unzipSync(input);
    const after = unzipSync(new Uint8Array(await result.file.arrayBuffer()));
    expect(Object.keys(after)).toEqual(Object.keys(before));
    for (const name of Object.keys(before)) {
      if (name === "word/media/image1.jpeg") expect(after[name]!.length).toBe(100_000);
      else expect(after[name]).toEqual(before[name]); // XML, rels, EMF, macros unchanged
    }
    expect(halve).toHaveBeenCalledTimes(1); // EMF is never passed to the image re-encoder
    expect(result.notes.join(" ")).toContain("macros");
  });

  it("refuses signed documents by default", async () => {
    const file = new File([docx({ "_xmlsignatures/sig1.xml": strToU8("<sig/>") })], "signed.docx", {
      type: DOCX_MIME,
    });
    await expect(
      optimizeFile(file, { engines: [createDocumentEngine({ recompress: halve })] }),
    ).rejects.toMatchObject({
      reason: "unsupported",
    });
  });

  it("fails cleanly on corrupt packages", async () => {
    const bytes = docx();
    const file = new File([bytes.slice(0, bytes.length - 40)], "broken.docx", { type: DOCX_MIME });
    await expect(
      optimizeFile(file, { engines: [createDocumentEngine({ recompress: halve })] }),
    ).rejects.toMatchObject({
      name: "OptimizationError",
    });
  });
});
