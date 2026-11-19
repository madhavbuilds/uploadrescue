import { CodeBlock } from "../components/Code";
import { REPO_URL } from "../site";

const REACT = `import { UploadRescue } from "@uploadrescue/react";
import { createXhrUpload } from "@uploadrescue/upload-adapters";
import "@uploadrescue/ui/styles.css";

const upload = createXhrUpload({ url: "/api/upload" });

export function App() {
  return <UploadRescue onUpload={upload} acceptedTypes={["image/*"]} />;
}`;

const VANILLA = `import { createUploadRescue } from "@uploadrescue/vanilla";
import { createXhrUpload } from "@uploadrescue/upload-adapters";
import "@uploadrescue/ui/styles.css";

const rescue = createUploadRescue({
  upload: createXhrUpload({ url: "/api/upload" }),
});
rescue.attach("#upload-input");`;

const NEXT = `// app/api/upload/route.ts — enforces a 1 MB limit with HTTP 413
export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
  if (file.size > LIMIT) {
    return Response.json({ error: "Payload Too Large", maxSize: LIMIT }, { status: 413 });
  }
  return Response.json({ name: file.name, size: file.size }, { status: 201 });
}`;

const S3 = `import { UploadRescue } from "@uploadrescue/react";
import { createS3PresignedUpload } from "@uploadrescue/upload-adapters";

// A new URL is signed for every attempt, including the optimized retry.
const upload = createS3PresignedUpload({
  getTarget: async (file) =>
    (await fetch("/api/sign", { method: "POST", body: JSON.stringify({ type: file.type, size: file.size }) })).json(),
});

export const Uploader = () => <UploadRescue upload={upload} maxSize={10 * 1024 * 1024} />;`;

export function Examples() {
  return (
    <div className="container page prose wide">
      <h1>Examples</h1>
      <p className="lead">
        Each example in the <a href={`${REPO_URL}/tree/main/examples`}>examples directory</a>{" "}
        includes a real endpoint that rejects files over 1 MB with HTTP 413, so you can watch the
        full failure → optimization → retry → success flow.
      </p>
      <div className="examples">
        <section>
          <h2>React (Vite)</h2>
          <p>
            <code>examples/react</code> — component with progress, a dev-server endpoint enforcing
            the limit.
          </p>
          <CodeBlock code={REACT} title="src/App.tsx" />
        </section>
        <section>
          <h2>Vanilla JavaScript (Vite)</h2>
          <p>
            <code>examples/vanilla-js</code> — attach to an existing input; the widget appears below
            it.
          </p>
          <CodeBlock code={VANILLA} lang="ts" title="main.ts" />
        </section>
        <section>
          <h2>Next.js (App Router)</h2>
          <p>
            <code>examples/nextjs</code> — client component plus a route handler that returns 413
            with the limit.
          </p>
          <CodeBlock code={NEXT} lang="ts" title="app/api/upload/route.ts" />
        </section>
        <section>
          <h2>S3 presigned uploads</h2>
          <p>
            Signed URLs are requested per attempt, so the retry is signed for the optimized file.
          </p>
          <CodeBlock code={S3} title="Uploader.tsx" />
        </section>
      </div>
      <h2>Run locally</h2>
      <CodeBlock
        lang="bash"
        title="terminal"
        code={`pnpm install && pnpm build
pnpm --filter @uploadrescue/example-react dev       # http://localhost:5174
pnpm --filter @uploadrescue/example-vanilla dev     # http://localhost:5175
pnpm --filter @uploadrescue/example-nextjs dev      # http://localhost:3000`}
      />
    </div>
  );
}
