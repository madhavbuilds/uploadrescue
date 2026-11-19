import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes } from "react";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

export function navigate(href: string) {
  const url = new URL(href, window.location.href);
  if (url.pathname === window.location.pathname && url.hash) {
    window.history.pushState(null, "", url);
    document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView();
    return;
  }
  window.history.pushState(null, "", url);
  window.scrollTo(0, 0);
  notify();
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

/** Turns same-origin <a> clicks anywhere in the app (including rendered markdown) into SPA navigation. */
export function useLinkInterception() {
  useEffect(() => {
    const onClick = (e: globalThis.MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const a = (e.target as Element | null)?.closest("a");
      if (!a || a.target || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      e.preventDefault();
      navigate(url.pathname + url.search + url.hash);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
}

export function Link({
  href,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const path = usePath();
  const section = href.startsWith("/docs") ? "/docs" : href;
  const active = href !== "/" && (path === section || path.startsWith(`${section}/`));
  return (
    <a
      href={href}
      aria-current={path === href ? "page" : undefined}
      data-active={active || undefined}
      {...rest}
    />
  );
}
