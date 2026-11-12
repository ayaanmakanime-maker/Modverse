# 3D export formats

Every garment shown in 3D can be downloaded in twelve formats from one **Export 3D** panel, grouped like a typical export studio:

| Group | Format | File | Units | What it keeps |
|---|---|---|---|---|
| 3D model & web | **GLB** (default) | `.glb` | metres | geometry, UVs, normals, materials, textures, artwork |
| | GLTF | `.gltf` (embedded data) | metres | same as GLB, as JSON |
| | OBJ | `.zip` (`.obj` + `.mtl` + `textures/`) | metres | geometry, UVs, normals, colours, texture maps |
| | FBX | `.fbx` (7.4 binary) | centimetres | geometry, UVs, normals, materials, embedded textures |
| | PLY | `.ply` (binary) | metres | geometry, normals, UVs, vertex colours |
| Apple / spatial | USD | `.zip` (`.usda` + sub-layers + textures) | metres | geometry, UVs, materials, textures |
| | USDZ | `.usdz` | metres | AR Quick Look package (iPhone, iPad, Vision Pro) |
| | USDC | `.zip` (`model.usdc` + textures) | metres | binary crate, flattened (one file) — **needs OpenUSD on the server** |
| Manufacturing / 3D printing | STL | `.stl` (binary) | millimetres | geometry |
| | 3MF | `.3mf` | millimetres | geometry, colour per part |
| | OBJ (mm) | `.zip` | millimetres | geometry, UVs, materials for slicers and CAD |
| | DXF | `.dxf` (R12) | millimetres | 3D faces, one layer per part |

Where: the 3D collection garment page (`/collection/[id]`, plus the ZIP project with artwork and credit) and the design editor in every mode (**Export 3D** above the 3D view). Atelier Pro's tech pack keeps its GLB button. A worn garment (Atelier Pro avatar) is exported in its worn shape; the avatar itself is not included.

## How it works
* `src/lib/three/export3d.ts` bakes the visible scene once into static world-space meshes (skinning applied, mirrored transforms re-wound, multi-material meshes split) and feeds every format from that.
* GLB / glTF / USDZ use three.js's exporters on a metre-scaled copy. USD (text) is the USDZ's layers re-packed as a ZIP.
* FBX, 3MF, DXF, OBJ + MTL, PLY and STL are ModVerse's own writers (`src/lib/three/export-writers.ts`), written from the public format descriptions.
* USDC: the browser sends the USDZ to `POST /api/export/usdc` (signed-in users, rate-limited, 64 MB max). The server runs `scripts/usd/usdz_to_usdc.py` with the Python named in `MODVERSE_USD_PYTHON` (needs `pip install usd-core`), which extracts only `.usda/.usdc/.png/.jpg` members inside a private temporary folder, flattens the stage into one crate, makes texture paths relative and returns a ZIP; a 60-second time limit applies. Without `MODVERSE_USD_PYTHON` the button explains that USDC needs OpenUSD and points to USDZ / USD.
* Licence credits of 3D collection garments travel inside the files (FBX creator, OBJ / PLY / DXF comments, glTF extras, README in ZIPs).

## Verification (this build)
A real 3D collection garment (5,140 vertices, 8,056 triangles, 104.5 cm wide, textured) was exported in every format from the running app and re-opened with independent readers:

| Format | Reader | Result |
|---|---|---|
| GLB, OBJ, PLY, STL, USDZ, USD, USDC | Blender 5.3 importers | 5,140 vertices / 8,056 faces each (STL: 4,685 welded vertices), 1.045 m wide (STL 1,045 mm), UVs, material and texture where the format has them |
| FBX | Blender 5.3 FBX importer | FBX 7400, 5,140 / 8,056, 1.045 m, UVs, material, embedded texture |
| USDC | OpenUSD 26.11 + Blender | `PXR-USDC` crate, mesh and texture load |
| DXF | ezdxf | 8,056 `3DFACE` entities, −517 … 515 mm |
| 3MF | trimesh | extents 1,045 × 678 × 382 mm |

Automated: `tests/unit/export-writers.test.ts` (each writer re-read), `tests/e2e/garment-library.spec.ts` (all formats from the 3D collection), `tests/e2e/export3d.spec.ts` (editor export, units checked in GLB and STL).

**Not done:** no rig, animation or cloth-simulation data is exported (garments are static meshes). DXF is a 3D mesh, not flat sewing-pattern pieces (ModVerse's parametric panels are not graded production patterns). The real-device check of USDZ in AR Quick Look on an iPhone / Vision Pro has not been done.
