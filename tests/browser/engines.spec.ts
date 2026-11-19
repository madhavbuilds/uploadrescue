/**
 * Real-browser tests of the optimization engines (canvas, Web Workers,
 * DOMParser, pdf-lib, FFmpeg) in Chromium, Firefox and WebKit.
 */
import { expect, test, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.goto("http://localhost:5176/");
  await expect(page.locator("#ready")).toHaveText("ready");
}

test.describe("image engine", () => {
  test("compresses a large JPEG below the target with real canvas encoding", async ({ page }) => {
    await open(page);
    const r = await page.evaluate(async () => {
      const { core, image, makeImage } = window.UR;
      const file = await makeImage(3000, 2000, "image/jpeg");
      const before = new Uint8Array(await file.arrayBuffer());
      const result = await core.optimizeFile(file, {
        engines: [image.createImageEngine()],
        targetSize: 400_000,
        quality: 0.85,
      });
      const after = new Uint8Array(await file.arrayBuffer());
      const bitmap = await createImageBitmap(result.file);
      return {
        originalSize: result.originalSize,
        outputSize: result.outputSize,
        type: result.file.type,
        changed: result.changed,
        withinTarget: result.withinTarget,
        decoded: [bitmap.width, bitmap.height],
        unchanged: before.length === after.length && before.every((b, i) => b === after[i]),
        worker: result.details?.worker,
        durationMs: result.durationMs,
      };
    });
    expect(r.changed).toBe(true);
    expect(r.withinTarget).toBe(true);
    expect(r.outputSize).toBeLessThanOrEqual(400_000);
    expect(r.type).toBe("image/jpeg");
    expect(r.decoded[0]! / r.decoded[1]!).toBeCloseTo(1.5, 1);
    expect(r.unchanged).toBe(true);
    expect(r.durationMs).toBeGreaterThan(0);
    test.info().annotations.push({
      type: "measurement",
      description: `${r.originalSize} → ${r.outputSize} bytes in ${r.durationMs} ms (worker: ${r.worker})`,
    });
  });

  test("honours maxDimension", async ({ page }) => {
    await open(page);
    const dims = await page.evaluate(async () => {
      const { core, image, makeImage } = window.UR;
      const result = await core.optimizeFile(await makeImage(2400, 1200, "image/jpeg"), {
        engines: [image.createImageEngine()],
        maxDimension: 800,
      });
      const bitmap = await createImageBitmap(result.file);
      return [bitmap.width, bitmap.height];
    });
    expect(dims).toEqual([800, 400]);
  });

  test("preserves transparency and never produces JPEG for transparent PNGs", async ({ page }) => {
    await open(page);
    const r = await page.evaluate(async () => {
      const { core, image, makeImage, alphaAt } = window.UR;
      const png = await makeImage(1600, 1200, "image/png", { alpha: true });
      const result = await core.optimizeFile(png, {
        engines: [image.createImageEngine()],
        preserveFormat: false,
        targetSize: png.size / 3,
      });
      return {
        type: result.file.type,
        changed: result.changed,
        alpha: await alphaAt(result.file),
        hasAlpha: result.details?.hasAlpha,
      };
    });
    expect(r.changed).toBe(true);
    expect(r.type).not.toBe("image/jpeg");
    expect(r.hasAlpha).toBe(true);
    expect(r.alpha.corner).toBe(0); // transparent border kept
    expect(r.alpha.centre).toBe(255);
  });

  test("refuses animated GIFs and invalid images", async ({ page }) => {
    await open(page);
    const r = await page.evaluate(async () => {
      const { core, image } = window.UR;
      const enc = (s: string) => [...new TextEncoder().encode(s)];
      const frame = [
        0x21, 0xf9, 4, 0, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 0x01, 0,
      ];
      const gif = new File(
        [
          new Uint8Array([
            ...enc("GIF89a"),
            1,
            0,
            1,
            0,
            0x80,
            0,
            0,
            0,
            0,
            0,
            255,
            255,
            255,
            ...frame,
            ...frame,
            0x3b,
          ]),
        ],
        "a.gif",
        { type: "image/gif" },
      );
      const bad = new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5])],
        "bad.png",
        { type: "image/png" },
      );
      const reason = (p: Promise<unknown>) =>
        p.then(
          () => "ok",
          (e: { reason?: string }) => e.reason ?? "error",
        );
      return {
        gif: await reason(core.optimizeFile(gif, { engines: [image.createImageEngine()] })),
        bad: await reason(core.optimizeFile(bad, { engines: [image.createImageEngine()] })),
      };
    });
    expect(r.gif).toBe("unsupported");
    expect(r.bad).toBe("failed");
  });

  test("cancels a running optimization", async ({ page }) => {
    await open(page);
    const reason = await page.evaluate(async () => {
      const { core, image, makeImage } = window.UR;
      const file = await makeImage(4000, 3000, "image/png");
      const controller = new AbortController();
      const run = core.optimizeFile(file, {
        engines: [image.createImageEngine()],
        signal: controller.signal,
        targetSize: 10_000,
      });
      setTimeout(() => controller.abort(), 50);
      return run.then(
        () => "completed",
        (e: { reason?: string }) => e.reason,
      );
    });
    expect(reason).toBe("aborted");
  });

  test("sanitizes SVG with the browser's DOMParser", async ({ page }) => {
    await open(page);
    const svg = await page.evaluate(async () => {
      const { core, image } = window.UR;
      const src = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><!-- c --><script>alert(2)</script><a href="javascript:alert(3)"><rect width="9" height="9"/></a></svg>`;
      const result = await core.optimizeFile(new File([src], "x.svg", { type: "image/svg+xml" }), {
        engines: [image.createImageEngine()],
      });
      return result.file.text();
    });
    expect(svg).not.toMatch(/script|onload|javascript:/i);
    expect(svg).toContain("<rect");
  });
});

test.describe("pdf and office engines with real image re-encoding", () => {
  test("shrinks a PDF with a large JPEG and keeps its pages", async ({ page }) => {
    await open(page);
    const r = await page.evaluate(async () => {
      const { core, pdf, pdfLib, makeImage } = window.UR;
      const doc = await pdfLib.PDFDocument.create();
      const jpeg = await doc.embedJpg(
        await (await makeImage(2400, 1800, "image/jpeg")).arrayBuffer(),
      );
      for (let i = 0; i < 3; i += 1)
        doc.addPage([600, 800]).drawImage(jpeg, { x: 0, y: 0, width: 600, height: 450 });
      const file = new File([await doc.save()], "scan.pdf", { type: "application/pdf" });
      const result = await core.optimizeFile(file, {
        engines: [pdf.createPdfEngine()],
        quality: 0.7,
      });
      const out = await pdfLib.PDFDocument.load(await result.file.arrayBuffer());
      return {
        before: file.size,
        after: result.outputSize,
        pages: out.getPageCount(),
        reencoded: result.details?.imagesReencoded,
      };
    });
    expect(r.pages).toBe(3);
    expect(r.reencoded).toBe(1);
    expect(r.after).toBeLessThan(r.before * 0.7);
  });

  test("re-encodes images inside a DOCX without touching XML", async ({ page }) => {
    await open(page);
    const r = await page.evaluate(async () => {
      const { core, document, fflate, makeImage } = window.UR;
      const enc = (s: string) => new TextEncoder().encode(s);
      const xml =
        '<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p/></w:body></w:document>';
      const zip = fflate.zipSync({
        "[Content_Types].xml": enc("<Types/>"),
        "_rels/.rels": enc("<Relationships/>"),
        "word/document.xml": enc(xml),
        "word/media/image1.jpeg": new Uint8Array(
          await (await makeImage(3000, 2000, "image/jpeg")).arrayBuffer(),
        ),
      });
      const file = new File([zip], "report.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      const result = await core.optimizeFile(file, { engines: [document.createDocumentEngine()] });
      const out = fflate.unzipSync(new Uint8Array(await result.file.arrayBuffer()));
      return {
        before: file.size,
        after: result.outputSize,
        xml: new TextDecoder().decode(out["word/document.xml"]),
        names: Object.keys(out),
      };
    });
    expect(r.after).toBeLessThan(r.before);
    expect(r.xml).toContain("<w:body>");
    expect(r.names).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "word/document.xml",
      "word/media/image1.jpeg",
    ]);
  });
});

test.describe("media engine", () => {
  test("re-encodes WAV with self-hosted FFmpeg.wasm", async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium",
      "FFmpeg.wasm (32 MB) is exercised once, in Chromium, to keep CI time reasonable.",
    );
    test.setTimeout(180_000);
    await open(page);
    const r = await page.evaluate(async () => {
      const { core, media, makeWav } = window.UR;
      const engine = media.createMediaEngine({
        coreURL: "/ffmpeg/ffmpeg-core.js",
        wasmURL: "/ffmpeg/ffmpeg-core.wasm",
      });
      const wav = makeWav(4);
      const result = await core.optimizeFile(wav, {
        engines: [engine],
        attempt: 1,
        preserveFormat: true,
      });
      return {
        before: wav.size,
        after: result.outputSize,
        type: result.file.type,
        args: result.details?.args,
      };
    });
    expect(r.type).toBe("audio/wav");
    expect(r.after).toBeLessThan(r.before * 0.6); // 44.1 kHz → 22.05 kHz
    expect(r.args).toContain("22050");
  });
});
