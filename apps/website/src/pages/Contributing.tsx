import { CodeBlock } from "../components/Code";
import { REPO_URL } from "../site";

const SETUP = `git clone ${REPO_URL}.git
cd uploadrescue
corepack enable
pnpm install
pnpm build        # build all packages
pnpm test         # unit, integration and security tests (Vitest)
pnpm test:e2e     # browser tests (Playwright: Chromium, Firefox, WebKit)
pnpm dev          # website + docs + playground on http://localhost:5173`;

export function Contributing() {
  return (
    <div className="container narrow page prose">
      <h1>GitHub &amp; contributing</h1>
      <p className="lead">
        UploadRescue is developed in the open. Issues, discussions and pull requests are welcome.
      </p>
      <p>
        Repository: <a href={REPO_URL}>{REPO_URL.replace("https://", "")}</a>
      </p>
      <h2>Local setup</h2>
      <CodeBlock code={SETUP} lang="bash" title="terminal" />
      <h2>Repository layout</h2>
      <ul>
        <li>
          <code>packages/</code> — published packages (core, react, vanilla, ui, upload-adapters and
          the engines).
        </li>
        <li>
          <code>apps/website</code> — this site, the docs renderer and the playground.
        </li>
        <li>
          <code>docs/</code> — documentation in Markdown; every TypeScript snippet is type-checked
          in CI.
        </li>
        <li>
          <code>examples/</code> — React (Vite), vanilla JS (Vite) and Next.js apps with a real
          size-limited endpoint.
        </li>
        <li>
          <code>tests/</code> — integration (real HTTP), security, docs and browser (Playwright)
          tests.
        </li>
      </ul>
      <h2>Pull requests</h2>
      <ul>
        <li>
          Add or update tests for behaviour changes; run <code>pnpm lint</code>,{" "}
          <code>pnpm typecheck</code> and <code>pnpm test</code>.
        </li>
        <li>
          Add a changeset (<code>pnpm changeset</code>) describing user-facing changes.
        </li>
        <li>Keep the core dependency-free and engines independently installable.</li>
        <li>Never add telemetry, network calls or claims that aren't measured.</li>
      </ul>
      <p>
        See <a href={`${REPO_URL}/blob/main/CONTRIBUTING.md`}>CONTRIBUTING.md</a> and the{" "}
        <a href={`${REPO_URL}/blob/main/CODE_OF_CONDUCT.md`}>Code of Conduct</a>.
      </p>
    </div>
  );
}
