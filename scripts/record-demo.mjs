import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
// Records .github/assets/demo.{gif,mp4} from the React example (real 413 endpoint).
// Usage: pnpm --filter @uploadrescue/example-react dev   (in another terminal)
//        node scripts/record-demo.mjs                    (requires ffmpeg on PATH)
const root = fileURLToPath(new URL("..", import.meta.url));
const out = root + "node_modules/.cache/demo-frames";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();

// 1) Make the test photo off-camera.
const prep = await browser.newPage();
await prep.goto("http://localhost:5174/");
const photo = await prep.evaluate(async () => {
  const c = Object.assign(document.createElement("canvas"), { width: 3000, height: 2000 });
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 3000, 2000);
  g.addColorStop(0, "#0ea5e9");
  g.addColorStop(0.5, "#f59e0b");
  g.addColorStop(1, "#10b981");
  x.fillStyle = g;
  x.fillRect(0, 0, 3000, 2000);
  const d = x.getImageData(0, 0, 3000, 2000);
  let s = 5;
  for (let i = 0; i < d.data.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    d.data[i] = Math.min(255, d.data[i] + (s % 30));
  }
  x.putImageData(d, 0, 0);
  const b = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.95));
  return Array.from(new Uint8Array(await b.arrayBuffer()));
});
await prep.close();

// 2) Record with timestamped screenshots.
const page = await browser.newPage({ viewport: { width: 760, height: 520 }, deviceScaleFactor: 1 });
await page.goto("http://localhost:5174/");
await page.addStyleTag({
  content:
    "#cur{position:fixed;z-index:99;width:18px;height:18px;border-radius:50%;background:rgba(37,99,235,.35);border:2px solid #2563eb;pointer-events:none;transition:left .6s ease,top .6s ease,transform .15s;left:640px;top:440px}#cur.down{transform:scale(.7)}",
});
await page.evaluate(() => {
  const c = document.createElement("div");
  c.id = "cur";
  document.body.appendChild(c);
});
let recording = true;
const frames = [];
const capture = (async () => {
  while (recording) {
    const t = Date.now();
    const buf = await page.screenshot({ type: "png" });
    const name = String(frames.length).padStart(4, "0") + ".png";
    writeFileSync(out + "/" + name, buf);
    frames.push({ name, t });
  }
})();
const moveTo = async (locator) => {
  const b = await locator.boundingBox();
  await page.evaluate(
    ([x, y]) => {
      const c = document.getElementById("cur");
      c.style.left = x + "px";
      c.style.top = y + "px";
    },
    [b.x + b.width / 2 - 9, b.y + b.height / 2 - 9],
  );
  await page.waitForTimeout(750);
  await page.evaluate(() => document.getElementById("cur").classList.add("down"));
  await page.waitForTimeout(180);
  await page.evaluate(() => document.getElementById("cur").classList.remove("down"));
};
await page.waitForTimeout(700);
await moveTo(page.getByRole("button", { name: "Browse files" }));
await page
  .locator('input[type="file"]')
  .setInputFiles({ name: "holiday-photo.jpg", mimeType: "image/jpeg", buffer: Buffer.from(photo) });
await page.locator(".ur-title", { hasText: "Your file is too large." }).waitFor();
await page.waitForTimeout(2300);
await moveTo(page.getByRole("button", { name: "Compress & Retry Upload" }));
await page.getByRole("button", { name: "Compress & Retry Upload" }).click();
await page
  .locator(".ur-title", { hasText: "Upload completed successfully." })
  .waitFor({ timeout: 60000 });
await page.waitForTimeout(3500);
recording = false;
await capture;
// ffmpeg concat list with real per-frame durations.
let list = "";
frames.forEach((f, i) => {
  const next = frames[i + 1]?.t ?? f.t + 1500;
  list += "file '" + out + "/" + f.name + "'\nduration " + ((next - f.t) / 1000).toFixed(3) + "\n";
});
list += "file '" + out + "/" + frames[frames.length - 1].name + "'\n";
writeFileSync(out + "/list.txt", list);
console.log(
  frames.length,
  "frames over",
  ((frames.at(-1).t - frames[0].t) / 1000).toFixed(1),
  "s; photo",
  photo.length,
  "bytes",
);
await browser.close();
const assets = root + ".github/assets/";
execFileSync("ffmpeg", [
  "-v",
  "error",
  "-y",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  out + "/list.txt",
  "-vf",
  "fps=15,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
  assets + "demo.gif",
]);
execFileSync("ffmpeg", [
  "-v",
  "error",
  "-y",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  out + "/list.txt",
  "-vf",
  "fps=30,format=yuv420p",
  "-c:v",
  "libx264",
  "-crf",
  "24",
  "-preset",
  "slow",
  "-movflags",
  "+faststart",
  assets + "demo.mp4",
]);
rmSync(out, { recursive: true, force: true });
console.log("Wrote .github/assets/demo.gif and demo.mp4");
