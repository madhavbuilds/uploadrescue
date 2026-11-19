/**
 * The complete failure → recovery → success workflow against the examples'
 * real upload endpoint (HTTP 413 above 1 MB), in every browser.
 */
import { expect, test, type Page } from "@playwright/test";

/** Generates a ~2-4 MB photo-like JPEG inside the page (each browser encodes its own). */
async function bigJpeg(page: Page): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const base64 = await page.evaluate(async () => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 2600, height: 1800 });
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(1300, 900, 50, 1300, 900, 1500);
    g.addColorStop(0, "#fde68a");
    g.addColorStop(1, "#1e3a8a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 2600, 1800);
    const img = ctx.getImageData(0, 0, 2600, 1800);
    let seed = 7;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      img.data[i + 2] = Math.min(255, img.data[i + 2]! + (seed % 40));
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 1));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const buffer = Buffer.from(base64, "base64");
  expect(buffer.length).toBeGreaterThan(1024 * 1024);
  return { name: "holiday.jpg", mimeType: "image/jpeg", buffer };
}

test("React example: real 413 → Compress & Retry → success", async ({ page }) => {
  const uploads: number[] = [];
  page.on("response", (r) => {
    if (r.url().endsWith("/api/upload")) uploads.push(r.status());
  });
  await page.goto("http://localhost:5174/");
  const file = await bigJpeg(page);
  await page.locator('input[type="file"]').setInputFiles(file);

  const widget = page.getByRole("group", { name: "File upload" });
  await expect(widget.locator(".ur-title")).toHaveText("Your file is too large.");
  await expect(widget).toContainText("Maximum allowed: 1 MB.");
  expect(uploads).toEqual([413]);

  await page.getByRole("button", { name: "Compress & Retry Upload" }).click();
  await expect(widget.locator(".ur-title")).toHaveText("Upload completed successfully.", {
    timeout: 60_000,
  });
  await expect(widget.locator('[data-stat="reduction"]')).toBeVisible();
  expect(uploads).toEqual([413, 201]);
  await expect(page.getByTestId("log")).toContainText("(optimized)");
});

test("React example: keyboard access and cancellation", async ({ page }) => {
  // Let the first request reach the real server (413), then hold the retry open
  // so cancellation is deterministic regardless of how fast the browser is.
  let calls = 0;
  let aborted = false;
  await page.route("**/api/upload", async (route) => {
    calls += 1;
    if (calls === 1) return route.continue();
    page.on("requestfailed", (r) => {
      if (r.url().endsWith("/api/upload")) aborted = true;
    });
  });
  await page.goto("http://localhost:5174/");
  await page.locator('input[type="file"]').setInputFiles(await bigJpeg(page));
  const recover = page.getByRole("button", { name: "Compress & Retry Upload" });
  await recover.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".ur-title")).toHaveText("Uploading optimized file…", {
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => aborted).toBe(true);
  await expect(page.locator(".ur-title")).toHaveText("Upload cancelled.");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("Vanilla example: attach() to an input, real 413, recovery", async ({ page }) => {
  await page.goto("http://localhost:5175/");
  await expect(page.locator(".ur-widget")).toBeHidden(); // hidden while idle
  await page.locator("#upload-input").setInputFiles(await bigJpeg(page));
  await expect(page.locator(".ur-title")).toHaveText("Your file is too large.");
  await page.getByRole("button", { name: "Compress & Retry Upload" }).click();
  await expect(page.locator(".ur-title")).toHaveText("Upload completed successfully.", {
    timeout: 60_000,
  });
  await expect(page.locator("#log")).toContainText("Upload succeeded with the optimized file");
});
