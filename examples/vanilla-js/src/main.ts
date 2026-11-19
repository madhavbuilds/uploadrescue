import { createUploadRescue } from "@uploadrescue/vanilla";
import { createXhrUpload } from "@uploadrescue/upload-adapters";
import "@uploadrescue/ui/styles.css";

// POST /api/upload on the dev server rejects files over 1 MB with HTTP 413.
const rescue = createUploadRescue({
  upload: createXhrUpload({ url: "/api/upload" }),
  acceptedTypes: ["image/*"],
  recovery: { enabled: true, showButton: true, autoRetry: false },
});

rescue.attach("#upload-input", { dropzone: "#drop-area" });

const log = document.querySelector<HTMLOListElement>("#log")!;
const add = (text: string) => {
  const li = document.createElement("li");
  li.textContent = text;
  log.appendChild(li);
};
rescue.on(
  "error",
  ({ failure }) =>
    failure && add(`Failed: ${failure.kind}${failure.status ? ` (HTTP ${failure.status})` : ""}`),
);
rescue.on("optimization", (r) =>
  add(`Optimized ${r.originalSize} → ${r.outputSize} bytes in ${r.durationMs} ms`),
);
rescue.on("success", ({ optimized }) =>
  add(`Upload succeeded${optimized ? " with the optimized file" : ""}`),
);
