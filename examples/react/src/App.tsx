import { UploadRescue } from "@uploadrescue/react";
import { createXhrUpload } from "@uploadrescue/upload-adapters";
import { useState } from "react";

/**
 * The dev server's /api/upload endpoint rejects files over 1 MB with HTTP 413.
 * No client-side maxSize is set here on purpose: the failure comes from the
 * real server, UploadRescue classifies it, optimizes the image locally and
 * calls this same upload function again with the smaller file.
 */
const uploadFile = createXhrUpload<{ ok: boolean; size: number }>({ url: "/api/upload" });

export function App() {
  const [log, setLog] = useState<string[]>([]);
  const add = (line: string) => setLog((l) => [...l, line]);

  return (
    <main
      style={{
        maxWidth: 560,
        margin: "48px auto",
        padding: "0 16px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1>UploadRescue · React</h1>
      <p>
        The server accepts files up to <strong>1 MB</strong>. Upload a larger JPEG or PNG to see the
        failure → optimization → retry → success flow.
      </p>
      <UploadRescue
        onUpload={uploadFile}
        acceptedTypes={["image/*"]}
        optimization={{ quality: 0.82 }}
        recovery={{ enabled: true, showButton: true, autoRetry: false }}
        onError={(_error, failure) =>
          failure &&
          add(`Failed: ${failure.kind}${failure.status ? ` (HTTP ${failure.status})` : ""}`)
        }
        onOptimization={(original, optimized) =>
          add(`Optimized ${original.size} → ${optimized.size} bytes`)
        }
        onSuccess={(result, ctx) =>
          add(
            `Uploaded ${result.size} bytes on attempt ${ctx.attempt}${ctx.optimized ? " (optimized)" : ""}`,
          )
        }
      />
      {log.length > 0 && (
        <ol data-testid="log" style={{ fontSize: 14 }}>
          {log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      )}
    </main>
  );
}
