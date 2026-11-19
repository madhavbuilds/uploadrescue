import { Marked, type Tokens } from "marked";
import { highlight } from "./highlight";

export interface DocPage {
  slug: string;
  title: string;
  order: number;
  markdown: string;
}

const files = import.meta.glob("../../../../docs/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function parse(path: string, raw: string): DocPage {
  const slug = path.split("/").pop()!.replace(/\.md$/, "");
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  const meta = Object.fromEntries(
    (fm?.[1] ?? "").split("\n").map((line) => {
      const i = line.indexOf(":");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
  return {
    slug,
    title: meta.title ?? slug,
    order: Number(meta.order ?? 99),
    markdown: fm ? raw.slice(fm[0].length) : raw,
  };
}

export const DOCS: DocPage[] = Object.entries(files)
  .map(([path, raw]) => parse(path, raw))
  .sort((a, b) => a.order - b.order);

export function getDoc(slug: string): DocPage | undefined {
  return DOCS.find((d) => d.slug === slug);
}

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const marked = new Marked({
  gfm: true,
  renderer: {
    code({ text, lang }: Tokens.Code) {
      const language = (lang ?? "").split(/\s/)[0] ?? "";
      return `<div class="code"><div class="code-bar"><span>${language || "text"}</span><button type="button" class="copy" data-copy>Copy</button></div><pre><code>${highlight(text, language)}</code></pre></div>`;
    },
    heading({ tokens, depth }: Tokens.Heading) {
      const text = this.parser.parseInline(tokens);
      const id = slugify(text);
      return depth === 1
        ? `<h1>${text}</h1>`
        : `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${text}</h${depth}>`;
    },
  },
});

/** Renders trusted, repository-owned Markdown to HTML. */
export function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

export function headings(md: string): Array<{ id: string; text: string }> {
  return [...md.matchAll(/^## (.+)$/gm)].map((m) => ({
    id: slugify(m[1]!.replace(/`/g, "")),
    text: m[1]!.replace(/`/g, ""),
  }));
}
