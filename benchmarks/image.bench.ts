/**
 * Measures real optimization results in the browser (Chromium) for several
 * file types. Inputs are generated (photo-like images with gradients + noise,
 * PDFs/DOCX embedding those images, a ZIP of text logs), so numbers are
 * reproducible but content-dependent. Results depend on hardware.
 *
 * Writes benchmarks/results.json (used for README charts) and
 * benchmarks/image-performance.md.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

interface Row {
  id: string;
  label: string;
  engine: string;
  inputBytes: number;
  outputBytes: number;
  targetBytes: number | null;
  withinTarget: boolean;
  medianMs: number;
  outputType: string;
}

test("optimization benchmark", async ({ page, browserName }) => {
  await page.goto("http://localhost:5176/");
  await expect(page.locator("#ready")).toHaveText("ready");

  const rows: Row[] = await page.evaluate(async () => {
    const { core, image, pdf, document, archive, pdfLib, fflate, makeImage } = window.UR;
    const MB = 1024 * 1024;
    const imageEngine = image.createImageEngine();

    async function run(
      id: string,
      label: string,
      file: File,
      engines: Parameters<typeof core.optimizeFile>[1]["engines"],
      options: { targetSize?: number; preserveFormat?: boolean; quality?: number } = {},
    ) {
      const times: number[] = [];
      let result;
      for (let i = 0; i < 3; i += 1) {
        result = await core.optimizeFile(file, { engines, ...options });
        times.push(result.durationMs);
      }
      times.sort((a, b) => a - b);
      return {
        id,
        label,
        engine: result!.engine,
        inputBytes: file.size,
        outputBytes: result!.outputSize,
        targetBytes: options.targetSize ?? null,
        withinTarget: result!.withinTarget,
        medianMs: times[1]!,
        outputType: result!.outputType,
      };
    }

    const photo = await makeImage(4032, 3024, "image/jpeg");
    const screenshot = await makeImage(2880, 1800, "image/png");

    const pdfDoc = await pdfLib.PDFDocument.create();
    for (let i = 0; i < 4; i += 1) {
      const jpg = await pdfDoc.embedJpg(
        await (await makeImage(2400, 1800, "image/jpeg")).arrayBuffer(),
      );
      pdfDoc.addPage([595, 842]).drawImage(jpg, { x: 0, y: 200, width: 595, height: 446 });
    }
    const pdfFile = new File([await pdfDoc.save()], "scan.pdf", { type: "application/pdf" });

    const enc = (s: string) => new TextEncoder().encode(s);
    const media: Record<string, Uint8Array> = {};
    for (let i = 1; i <= 3; i += 1) {
      media[`word/media/image${i}.jpeg`] = new Uint8Array(
        await (await makeImage(3000, 2000, "image/jpeg")).arrayBuffer(),
      );
    }
    const docx = new File(
      [
        fflate.zipSync({
          "[Content_Types].xml": enc("<Types/>"),
          "_rels/.rels": enc("<Relationships/>"),
          "word/document.xml": enc(
            `<w:document><w:body>${"<w:p><w:r><w:t>Report text</w:t></w:r></w:p>".repeat(400)}</w:body></w:document>`,
          ),
          ...media,
        }),
      ],
      "report.docx",
      { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    );

    const logs: Record<string, Uint8Array> = {};
    for (let i = 0; i < 20; i += 1) {
      logs[`logs/app-${i}.log`] = enc(
        Array.from(
          { length: 2500 },
          (_, n) =>
            `2026-11-19T10:${String(n % 60).padStart(2, "0")}:00Z INFO request ${i}-${n} handled in ${n % 97} ms\n`,
        ).join(""),
      );
    }
    const zip = new File([fflate.zipSync(logs, { level: 0 })], "logs.zip", {
      type: "application/zip",
    });

    return [
      await run("photo-2mb", "Phone photo (12 MP JPEG) → 2 MB limit", photo, [imageEngine], {
        targetSize: 2 * MB,
      }),
      await run("photo-1mb", "Phone photo (12 MP JPEG) → 1 MB limit", photo, [imageEngine], {
        targetSize: 1 * MB,
      }),
      await run(
        "screenshot",
        "Retina screenshot (PNG → WebP) → 1 MB limit",
        screenshot,
        [imageEngine],
        { targetSize: 1 * MB, preserveFormat: false },
      ),
      await run("pdf", "4-page PDF with photos", pdfFile, [pdf.createPdfEngine()], {
        quality: 0.75,
      }),
      await run("docx", "DOCX with 3 photos", docx, [document.createDocumentEngine()]),
      await run("zip", "ZIP of text logs (stored → deflate)", zip, [archive.createArchiveEngine()]),
    ];
  });

  const ua = await page.evaluate(() => navigator.userAgent);
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync(
    fileURLToPath(new URL("./results.json", import.meta.url)),
    JSON.stringify({ date, browser: browserName, userAgent: ua, rows }, null, 2) + "\n",
  );

  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
  const md = `# Optimization performance

Measured with \`pnpm bench\` on ${date} in ${browserName} (${ua}).
Inputs are generated (photo-like images with noise, documents embedding them, text logs) so results are
reproducible; real-world content usually compresses differently. Times are the median of 3 runs of
\`optimizeFile\`. Hardware-dependent: re-run locally.

| Case | Engine | Input | Output | Saved | Target met | Median time |
| --- | --- | --- | --- | --- | --- | --- |
${rows
  .map(
    (r) =>
      `| ${r.label} | ${r.engine} | ${mb(r.inputBytes)} | ${mb(r.outputBytes)} (${r.outputType.split("/").pop()}) | ${(100 * (1 - r.outputBytes / r.inputBytes)).toFixed(1)}% | ${r.targetBytes === null ? "—" : r.withinTarget ? "yes" : "no"} | ${r.medianMs.toLocaleString()} ms |`,
  )
  .join("\n")}
`;
  writeFileSync(fileURLToPath(new URL("./image-performance.md", import.meta.url)), md);
  console.log(md);
});
