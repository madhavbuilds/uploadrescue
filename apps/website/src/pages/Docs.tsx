import { useEffect, useMemo, useRef } from "react";
import { copyText } from "../components/Code";
import { DOCS, getDoc, headings, renderMarkdown } from "../lib/docs";
import { Link } from "../lib/router";
import { NotFound } from "./NotFound";

export function DocsPage({ slug }: { slug: string }) {
  const doc = getDoc(slug);
  const html = useMemo(() => (doc ? renderMarkdown(doc.markdown) : ""), [doc]);
  const toc = useMemo(() => (doc ? headings(doc.markdown) : []), [doc]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (doc) document.title = `${doc.title} — UploadRescue docs`;
    const el = ref.current;
    if (!el) return;
    // Copy buttons inside rendered markdown.
    const onClick = async (e: MouseEvent) => {
      const button = (e.target as Element).closest<HTMLButtonElement>("[data-copy]");
      if (!button) return;
      const code = button.closest(".code")?.querySelector("code")?.textContent ?? "";
      button.textContent = (await copyText(code)) ? "Copied" : "Copy failed";
      setTimeout(() => (button.textContent = "Copy"), 1500);
    };
    el.addEventListener("click", onClick);
    if (window.location.hash)
      document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView();
    return () => el.removeEventListener("click", onClick);
  }, [doc]);

  if (!doc) return <NotFound />;
  const index = DOCS.indexOf(doc);
  const prev = DOCS[index - 1];
  const next = DOCS[index + 1];

  return (
    <div className="container docs-layout">
      <nav className="docs-nav" aria-label="Documentation">
        <p className="docs-nav-title">Documentation</p>
        <ul>
          {DOCS.map((d) => (
            <li key={d.slug}>
              <Link href={`/docs/${d.slug}`} aria-current={d.slug === slug ? "page" : undefined}>
                {d.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <article className="prose">
        <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
        <nav className="pager" aria-label="Previous and next page">
          {prev ? <Link href={`/docs/${prev.slug}`}>← {prev.title}</Link> : <span />}
          {next ? <Link href={`/docs/${next.slug}`}>{next.title} →</Link> : <span />}
        </nav>
      </article>
      {toc.length > 1 ? (
        <aside className="toc" aria-label="On this page">
          <p className="docs-nav-title">On this page</p>
          <ul>
            {toc.map((h) => (
              <li key={h.id}>
                <a href={`#${h.id}`}>{h.text}</a>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}
