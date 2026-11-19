import { Layout, useSiteTheme } from "./components/Layout";
import { useLinkInterception, usePath } from "./lib/router";
import { Architecture } from "./pages/Architecture";
import { Contributing } from "./pages/Contributing";
import { DocsPage } from "./pages/Docs";
import { Examples } from "./pages/Examples";
import { Home } from "./pages/Home";
import { License } from "./pages/License";
import { NotFound } from "./pages/NotFound";
import { SecurityPage } from "./pages/Security";
import { Suspense, lazy, useEffect } from "react";

// The playground imports every engine; keep it out of the initial bundle.
const Playground = lazy(() =>
  import("./pages/Playground").then((m) => ({ default: m.Playground })),
);

const TITLES: Record<string, string> = {
  "/": "UploadRescue — Never lose an upload again",
  "/playground": "Playground — UploadRescue",
  "/examples": "Examples — UploadRescue",
  "/architecture": "Architecture — UploadRescue",
  "/contributing": "Contributing — UploadRescue",
  "/security": "Security — UploadRescue",
  "/license": "License — UploadRescue",
};

export function App() {
  const path = usePath().replace(/\/$/, "") || "/";
  const [theme, toggleTheme] = useSiteTheme();
  useLinkInterception();
  useEffect(() => {
    if (TITLES[path]) document.title = TITLES[path]!;
  }, [path]);

  let page;
  if (path === "/") page = <Home theme={theme} />;
  else if (path === "/docs") page = <DocsPage slug="introduction" />;
  else if (path.startsWith("/docs/")) page = <DocsPage slug={path.slice(6)} />;
  else if (path === "/api") page = <DocsPage slug="api-reference" />;
  else if (path === "/playground")
    page = (
      <Suspense fallback={<div className="container page muted">Loading playground…</div>}>
        <Playground theme={theme} />
      </Suspense>
    );
  else if (path === "/examples") page = <Examples />;
  else if (path === "/architecture") page = <Architecture />;
  else if (path === "/contributing") page = <Contributing />;
  else if (path === "/security") page = <SecurityPage />;
  else if (path === "/license") page = <License />;
  else page = <NotFound />;

  return (
    <Layout theme={theme} onToggleTheme={toggleTheme}>
      {page}
    </Layout>
  );
}
