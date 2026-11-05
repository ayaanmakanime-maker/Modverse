# 3D system

Browser 3D with **Three.js 0.187 + React Three Fiber 9 + drei 10** (`src/components/three/GarmentViewer.tsx`). Scene units are **centimetres** (garment faces +Z, wearer's left = +X, HPS at y = 0).

## Parametric geometry (`src/lib/three/garment-geometry.ts`, pure TS, unit-tested for all 92 model/category combinations)
* **Torso panels:** a fine grid clipped to the flat panel outline (boundary vertices snapped to the outline, so V-necks, curved hems and armholes are exact), bent around a **superelliptic body section** whose depth tapers toward the shoulders; front/back meet at side and shoulder seams; the neck opening comes from the real neckline.
* **Sleeves:** lofted from the actual 3D **armhole loop** (sampled from both panels) to an elliptical cuff ring along an arm direction that depends on set-in / raglan / drop-shoulder; UVs follow the flat sleeve so sleeve artwork reads correctly from outside.
* **Collars:** rib band (crew/V/henley), funnel (mock), shirt stand + **collar leaf** whose fall, tip length and spread depend on point/spread/cutaway/button-down/club/camp; mandarin/band stands with rounded or square fronts.
* **Details:** placket strip, buttons/snaps (oriented to surface normals; pearl/metal/horn materials), patch and flap pockets (pocket artwork textured), rib and shirt cuffs.
* Every construction/proportion change rebuilds geometry (≈20 ms per garment).

## Materials & textures
* Panel textures are the composer's zone SVGs rasterised to canvases (fonts embedded as data URLs) — identical to the 2D editor.
* `MeshPhysicalMaterial` with fabric roughness, **sheen** for cloth, and a procedural tileable **weave relief** (jersey, slub, piqué, oxford, twill, denim, linen, flannel, satin, …) at physical scale (`src/lib/three/fabric-textures.ts`). Visual only — not measured material data.
* Lighting presets (studio / daylight / evening), locally generated soft environment (no HDR downloads), cm-scaled shadow camera, contact shadows.

## Viewer
360° orbit, zoom, pan, view presets (front/back/side/¾), lighting presets, avatar toggle, PNG capture for mockups. WebGL absence is detected and explained; the rest of the editor keeps working.

## Avatar (`src/lib/three/avatar.ts`)
Parametric mannequin from body measurements (height, chest, waist, hip, shoulder, arm, neck, bicep, wrist), body type, build, skin tone and hair. Arms follow the sleeve angle. It is a **visual representation**, not a body scan.

## Limitations
No cloth physics, wrinkles or self-collision; geometry is a proportional visualisation, not a pattern; very extreme adjustments can produce stylised shapes (validation flags them).
