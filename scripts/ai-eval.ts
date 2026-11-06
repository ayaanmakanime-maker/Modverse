/**
 * Fashion Director evaluation harness.
 *
 *   npm run ai:eval                       # local rules only (free, offline)
 *   EVAL_OLLAMA_URL=http://127.0.0.1:11434 EVAL_OLLAMA_MODEL=llama3.1:8b npm run ai:eval
 *   EVAL_GEMINI_KEY=… EVAL_GEMINI_MODEL=gemini-2.5-flash npm run ai:eval     # billable/quota — opt-in
 *   EVAL_OPENAI_KEY=… EVAL_OPENAI_MODEL=gpt-4.1-mini npm run ai:eval         # billable — opt-in
 *
 * Each provider receives the same prompt suite. Its proposal must parse
 * against the versioned schema, compile through the same design compiler and
 * satisfy prompt-specific expectations. Results: docs/evaluation/ai-eval-results.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createLibraryLookup } from "../src/lib/library/lookup";
import type { LibraryIndex } from "../src/lib/library/types";
import { createDesign, createTextLayer } from "../src/lib/garment/design";
import type { DesignConfig } from "../src/lib/garment/schema";
import { localDirector, runPipeline, type Direction } from "../src/lib/ai/pipeline";
import { parseProposal } from "../src/lib/ai/proposal";
import { directorSystemPrompt } from "../src/lib/ai/prompt";
import { callGemini, callOllama, callOpenAI } from "../src/lib/ai/model-clients";
import { relativeLuminance, hexToHsl } from "../src/lib/color";
import { getModel } from "../src/lib/garment/models";

const lib = createLibraryLookup(JSON.parse(readFileSync(path.resolve("src/data/creative-library.index.json"), "utf8")) as LibraryIndex);

interface Case {
  id: string;
  prompt: string;
  base: () => DesignConfig | null;
  expect: [string, (c: DesignConfig, rejected: number) => boolean][];
}

const shirt = () => createDesign("shirt-classic-formal", "men");
const withText = () => {
  const d = createDesign("tee-classic-crew", "men");
  d.layers.push(createTextLayer(d, "HELLO", "center-chest"));
  return d;
};
const isRed = (hex: string) => {
  const [h, s] = hexToHsl(hex);
  return (h < 20 || h > 340) && s > 0.4;
};
const layer = (c: DesignConfig, zone: string, type?: string) => c.layers.find((l) => l.zone === zone && (!type || l.type === type));

const CASES: Case[] = [
  {
    id: "v2-spec", prompt: "Create a black oversized T-shirt with Japanese cyberpunk artwork on the back, red typography on the front and wider sleeves.", base: () => null,
    expect: [["oversized", (c) => c.fit === "oversized" || getModel(c.modelId).fit === "oversized"], ["black", (c) => relativeLuminance(c.fabric.color) < 0.03], ["back artwork", (c) => !!layer(c, "back", "graphic") || !!layer(c, "back", "image")], ["red front text", (c) => { const t = layer(c, "front", "text"); return !!t && t.type === "text" && isRed(t.color); }], ["wider sleeves", (c) => c.adjustments.sleeveWidth > 0]],
  },
  { id: "v1-linen", prompt: "Design a beige linen shirt with a mandarin collar, hidden placket and brown buttons.", base: () => null, expect: [["shirt", (c) => c.garmentType === "shirt"], ["linen", (c) => c.fabric.id.includes("linen")], ["mandarin", (c) => c.construction.collar === "mandarin"], ["hidden placket", (c) => c.construction.placket === "hidden"]] },
  { id: "edit-colours", prompt: "Make the sleeves navy and the buttons brown", base: shirt, expect: [["navy sleeves", (c) => (c.panels.sleeveLeft.color ?? "").toUpperCase() === "#1B2A47" || relativeLuminance(c.panels.sleeveLeft.color ?? "#FFFFFF") < 0.05], ["brown buttons", (c) => { const [h, s, l] = hexToHsl(c.construction.buttons.color); return h > 10 && h < 45 && s > 0.15 && l < 0.45; }]] },
  { id: "pocket-collar", prompt: "Change the collar to button-down and add a chest pocket", base: shirt, expect: [["button-down", (c) => c.construction.collar === "button-down"], ["pocket", (c) => c.construction.pocketCount >= 1]] },
  { id: "name-back", prompt: "Add the name 'ARJUN' across the back in Bebas Neue", base: () => createDesign("tee-classic-crew", "men"), expect: [["text on back", (c) => { const t = layer(c, "back", "text"); return !!t && t.type === "text" && t.text.toUpperCase().includes("ARJUN"); }], ["font", (c) => c.layers.some((l) => l.type === "text" && l.fontFamily === "Bebas Neue")]] },
  { id: "monogram", prompt: "Embroider the initials 'AK' on the left chest", base: () => createDesign("tee-classic-crew", "men"), expect: [["AK", (c) => c.layers.some((l) => l.type === "text" && l.text.includes("AK"))], ["embroidery", (c) => c.layers.some((l) => l.method === "embroidery") || c.printMethod === "embroidery"]] },
  { id: "length", prompt: "Make it 5 cm longer", base: () => createDesign("tee-classic-crew", "men"), expect: [["+5 cm", (c) => c.adjustments.bodyLength >= 4.5]] },
  { id: "womens", prompt: "A yellow women's T-shirt with a space rocket graphic on the front", base: () => null, expect: [["women", (c) => c.audience === "women"], ["yellow", (c) => { const [h, s] = hexToHsl(c.fabric.color); return h > 40 && h < 70 && s > 0.4; }], ["graphic", (c) => !!layer(c, "front")]] },
  { id: "gsm", prompt: "Use heavyweight 240 GSM cotton", base: () => createDesign("tee-classic-crew", "men"), expect: [["240", (c) => c.fabric.gsm === 240]] },
  { id: "unsupported", prompt: "Add a metal zipper down the front", base: shirt, expect: [["no zipper invented", (c, rejected) => rejected > 0 || JSON.stringify(c).indexOf("zipper") === -1]] },
  { id: "bigger-text", prompt: "Make the text bigger", base: withText, expect: [["larger", (c) => { const t = c.layers.find((l) => l.type === "text"); const o = withText().layers[0]; return !!t && t.type === "text" && o.type === "text" && t.fontSize > o.fontSize; }]] },
  { id: "preserve", prompt: "Change the colour to olive green", base: withText, expect: [["olive", (c) => { const [h] = hexToHsl(c.fabric.color); return h > 50 && h < 110; }], ["text kept", (c) => c.layers.some((l) => l.type === "text" && l.text === "HELLO")]] },
];

interface Provider {
  id: string;
  label: string;
  direct(prompt: string, base: DesignConfig | null): Promise<Direction | null>;
}

function modelProvider(id: string, label: string, call: (system: string, user: string) => Promise<string>): Provider {
  return {
    id, label,
    async direct(prompt, base) {
      const t0 = Date.now();
      const raw = await call(directorSystemPrompt(base), prompt);
      const proposal = parseProposal(raw);
      return proposal ? { provider: id, label, proposal, understood: proposal.rationale, latencyMs: Date.now() - t0 } : null;
    },
  };
}

const providers: Provider[] = [{ id: "local-rules", label: "Local rules (offline)", direct: async (p, b) => localDirector(p, b, lib, { defaultAudience: "men" }) }];
const env = process.env;
if (env.EVAL_OLLAMA_URL && env.EVAL_OLLAMA_MODEL) providers.push(modelProvider("ollama", `Ollama ${env.EVAL_OLLAMA_MODEL}`, (s, u) => callOllama(env.EVAL_OLLAMA_URL!, env.EVAL_OLLAMA_MODEL!, s, u)));
if (env.EVAL_GEMINI_KEY && env.EVAL_GEMINI_MODEL) providers.push(modelProvider("gemini", `Gemini ${env.EVAL_GEMINI_MODEL}`, (s, u) => callGemini(env.EVAL_GEMINI_KEY!, env.EVAL_GEMINI_MODEL!, s, u)));
if (env.EVAL_OPENAI_KEY && env.EVAL_OPENAI_MODEL) providers.push(modelProvider("openai", `OpenAI ${env.EVAL_OPENAI_MODEL}`, (s, u) => callOpenAI(env.EVAL_OPENAI_KEY!, env.EVAL_OPENAI_MODEL!, s, u)));

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const quantile = (xs: number[], q: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] : 0);

(async () => {
  const results: unknown[] = [];
  const rows: string[] = ["| Provider | Schema-valid | Compiled | Expectations met | Avg ops | Rejected items | Latency p50 / p95 |", "|---|---|---|---|---|---|---|"];
  for (const p of providers) {
    let valid = 0, compiled = 0, checks = 0, passed = 0, ops = 0, rejectedTotal = 0;
    const lat: number[] = [];
    const cases: unknown[] = [];
    for (const c of CASES) {
      const base = c.base();
      let dir: Direction | null = null;
      let error: string | undefined;
      try {
        dir = await p.direct(c.prompt, base);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      if (!dir) {
        cases.push({ id: c.id, valid: false, error: error ?? "invalid output" });
        checks += c.expect.length;
        continue;
      }
      valid++;
      lat.push(dir.latencyMs);
      const { compiled: r } = await runPipeline(dir, base, { lib, defaultAudience: "men" });
      if (r.ok) compiled++;
      ops += r.ops.length;
      rejectedTotal += r.rejected.length;
      const outcome = c.expect.map(([name, fn]) => ({ name, ok: (() => { try { return fn(r.config, r.rejected.length); } catch { return false; } })() }));
      checks += outcome.length;
      passed += outcome.filter((o) => o.ok).length;
      cases.push({ id: c.id, valid: true, compiled: r.ok, latencyMs: dir.latencyMs, ops: r.ops.length, rejected: r.rejected, conflicts: r.conflicts, expectations: outcome });
    }
    const summary = { provider: p.id, label: p.label, schemaValidPct: pct(valid, CASES.length), compiledPct: pct(compiled, CASES.length), expectationsPct: pct(passed, checks), avgOps: +(ops / Math.max(1, valid)).toFixed(1), rejectedItems: rejectedTotal, latencyP50: quantile(lat, 0.5), latencyP95: quantile(lat, 0.95) };
    results.push({ ...summary, cases });
    rows.push(`| ${p.label} | ${summary.schemaValidPct}% | ${summary.compiledPct}% | ${summary.expectationsPct}% (${passed}/${checks}) | ${summary.avgOps} | ${rejectedTotal} | ${summary.latencyP50} / ${summary.latencyP95} ms |`);
  }
  mkdirSync("docs/evaluation", { recursive: true });
  writeFileSync("docs/evaluation/ai-eval-results.json", JSON.stringify({ suite: CASES.map((c) => ({ id: c.id, prompt: c.prompt, expectations: c.expect.map(([n]) => n) })), results, note: "Generated by npm run ai:eval. Model providers run only when EVAL_* variables are set." }, null, 2));
  console.log(rows.join("\n"));
})();
