// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createImageEngine } from "../src/engine";
import { sanitizeSvg } from "../src/svg";
import { inspectFile, optimizeFile } from "@uploadrescue/core";

const MALICIOUS = `<?xml version="1.0"?>
<!-- exported by an editor -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" inkscape:version="1.0" onload="alert(1)">
  <metadata>tracking</metadata>
  <script>alert('xss')</script>
  <foreignObject><iframe src="https://evil.example"></iframe></foreignObject>
  <a href="javascript:alert(1)"><rect width="10" height="10" onclick="steal()"/></a>
  <image href="https://tracker.example/pixel.png" width="1" height="1"/>
  <use xlink:href="#shape"/>
  <set attributeName="href" to="javascript:alert(1)"/>
  <style>@import url(https://evil.example/x.css); .a { fill: url(#grad); background: url(https://evil.example/b.png) }</style>
  <rect id="shape" width="20" height="20" style="fill: red; background: url(javascript:alert(1))"/>
  <text x="0" y="10">Hello   world</text>
</svg>`;

describe("sanitizeSvg", () => {
  const { svg, removedElements, removedAttributes } = sanitizeSvg(MALICIOUS);

  it("removes scripts, event handlers and foreign content", () => {
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/foreignObject/i);
    expect(svg).not.toMatch(/iframe/i);
    expect(svg).not.toMatch(/\bon(load|click)=/i);
    expect(svg).not.toMatch(/javascript:/i);
    expect(svg).not.toMatch(/<set/i);
    expect(removedElements).toBeGreaterThan(0);
    expect(removedAttributes).toBeGreaterThan(0);
  });

  it("removes external references but keeps local ones", () => {
    expect(svg).not.toContain("tracker.example");
    expect(svg).not.toContain("evil.example");
    expect(svg).toContain('href="#shape"');
    expect(svg).toContain("url(#grad)");
  });

  it("removes editor metadata and comments, keeps drawable content", () => {
    expect(svg).not.toContain("inkscape");
    expect(svg).not.toContain("<metadata");
    expect(svg).not.toContain("exported by");
    expect(svg).toContain('<rect id="shape"');
    expect(svg).toContain("Hello");
  });

  it("strips DOCTYPE entity definitions", () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;">]><svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>`;
    expect(sanitizeSvg(bomb).svg).not.toContain("ENTITY");
  });

  it("rejects malformed input", () => {
    expect(() => sanitizeSvg("<svg><g></svg")).toThrow();
    expect(() => sanitizeSvg("<html></html>")).toThrow();
  });
});

describe("image engine — SVG", () => {
  it("produces a smaller, sanitized SVG through the core orchestrator", async () => {
    const file = new File([MALICIOUS], "logo.svg", { type: "image/svg+xml" });
    const info = await inspectFile(file);
    expect(info.detected.mime).toBe("image/svg+xml");
    const result = await optimizeFile(file, { engines: [createImageEngine()] });
    expect(result.changed).toBe(true);
    expect(result.outputType).toBe("image/svg+xml");
    expect(result.outputSize).toBeLessThan(file.size);
    expect(await result.file.text()).not.toContain("<script");
  });
});
