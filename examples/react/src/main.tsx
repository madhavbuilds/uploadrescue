import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@uploadrescue/ui/styles.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
