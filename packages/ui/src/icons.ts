import type { ViewTone } from "./view";

/** 24×24 stroke icon paths (Lucide-style, drawn for UploadRescue). */
export const TONE_ICONS: Readonly<Record<ViewTone, string>> = {
  neutral: "M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  progress: "M21 12a9 9 0 1 1-6.22-8.56",
  error:
    "M12 8v5m0 3.5h.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  warning: "M12 8v5m0 3.5h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  success: "M20 6 9 17l-5-5",
};
