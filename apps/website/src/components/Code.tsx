import { useState } from "react";
import { highlight } from "../lib/highlight";

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className="copy"
      onClick={async () => {
        setState((await copyText(text)) ? "copied" : "failed");
        setTimeout(() => setState("idle"), 1500);
      }}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </button>
  );
}

export function CodeBlock({
  code,
  lang = "tsx",
  title,
}: {
  code: string;
  lang?: string;
  title?: string;
}) {
  return (
    <div className="code">
      <div className="code-bar">
        <span>{title ?? lang}</span>
        <CopyButton text={code} />
      </div>
      <pre>
        <code dangerouslySetInnerHTML={{ __html: highlight(code, lang) }} />
      </pre>
    </div>
  );
}

export function InstallCommand({ command }: { command: string }) {
  return (
    <div className="install">
      <span aria-hidden="true">$</span>
      <code>{command}</code>
      <CopyButton text={command} />
    </div>
  );
}
