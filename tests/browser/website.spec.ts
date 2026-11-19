import { expect, test } from "@playwright/test";

const SITE = "http://localhost:5173";

test("home page renders the hero, install command and live demo", async ({ page }) => {
  await page.goto(SITE);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Failed uploads? Let us rescue them.",
  );
  await expect(page.getByText("pnpm add @uploadrescue/react").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Get started" }).first()).toBeVisible();
  await expect(page.getByRole("group", { name: "Demo upload" })).toBeVisible();
  await expect(page.getByText("Simulated server").first()).toBeVisible();
});

test("docs navigation works client-side and renders code", async ({ page }) => {
  await page.goto(`${SITE}/docs/introduction`);
  await page
    .getByRole("navigation", { name: "Documentation" })
    .getByRole("link", { name: "Quick start" })
    .click();
  await expect(page).toHaveURL(/\/docs\/quick-start$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Quick start");
  await expect(page.locator(".code").first()).toBeVisible();
  await page.goto(`${SITE}/api`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("API reference");
});

test("playground: client-side limit, real optimization, inspector and generated code", async ({
  page,
}) => {
  await page.goto(`${SITE}/playground`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Playground");
  await expect(page.getByText("No file is uploaded anywhere.")).toBeVisible();

  const png = await page.evaluate(async () => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 1800, height: 1200 });
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(1800, 1200);
    let seed = 3;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      img.data[i] = ((i / 4) % 1800) / 8;
      img.data[i + 1] = i / 4 / 1800 / 5;
      img.data[i + 2] = 120 + (seed % 60);
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page
    .getByRole("group", { name: "Playground upload" })
    .locator('input[type="file"]')
    .setInputFiles({
      name: "screenshot.png",
      mimeType: "image/png",
      buffer: Buffer.from(png),
    });
  await expect(page.locator(".ur-title").first()).toHaveText("Your file is too large.");
  await page.getByRole("button", { name: "Compress & Retry Upload" }).click();
  await expect(page.locator(".pg-inspector")).toContainText("Processing time", { timeout: 60_000 });
  await expect(page.locator(".pg-inspector")).toContainText("Event log");
  await expect(page.getByRole("button", { name: "Download optimized file" })).toBeVisible();

  await page.getByRole("tab", { name: "Vanilla JS" }).click();
  await expect(page.locator(".pg-code")).toContainText('rescue.attach("#upload-input")');
});

test("theme toggle switches to dark mode", async ({ page }) => {
  await page.goto(SITE);
  await page.getByRole("button", { name: /Switch to dark theme/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
