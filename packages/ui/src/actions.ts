import type { RecoveryState, UploadRescueController } from "@uploadrescue/core";
import type { ViewActionId } from "./view";

/**
 * Triggers a browser download for a File/Blob and releases the object URL.
 * No-op outside the browser.
 */
export function downloadFile(file: Blob, fileName?: string): void {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName ?? (file instanceof File ? file.name : "download");
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been processed.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Executes a view action against a controller. `select` must be handled by
 * the caller (it opens a file picker, which is UI-specific).
 */
export function runViewAction(
  controller: UploadRescueController<unknown>,
  id: Exclude<ViewActionId, "select">,
): Promise<RecoveryState<unknown>> | void {
  const state = controller.getState();
  switch (id) {
    case "upload":
      return controller.upload();
    case "recover":
      return controller.recover();
    case "recover-alternative":
      return state.alternativeAction ? controller.recover(state.alternativeAction) : undefined;
    case "cancel":
      controller.cancel();
      return;
    case "reset":
      controller.reset();
      return;
    case "restart":
      return state.originalFile ? controller.select(state.originalFile) : undefined;
    case "download":
      if (state.optimization?.changed) downloadFile(state.optimization.file);
      return;
  }
}
