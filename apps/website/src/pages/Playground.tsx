import { createArchiveEngine } from "@uploadrescue/archive-engine";
import {
  formatBytes,
  formatPercent,
  type OptimizationEngine,
  type RecoveryStatus,
} from "@uploadrescue/core";
import { createDocumentEngine } from "@uploadrescue/document-engine";
import { createImageEngine } from "@uploadrescue/image-engine";
import { createMediaEngine } from "@uploadrescue/media-engine";
import { createPdfEngine } from "@uploadrescue/pdf-engine";
import { UploadRescue, useUploadRescue } from "@uploadrescue/react";
import { downloadFile } from "@uploadrescue/ui";
import { useEffect, useId, useMemo, useState } from "react";
import { CodeBlock } from "../components/Code";
import { createSimulatedServer } from "../lib/simulated-server";

const MB = 1024 * 1024;

const TYPE_GROUPS = [
  { id: "images", label: "Images", patterns: ["image/*"] },
  { id: "pdf", label: "PDF", patterns: ["application/pdf"] },
  { id: "office", label: "Office (DOCX, XLSX, PPTX)", patterns: [".docx", ".xlsx", ".pptx"] },
  { id: "zip", label: "ZIP", patterns: [".zip"] },
  { id: "video", label: "Video (MP4, MOV)", patterns: ["video/mp4", "video/quicktime"] },
  { id: "audio", label: "Audio (MP3, WAV)", patterns: ["audio/mpeg", "audio/wav"] },
] as const;

const ENGINE_IDS = ["image", "pdf", "document", "archive", "media"] as const;
type EngineId = (typeof ENGINE_IDS)[number];

const FFMPEG = { coreURL: "/ffmpeg/ffmpeg-core.js", wasmURL: "/ffmpeg/ffmpeg-core.wasm" };

interface PlaygroundConfig {
  clientLimit: boolean;
  maxSizeMb: number;
  types: string[];
  quality: number;
  preserveFormat: boolean;
  autoRetry: boolean;
  optimizationAttempts: number;
  simulate413: boolean;
  serverLimitMb: number;
  announceLimit: boolean;
  engines: EngineId[];
}

const INITIAL: PlaygroundConfig = {
  clientLimit: true,
  maxSizeMb: 1,
  types: [],
  quality: 0.82,
  preserveFormat: true,
  autoRetry: false,
  optimizationAttempts: 2,
  simulate413: false,
  serverLimitMb: 0.5,
  announceLimit: false,
  engines: ["image", "pdf", "document", "archive"],
};

function buildEngine(id: EngineId): OptimizationEngine {
  switch (id) {
    case "image":
      return createImageEngine();
    case "pdf":
      return createPdfEngine();
    case "document":
      return createDocumentEngine();
    case "archive":
      return createArchiveEngine();
    case "media":
      return createMediaEngine(FFMPEG);
  }
}

function generateCode(c: PlaygroundConfig, framework: "react" | "vanilla"): string {
  const pkg: Record<EngineId, [string, string]> = {
    image: ["@uploadrescue/image-engine", "createImageEngine()"],
    pdf: ["@uploadrescue/pdf-engine", "createPdfEngine()"],
    document: ["@uploadrescue/document-engine", "createDocumentEngine()"],
    archive: ["@uploadrescue/archive-engine", "createArchiveEngine()"],
    media: [
      "@uploadrescue/media-engine",
      'createMediaEngine({ coreURL: "/ffmpeg/ffmpeg-core.js", wasmURL: "/ffmpeg/ffmpeg-core.wasm" })',
    ],
  };
  const imports = c.engines.map(
    (e) => `import { ${pkg[e][1].split("(")[0]} } from "${pkg[e][0]}";`,
  );
  const accepted = TYPE_GROUPS.filter((g) => c.types.includes(g.id)).flatMap((g) => g.patterns);
  const bytes = Math.round(c.maxSizeMb * MB);
  const lines = [
    ...(c.clientLimit ? [`maxSize: ${bytes}, // ${formatBytes(bytes)}`] : []),
    ...(accepted.length ? [`acceptedTypes: ${JSON.stringify(accepted)},`] : []),
    `engines: [${c.engines.map((e) => pkg[e][1]).join(", ")}],`,
    `optimization: { quality: ${c.quality}, preserveFormat: ${c.preserveFormat}, maxAttempts: ${c.optimizationAttempts} },`,
    `recovery: { enabled: true, showButton: true, autoRetry: ${c.autoRetry} },`,
  ];
  if (framework === "react") {
    const props = lines.map((l) => {
      const [key, ...rest] = l.split(": ");
      const value = rest.join(": ").replace(/,(\s*\/\/.*)?$/, "");
      const comment = /\/\/.*$/.exec(l)?.[0];
      return `      ${key}={${value}${comment ? ` /* ${comment.slice(3)} */` : ""}}`;
    });
    return [
      'import { UploadRescue } from "@uploadrescue/react";',
      'import { createXhrUpload } from "@uploadrescue/upload-adapters";',
      ...imports,
      'import "@uploadrescue/ui/styles.css";',
      "",
      "// Replace with your endpoint. Non-2xx responses (e.g. 413) become typed errors.",
      'const uploadFile = createXhrUpload({ url: "/api/upload" });',
      "",
      "export function Uploader() {",
      "  return (",
      "    <UploadRescue",
      "      onUpload={uploadFile}",
      ...props,
      "    />",
      "  );",
      "}",
    ].join("\n");
  }
  return [
    'import { createUploadRescue } from "@uploadrescue/vanilla";',
    'import { createXhrUpload } from "@uploadrescue/upload-adapters";',
    ...imports,
    'import "@uploadrescue/ui/styles.css";',
    "",
    "const rescue = createUploadRescue({",
    '  upload: createXhrUpload({ url: "/api/upload" }),',
    ...lines.map((l) => `  ${l}`),
    "});",
    "",
    'rescue.attach("#upload-input");',
  ].join("\n");
}

export function Playground({ theme }: { theme: "light" | "dark" }) {
  const [config, setConfig] = useState<PlaygroundConfig>(INITIAL);
  const [mediaAvailable, setMediaAvailable] = useState<boolean | null>(null);
  const [framework, setFramework] = useState<"react" | "vanilla">("react");
  const [log, setLog] = useState<Array<{ t: number; status: RecoveryStatus; detail?: string }>>([]);
  const id = useId();
  const set = <K extends keyof PlaygroundConfig>(key: K, value: PlaygroundConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));

  useEffect(() => {
    // Same-origin check for the self-hosted FFmpeg core.
    fetch(FFMPEG.wasmURL, { method: "HEAD" })
      .then((r) => setMediaAvailable(r.ok))
      .catch(() => setMediaAvailable(false));
  }, []);

  const engineKey = config.engines.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const engines = useMemo(() => config.engines.map(buildEngine), [engineKey]);
  const upload = useMemo(
    () =>
      createSimulatedServer({
        limit: config.simulate413 ? Math.round(config.serverLimitMb * MB) : null,
        announceLimit: config.announceLimit,
      }),
    [config.simulate413, config.serverLimitMb, config.announceLimit],
  );
  const acceptedTypes = TYPE_GROUPS.filter((g) => config.types.includes(g.id)).flatMap((g) => [
    ...g.patterns,
  ]);

  const api = useUploadRescue({
    upload,
    engines,
    ...(config.clientLimit ? { maxSize: Math.round(config.maxSizeMb * MB) } : {}),
    ...(acceptedTypes.length ? { acceptedTypes } : {}),
    optimization: {
      quality: config.quality,
      preserveFormat: config.preserveFormat,
      maxAttempts: config.optimizationAttempts,
    },
    recovery: { enabled: true, showButton: true, autoRetry: config.autoRetry },
  });
  const { state, controller } = api;

  useEffect(
    () =>
      controller.subscribe((s) =>
        setLog((entries) => {
          const last = entries[entries.length - 1];
          if (last?.status === s.status) return entries;
          const detail =
            s.status === "upload-failed"
              ? `${s.failure?.kind}${s.failure?.status ? ` (HTTP ${s.failure.status}${s.failure.source === "http" ? ", simulated" : ""})` : ""}`
              : s.status === "optimization-failed"
                ? s.optimizationFailure?.reason
                : undefined;
          const next = s.status === "file-selected" ? [] : entries;
          return [
            ...next,
            { t: Date.now(), status: s.status, ...(detail ? { detail } : {}) },
          ].slice(-40);
        }),
      ),
    [controller],
  );

  const r = state.optimization;
  const info = state.fileInfo;
  const code = generateCode(config, framework);
  const start = log[0]?.t ?? 0;

  return (
    <div className="container page playground">
      <header className="pg-header">
        <h1>Playground</h1>
        <p className="lead">
          Configure UploadRescue and try it with your own files. Optimization runs locally in your
          browser; the “server” is simulated inside this page.{" "}
          <strong>No file is uploaded anywhere.</strong>
        </p>
      </header>

      <div className="pg-grid">
        <form className="pg-panel" onSubmit={(e) => e.preventDefault()} aria-label="Configuration">
          <fieldset>
            <legend>Client-side validation</legend>
            <label className="check">
              <input
                type="checkbox"
                checked={config.clientLimit}
                onChange={(e) => set("clientLimit", e.target.checked)}
              />
              Enforce maximum size
            </label>
            <label>
              Maximum size (MB)
              <input
                type="number"
                min={0.01}
                step={0.05}
                value={config.maxSizeMb}
                disabled={!config.clientLimit}
                onChange={(e) => set("maxSizeMb", Math.max(0.01, Number(e.target.value) || 0.01))}
              />
            </label>
            <p className="field-label">
              Accepted formats <span className="muted">(none = any)</span>
            </p>
            {TYPE_GROUPS.map((g) => (
              <label className="check" key={g.id}>
                <input
                  type="checkbox"
                  checked={config.types.includes(g.id)}
                  onChange={(e) =>
                    set(
                      "types",
                      e.target.checked
                        ? [...config.types, g.id]
                        : config.types.filter((t) => t !== g.id),
                    )
                  }
                />
                {g.label}
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend>Optimization</legend>
            <label htmlFor={`${id}-q`} className="check">
              Quality: <strong>{Math.round(config.quality * 100)}</strong>
            </label>
            <input
              id={`${id}-q`}
              type="range"
              min={0.3}
              max={0.95}
              step={0.01}
              value={config.quality}
              onChange={(e) => set("quality", Number(e.target.value))}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={config.preserveFormat}
                onChange={(e) => set("preserveFormat", e.target.checked)}
              />
              Preserve original format
            </label>
            <label>
              Optimization attempts
              <select
                value={config.optimizationAttempts}
                onChange={(e) => set("optimizationAttempts", Number(e.target.value))}
              >
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <p className="field-label">Engines</p>
            {ENGINE_IDS.map((e) => (
              <label className="check" key={e}>
                <input
                  type="checkbox"
                  checked={config.engines.includes(e)}
                  disabled={e === "media" && !mediaAvailable}
                  onChange={(ev) =>
                    set(
                      "engines",
                      ev.target.checked
                        ? [...config.engines, e]
                        : config.engines.filter((x) => x !== e),
                    )
                  }
                />
                {e}
                {e === "media" ? (
                  <span className="muted">
                    {" "}
                    {mediaAvailable === false
                      ? "(FFmpeg core not available)"
                      : "(~30 MB, loads on first use)"}
                  </span>
                ) : null}
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend>Recovery</legend>
            <label className="check">
              <input
                type="checkbox"
                checked={config.autoRetry}
                onChange={(e) => set("autoRetry", e.target.checked)}
              />
              Automatic retry
            </label>
          </fieldset>

          <fieldset className="simulated">
            <legend>
              Simulated server <span className="badge">Simulation</span>
            </legend>
            <label className="check">
              <input
                type="checkbox"
                checked={config.simulate413}
                onChange={(e) => set("simulate413", e.target.checked)}
              />
              Reject large files with HTTP 413
            </label>
            <label>
              Server limit (MB)
              <input
                type="number"
                min={0.01}
                step={0.05}
                value={config.serverLimitMb}
                disabled={!config.simulate413}
                onChange={(e) =>
                  set("serverLimitMb", Math.max(0.01, Number(e.target.value) || 0.01))
                }
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={config.announceLimit}
                disabled={!config.simulate413}
                onChange={(e) => set("announceLimit", e.target.checked)}
              />
              Announce limit (<code>X-Upload-Max-Size</code>)
            </label>
            <p className="muted small">
              Runs in this page. Uploads are never sent to a real server.
            </p>
          </fieldset>
        </form>

        <section className="pg-main" aria-label="Recovery widget">
          <UploadRescue controller={controller} theme={theme} label="Playground upload" />

          <div className="pg-inspector">
            <h2>Inspector</h2>
            {info ? (
              <dl className="kv">
                <dt>File</dt>
                <dd>{info.name}</dd>
                <dt>Size</dt>
                <dd>
                  {formatBytes(info.size)} ({info.size.toLocaleString()} bytes)
                </dd>
                <dt>Detected type</dt>
                <dd>
                  {info.detected.mime} <span className="muted">via {info.detected.source}</span>
                  {info.typeMismatch ? (
                    <span className="badge warn">extension mismatch</span>
                  ) : null}
                </dd>
                <dt>Status</dt>
                <dd>
                  <code>{state.status}</code>
                </dd>
                {state.failure ? (
                  <>
                    <dt>Failure</dt>
                    <dd>
                      <code>{state.failure.kind}</code> from {state.failure.source}
                      {state.failure.status ? ` · HTTP ${state.failure.status}` : ""}
                      {state.failure.source === "http" ? (
                        <span className="badge">simulated</span>
                      ) : null}
                    </dd>
                  </>
                ) : null}
                {state.maxSize !== null ? (
                  <>
                    <dt>Effective limit</dt>
                    <dd>{formatBytes(state.maxSize)}</dd>
                  </>
                ) : null}
              </dl>
            ) : (
              <p className="muted">Select a file to inspect it.</p>
            )}

            {r ? (
              <div className="result">
                <h3>Optimization result</h3>
                <dl className="kv">
                  <dt>Engine</dt>
                  <dd>{r.engine}</dd>
                  <dt>Original</dt>
                  <dd>{formatBytes(r.originalSize)}</dd>
                  <dt>Optimized</dt>
                  <dd>
                    {formatBytes(r.outputSize)} {r.changed ? `(${r.outputType})` : "(no reduction)"}
                  </dd>
                  <dt>Reduction</dt>
                  <dd>{formatPercent(r.reduction)}</dd>
                  <dt>Processing time</dt>
                  <dd>{r.durationMs.toLocaleString()} ms</dd>
                  {r.targetSize !== undefined ? (
                    <>
                      <dt>Target</dt>
                      <dd>
                        {formatBytes(r.targetSize)} {r.withinTarget ? "✓ reached" : "✗ not reached"}
                      </dd>
                    </>
                  ) : null}
                </dl>
                {r.notes.length ? (
                  <ul className="notes">
                    {r.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                ) : null}
                {r.changed ? (
                  <button type="button" className="button" onClick={() => downloadFile(r.file)}>
                    Download optimized file
                  </button>
                ) : null}
              </div>
            ) : null}

            {log.length ? (
              <>
                <h3>Event log</h3>
                <ol className="log">
                  {log.map((e, i) => (
                    <li key={`${e.t}-${i}`}>
                      <span className="muted">+{e.t - start} ms</span> <code>{e.status}</code>{" "}
                      {e.detail ? <span className="muted">{e.detail}</span> : null}
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
          </div>
        </section>
      </div>

      <section className="pg-code" aria-label="Generated code">
        <div className="tabs" role="tablist" aria-label="Framework">
          {(["react", "vanilla"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={framework === f}
              onClick={() => setFramework(f)}
            >
              {f === "react" ? "React" : "Vanilla JS"}
            </button>
          ))}
        </div>
        <CodeBlock
          code={code}
          lang={framework === "react" ? "tsx" : "ts"}
          title="Generated configuration"
        />
      </section>
    </div>
  );
}
