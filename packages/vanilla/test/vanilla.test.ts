import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadHttpError, type OptimizationEngine } from "@uploadrescue/core";
import { createUploadRescue } from "../src";

afterEach(() => {
  document.body.innerHTML = "";
});

const png = (size: number) => {
  const b = new Uint8Array(size);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new File([b], "photo.png", { type: "image/png" });
};
const halfEngine: OptimizationEngine = {
  id: "half",
  supportedTypes: ["image/*"],
  canProcess: () => true,
  optimize: async (file) => ({ blob: file.slice(0, file.size / 2), type: "image/png" }),
};
const upload = vi.fn(async (file: File) => {
  if (file.size > 600) throw new UploadHttpError({ status: 413 });
  return "stored";
});

function choose(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
}

describe("createUploadRescue (vanilla)", () => {
  it("attaches to an input and renders the recovery widget after it", async () => {
    document.body.innerHTML = '<input id="file" type="file">';
    const rescue = createUploadRescue({ upload, engines: [halfEngine] });
    const success = vi.fn();
    rescue.on("success", success);
    rescue.attach("#file");

    choose(document.querySelector("#file")!, png(1000));
    await vi.waitFor(() => expect(rescue.getState().status).toBe("recovery-available"));
    const widget = document.querySelector(".ur-attached .ur-widget")!;
    expect(widget.textContent).toContain("Your file is too large.");

    widget.querySelector<HTMLButtonElement>('[data-action="recover"]')!.click();
    await vi.waitFor(() => expect(rescue.getState().status).toBe("success"));
    expect(document.querySelector(".ur-title")!.textContent).toBe("Upload completed successfully.");
    expect(success).toHaveBeenCalledWith(
      expect.objectContaining({ result: "stored", optimized: true }),
    );
    rescue.destroy();
    expect(document.querySelector(".ur-widget")).toBeNull();
  });

  it("mounts into a container, accepts drops, and supports headless use", async () => {
    document.body.innerHTML = '<div id="zone"></div><div id="ui"></div><input id="f" type="file">';
    const rescue = createUploadRescue({ upload, engines: [halfEngine], container: "#ui" });
    rescue.attach("#f", { dropzone: "#zone" });
    expect(document.querySelector("#ui .ur-widget")).not.toBeNull();
    const drop = new Event("drop", { bubbles: true }) as Event & { dataTransfer: unknown };
    drop.dataTransfer = { files: [png(10)] };
    document.querySelector("#zone")!.dispatchEvent(drop);
    await vi.waitFor(() => expect(rescue.getState().status).toBe("success"));
    rescue.destroy();

    const headless = createUploadRescue({ upload, render: false });
    const states: string[] = [];
    headless.on("state", (s) => states.push(s.status));
    await headless.select(png(10));
    expect(states).toContain("success");
    expect(document.querySelectorAll(".ur-widget")).toHaveLength(0);
    headless.destroy();
  });

  it("throws helpful errors for missing elements", () => {
    const rescue = createUploadRescue({ upload, render: false });
    expect(() => rescue.attach("#missing")).toThrow(/#missing/);
  });
});
