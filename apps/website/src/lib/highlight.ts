const KEYWORDS =
  "import|from|export|default|const|let|var|function|return|async|await|if|else|for|while|of|in|new|type|interface|extends|implements|class|throw|try|catch|finally|typeof|as|null|undefined|true|false|void";

const TOKEN = new RegExp(
  [
    String.raw`(\/\/[^\n]*|\/\*[\s\S]*?\*\/|(?:^|\s)#[^\n]*)`, // 1 comments (# for bash)
    String.raw`("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\`(?:\\.|[^\`\\])*\`)`, // 2 strings
    String.raw`\b(${KEYWORDS})\b`, // 3 keywords
    String.raw`\b(\d[\d_.]*)\b`, // 4 numbers
    String.raw`(<\/?[A-Z][\w.]*|<\/?[a-z][\w-]*(?=[\s>/]))`, // 5 JSX tags
  ].join("|"),
  "gm",
);

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Minimal, dependency-free syntax highlighting for TS/TSX/JS/bash snippets. Returns safe HTML. */
export function highlight(code: string, lang: string): string {
  if (!["ts", "tsx", "js", "jsx", "bash", "sh", "css", "html"].includes(lang)) return escape(code);
  let out = "";
  let last = 0;
  for (const m of code.matchAll(TOKEN)) {
    const index = m.index ?? 0;
    out += escape(code.slice(last, index));
    const cls = m[1] ? "c" : m[2] ? "s" : m[3] ? "k" : m[4] ? "n" : "t";
    if (cls === "c" && lang !== "bash" && lang !== "sh" && m[1]!.trimStart().startsWith("#")) {
      out += escape(m[0]);
    } else {
      out += `<span class="tok-${cls}">${escape(m[0])}</span>`;
    }
    last = index + m[0].length;
  }
  return out + escape(code.slice(last));
}
