import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UploadHttpError,
  createUploadRescue,
  type OptimizationEngine,
  type UploadContext,
} from "@uploadrescue/core";
import { UploadRescue, useFileOptimization, useUploadRescue } from "../src";

afterEach(cleanup);

const png = (size: number, name = "photo.png") => {
  const b = new Uint8Array(size);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new File([b], name, { type: "image/png" });
};
const halfEngine: OptimizationEngine = {
  id: "half",
  supportedTypes: ["image/*"],
  canProcess: () => true,
  optimize: async (file) => ({ blob: file.slice(0, Math.floor(file.size / 2)), type: "image/png" }),
};

function server(limit: number) {
  return vi.fn(async (file: File, _ctx: UploadContext) => {
    if (file.size > limit) throw new UploadHttpError({ status: 413 });
    return { ok: true };
  });
}

function pick(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("<UploadRescue />", () => {
  it("runs the full failure → Compress & Retry → success flow", async () => {
    const upload = server(600);
    const onSuccess = vi.fn();
    render(
      <StrictMode>
        <UploadRescue onUpload={upload} engines={[halfEngine]} onSuccess={onSuccess} />
      </StrictMode>,
    );
    expect(screen.getByText("Upload a file")).toBeTruthy();
    pick(png(1000));
    await screen.findByText("Your file is too large.");
    expect(screen.getByText("The server rejected the file because it is too large.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Compress & Retry Upload" }));
    await screen.findByText("Upload completed successfully.", { selector: ".ur-title" });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1]![0].size).toBe(500);
    expect(screen.getByText("50%")).toBeTruthy(); // Reduction stat
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("shows the client-side limit and accessible states", async () => {
    render(
      <UploadRescue upload={server(Infinity)} maxSize={2 * 1024 * 1024} engines={[halfEngine]} />,
    );
    pick(png(Math.round(8.4 * 1024 * 1024)));
    await screen.findByText("Maximum allowed: 2 MB. Your file: 8.4 MB.");
    const group = screen.getByRole("group", { name: "File upload" });
    expect(group.getAttribute("data-tone")).toBe("error");
    expect(group.querySelector('[aria-live="assertive"]')!.textContent).toContain(
      "Your file is too large.",
    );
  });

  it("supports a custom renderer and custom buttons", async () => {
    render(
      <UploadRescue
        upload={server(10)}
        engines={[halfEngine]}
        renderButton={(a, onClick) => <a onClick={onClick}>[{a.label}]</a>}
      >
        {undefined}
      </UploadRescue>,
    );
    pick(png(100));
    expect(await screen.findByText("[Compress & Retry Upload]")).toBeTruthy();
    cleanup();
    render(
      <UploadRescue upload={server(10)} engines={[]}>
        {({ view }) => <p data-testid="custom">{view.status}</p>}
      </UploadRescue>,
    );
    expect(screen.getByTestId("custom").textContent).toBe("idle");
  });

  it("works in controlled mode with an external controller", async () => {
    const controller = createUploadRescue({ upload: server(Infinity) });
    render(<UploadRescue controller={controller} />);
    await act(() => controller.select(png(10)));
    expect(
      screen.getByText("Upload completed successfully.", { selector: ".ur-title" }),
    ).toBeTruthy();
  });

  it("cancels in-flight uploads on unmount", async () => {
    let signal: AbortSignal | undefined;
    const upload = vi.fn((_f: File, c: UploadContext) => {
      signal = c.signal;
      return new Promise(() => undefined);
    });
    const { unmount } = render(<UploadRescue upload={upload} />);
    pick(png(10));
    await waitFor(() => expect(upload).toHaveBeenCalled());
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});

describe("hooks", () => {
  it("useUploadRescue exposes state and actions, and keeps callbacks fresh", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ cb }) => useUploadRescue({ upload: server(Infinity), onSuccess: cb }),
      {
        initialProps: { cb: first },
      },
    );
    rerender({ cb: second });
    await act(() => result.current.select(png(10)));
    expect(result.current.state.status).toBe("success");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("useFileOptimization optimizes without uploading", async () => {
    const { result } = renderHook(() => useFileOptimization({ engines: [halfEngine] }));
    await act(async () => {
      await result.current.optimize(png(1000));
    });
    expect(result.current.status).toBe("done");
    expect(result.current.result?.outputSize).toBe(500);
  });

  it("throws a clear error without an upload function", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useUploadRescue({} as never))).toThrow(/upload/);
  });
});
