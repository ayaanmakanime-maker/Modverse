/**
 * Strict allowlist SVG sanitiser (no DOM dependency — runs on server, in
 * scripts and in the browser).
 *
 * Used for:
 *   - importing the ModVerse Creative Library (defence in depth, even though
 *     the supplied files contain no active content), and
 *   - customer SVG uploads.
 *
 * Anything not explicitly allowed is removed: scripts, foreignObject, event
 * handlers, external references, animation elements, <image>, <style>, DTDs
 * and entities. Element subtrees that are not allowed are dropped entirely.
 */

const ALLOWED_ELEMENTS = new Set([
  "svg", "g", "defs", "title", "desc", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "path", "text", "tspan", "textPath", "pattern", "linearGradient", "radialGradient", "stop",
  "clipPath", "mask", "use", "symbol", "marker", "filter", "feGaussianBlur", "feOffset", "feBlend",
  "feColorMatrix", "feMerge", "feMergeNode", "feFlood", "feComposite", "feMorphology",
]);

const ALLOWED_ATTRIBUTES = new Set([
  "id", "class", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "d",
  "points", "width", "height", "viewBox", "preserveAspectRatio", "transform", "fill", "fill-opacity",
  "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit", "opacity", "color", "display",
  "visibility", "clip-path", "clip-rule", "mask", "font-family", "font-size", "font-weight",
  "font-style", "text-anchor", "dominant-baseline", "alignment-baseline", "letter-spacing",
  "word-spacing", "text-decoration", "dx", "dy", "rotate", "textLength", "lengthAdjust",
  "startOffset", "method", "spacing", "side", "patternUnits", "patternContentUnits",
  "patternTransform", "gradientUnits", "gradientTransform", "spreadMethod", "offset", "stop-color",
  "stop-opacity", "clipPathUnits", "maskUnits", "maskContentUnits", "markerWidth", "markerHeight",
  "refX", "refY", "orient", "markerUnits", "marker-start", "marker-mid", "marker-end",
  "filterUnits", "primitiveUnits", "stdDeviation", "in", "in2", "result", "mode", "type", "values",
  "flood-color", "flood-opacity", "operator", "k1", "k2", "k3", "k4", "radius", "filter",
  "xmlns", "xmlns:xlink", "version", "href", "xlink:href", "style", "paint-order",
  "vector-effect", "shape-rendering", "text-rendering", "xml:space",
]);

const ATTR_LOOKUP = new Map<string, string>();
for (const a of ALLOWED_ATTRIBUTES) ATTR_LOOKUP.set(a.toLowerCase(), a);
const ELEMENT_LOOKUP = new Map<string, string>();
for (const e of ALLOWED_ELEMENTS) ELEMENT_LOOKUP.set(e.toLowerCase(), e);

const DANGEROUS_VALUE = /(javascript|vbscript|data)\s*:|expression\s*\(|@import|-moz-binding|behavior\s*:/i;
const URL_REF = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;

export interface SanitizeResult {
  svg: string;
  removedElements: string[];
  removedAttributes: string[];
}

export class SvgSanitizeError extends Error {}

function escapeAttr(value: string): string {
  return value.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeText(value: string): string {
  return value.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function sanitizeUrlRefs(value: string): string | null {
  let ok = true;
  value.replace(URL_REF, (_m, _q, target: string) => {
    if (!target.trim().startsWith("#")) ok = false;
    return "";
  });
  return ok ? value : null;
}

function sanitizeStyle(style: string): string {
  return style
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d.length > 0)
    .filter((d) => {
      const decoded = decodeBasicEntities(d);
      if (DANGEROUS_VALUE.test(decoded)) return false;
      if (/url\(/i.test(decoded) && sanitizeUrlRefs(decoded) === null) return false;
      return /^[a-zA-Z-]+\s*:/.test(decoded);
    })
    .join("; ");
}

function sanitizeAttribute(name: string, rawValue: string, removed: string[]): [string, string] | null {
  const canonical = ATTR_LOOKUP.get(name.toLowerCase());
  if (!canonical || /^on/i.test(name)) {
    removed.push(name);
    return null;
  }
  const decoded = decodeBasicEntities(rawValue);
  if (canonical === "href" || canonical === "xlink:href") {
    if (!decoded.trim().startsWith("#")) {
      removed.push(name);
      return null;
    }
    return [canonical, decoded.trim()];
  }
  if (canonical === "style") {
    const s = sanitizeStyle(decoded);
    return s ? [canonical, s] : null;
  }
  if (DANGEROUS_VALUE.test(decoded)) {
    removed.push(name);
    return null;
  }
  if (/url\(/i.test(decoded) && sanitizeUrlRefs(decoded) === null) {
    removed.push(name);
    return null;
  }
  if (canonical === "xmlns" && decoded !== "http://www.w3.org/2000/svg") return ["xmlns", "http://www.w3.org/2000/svg"];
  if (canonical === "xmlns:xlink" && decoded !== "http://www.w3.org/1999/xlink") return null;
  return [canonical, decoded];
}

const ATTR_RE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const TOKEN_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<\/?[a-zA-Z][^>]*>|[^<]+|</g;

export function sanitizeSvg(input: string, opts: { maxBytes?: number } = {}): SanitizeResult {
  const maxBytes = opts.maxBytes ?? 2_000_000;
  if (typeof input !== "string" || input.length === 0) throw new SvgSanitizeError("Empty SVG");
  if (input.length > maxBytes) throw new SvgSanitizeError("SVG is too large");
  if (/<!ENTITY/i.test(input)) throw new SvgSanitizeError("SVG entity declarations are not allowed");

  const removedElements: string[] = [];
  const removedAttributes: string[] = [];
  const out: string[] = [];
  const stack: string[] = [];
  let skipDepth = 0; // >0 while inside a disallowed subtree
  const skipStack: string[] = [];
  let sawRoot = false;

  const tokens = input.match(TOKEN_RE) ?? [];
  for (const token of tokens) {
    if (token.startsWith("<!--") || token.startsWith("<?") || /^<!DOCTYPE/i.test(token)) continue;
    if (token.startsWith("<![CDATA[")) {
      if (skipDepth === 0 && stack.length) out.push(escapeText(token.slice(9, -3)));
      continue;
    }
    if (token === "<") continue;
    if (!token.startsWith("<")) {
      if (skipDepth === 0 && stack.length) out.push(escapeText(token));
      continue;
    }
    const closing = token.startsWith("</");
    const selfClosing = /\/\s*>$/.test(token);
    const nameMatch = /^<\/?\s*([a-zA-Z][\w:.-]*)/.exec(token);
    if (!nameMatch) continue;
    const rawName = nameMatch[1];
    const canonical = ELEMENT_LOOKUP.get(rawName.toLowerCase());

    if (closing) {
      if (skipDepth > 0) {
        if (skipStack[skipStack.length - 1]?.toLowerCase() === rawName.toLowerCase()) {
          skipStack.pop();
          skipDepth--;
        }
        continue;
      }
      if (!canonical) continue;
      const idx = stack.lastIndexOf(canonical);
      if (idx === -1) continue;
      while (stack.length > idx) out.push(`</${stack.pop()}>`);
      continue;
    }

    if (skipDepth > 0) {
      if (!selfClosing) {
        skipStack.push(rawName);
        skipDepth++;
      }
      continue;
    }

    if (!canonical || (!sawRoot && canonical !== "svg")) {
      removedElements.push(rawName);
      if (!selfClosing) {
        skipStack.push(rawName);
        skipDepth++;
      }
      continue;
    }
    if (canonical === "svg") sawRoot = true;

    const attrSource = token.slice(nameMatch[0].length).replace(/\/?\s*>$/, "");
    const attrs: string[] = [];
    const seen = new Set<string>();
    ATTR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ATTR_RE.exec(attrSource))) {
      const name = m[1];
      const value = m[2] ?? m[3] ?? m[4] ?? "";
      const res = sanitizeAttribute(name, value, removedAttributes);
      if (!res || seen.has(res[0])) continue;
      seen.add(res[0]);
      attrs.push(`${res[0]}="${escapeAttr(res[1])}"`);
    }
    if (canonical === "svg" && stack.length === 0 && !seen.has("xmlns")) attrs.unshift('xmlns="http://www.w3.org/2000/svg"');
    const open = `<${canonical}${attrs.length ? " " + attrs.join(" ") : ""}`;
    if (selfClosing) out.push(`${open}/>`);
    else {
      out.push(`${open}>`);
      stack.push(canonical);
    }
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  if (!sawRoot) throw new SvgSanitizeError("No <svg> root element found");
  return { svg: out.join(""), removedElements, removedAttributes };
}

/** Extract unique hex colours used for fill / stroke / stop-color. */
export function extractSvgColors(svg: string): string[] {
  const colors = new Set<string>();
  const re = /(?:fill|stroke|stop-color|flood-color)\s*[:=]\s*"?\s*(#[0-9a-fA-F]{3,8})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    let c = m[1].toUpperCase();
    if (c.length === 4) c = "#" + c.slice(1).split("").map((x) => x + x).join("");
    colors.add(c.slice(0, 7));
  }
  return [...colors];
}

/** Replace colours (case-insensitive) according to a map of #RRGGBB -> #RRGGBB. */
export function recolorSvg(svg: string, colorMap: Record<string, string>): string {
  const entries = Object.entries(colorMap).filter(([from, to]) => /^#[0-9a-fA-F]{6}$/.test(from) && /^#[0-9a-fA-F]{6}$/.test(to));
  if (!entries.length) return svg;
  const lookup = new Map(entries.map(([f, t]) => [f.toUpperCase(), t]));
  return svg.replace(/#[0-9a-fA-F]{6}\b/g, (c) => lookup.get(c.toUpperCase()) ?? c);
}

export function parseSvgDimensions(svg: string): { width: number; height: number; viewBox: [number, number, number, number] } {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const vb = /viewBox="([^"]+)"/.exec(root)?.[1]?.trim().split(/[\s,]+/).map(Number);
  const w = parseFloat(/\swidth="([\d.]+)/.exec(root)?.[1] ?? "");
  const h = parseFloat(/\sheight="([\d.]+)/.exec(root)?.[1] ?? "");
  const viewBox: [number, number, number, number] =
    vb && vb.length === 4 && vb.every((n) => Number.isFinite(n)) ? [vb[0], vb[1], vb[2], vb[3]] : [0, 0, w || 100, h || 100];
  return { width: w || viewBox[2], height: h || viewBox[3], viewBox };
}

/** Returns the inner markup of an <svg> root (used when nesting assets). */
export function svgInner(svg: string): string {
  const start = svg.indexOf(">", svg.search(/<svg\b/i));
  const end = svg.lastIndexOf("</svg>");
  if (start === -1 || end === -1) return "";
  return svg.slice(start + 1, end);
}

/** Make element ids unique so that several assets can be inlined in one SVG document. */
export function namespaceSvgIds(svg: string, prefix: string): string {
  const ids = new Set<string>();
  svg.replace(/\sid="([^"]+)"/g, (_m, id: string) => {
    ids.add(id);
    return "";
  });
  if (!ids.size) return svg;
  let out = svg;
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out
      .replace(new RegExp(`\\sid="${esc}"`, "g"), ` id="${prefix}-${id}"`)
      .replace(new RegExp(`url\\(#${esc}\\)`, "g"), `url(#${prefix}-${id})`)
      .replace(new RegExp(`href="#${esc}"`, "g"), `href="#${prefix}-${id}"`);
  }
  return out;
}
