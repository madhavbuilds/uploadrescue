import { Link } from "../lib/router";

const PACKAGES: Array<[string, string, string]> = [
  [
    "@uploadrescue/core",
    "none",
    "File detection (magic bytes), validation, failure classification, engine orchestration and output validation, the recovery state machine, typed errors.",
  ],
  [
    "@uploadrescue/ui",
    "core, image-engine (lazy)",
    "Pure view model (state → title, stats, actions), DOM renderer, accessible CSS, default lazy engines.",
  ],
  [
    "@uploadrescue/react",
    "core, ui · peer: react",
    "Component, hooks, controlled/uncontrolled modes, SSR-safe.",
  ],
  ["@uploadrescue/vanilla", "core, ui", "attach(), drag and drop, events, widget mounting."],
  [
    "@uploadrescue/upload-adapters",
    "core",
    "fetch, XHR, multipart, S3, Supabase, Firebase, Cloudinary — provider SDKs are typed structurally, not depended on.",
  ],
  [
    "@uploadrescue/image-engine",
    "core",
    "Raster pipeline in a Web Worker (OffscreenCanvas) with main-thread fallback, header parsing, SVG sanitizer.",
  ],
  [
    "@uploadrescue/pdf-engine",
    "core, image-engine, pdf-lib (lazy)",
    "Inspection, JPEG re-encoding, object-stream rewrite, page-count validation.",
  ],
  [
    "@uploadrescue/archive-engine",
    "core, fflate",
    "Bounded ZIP reader/writer, repacking, CRC verification.",
  ],
  [
    "@uploadrescue/document-engine",
    "core, archive-engine, image-engine",
    "OOXML validation and media re-encoding.",
  ],
  [
    "@uploadrescue/media-engine",
    "core · optional peer: @ffmpeg/ffmpeg",
    "FFmpeg job planning, lazy loading, cancellation.",
  ],
];

export function Architecture() {
  return (
    <div className="container page prose wide">
      <h1>Architecture</h1>
      <p className="lead">
        A small, dependency-free core; everything heavy lives in optional, lazily loaded packages.
      </p>

      <h2 id="layers">Layers</h2>
      <div className="arch">
        <div className="arch-row">
          <span className="arch-box">Your app</span>
        </div>
        <div className="arch-row">
          <span className="arch-box">@uploadrescue/react</span>
          <span className="arch-box">@uploadrescue/vanilla</span>
          <span className="arch-box">Your own UI</span>
        </div>
        <div className="arch-row">
          <span className="arch-box">
            @uploadrescue/ui — getRecoveryView() · DOM renderer · CSS tokens
          </span>
        </div>
        <div className="arch-row">
          <span className="arch-box arch-core">@uploadrescue/core — UploadRescueController</span>
        </div>
        <div className="arch-row">
          <span className="arch-box arch-engine">Engines (OptimizationEngine)</span>
          <span className="arch-box arch-engine">Your upload function / adapters</span>
        </div>
      </div>

      <h2 id="flow">Request flow</h2>
      <ol>
        <li>
          <code>select(file)</code> reads at most ~72 KB to detect the type from magic bytes and
          validates size and type.
        </li>
        <li>
          The developer's upload function runs with a fresh <code>UploadContext</code> (signal,
          attempt, idempotency key, progress callback).
        </li>
        <li>
          Any thrown value is classified into an <code>UploadFailure</code>. Only size-related,
          network and timeout failures can be recovered.
        </li>
        <li>
          The core picks an engine by content type, runs it with a target size, then validates the
          output: non-empty, matching magic bytes, smaller, within <code>maxSize</code> and{" "}
          <code>acceptedTypes</code>.
        </li>
        <li>
          The upload function is invoked again with the optimized file. Attempts are bounded; stale
          results are ignored.
        </li>
      </ol>
      <p>
        See <Link href="/docs/recovery-workflow">Recovery workflow</Link> for the full state
        diagram.
      </p>

      <h2 id="packages">Packages and dependencies</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Package</th>
              <th scope="col">Depends on</th>
              <th scope="col">Responsibility</th>
            </tr>
          </thead>
          <tbody>
            {PACKAGES.map(([name, deps, what]) => (
              <tr key={name}>
                <th scope="row">
                  <code>{name}</code>
                </th>
                <td>{deps}</td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        The dependency graph is acyclic; engines never depend on UI packages and the core depends on
        nothing.
      </p>

      <h2 id="decisions">Design decisions</h2>
      <ul>
        <li>
          <strong>One view model, two renderers.</strong> React and Vanilla call the same{" "}
          <code>getRecoveryView()</code>, so copy, numbers and actions are identical.
        </li>
        <li>
          <strong>Worker from a bundled string.</strong> The image worker is compiled into the
          package and started from a Blob URL, so it works with every bundler without configuration
          and falls back when CSP forbids it.
        </li>
        <li>
          <strong>Own ZIP reader.</strong> Limits are enforced on the central directory before
          decompression and inflation is chunked, which general-purpose unzip libraries don't
          guarantee.
        </li>
        <li>
          <strong>Adapters are structural.</strong> Supabase, Firebase and Cloudinary are not
          dependencies; you pass your client objects.
        </li>
        <li>
          <strong>Self-hosted FFmpeg.</strong> No third-party CDN requests happen unless you
          configure them.
        </li>
      </ul>
    </div>
  );
}
