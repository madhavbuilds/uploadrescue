import { formatBytes } from "@uploadrescue/core";
import { UploadRescue } from "@uploadrescue/react";
import { useMemo } from "react";
import { CodeBlock, InstallCommand } from "../components/Code";
import { createSimulatedServer } from "../lib/simulated-server";
import { Link } from "../lib/router";
import { INSTALL_REACT, REPO_URL } from "../site";

const DEMO_LIMIT = 500 * 1024;

const INTEGRATION = `import { UploadRescue } from "@uploadrescue/react";
import "@uploadrescue/ui/styles.css";

export function AvatarUpload() {
  return (
    <UploadRescue
      maxSize={2 * 1024 * 1024}
      onUpload={uploadFile} // your existing upload function
      recovery={{
        enabled: true,
        showButton: true,
        autoRetry: true,
      }}
    />
  );
}`;

const STEPS = [
  {
    title: "Detect",
    body: "Client-side limits, HTTP 413, provider size errors, network failures and timeouts are classified into clear failure kinds.",
  },
  {
    title: "Explain",
    body: "Users see what went wrong with real numbers: “Maximum allowed: 2 MB. Your file: 8.4 MB.”",
  },
  {
    title: "Optimize",
    body: "Eligible files are compressed in the browser. Outputs are validated against your limits before anything is retried.",
  },
  {
    title: "Retry",
    body: "Your own upload function is called again with the optimized file and a fresh context. You keep your storage.",
  },
];

const CAPABILITIES = [
  [
    "Failure classification",
    "413s, S3 EntityTooLarge, Supabase and Cloudinary size errors, network errors, timeouts, plus your own classifier.",
  ],
  [
    "Recovery state machine",
    "Explicit transitions, bounded retries, de-duplicated recovery, cancellation, per-session history.",
  ],
  [
    "Local optimization",
    "Image, PDF, Office, ZIP and opt-in media engines. Lazy-loaded so the core stays small.",
  ],
  [
    "Your upload stack",
    "Plain upload functions plus optional fetch, XHR, S3, Supabase, Firebase and Cloudinary adapters.",
  ],
  [
    "Accessible widget",
    "React component and vanilla widget from one shared view model. Keyboard, screen reader and dark mode support.",
  ],
  [
    "Honest results",
    "Never reports success when the output is larger or still over the limit. Never retries auth or server errors.",
  ],
];

const CATEGORIES: Array<[string, string, string]> = [
  [
    "Images",
    "JPEG, PNG, WebP, AVIF*, GIF, SVG",
    "Quality search, resizing, format conversion when allowed, transparency and animation preserved, SVG sanitized",
  ],
  [
    "PDF",
    "PDF",
    "JPEG image re-encoding and structure rewrite. Encrypted and signed files are left untouched",
  ],
  [
    "Office",
    "DOCX, XLSX, PPTX",
    "Embedded image re-encoding and package re-deflation; XML, formulas and macros unchanged",
  ],
  ["Archives", "ZIP", "Lossless repacking with zip-bomb and path-traversal protection"],
  [
    "Media (opt-in)",
    "MP4, MOV, MP3, WAV",
    "FFmpeg WebAssembly from your own server; bitrate targeting",
  ],
  ["Anything else", "Any type", "Validation and retry only — no speculative transformations"],
];

const FAQ: Array<[string, string]> = [
  [
    "Does UploadRescue upload my users' files anywhere?",
    "No. It never makes network requests of its own. Files go only where your upload function sends them. There is no telemetry.",
  ],
  [
    "Do I need an API key or a backend?",
    "No. Install the package and pass the upload function you already have.",
  ],
  [
    "How does it know my server rejected a file for being too large?",
    "Your upload function throws (ideally an UploadHttpError, which the adapters do for you). A 413, a configured status, a known provider message, or your own classifyError marks the failure as size-related.",
  ],
  [
    "Is compression guaranteed?",
    "No. Many files can be reduced substantially, but some cannot. When the output is not small enough, UploadRescue shows the real result and offers alternatives instead of claiming success.",
  ],
  [
    "Does compressing a file make it safe?",
    "No. Re-encoding is not malware scanning. Validate and scan uploads on your server.",
  ],
  [
    "Which frameworks are supported?",
    "React (18 and 19, including Next.js App Router) and plain JavaScript. The core is framework-independent, so other frameworks can use it directly.",
  ],
];

export function Home({ theme }: { theme: "light" | "dark" }) {
  const upload = useMemo(() => createSimulatedServer({ limit: DEMO_LIMIT }), []);
  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <p className="eyebrow">Open-source upload recovery SDK</p>
            <h1>Failed uploads? Let us rescue them.</h1>
            <p className="lead">
              Detect upload failures, optimize files and retry uploads through one
              developer-friendly SDK.
            </p>
            <div className="cta-row">
              <Link href="/docs/quick-start" className="button button-primary">
                Get started
              </Link>
              <a href={REPO_URL} className="button" target="_blank" rel="noreferrer">
                View GitHub
              </a>
            </div>
            <InstallCommand command={INSTALL_REACT} />
            <p className="fineprint">Apache 2.0 · No API key · No backend · No telemetry</p>
          </div>
          <div className="demo-card">
            <div className="demo-head">
              <strong>Try it</strong>
              <span className="badge">Simulated server</span>
            </div>
            <p className="muted small">
              This server rejects files over {formatBytes(DEMO_LIMIT)} with HTTP 413. It runs inside
              this page — nothing is uploaded. Drop a large JPEG or PNG to see the real image engine
              recover it.
            </p>
            <UploadRescue
              upload={upload}
              acceptedTypes={["image/*"]}
              theme={theme}
              label="Demo upload"
            />
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="how">
        <div className="container">
          <h2 id="how">How it works</h2>
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="step-n">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section alt" aria-labelledby="caps">
        <div className="container">
          <h2 id="caps">Core capabilities</h2>
          <div className="grid-3">
            {CAPABILITIES.map(([title, body]) => (
              <div className="card" key={title}>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="types">
        <div className="container">
          <h2 id="types">Supported file categories</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Formats</th>
                  <th scope="col">What happens</th>
                </tr>
              </thead>
              <tbody>
                {CATEGORIES.map(([c, f, w]) => (
                  <tr key={c}>
                    <th scope="row">{c}</th>
                    <td>{f}</td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            * AVIF output depends on browser encoder support. See{" "}
            <Link href="/docs/browser-compatibility">browser compatibility</Link>.
          </p>
        </div>
      </section>

      <section className="section alt" aria-labelledby="integrate">
        <div className="container split">
          <div>
            <h2 id="integrate">Integration example</h2>
            <p>
              Wrap the upload function you already have. When a file is rejected, users get an
              explanation and a <strong>Compress &amp; Retry Upload</strong> button — or, with{" "}
              <code>autoRetry</code>, recovery happens on its own.
            </p>
            <p>
              Prefer plain JavaScript?{" "}
              <code>createUploadRescue(&#123; maxSize, upload &#125;).attach("#upload-input")</code>
              .
            </p>
            <Link href="/docs/react">React guide →</Link>
          </div>
          <CodeBlock code={INTEGRATION} title="AvatarUpload.tsx" />
        </div>
      </section>

      <section className="section" aria-labelledby="privacy">
        <div className="container split">
          <div>
            <h2 id="privacy">Privacy and security</h2>
            <ul className="checks">
              <li>Files are processed in the browser and never sent anywhere by UploadRescue.</li>
              <li>File types are checked by content, not just by extension.</li>
              <li>
                SVGs are sanitized; ZIP and Office files are read with bomb and traversal
                protection.
              </li>
              <li>Encrypted and signed documents are not modified unless you opt in.</li>
              <li>Work runs in Web Workers where possible and is always cancellable.</li>
            </ul>
            <Link href="/security">Read the security model →</Link>
          </div>
          <div className="card">
            <h3>What it does not claim</h3>
            <p>
              Compressing a file does not make it safe. UploadRescue is not a malware scanner or
              access control. Keep validating uploads on your server.
            </p>
          </div>
        </div>
      </section>

      <section className="section alt" aria-labelledby="arch">
        <div className="container">
          <h2 id="arch">Architecture</h2>
          <div className="arch">
            <div className="arch-row">
              <span className="arch-box">@uploadrescue/react</span>
              <span className="arch-box">@uploadrescue/vanilla</span>
            </div>
            <div className="arch-row">
              <span className="arch-box">@uploadrescue/ui — shared view model &amp; styles</span>
            </div>
            <div className="arch-row">
              <span className="arch-box arch-core">
                @uploadrescue/core — detection · classification · state machine · engine registry
              </span>
            </div>
            <div className="arch-row">
              {["image", "pdf", "document", "archive", "media"].map((e) => (
                <span className="arch-box arch-engine" key={e}>
                  {e}-engine
                </span>
              ))}
              <span className="arch-box arch-engine">upload-adapters</span>
            </div>
          </div>
          <Link href="/architecture">Architecture details →</Link>
        </div>
      </section>

      <section className="section" aria-labelledby="frameworks">
        <div className="container grid-3">
          <div>
            <h2 id="frameworks">Framework support</h2>
            <p>
              React 18/19 with hooks, Strict Mode and SSR. Plain JavaScript with inputs, drag and
              drop and events. A framework-free core for everything else.
            </p>
          </div>
          <div className="card">
            <h3>Quick installation</h3>
            <InstallCommand command="pnpm add @uploadrescue/react" />
            <InstallCommand command="pnpm add @uploadrescue/vanilla" />
          </div>
          <div className="card">
            <h3>Add engines when you need them</h3>
            <InstallCommand command="pnpm add @uploadrescue/pdf-engine" />
            <InstallCommand command="pnpm add @uploadrescue/document-engine" />
          </div>
        </div>
      </section>

      <section className="section alt" aria-labelledby="faq">
        <div className="container narrow">
          <h2 id="faq">FAQ</h2>
          {FAQ.map(([q, a]) => (
            <details key={q} className="faq">
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="section final-cta">
        <div className="container narrow center">
          <h2>Never lose an upload again.</h2>
          <p className="lead">Add recovery to your existing upload flow in a few minutes.</p>
          <div className="cta-row center">
            <Link href="/docs/quick-start" className="button button-primary">
              Get started
            </Link>
            <Link href="/playground" className="button">
              Open the playground
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
