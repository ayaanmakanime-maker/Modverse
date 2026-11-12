import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { inspectFbx, write3mf, writeDxf, writeFbx, writeObjZip, writePly, writeStl, type ExportMesh } from "@/lib/three/export-writers";

/** A unit cube (12 triangles) and a textured quad. */
function cube(): ExportMesh {
  const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6], [1, 2, 6], [1, 6, 5], [0, 4, 7], [0, 7, 3]];
  return { name: "Body panel", positions: Float32Array.from(v.flat()), normals: Float32Array.from(v.flat().map((x) => x - 0.5)), uvs: Float32Array.from(v.flatMap(([x, y]) => [x, y])), indices: Uint32Array.from(f.flat()), color: [0.2, 0.3, 0.5], roughness: 0.7 };
}
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const quad = (): ExportMesh => ({ name: "Decal", positions: Float32Array.of(0, 0, 2, 1, 0, 2, 1, 1, 2, 0, 1, 2), uvs: Float32Array.of(0, 0, 1, 0, 1, 1, 0, 1), indices: Uint32Array.of(0, 1, 2, 0, 2, 3), color: [1, 1, 1], opacity: 1, texture: { name: "art", png: PNG } });

describe("3D export writers", () => {
  it("STL: binary header, triangle count and size", () => {
    const b = writeStl([cube(), quad()]);
    const dv = new DataView(b.buffer);
    expect(dv.getUint32(80, true)).toBe(14);
    expect(b.length).toBe(84 + 14 * 50);
  });
  it("PLY: header declares vertices, faces, normals only when every mesh has them, colours", () => {
    const b = writePly([cube()]);
    const head = strFromU8(b.slice(0, 400)).split("end_header")[0];
    expect(head).toContain("element vertex 8");
    expect(head).toContain("element face 12");
    expect(head).toContain("property float nx");
    expect(head).toContain("property uchar red");
    expect(strFromU8(writePly([cube(), quad()]).slice(0, 400))).not.toContain("property float nx");
  });
  it("OBJ zip: obj + mtl + texture, faces reference the right offsets", () => {
    const files = unzipSync(writeObjZip([cube(), quad()], "My Tee", "credit line"));
    const obj = strFromU8(files["My_Tee.obj"]);
    expect(obj).toContain("mtllib My_Tee.mtl");
    expect(obj.match(/^v /gm)).toHaveLength(12);
    expect(obj.match(/^f /gm)).toHaveLength(14);
    expect(obj).toContain("f 9/9 10/10 11/11"); // second mesh continues after 8 vertices / 8 uvs
    expect(strFromU8(files["My_Tee.mtl"])).toMatch(/map_Kd textures\/art_1\.png/);
    expect(files["textures/art_1.png"]).toEqual(PNG);
  });
  it("3MF: core package with millimetre model, objects, triangles and colours", () => {
    const files = unzipSync(write3mf([cube()], "Tee"));
    expect(Object.keys(files).sort()).toEqual(["3D/3dmodel.model", "[Content_Types].xml", "_rels/.rels"]);
    const model = strFromU8(files["3D/3dmodel.model"]);
    expect(model).toContain('unit="millimeter"');
    expect(model.match(/<vertex /g)).toHaveLength(8);
    expect(model.match(/<triangle /g)).toHaveLength(12);
    expect(model).toMatch(/displaycolor="#[0-9A-F]{6}"/);
  });
  it("DXF: R12 with one 3DFACE per triangle on a layer per mesh", () => {
    const d = writeDxf([cube(), quad()], "ModVerse");
    expect(d).toContain("AC1009");
    expect(d.match(/\n3DFACE\n/g)).toHaveLength(14);
    expect(d).toContain("BODY_PANEL_0");
    expect(d.trimEnd().endsWith("EOF")).toBe(true);
  });
  it("FBX: binary 7.4 that reads back with models, geometry counts, materials and the embedded texture", () => {
    const b = writeFbx([cube(), quad()], { creator: "ModVerse test", now: new Date("2026-11-11T10:00:00Z") });
    expect(new TextDecoder().decode(b.slice(0, 20))).toBe("Kaydara FBX Binary  ");
    const r = inspectFbx(b);
    expect(r.version).toBe(7400);
    expect(r.models).toBe(2);
    expect(r.materials).toBe(2);
    expect(r.textures).toBe(1);
    expect(r.geometries).toEqual([{ vertices: 8, polygonIndices: 36 }, { vertices: 4, polygonIndices: 6 }]);
  });
});
