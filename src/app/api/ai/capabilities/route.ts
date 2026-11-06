import { route } from "@/lib/api/handler";
import { ADAPTERS, AI_CAPABILITIES, activeAdapters } from "@/lib/ai/capabilities";
import { getActiveIntegration } from "@/lib/integrations/config";

/** Which adapter answers each AI capability right now (paid/hosted providers are inactive unless an admin enabled them). */
export const GET = route({}, async () => {
  const optional = [...new Set(ADAPTERS.map((a) => a.requires).filter((x): x is string => !!x))];
  const enabled: string[] = [];
  for (const id of optional) if (await getActiveIntegration(id)) enabled.push(id);
  const active = activeAdapters(enabled);
  return {
    capabilities: AI_CAPABILITIES.map((c) => ({ capability: c, active: active[c]?.id ?? null, adapters: ADAPTERS.filter((a) => a.capability === c).map((a) => ({ ...a, enabled: !a.requires || enabled.includes(a.requires) })) })),
  };
});
