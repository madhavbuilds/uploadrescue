import { describe, expect, it, vi } from "vitest";
import { UploadHttpError, createUploadRescue, type OptimizationEngine } from "@uploadrescue/core";
import { createDomWidget, getRecoveryView } from "../src";

const MB = 1024 * 1024;
const png = (size: number, name = "photo.png") => {
  const b = new Uint8Array(size);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new File([b], name, { type: "image/png" });
};
const engine = (outputSize: number): OptimizationEngine => ({
  id: "test",
  supportedTypes: ["image/*"],
  canProcess: () => true,
  optimize: async (file) => ({
    blob: new Blob([(await file.arrayBuffer()).slice(0, outputSize)]),
    type: "image/png",
  }),
});

describe("getRecoveryView", () => {
  it("shows the size explanation and the Compress & Retry action", async () => {
    const rescue = createUploadRescue({
      upload: async () => "ok",
      maxSize: 2 * MB,
      engines: [engine(MB)],
    });
    const state = await rescue.select(png(8.4 * MB));
    const view = getRecoveryView(state);
    expect(view.title).toBe("Your file is too large.");
    expect(view.description).toBe("Maximum allowed: 2 MB. Your file: 8.4 MB.");
    expect(view.actions.map((a) => a.label)).toEqual([
      "Compress & Retry Upload",
      "Choose another file",
    ]);
    expect(view.tone).toBe("error");
    expect(view.urgent).toBe(true);
  });

  it("reports real before/after numbers after recovery", async () => {
    const rescue = createUploadRescue({
      upload: async () => "ok",
      maxSize: 2 * MB,
      engines: [engine(1.7 * MB)],
    });
    await rescue.select(png(8.4 * MB));
    const view = getRecoveryView(await rescue.recover());
    expect(view.title).toBe("Upload completed successfully.");
    expect(view.stats).toEqual([
      { id: "original", label: "Original", value: "8.4 MB" },
      { id: "optimized", label: "Optimized", value: "1.7 MB" },
      { id: "reduction", label: "Reduction", value: "79.8%" },
    ]);
  });

  it("never shows success when the optimized file is still too large", async () => {
    const rescue = createUploadRescue({
      upload: async () => "ok",
      maxSize: 2 * MB,
      engines: [engine(3.1 * MB)],
      optimization: { maxAttempts: 1 },
    });
    await rescue.select(png(8.4 * MB));
    const view = getRecoveryView(await rescue.recover());
    expect(view.tone).toBe("warning");
    expect(view.title).toBe("The optimized file is still too large.");
    expect(view.stats.map((s) => `${s.label}: ${s.value}`)).toEqual([
      "Original: 8.4 MB",
      "Maximum allowed: 2 MB",
      "Optimized: 3.1 MB",
      "Reduction: 63.1%",
    ]);
    expect(view.actions.map((a) => a.id)).toEqual(["download", "reset"]);
  });

  it("hides recovery buttons when showButton is false and supports custom labels", async () => {
    const rescue = createUploadRescue({
      upload: async () => {
        throw new UploadHttpError({ status: 413 });
      },
      engines: [engine(10)],
    });
    const state = await rescue.select(png(1000));
    const view = getRecoveryView(state, {
      showRecoveryButton: false,
      labels: { chooseAnother: "Pick again" },
    });
    expect(view.actions.map((a) => a.label)).toEqual(["Pick again"]);
    expect(view.description).toBe("The server rejected the file because it is too large.");
  });

  it("covers every status", async () => {
    const rescue = createUploadRescue({ upload: async () => "ok", autoUpload: false });
    expect(getRecoveryView(rescue.getState()).actions[0]!.id).toBe("select");
    const state = await rescue.select(png(100));
    expect(getRecoveryView(state).actions[0]!.id).toBe("upload");
    rescue.cancel();
    const cancelled = getRecoveryView(rescue.getState());
    expect(cancelled.title).toBe("Upload cancelled.");
    expect(cancelled.actions.map((a) => a.id)).toEqual(["restart", "reset"]);
  });
});

describe("createDomWidget", () => {
  it("renders text safely and dispatches actions", async () => {
    const onAction = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const widget = createDomWidget(host, { onAction, onFiles: vi.fn() });
    const rescue = createUploadRescue({
      upload: async () => "ok",
      maxSize: 10,
      engines: [engine(5)],
    });
    await rescue.select(png(100, '<img src=x onerror="alert(1)">.png'));
    widget.update(getRecoveryView(rescue.getState()));

    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector(".ur-file-name")!.textContent).toContain("<img");
    expect(host.querySelector(".ur-widget")!.getAttribute("data-tone")).toBe("error");
    expect(host.querySelector("[aria-live]")!.textContent).toContain("Your file is too large.");
    host.querySelector<HTMLButtonElement>('[data-action="recover"]')!.click();
    expect(onAction).toHaveBeenCalledWith("recover");
    widget.destroy();
    expect(host.children).toHaveLength(0);
  });
});
