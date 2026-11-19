import { useEffect, useState, type ReactNode } from "react";
import { Link } from "../lib/router";
import { NAV, REPO_URL } from "../site";

type Theme = "light" | "dark";

function readTheme(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === "dark" || set === "light") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useSiteTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("ur-site-theme", theme);
    } catch {
      // Storage may be unavailable (private mode); the theme still applies for this visit.
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}

export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="UploadRescue home">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" className="logo-bg" />
        <path d="M16 22V9m0 0-5 5m5-5 5 5" className="logo-arrow" />
        <circle cx="24" cy="24" r="4" className="logo-dot" />
      </svg>
      <span>UploadRescue</span>
    </Link>
  );
}

export function Layout({
  children,
  theme,
  onToggleTheme,
}: {
  children: ReactNode;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <>
      <a href="#main" className="skip">
        Skip to content
      </a>
      <header className="site-header">
        <div className="container header-inner">
          <Logo />
          <button
            type="button"
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="site-nav"
            onClick={() => setMenuOpen((o) => !o)}
          >
            Menu
          </button>
          <nav
            id="site-nav"
            aria-label="Main"
            data-open={menuOpen || undefined}
            onClick={() => setMenuOpen(false)}
          >
            {NAV.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </nav>
          <button
            type="button"
            className="theme-toggle"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <div className="container footer-inner">
          <div>
            <Logo />
            <p className="muted">
              Never lose an upload again. Open source under the Apache License 2.0.
            </p>
          </div>
          <div className="footer-links">
            <Link href="/docs/introduction">Documentation</Link>
            <Link href="/playground">Playground</Link>
            <Link href="/examples">Examples</Link>
            <Link href="/contributing">Contributing</Link>
            <Link href="/security">Security</Link>
            <Link href="/license">License</Link>
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}
