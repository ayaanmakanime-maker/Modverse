"""Builds the Human Studio look assets from CC0 MakeHuman asset packs (downloaded and extracted, not committed).

  public/avatars/human/parts/<kind>/<id>/{part.json, part.bin, diffuse.webp, thumb.webp}
      eyes, eyebrows, eyelashes, hair, bottoms, shoes, outfits — each fitted to the body through its .mhclo
  public/avatars/human/skins/*.webp        skin textures (three complexions × sex)
  public/avatars/human/eyes/*.webp         iris textures
  public/avatars/human/base-<sex>.webp     base-layer mask (briefs; for women also a top) in the body's UV space
  public/avatars/human/parts.json          index with name, kind, licence, creator

Only parts whose own files state CC0 are imported (an old AGPL or CC BY header excludes the part).
Usage: python -I scripts/human/build_parts.py <mpfb.zip> <packs dir> <repo root>     (numpy + Pillow)
"""
import json
import os
import re
import sys
import zipfile

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_human import DM_TO_CM, read_obj, read_target  # noqa: E402


def licence_of(text):
    head = "\n".join(l for l in text.splitlines()[:40] if l.startswith("#") or l.lower().startswith("license"))
    if re.search(r"agpl|cc[ _-]?by", head, re.I):
        return None
    return "CC0-1.0" if re.search(r"cc[ -]?0", head, re.I) else None


def author_of(text):
    m = re.search(r"^#\s*author[: ]+(.+)$", text, re.M | re.I)
    if m:
        return m.group(1).strip()
    return "MakeHuman team (Data Collection AB, Joel Palmius, Jonas Hauquier)" if "Data Collection AB" in text[:900] else "MakeHuman community"


def parse_mhclo(txt):
    scales, binds, delete, mode, objn, mat = {}, [], [], None, None, None
    for line in txt.splitlines():
        p = line.split()
        if not p or p[0].startswith("#"):
            continue
        if p[0] == "obj_file":
            objn = line.split(None, 1)[1].strip()
        elif p[0] == "material":
            mat = line.split(None, 1)[1].strip()
        elif p[0] in ("x_scale", "y_scale", "z_scale"):
            scales[p[0][0]] = {"a": int(p[1]), "b": int(p[2]), "den": float(p[3])}
        elif re.match(r"[lr]_shear_[xyz]$", p[0]):
            scales.setdefault(p[0][-1], {"a": int(p[1]), "b": int(p[2]), "den": float(p[3]) - float(p[4])})
        elif p[0] == "verts":
            mode = "verts"
        elif p[0] == "delete_verts":
            mode = "delete"
        elif mode == "verts" and re.match(r"^-?\d", p[0]):
            if len(p) >= 9:
                binds.append(([int(p[0]), int(p[1]), int(p[2])], [float(p[3]), float(p[4]), float(p[5])], [float(p[6]), float(p[7]), float(p[8])]))
            elif len(p) == 1:
                binds.append(([int(p[0])] * 3, [1.0, 0.0, 0.0], [0.0, 0.0, 0.0]))
        elif mode == "delete":
            toks = line.replace("-", " - ").split()
            k = 0
            while k < len(toks):
                if k + 2 < len(toks) and toks[k + 1] == "-":
                    delete.extend(range(int(toks[k]), int(toks[k + 2]) + 1)); k += 3
                elif toks[k].isdigit():
                    delete.append(int(toks[k])); k += 1
                else:
                    k += 1
        elif p[0] not in ("verts", "delete_verts"):
            mode = None if mode == "verts" and binds else mode
    return objn, mat, scales, binds, delete


def ranges(dl, n):
    dl = sorted(set(d for d in dl if 0 <= d < n))
    out, k = [], 0
    while k < len(dl):
        j = k
        while j + 1 < len(dl) and dl[j + 1] == dl[j] + 1:
            j += 1
        out.append([dl[k], dl[j]]); k = j + 1
    return out


def save_webp(src, dst, size, quality=82):
    im = Image.open(src)
    im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
    if max(im.size) > size:
        im.thumbnail((size, size), Image.LANCZOS)
    im.save(dst, "WEBP", quality=quality, method=6)
    return im.mode == "RGBA"


def build_part(src_dir, kind, pid, out_root, n_body, name=None, sex=None, tex_size=1024):
    mh = [f for f in os.listdir(src_dir) if f.endswith(".mhclo")]
    if not mh:
        return None
    txt = open(os.path.join(src_dir, mh[0]), encoding="utf8", errors="replace").read()
    lic = licence_of(txt)
    if not lic or "basemesh hm08" not in txt:
        return {"skipped": pid, "reason": "no CC0 statement in the file" if not lic else "not hm08"}
    objn, mat, scales, binds, delete = parse_mhclo(txt)
    V, VT, faces, _ = read_obj(open(os.path.join(src_dir, objn), encoding="utf8", errors="replace").read())
    if len(binds) != len(V):
        return {"skipped": pid, "reason": f"binding count {len(binds)} != vertices {len(V)}"}
    key_to_r, orig, uvs, tris = {}, [], [], []
    for f in faces:
        ids = []
        for vi, ti in f:
            k = (vi, ti)
            if k not in key_to_r:
                key_to_r[k] = len(orig); orig.append(vi); uvs.append(VT[ti] if ti >= 0 and len(VT) else (0.0, 0.0))
            ids.append(key_to_r[k])
        for j in range(1, len(ids) - 1):
            tris.append((ids[0], ids[j], ids[j + 1]))
    refs = np.array([binds[i][0] for i in orig], np.uint16)
    wts = np.clip(np.round(np.array([binds[i][1] for i in orig]) * 16384), -32767, 32767).astype(np.int16)
    offs = np.clip(np.round(np.array([binds[i][2] for i in orig]) * 1e4), -32767, 32767).astype(np.int16)
    out = os.path.join(out_root, "parts", kind, pid)
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "part.bin"), "wb") as fo:
        fo.write(np.array(tris, np.uint32).tobytes()); fo.write(np.array(uvs, np.float32).tobytes())
        fo.write(refs.tobytes()); fo.write(wts.tobytes()); fo.write(offs.tobytes())
    color, tex, alpha, two_sided = [0.8, 0.8, 0.8], None, False, True
    if mat and os.path.exists(os.path.join(src_dir, mat)):
        for line in open(os.path.join(src_dir, mat), encoding="utf8", errors="replace"):
            p = line.split()
            if len(p) >= 4 and p[0] == "diffuseColor":
                color = [float(p[1]), float(p[2]), float(p[3])]
            elif len(p) >= 2 and p[0] == "diffuseTexture":
                tex = line.split(None, 1)[1].strip()
            elif len(p) >= 2 and p[0] == "backfaceCull":
                two_sided = p[1].lower() != "true"
    if tex and os.path.exists(os.path.join(src_dir, tex)):
        alpha = save_webp(os.path.join(src_dir, tex), os.path.join(out, "diffuse.webp"), tex_size)
    else:
        tex = None
    thumbs = [f for f in os.listdir(src_dir) if f.endswith(".thumb")]
    if thumbs:
        try:
            save_webp(os.path.join(src_dir, thumbs[0]), os.path.join(out, "thumb.webp"), 128, 80)
        except Exception:
            thumbs = []
    tags = re.findall(r"^tag (.+)$", txt, re.M)
    if sex is None:
        low = (pid + " " + " ".join(tags)).lower()
        sex = "female" if re.search(r"female|woman|heroine|ladies|stiletto|ballet|flats|t-bar", low) else "male" if re.search(r"\bmale|\bmen|hero_", low) else None
    meta = {"id": pid, "kind": kind, "name": name or pid.split("_", 1)[-1].replace("_", " ").replace("-", " ").title(), "sex": sex, "vertices": len(orig), "triangles": len(tris), "scales": scales,
            "hideBody": ranges(delete, n_body), "texture": bool(tex), "alpha": alpha, "twoSided": two_sided, "color": color, "thumb": bool(thumbs), "licence": lic, "creator": author_of(txt)}
    with open(os.path.join(out, "part.json"), "w") as fo:
        json.dump(meta, fo, separators=(",", ":"))
    return meta


def base_layer_masks(zip_path, out_root):
    """Briefs (and a top for women) painted in the body's UV space from the faces of the pelvis / chest."""
    z = zipfile.ZipFile(zip_path)
    V, VT, faces, groups = read_obj(z.read("data/3dobjs/base.obj").decode("utf8"))
    meta = json.load(open(os.path.join(out_root, "hm08.json")))
    names = set(z.namelist())
    def T(stem):
        p = next(x for x in sorted(names) if x.startswith("data/targets/macrodetails") and x.endswith(f"/{stem}.target.gz"))
        return read_target(z, p, len(V))
    buf = np.fromfile(os.path.join(out_root, "hm08.bin"), np.uint8)
    lay = meta["layout"]["skin.joints"]
    J = buf[lay["offset"]:lay["offset"] + lay["length"]].reshape(-1, 4)
    bone = [b["name"] for b in meta["bones"]]
    dom = [bone[j[0]] for j in J]
    head = {b["name"]: b["head"]["verts"] for b in meta["bones"]}
    for sex in ("male", "female"):
        P = (V + sum(T(f"{e}-{sex}-young") for e in ("african", "asian", "caucasian")) / 3.0) * DM_TO_CM
        jy = lambda b: float(P[head[b]][:, 1].mean())
        upleg, hips, spine2, arm = jy("LeftUpLeg"), jy("Hips"), jy("Spine2"), jy("LeftArm")
        S = 2048
        im = Image.new("L", (S, S), 0)
        dr = ImageDraw.Draw(im)
        for f, g in zip(faces, groups):
            if g != "body":
                continue
            vs = [vi for vi, _ in f]
            cy = float(P[vs][:, 1].mean())
            d = [dom[v] for v in vs]
            pelvis = all(x in ("Hips", "Spine", "LeftUpLeg", "RightUpLeg") for x in d) and upleg - 9.5 < cy < hips + 1.0
            top = sex == "female" and all(x in ("Spine1", "Spine2", "Spine", "LeftShoulder", "RightShoulder") for x in d) and spine2 - 7.0 < cy < arm - 5.0
            if pelvis or top:
                dr.polygon([(VT[ti][0] * S, (1 - VT[ti][1]) * S) for _, ti in f], fill=255)
        im = im.resize((1024, 1024), Image.LANCZOS)
        rgba = Image.merge("RGBA", (Image.new("L", im.size, 255),) * 3 + (im,))
        rgba.save(os.path.join(out_root, f"base-{sex}.webp"), "WEBP", quality=90, method=6)


def main(zip_path, packs, root):
    out_root = os.path.join(root, "public/avatars/human")
    n_body = json.load(open(os.path.join(out_root, "hm08.json")))["vertices"]
    sysd = os.path.join(packs, "x_makehuman_system_assets")
    index, skipped = [], []
    def add(src, kind, pid, **kw):
        if not os.path.isdir(src):
            return
        m = build_part(src, kind, pid, out_root, n_body, **kw)
        if m and "skipped" in m:
            skipped.append(m)
        elif m:
            index.append({k: m[k] for k in ("id", "kind", "name", "sex", "vertices", "texture", "alpha", "thumb", "licence", "creator")})
    add(os.path.join(sysd, "eyes/low-poly"), "eyes", "low-poly", name="Eyes")
    for k in range(1, 9):
        add(os.path.join(sysd, f"eyebrows/eyebrow{k:03d}"), "eyebrows", f"eyebrow{k:03d}", name=f"Brows {k}", tex_size=512)
    for k in range(1, 5):
        add(os.path.join(sysd, f"eyelashes/eyelashes{k:02d}"), "eyelashes", f"eyelashes{k:02d}", name=f"Lashes {k}", tex_size=512)
    for h in sorted(os.listdir(os.path.join(sysd, "hair"))):
        add(os.path.join(sysd, "hair", h), "hair", h, name=re.sub(r"(\d+)$", r" \1", h).title())
    hp = os.path.join(packs, "x_hair01/hair")
    for h in sorted(os.listdir(hp)):
        if h in ("learning_anime_hair", "cortu_shaggy_green_hair", "cortu_strawberry_cloud_hair"):
            continue
        add(os.path.join(hp, h), "hair", h)
    pp = os.path.join(packs, "x_pants01/clothes")
    for h in sorted(os.listdir(pp)):
        add(os.path.join(pp, h), "bottoms", h)
    sp = os.path.join(packs, "x_shoes01/clothes")
    for h in sorted(os.listdir(sp)):
        if re.search(r"hero|pirate|gogo|water|overknee", h):
            continue
        add(os.path.join(sp, h), "shoes", h)
    cp = os.path.join(sysd, "clothes")
    for h in sorted(os.listdir(cp)):
        if re.match(r"shoes\d+", h):
            add(os.path.join(cp, h), "shoes", h, name=re.sub(r"(\d+)$", r" \1", h).title())
        elif re.search(r"suit\d+$", h):
            add(os.path.join(cp, h), "outfits", h, name=h.replace("_", " ").replace("suit", " suit ").title().replace("  ", " "))
    # skins and eyes
    os.makedirs(os.path.join(out_root, "skins"), exist_ok=True)
    os.makedirs(os.path.join(out_root, "eyes"), exist_ok=True)
    skins = []
    for tone, folder in (("light", "caucasian"), ("medium", "asian"), ("deep", "african")):
        for sex in ("male", "female"):
            d = os.path.join(sysd, "skins", f"young_{folder}_{sex}")
            mat = open(os.path.join(d, f"young_{folder}_{sex}.mhmat"), encoding="utf8", errors="replace").read()
            if not licence_of(mat):
                raise SystemExit(f"skin {d} has no CC0 statement")
            tex = re.search(r"^diffuseTexture (.+)$", mat, re.M).group(1).strip()
            save_webp(os.path.join(d, tex), os.path.join(out_root, "skins", f"{tone}-{sex}.webp"), 2048, 84)
            skins.append({"id": f"{tone}-{sex}", "tone": tone, "sex": sex})
    eyes = []
    for f in sorted(os.listdir(os.path.join(sysd, "eyes/materials"))):
        if f.endswith("_eye.png"):
            eid = f[:-8]
            save_webp(os.path.join(sysd, "eyes/materials", f), os.path.join(out_root, "eyes", f"{eid}.webp"), 512, 88)
            eyes.append(eid)
    base_layer_masks(zip_path, out_root)
    with open(os.path.join(out_root, "parts.json"), "w") as fo:
        json.dump({"format": "modverse-human-parts/1", "source": "MakeHuman system assets and community asset packs hair01, pants01, shoes01 (CC0 items only)", "parts": index, "skins": skins, "eyes": eyes, "skipped": skipped}, fo, separators=(",", ":"))
    kinds = {}
    for m in index:
        kinds[m["kind"]] = kinds.get(m["kind"], 0) + 1
    print("parts", kinds, "skipped", len(skipped), [s["skipped"] + ": " + s["reason"] for s in skipped][:40])


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
