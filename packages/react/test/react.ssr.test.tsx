import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UploadRescue } from "../src";

describe("SSR", () => {
  it("imports and renders on the server without browser globals", () => {
    expect(typeof window).toBe("undefined");
    const html = renderToString(<UploadRescue upload={async () => "ok"} maxSize={1024} />);
    expect(html).toContain("Upload a file");
    expect(html).toContain('data-status="idle"');
  });
});
