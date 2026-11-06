export const metadata = { title: "How we label prototypes" };
export default function Page() {
  const rows = [
    ["Size recommendations", "Measurement-based estimates comparing garment dimensions with your body. Never verified fit."],
    ["Avatars", "Atlas, Aura and Nova are rigged parametric bodies generated from measurements (stylised heads) — not exact body scans."],
    ["3D garments", "Parametric visualisations of construction and proportions — not physics-simulated cloth or factory patterns."],
    ["Virtual trial room", "Pose-tracked overlays (Levels A/B) and experimental occlusion (Level C). Not physically accurate clothing."],
    ["Fabric properties", "Typical industry ranges for visualisation and rules — not lab-tested values of a specific mill."],
    ["Tech packs, BOM, CAD exports", "Design-intent documents. Pattern making, grading and production approval must be done by qualified professionals and the manufacturer."],
    ["AI Muse", "Local deterministic rules unless an admin connects a language model; every answer is labelled with its source."],
    ["AI artwork", "Only generated when a provider is configured. Nothing is faked."],
    ["Payments", "Simulated and clearly labelled unless a payment provider is configured. Real payments are only confirmed after verified provider signatures."],
    ["Manufacturing & shipping", "Orders are made and shipped by manufacturing and logistics partners that ModVerse approves; they work in the ModVerse partner portals. Courier tracking numbers and labels are issued by ModVerse until a courier integration is connected, so tracking happens on ModVerse rather than on the courier website."],
  ];
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mv-display text-5xl">How we label prototypes</h1>
      <p className="mt-4 text-bone-2">ModVerse is built to be genuinely useful — and honest about what is an estimate, a visualisation, or a simulation.</p>
      <dl className="mt-8 divide-y divide-line">{rows.map(([k, v]) => <div key={k} className="grid gap-1 py-4 sm:grid-cols-[220px_1fr]"><dt className="font-medium">{k}</dt><dd className="text-sm text-bone-2">{v}</dd></div>)}</dl>
    </div>
  );
}
