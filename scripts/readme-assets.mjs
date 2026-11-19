// Generates the README graphics in .github/assets from measured data:
//   benchmarks/results.json      (pnpm bench)
//   benchmarks/bundle-size.json  (pnpm size)
// Every number drawn here comes from those files or is derived from them with
// the formula stated on the chart. Run: node scripts/readme-assets.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, ".github/assets");
mkdirSync(out, { recursive: true });

const results = JSON.parse(readFileSync(join(root, "benchmarks/results.json"), "utf8"));
const bundle = JSON.parse(readFileSync(join(root, "benchmarks/bundle-size.json"), "utf8"));

const THEMES = {
  light: {
    bg: "#ffffff",
    border: "#e4e4e7",
    text: "#171717",
    muted: "#64748b",
    track: "#f4f4f5",
    original: "#a1a1aa",
    optimized: "#16a34a",
    optimizedText: "#15803d",
    accent: "#171717",
    accentText: "#ffffff",
    error: "#dc2626",
    errorBg: "#fef2f2",
    errorBorder: "#fecaca",
    successBg: "#f0fdf4",
    successBorder: "#bbf7d0",
    lazy: "#86efac",
    node: "#fafafa",
  },
  dark: {
    bg: "#0d1117",
    border: "#30363d",
    text: "#e6edf3",
    muted: "#8b949e",
    track: "#161b22",
    original: "#6e7681",
    optimized: "#3fb950",
    optimizedText: "#3fb950",
    accent: "#e6edf3",
    accentText: "#0d1117",
    error: "#f85149",
    errorBg: "#1f1416",
    errorBorder: "#5a2a2a",
    successBg: "#12201a",
    successBorder: "#1f4d2e",
    lazy: "#238636",
    node: "#161b22",
  },
};

const FONT = `font-family="Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"`;
const MONO = `font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const mb = (b) => `${(b / 1024 / 1024).toFixed(b >= 10 * 1024 * 1024 ? 1 : 2)} MB`;
const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
const pct = (a, b) => `−${(100 * (1 - b / a)).toFixed(1)}%`;
const secs = (b, mbit) => (b * 8) / (mbit * 1_000_000);

function svg(w, h, t, body, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="14" fill="${t.bg}" stroke="${t.border}"/>
${body}
</svg>
`;
}

const text = (x, y, s, attrs = "") => `<text x="${x}" y="${y}" ${FONT} ${attrs}>${esc(s)}</text>`;

function header(t, title, subtitle) {
  return [
    text(28, 40, title, `font-size="19" font-weight="700" fill="${t.text}"`),
    text(28, 62, subtitle, `font-size="12.5" fill="${t.muted}"`),
  ].join("\n");
}

function logo(t, x, y, size) {
  const s = size / 32;
  return `<g transform="translate(${x} ${y}) scale(${s})">
  <rect width="32" height="32" rx="7" fill="${t.accent}"/>
  <path d="M16 22V9m0 0-5 5m5-5 5 5" fill="none" stroke="${t.accentText}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="24" cy="24" r="4" fill="${t.optimized}"/>
</g>`;
}

function write(name, make) {
  for (const [mode, t] of Object.entries(THEMES))
    writeFileSync(join(out, `${name}-${mode}.svg`), make(t));
}

// ------------------------------------------------------------------ banner
const hero = results.rows.find((r) => r.id === "photo-2mb");
write("banner", (t) => {
  const W = 880;
  const H = 300;
  const cx = 470;
  const card = (y, h, bg, border) =>
    `<rect x="${cx}" y="${y}" width="382" height="${h}" rx="10" fill="${bg}" stroke="${border}"/>`;
  const body = [
    logo(t, 40, 52, 44),
    text(
      98,
      84,
      "UploadRescue",
      `font-size="30" font-weight="800" fill="${t.text}" letter-spacing="-0.5"`,
    ),
    text(
      40,
      140,
      "Never lose an upload again.",
      `font-size="22" font-weight="650" fill="${t.text}"`,
    ),
    text(
      40,
      172,
      "Detect failed uploads, optimize files in the browser,",
      `font-size="14.5" fill="${t.muted}"`,
    ),
    text(
      40,
      194,
      "and retry your own upload function — automatically.",
      `font-size="14.5" fill="${t.muted}"`,
    ),
    ...["Apache 2.0", "No API key", "No backend", "No telemetry"].map((label, i) => {
      const x = [40, 134, 224, 316][i];
      const w = [86, 82, 84, 96][i];
      return `<rect x="${x}" y="226" width="${w}" height="26" rx="13" fill="none" stroke="${t.border}"/>${text(x + w / 2, 243.5, label, `font-size="11.5" fill="${t.muted}" text-anchor="middle"`)}`;
    }),
    // state 1
    card(28, 76, t.errorBg, t.errorBorder),
    text(
      cx + 18,
      54,
      "Your file is too large.",
      `font-size="14" font-weight="650" fill="${t.error}"`,
    ),
    text(cx + 18, 76, "Maximum allowed: 2 MB.", `font-size="12" fill="${t.muted}"`),
    text(cx + 18, 93, `Your file: ${mb(hero.inputBytes)}.`, `font-size="12" fill="${t.muted}"`),
    `<rect x="${cx + 230}" y="44" width="134" height="26" rx="6" fill="${t.accent}"/>`,
    text(
      cx + 297,
      61,
      "Compress & Retry",
      `font-size="12" font-weight="600" fill="${t.accentText}" text-anchor="middle"`,
    ),
    // state 2
    card(116, 62, t.bg, t.border),
    text(
      cx + 18,
      141,
      "Optimizing your file…",
      `font-size="14" font-weight="650" fill="${t.text}"`,
    ),
    `<rect x="${cx + 18}" y="155" width="346" height="6" rx="3" fill="${t.track}"/>`,
    `<rect x="${cx + 18}" y="155" width="220" height="6" rx="3" fill="${t.accent}"/>`,
    // state 3
    card(190, 82, t.successBg, t.successBorder),
    text(
      cx + 18,
      215,
      "Upload completed successfully.",
      `font-size="14" font-weight="650" fill="${t.optimizedText}"`,
    ),
    text(cx + 18, 240, `Original ${mb(hero.inputBytes)}`, `font-size="12" fill="${t.muted}"`),
    text(cx + 140, 240, `Optimized ${mb(hero.outputBytes)}`, `font-size="12" fill="${t.muted}"`),
    text(
      cx + 268,
      240,
      `Reduction ${pct(hero.inputBytes, hero.outputBytes).slice(1)}`,
      `font-size="12" font-weight="650" fill="${t.optimizedText}"`,
    ),
    text(
      cx + 18,
      260,
      "Measured: 12 MP JPEG → 2 MB limit, Chromium",
      `font-size="10" fill="${t.muted}"`,
    ),
  ].join("\n");
  return svg(W, H, t, body, "UploadRescue — Never lose an upload again");
});

// ------------------------------------------------------------------ flow
write("flow", (t) => {
  const steps = [
    ["1", "Detect", ["413 · S3 EntityTooLarge", "network · timeout · custom"]],
    ["2", "Explain", ["“Maximum allowed: 2 MB.", "Your file: 8.4 MB.”"]],
    ["3", "Optimize", ["in the browser (Worker)", "validated against limits"]],
    ["4", "Retry", ["your upload function,", "fresh context & signed URL"]],
  ];
  const parts = [
    header(
      t,
      "How a failed upload is rescued",
      "Bounded, cancellable, and the original file is never modified",
    ),
  ];
  steps.forEach(([n, title, lines], i) => {
    const x = 28 + i * 212;
    parts.push(
      `<rect x="${x}" y="90" width="186" height="112" rx="10" fill="${t.node}" stroke="${t.border}"/>`,
    );
    parts.push(
      `<circle cx="${x + 26}" cy="118" r="12" fill="${i === 3 ? t.optimized : t.accent}"/>`,
    );
    parts.push(
      text(
        x + 26,
        122.5,
        n,
        `font-size="12" font-weight="700" fill="${t.accentText}" text-anchor="middle"`,
      ),
    );
    parts.push(text(x + 46, 123, title, `font-size="16" font-weight="700" fill="${t.text}"`));
    lines.forEach((l, j) =>
      parts.push(text(x + 16, 158 + j * 20, l, `font-size="12" fill="${t.muted}"`)),
    );
    if (i < 3) {
      parts.push(
        `<path d="M${x + 190} 146 h18 m-6 -6 l6 6 l-6 6" fill="none" stroke="${t.muted}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    }
  });
  parts.push(
    `<rect x="28" y="222" width="824" height="40" rx="10" fill="none" stroke="${t.border}" stroke-dasharray="4 4"/>`,
  );
  parts.push(
    text(
      48,
      247,
      "Never retried automatically:  401/403 auth  ·  415 type  ·  429 rate limit  ·  5xx server  →  a clear, final error message",
      `font-size="12.5" fill="${t.muted}"`,
    ),
  );
  return svg(880, 284, t, parts.join("\n"), "Recovery flow: Detect, Explain, Optimize, Retry");
});

// ------------------------------------------------------------------ architecture
write("architecture", (t) => {
  const box = (x, y, w, h, label, sub, strong = false, dashed = false) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="${t.node}" stroke="${strong ? t.text : t.border}" stroke-width="${strong ? 1.6 : 1}"${dashed ? ' stroke-dasharray="5 4"' : ""}/>` +
    text(
      x + w / 2,
      y + (sub ? 24 : 28),
      label,
      `${MONO} font-size="12.5" font-weight="600" fill="${t.text}" text-anchor="middle"`,
    ).replace(FONT, "") +
    (sub
      ? text(x + w / 2, y + 42, sub, `font-size="11" fill="${t.muted}" text-anchor="middle"`)
      : "");
  const arrow = (y) =>
    `<path d="M440 ${y} v14 m-5 -5 l5 5 l5 -5" fill="none" stroke="${t.muted}" stroke-width="1.5" stroke-linecap="round"/>`;
  const parts = [
    header(
      t,
      "Architecture",
      "A dependency-free core; heavy engines are optional and loaded on demand",
    ),
    box(28, 84, 268, 52, "@uploadrescue/react", "component + hooks"),
    box(306, 84, 268, 52, "@uploadrescue/vanilla", "attach() · drag & drop"),
    box(584, 84, 268, 52, "your own UI", "getRecoveryView(state)", false, true),
    arrow(140),
    box(28, 158, 824, 46, "@uploadrescue/ui", "one view model · DOM renderer · accessible CSS"),
    arrow(208),
    box(
      28,
      226,
      824,
      52,
      "@uploadrescue/core",
      "detection · classification · state machine · engine orchestration · output validation",
      true,
    ),
    arrow(282),
  ];
  const engines = ["image", "pdf", "document", "archive", "media"];
  engines.forEach((e, i) =>
    parts.push(box(28 + i * 118, 300, 108, 46, `${e}`, "engine", false, true)),
  );
  parts.push(
    box(622, 300, 230, 46, "upload-adapters", "fetch · XHR · S3 · Supabase · …", false, true),
  );
  parts.push(
    text(
      28,
      374,
      "Dashed = optional package. Engines load lazily; the upload goes only where your function sends it.",
      `font-size="11.5" fill="${t.muted}"`,
    ),
  );
  return svg(880, 392, t, parts.join("\n"), "UploadRescue architecture");
});

// ------------------------------------------------------------------ charts
const rows = results.rows;
const subtitle = `Measured in ${results.browser} on ${results.date} · median of 3 runs · generated inputs (see benchmarks/)`;

write("chart-size", (t) => {
  const parts = [header(t, "How much smaller files get", subtitle)];
  const barW = 470;
  rows.forEach((r, i) => {
    const y = 96 + i * 54;
    const ratio = r.outputBytes / r.inputBytes;
    parts.push(text(28, y, r.label, `font-size="13" font-weight="600" fill="${t.text}"`));
    parts.push(
      `<rect x="28" y="${y + 9}" width="${barW}" height="14" rx="4" fill="${t.original}" opacity="0.45"/>`,
    );
    parts.push(
      `<rect x="28" y="${y + 9}" width="${Math.max(3, barW * ratio)}" height="14" rx="4" fill="${t.optimized}"/>`,
    );
    parts.push(
      text(
        520,
        y + 21,
        `${mb(r.inputBytes)} → ${mb(r.outputBytes)}`,
        `font-size="13" fill="${t.muted}"`,
      ),
    );
    parts.push(
      text(
        852,
        y + 21,
        pct(r.inputBytes, r.outputBytes),
        `font-size="15" font-weight="700" fill="${t.optimizedText}" text-anchor="end"`,
      ),
    );
  });
  const y = 96 + rows.length * 54;
  parts.push(
    `<rect x="28" y="${y - 6}" width="12" height="12" rx="3" fill="${t.original}" opacity="0.45"/>${text(46, y + 4, "original size", `font-size="12" fill="${t.muted}"`)}`,
  );
  parts.push(
    `<rect x="140" y="${y - 6}" width="12" height="12" rx="3" fill="${t.optimized}"/>${text(158, y + 4, "after UploadRescue", `font-size="12" fill="${t.muted}"`)}`,
  );
  return svg(880, y + 26, t, parts.join("\n"), "File size before and after optimization");
});

write("chart-upload-time", (t) => {
  const MBIT = 10;
  const parts = [
    header(
      t,
      `Upload time on a ${MBIT} Mbit/s connection`,
      `Calculated from the measured sizes: bytes × 8 ÷ ${MBIT},000,000 (excludes latency and protocol overhead)`,
    ),
  ];
  const max = Math.max(...rows.map((r) => secs(r.inputBytes, MBIT)));
  const scale = 520 / max;
  rows.forEach((r, i) => {
    const y = 96 + i * 62;
    const a = secs(r.inputBytes, MBIT);
    const b = secs(r.outputBytes, MBIT);
    parts.push(text(28, y, r.label, `font-size="13" font-weight="600" fill="${t.text}"`));
    parts.push(
      `<rect x="28" y="${y + 8}" width="${Math.max(3, a * scale)}" height="12" rx="3" fill="${t.original}"/>`,
    );
    parts.push(
      text(34 + a * scale, y + 18.5, `${a.toFixed(1)} s`, `font-size="12" fill="${t.muted}"`),
    );
    parts.push(
      `<rect x="28" y="${y + 24}" width="${Math.max(3, b * scale)}" height="12" rx="3" fill="${t.optimized}"/>`,
    );
    parts.push(
      text(
        34 + b * scale,
        y + 34.5,
        `${b.toFixed(1)} s`,
        `font-size="12" font-weight="650" fill="${t.optimizedText}"`,
      ),
    );
    parts.push(
      text(
        852,
        y + 28,
        `${(a / b).toFixed(1)}× faster`,
        `font-size="14" font-weight="700" fill="${t.optimizedText}" text-anchor="end"`,
      ),
    );
  });
  const y = 96 + rows.length * 62;
  parts.push(
    `<rect x="28" y="${y - 6}" width="12" height="12" rx="3" fill="${t.original}"/>${text(46, y + 4, "original file", `font-size="12" fill="${t.muted}"`)}`,
  );
  parts.push(
    `<rect x="140" y="${y - 6}" width="12" height="12" rx="3" fill="${t.optimized}"/>${text(158, y + 4, "optimized file", `font-size="12" fill="${t.muted}"`)}`,
  );
  return svg(880, y + 26, t, parts.join("\n"), "Upload time before and after optimization");
});

write("chart-processing", (t) => {
  const parts = [header(t, "Time spent optimizing in the browser", subtitle)];
  const max = Math.max(...rows.map((r) => r.medianMs));
  const scale = 560 / max;
  rows.forEach((r, i) => {
    const y = 96 + i * 46;
    parts.push(text(28, y, r.label, `font-size="13" font-weight="600" fill="${t.text}"`));
    parts.push(
      `<rect x="28" y="${y + 8}" width="${Math.max(3, r.medianMs * scale)}" height="14" rx="4" fill="${t.accent}" opacity="0.85"/>`,
    );
    parts.push(
      text(
        36 + r.medianMs * scale,
        y + 20,
        `${r.medianMs.toLocaleString("en-US")} ms`,
        `font-size="12.5" font-weight="600" fill="${t.text}"`,
      ),
    );
  });
  const y = 96 + rows.length * 46;
  parts.push(
    text(
      28,
      y + 4,
      "Images run in a Web Worker (OffscreenCanvas); documents re-encode their embedded images the same way.",
      `font-size="12" fill="${t.muted}"`,
    ),
  );
  return svg(880, y + 24, t, parts.join("\n"), "Optimization time per file type");
});

write("chart-bundle", (t) => {
  const parts = [
    header(
      t,
      "What it adds to your bundle",
      `Measured with esbuild, minified + gzip, on ${bundle.date} · peer dependencies (React) excluded`,
    ),
  ];
  const scenarios = bundle.scenarios;
  const max = Math.max(...scenarios.map((s) => s.initialBytes + s.lazyBytes));
  const scale = 520 / max;
  scenarios.forEach((s, i) => {
    const y = 98 + i * 52;
    parts.push(text(28, y, s.label, `font-size="13" font-weight="600" fill="${t.text}"`));
    parts.push(
      `<rect x="28" y="${y + 9}" width="${s.initialBytes * scale}" height="16" rx="4" fill="${t.accent}"/>`,
    );
    if (s.lazyBytes)
      parts.push(
        `<rect x="${30 + s.initialBytes * scale}" y="${y + 9}" width="${s.lazyBytes * scale}" height="16" rx="4" fill="${t.lazy}"/>`,
      );
    const label = s.lazyBytes
      ? `${kb(s.initialBytes)} + ${kb(s.lazyBytes)} on first optimization`
      : kb(s.initialBytes);
    parts.push(
      text(
        40 + (s.initialBytes + s.lazyBytes) * scale,
        y + 22,
        label,
        `font-size="12.5" fill="${t.muted}"`,
      ),
    );
  });
  const pdf = bundle.packages.find((p) => p.name === "@uploadrescue/pdf-engine");
  const y = 98 + scenarios.length * 52;
  parts.push(
    `<rect x="28" y="${y - 6}" width="12" height="12" rx="3" fill="${t.accent}"/>${text(46, y + 4, "initial load", `font-size="12" fill="${t.muted}"`)}`,
  );
  parts.push(
    `<rect x="130" y="${y - 6}" width="12" height="12" rx="3" fill="${t.lazy}"/>${text(148, y + 4, "image engine, loaded only when a file needs optimizing", `font-size="12" fill="${t.muted}"`)}`,
  );
  if (pdf)
    parts.push(
      text(
        28,
        y + 26,
        `Optional engines are separate: pdf-lib (${kb(pdf.lazyBytes)}) loads only for PDFs; FFmpeg (~30 MB) only for media, from your server.`,
        `font-size="12" fill="${t.muted}"`,
      ),
    );
  return svg(880, y + 44, t, parts.join("\n"), "Bundle size added by UploadRescue");
});

console.log(`Wrote README assets to ${out}`);
