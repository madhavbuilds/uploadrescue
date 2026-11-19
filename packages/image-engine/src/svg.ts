/**
 * SVG sanitization and conservative minification.
 *
 * Parsing uses `DOMParser`, whose documents are inert: scripts never run and
 * external resources are never fetched while we process them.
 */

export interface SvgProcessOptions {
  /** Remove comments, editor metadata and insignificant whitespace. Default true. */
  minify?: boolean;
}

export interface SvgProcessResult {
  svg: string;
  removedElements: number;
  removedAttributes: number;
}

const FORBIDDEN_ELEMENTS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "embed",
  "object",
  "audio",
  "video",
  "canvas",
  "handler",
  "listener",
  "set",
]);
const EDITOR_NAMESPACES = [
  "sodipodi",
  "inkscape",
  "sketch",
  "serif",
  "figma",
  "adobe",
  "illustrator",
];
const TEXT_ELEMENTS = new Set(["text", "tspan", "textpath", "style", "title", "desc"]);
const SAFE_DATA_URI = /^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;
const HREF_ATTRS = new Set(["href", "xlink:href"]);

function isSafeReference(value: string): boolean {
  const v = value.trim();
  return v.startsWith("#") || SAFE_DATA_URI.test(v);
}

function sanitizeCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "invalid(")
    .replace(/javascript:/gi, "")
    .replace(/url\(\s*(['"]?)(?!#)([^)'"]*)\1\s*\)/gi, (match, _q: string, target: string) =>
      SAFE_DATA_URI.test(target) ? match : "none",
    );
}

function localName(node: Element | Attr): string {
  return (node.localName ?? node.nodeName).toLowerCase();
}

function prefixOf(name: string): string | null {
  const idx = name.indexOf(":");
  return idx > 0 ? name.slice(0, idx).toLowerCase() : null;
}

/**
 * Removes executable and externally-loading content from an SVG:
 * `<script>`, `<foreignObject>`, event handler attributes, `javascript:` and
 * external `href`s, `@import` and external `url()` in CSS. Optionally minifies.
 *
 * Throws when the input is not well-formed SVG.
 */
export function sanitizeSvg(source: string, options: SvgProcessOptions = {}): SvgProcessResult {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
    throw new Error("SVG processing requires DOMParser and XMLSerializer.");
  }
  const minify = options.minify ?? true;
  // Strip DOCTYPE declarations up front: internal subsets can define entities (XXE / billion laughs).
  const withoutDoctype = source.replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/gi, "");
  const doc = new DOMParser().parseFromString(withoutDoctype, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || localName(root) !== "svg" || doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("The file is not a well-formed SVG document.");
  }

  let removedElements = 0;
  let removedAttributes = 0;

  const visit = (el: Element): void => {
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 1) {
        const childEl = child as Element;
        const name = localName(childEl);
        const prefix = prefixOf(childEl.nodeName);
        const animatesUnsafe =
          name.startsWith("animate") &&
          /^(href|xlink:href|on)/i.test(childEl.getAttribute("attributeName") ?? "");
        if (
          FORBIDDEN_ELEMENTS.has(name) ||
          animatesUnsafe ||
          (minify && (name === "metadata" || (prefix && EDITOR_NAMESPACES.includes(prefix))))
        ) {
          el.removeChild(childEl);
          removedElements += 1;
          continue;
        }
        if (name === "style") childEl.textContent = sanitizeCss(childEl.textContent ?? "");
        visit(childEl);
      } else if (child.nodeType === 8 || child.nodeType === 7) {
        // Comments and processing instructions.
        if (minify || child.nodeType === 7) {
          el.removeChild(child);
        }
      } else if (child.nodeType === 3 && minify && !TEXT_ELEMENTS.has(localName(el))) {
        if (!child.textContent?.trim()) el.removeChild(child);
      }
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const prefix = prefixOf(attr.name);
      let remove = false;
      if (name.startsWith("on")) remove = true;
      else if (HREF_ATTRS.has(name) && !isSafeReference(attr.value)) remove = true;
      else if (/^\s*javascript:/i.test(attr.value)) remove = true;
      else if (minify && prefix && EDITOR_NAMESPACES.includes(prefix)) remove = true;
      else if (minify && name.startsWith("xmlns:") && EDITOR_NAMESPACES.includes(name.slice(6)))
        remove = true;
      if (remove) {
        el.removeAttribute(attr.name);
        removedAttributes += 1;
      } else if (name === "style") {
        el.setAttribute(attr.name, sanitizeCss(attr.value));
      }
    }
  };
  visit(root);

  let svg = new XMLSerializer().serializeToString(root);
  if (minify) {
    const collapsed = svg.replace(/\s{2,}/g, " ");
    svg = collapsed.replace(/>\s+</g, (m, offset: number) =>
      keepSpace(collapsed, offset) ? m : "><",
    );
  }
  return { svg, removedElements, removedAttributes };
}

// Keep whitespace between tags inside <text> content.
function keepSpace(svg: string, offset: number): boolean {
  const before = svg.lastIndexOf("<text", offset);
  if (before === -1) return false;
  const close = svg.lastIndexOf("</text>", offset);
  return close < before;
}
