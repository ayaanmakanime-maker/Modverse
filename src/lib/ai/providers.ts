import "server-only";
import { z } from "zod";
import { getActiveIntegration } from "../integrations/config";
import { designOpSchema, type ResolvedAsset } from "../garment/operations";
import type { DesignConfig } from "../garment/schema";
import { GARMENT_MODELS } from "../garment/models";
import { FABRICS } from "../garment/fabrics";
import { getLibrary } from "../library/server";
import { COLLECTIONS } from "../library/collections";
import type { MuseReply } from "./muse";

/**
 * Provider-independent language-model adapters for The Muse.
 * A provider proposes {message, ops}; ops MUST parse as DesignOps (allowlisted,
 * schema-validated) and are applied by the same engine as local rules. Invalid
 * output is discarded and the local engine answers instead.
 */
const llmReply = z.object({ message: z.string().max(1200), ops: z.array(designOpSchema).max(30).default([]) });

function systemPrompt(config: DesignConfig | null): string {
  return [
    "You are The Muse, ModVerse's fashion design director. You edit garment designs ONLY by returning JSON.",
    'Respond with exactly: {"message": string, "ops": DesignOp[]}. No prose outside JSON.',
    "DesignOp kinds: reset{modelId,audience}, setModel{modelId}, set{path,value}, adjust{path,delta}, addText{text,preset,style?}, addGraphic{assetId,preset,scale?}, updateLayer{target,changes}, removeLayer{target}, duplicateLayer{target}.",
    "Allowed set paths: fit, size, printMethod, fabric.id|gsm|color, construction.<neckline|collar|placket|sleeveLength|sleeveStyle|cuff|hemShape|sideSlits|pocketCount|pocketStyle|backYoke|backPleat|darts|buttons.color|buttons.material|stitching.color|stitching.contrast>, adjustments.<bodyWidth|bodyLength|shoulderWidth|sleeveLength|sleeveWidth|neckDrop|neckWidth|hemCurve|waistShaping> (cm), panels.<front|back|sleeveLeft|sleeveRight|collar|cuffs|pocket|placket|yoke>.color|patternId.",
    "Colours are #RRGGBB. Presets: center-chest, full-front, left-chest, right-chest, upper-back, full-back, nape, left-sleeve, right-sleeve, pocket, hem, collar, cuff, yoke.",
    `Models: ${GARMENT_MODELS.map((m) => `${m.id}(${m.garmentType})`).join(", ")}.`,
    `Fabrics: ${FABRICS.map((f) => `${f.id}[${f.garmentTypes.join("/")}]`).join(", ")}.`,
    `Library graphic ids look like MVG_001..MVG_500 grouped in collections: ${COLLECTIONS.map((c) => c.slug).join(", ")} (25 graphics each, in order). Patterns MVP_001..MVP_100 (5 per collection).`,
    "Never invent capabilities. If something is unsupported, say so in message and return no op for it.",
    `Current design: ${config ? JSON.stringify({ ...config, layers: config.layers.map((l) => ({ id: l.id, type: l.type, zone: l.zone, name: l.name })) }) : "none (create a new one)"}`,
  ].join("\n");
}

async function callOllama(baseUrl: string, model: string, system: string, user: string): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: false, format: "json", messages: [{ role: "system", content: system }, { role: "user", content: user }], options: { temperature: 0.2 } }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? "";
}

async function callOpenAI(apiKey: string, model: string, system: string, user: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

export async function languageProviderRespond(message: string, config: DesignConfig | null, opts: { selectedLayerId: string | null }): Promise<MuseReply | null> {
  const ollama = await getActiveIntegration("ollama");
  const openai = ollama ? null : await getActiveIntegration("openai");
  if (!ollama && !openai) return null;
  const system = systemPrompt(config);
  try {
    const raw = ollama ? await callOllama(ollama.credentials.baseUrl, ollama.credentials.model, system, message) : await callOpenAI(openai!.credentials.apiKey, openai!.credentials.model, system, message);
    const parsed = llmReply.safeParse(JSON.parse(raw));
    if (!parsed.success) return null; // invalid model output → local fallback
    const lib = getLibrary();
    const assets: Record<string, ResolvedAsset> = {};
    for (const op of parsed.data.ops) {
      if (op.op === "addGraphic") {
        const a = lib.get(op.assetId);
        if (!a?.url) return null;
        assets[a.id] = { id: a.id, name: a.name, url: a.kind === "template" ? (a.baseUrl ?? a.url) : a.url, width: a.width, height: a.height };
      }
    }
    void opts;
    return {
      source: ollama ? "ollama" : "openai",
      message: parsed.data.message,
      applied: { ops: parsed.data.ops, understood: [`Generated by ${ollama ? `Ollama (${ollama.credentials.model})` : `OpenAI (${openai!.credentials.model})`} — validated as structured design operations`], unsupported: [], assets, mode: parsed.data.ops.some((o) => o.op === "reset") ? "create" : "edit" },
      suggestions: [],
    };
  } catch (e) {
    console.warn("[muse] provider failed, using local rules", e instanceof Error ? e.message : e);
    return null;
  }
}
