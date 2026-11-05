import { describe, expect, it } from "vitest";
import { sanitizeSvg, extractSvgColors, recolorSvg, namespaceSvgIds, SvgSanitizeError } from "@/lib/svg/sanitize";

describe("sanitizeSvg", () => {
  it("keeps safe shapes and text intact", () => {
    const src = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="1" y="1" width="5" height="5" fill="#FF0000"/><text x="2" y="8" font-family="Arial">Hi &amp; bye</text></svg>';
    const { svg, removedElements, removedAttributes } = sanitizeSvg(src);
    expect(svg).toContain('<rect x="1" y="1" width="5" height="5" fill="#FF0000"/>');
    expect(svg).toContain("Hi &amp; bye");
    expect(removedElements).toEqual([]);
    expect(removedAttributes).toEqual([]);
  });

  it("removes scripts, foreignObject and their contents", () => {
    const src = '<svg><script>alert(1)</script><foreignObject><div>x</div></foreignObject><circle r="2"/></svg>';
    const { svg, removedElements } = sanitizeSvg(src);
    expect(svg).not.toMatch(/script|alert|foreignObject|div/);
    expect(svg).toContain("<circle");
    expect(removedElements).toEqual(expect.arrayContaining(["script", "foreignObject"]));
  });

  it("strips event handlers and javascript/data URLs", () => {
    const src = '<svg><rect onclick="evil()" onload="x" fill="url(http://evil/x)" width="1"/><use href="https://evil/x.svg#a"/><use xlink:href="#ok"/><a href="javascript:alert(1)">t</a></svg>';
    const { svg } = sanitizeSvg(src);
    expect(svg).not.toMatch(/onclick|onload|evil|javascript/);
    expect(svg).toContain('<use xlink:href="#ok"/>');
  });

  it("rejects entity declarations (XXE / billion laughs)", () => {
    expect(() => sanitizeSvg('<!DOCTYPE svg [<!ENTITY a "x">]><svg>&a;</svg>')).toThrow(SvgSanitizeError);
  });

  it("drops dangerous style declarations but keeps safe ones", () => {
    const { svg } = sanitizeSvg('<svg><rect style="fill:#000; background:url(http://x); behavior: url(x.htc)"/></svg>');
    expect(svg).toContain('style="fill:#000"');
    expect(svg).not.toMatch(/url\(http|behavior/);
  });

  it("drops <style>, <image> and animation elements", () => {
    const { svg } = sanitizeSvg('<svg><style>@import url(x)</style><image href="x.png"/><animate attributeName="href" to="javascript:1"/><g/></svg>');
    expect(svg).toBe('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>');
  });

  it("requires an svg root", () => {
    expect(() => sanitizeSvg("<html><body/></html>")).toThrow(SvgSanitizeError);
  });
});

describe("svg colour helpers", () => {
  it("extracts and remaps colours", () => {
    const svg = '<svg><rect fill="#abc"/><circle stroke="#22D3EE"/><stop stop-color="#F472B6"/></svg>';
    expect(extractSvgColors(svg).sort()).toEqual(["#22D3EE", "#AABBCC", "#F472B6"]);
    expect(recolorSvg(svg, { "#22d3ee": "#000000" })).toContain('stroke="#000000"');
  });

  it("namespaces ids and references", () => {
    const svg = '<svg><defs><pattern id="p"/></defs><rect fill="url(#p)"/><use href="#p"/></svg>';
    const out = namespaceSvgIds(svg, "L1");
    expect(out).toContain('id="L1-p"');
    expect(out).toContain("url(#L1-p)");
    expect(out).toContain('href="#L1-p"');
  });
});
