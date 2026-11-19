import { TONE_ICONS } from "./icons";
import type { RecoveryView, ViewActionId } from "./view";

export interface DomWidgetOptions {
  /** Called when a button is pressed. */
  onAction: (id: ViewActionId) => void;
  /** Called with files from the picker or a drop. */
  onFiles: (files: File[]) => void;
  /** `accept` attribute for the internal file input. */
  accept?: string;
  /** "light" | "dark" | "auto". Default "auto". */
  theme?: "light" | "dark" | "auto";
  /** Accessible name of the widget. */
  label?: string;
  className?: string;
}

export interface DomWidget {
  readonly element: HTMLElement;
  update(view: RecoveryView): void;
  /** Opens the native file picker. */
  openFilePicker(): void;
  destroy(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function icon(path: string, spin: boolean): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", spin ? "ur-icon ur-icon--spin" : "ur-icon");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", path);
  svg.appendChild(p);
  return svg;
}

/**
 * Framework-free renderer for a {@link RecoveryView}. All user-provided text
 * (file names, server messages) is written with `textContent`, never HTML.
 */
export function createDomWidget(container: HTMLElement, options: DomWidgetOptions): DomWidget {
  const root = el("div", ["ur-widget", options.className].filter(Boolean).join(" "));
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", options.label ?? "File upload");
  root.dataset.theme = options.theme ?? "auto";

  const input = el("input");
  input.type = "file";
  input.className = "ur-sr-only";
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");
  if (options.accept) input.accept = options.accept;

  const live = el("div", "ur-sr-only");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");

  const content = el("div", "ur-content");
  root.append(content, live, input);
  container.appendChild(root);

  let current: RecoveryView | null = null;
  let dragDepth = 0;

  const onInputChange = () => {
    const files = input.files ? Array.from(input.files) : [];
    input.value = "";
    if (files.length) options.onFiles(files);
  };
  const onDragEnter = (e: DragEvent) => {
    if (!current?.selectable || !e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragDepth += 1;
    root.dataset.dragging = "true";
  };
  const onDragOver = (e: DragEvent) => {
    if (!current?.selectable) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) delete root.dataset.dragging;
  };
  const onDrop = (e: DragEvent) => {
    if (!current?.selectable) return;
    e.preventDefault();
    dragDepth = 0;
    delete root.dataset.dragging;
    const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length) options.onFiles(files);
  };

  input.addEventListener("change", onInputChange);
  root.addEventListener("dragenter", onDragEnter);
  root.addEventListener("dragover", onDragOver);
  root.addEventListener("dragleave", onDragLeave);
  root.addEventListener("drop", onDrop);

  function render(view: RecoveryView): void {
    const focusedAction =
      document.activeElement instanceof HTMLElement && root.contains(document.activeElement)
        ? document.activeElement.dataset.action
        : undefined;

    root.dataset.tone = view.tone;
    root.dataset.status = view.status;
    root.setAttribute("aria-busy", String(view.busy));
    content.replaceChildren();

    const header = el("div", "ur-header");
    header.appendChild(icon(TONE_ICONS[view.tone], view.tone === "progress"));
    const text = el("div", "ur-text");
    const title = el("p", "ur-title");
    title.textContent = view.title;
    text.appendChild(title);
    if (view.description) {
      const desc = el("p", "ur-description");
      desc.textContent = view.description;
      text.appendChild(desc);
    }
    header.appendChild(text);
    content.appendChild(header);

    if (view.file && view.status !== "idle") {
      const file = el("div", "ur-file");
      const name = el("span", "ur-file-name");
      name.textContent = view.file.name;
      name.title = view.file.name;
      const size = el("span", "ur-file-size");
      size.textContent = view.file.size;
      file.append(name, size);
      content.appendChild(file);
    }

    if (view.progress) {
      const bar = el("div", "ur-progress");
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", view.progress.label);
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      const fill = el("div", "ur-progress-bar");
      if (view.progress.value === null) {
        bar.dataset.indeterminate = "true";
      } else {
        const pct = Math.round(view.progress.value * 100);
        bar.setAttribute("aria-valuenow", String(pct));
        fill.style.width = `${pct}%`;
      }
      bar.appendChild(fill);
      content.appendChild(bar);
    }

    if (view.stats.length) {
      const dl = el("dl", "ur-stats");
      for (const stat of view.stats) {
        const item = el("div", "ur-stat");
        item.dataset.stat = stat.id;
        const dt = el("dt");
        dt.textContent = stat.label;
        const dd = el("dd");
        dd.textContent = stat.value;
        item.append(dt, dd);
        dl.appendChild(item);
      }
      content.appendChild(dl);
    }

    if (view.actions.length) {
      const actions = el("div", "ur-actions");
      for (const action of view.actions) {
        const button = el("button", `ur-button ur-button--${action.variant}`);
        button.type = "button";
        button.dataset.action = action.id;
        button.textContent = action.label;
        button.addEventListener("click", () => {
          if (action.id === "select") input.click();
          else options.onAction(action.id);
        });
        actions.appendChild(button);
      }
      content.appendChild(actions);
    }

    if (view.announcement !== current?.announcement) {
      live.setAttribute("aria-live", view.urgent ? "assertive" : "polite");
      live.textContent = view.announcement;
    }

    if (focusedAction) {
      const same = content.querySelector<HTMLButtonElement>(`[data-action="${focusedAction}"]`);
      (same ?? content.querySelector<HTMLButtonElement>("button"))?.focus();
    }
    current = view;
  }

  return {
    element: root,
    update: render,
    openFilePicker: () => input.click(),
    destroy() {
      input.removeEventListener("change", onInputChange);
      root.removeEventListener("dragenter", onDragEnter);
      root.removeEventListener("dragover", onDragOver);
      root.removeEventListener("dragleave", onDragLeave);
      root.removeEventListener("drop", onDrop);
      root.remove();
    },
  };
}
