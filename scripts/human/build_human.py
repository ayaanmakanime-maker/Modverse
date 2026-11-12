"""Builds the ModVerse Human Studio runtime assets from the CC0 MakeHuman data bundled with MPFB 2.

Inputs (not committed): the MPFB 2 add-on archive (its `data/` folder is CC0: base mesh hm08, targets, rigs and
weights), and the original MakeHuman garment files that `npm run assets:acquire` restores into
public/garment-library/**/original/ (their .mhclo fitting data).

Outputs (committed):
  public/avatars/human/hm08.json + hm08.bin   body: male / female bases, render mesh, skin weights, morph targets
  public/garment-library/<path>/fit.json + fit.bin   per garment: .mhclo binding of every GLB vertex to the body

Only data is read; no MakeHuman / MPFB code is used. Usage (Python 3 with numpy):
  python -I scripts/human/build_human.py <mpfb.zip> <repo root>
"""
import gzip
import json
import os
import re
import struct
import sys
import zipfile

import numpy as np

DM_TO_CM = 10.0


def read_obj(text):
    v, vt, faces, groups = [], [], [], []
    group = None
    for line in text.splitlines():
        if line.startswith("v "):
            v.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("vt "):
            vt.append([float(x) for x in line.split()[1:3]])
        elif line.startswith("g "):
            group = line.split(None, 1)[1].strip()
        elif line.startswith("f "):
            refs = [p.split("/") for p in line.split()[1:]]
            faces.append([(int(r[0]) - 1, int(r[1]) - 1 if len(r) > 1 and r[1] else -1) for r in refs])
            groups.append(group)
    return np.array(v, np.float64), np.array(vt, np.float64), faces, groups


def read_target(z, name, n):
    raw = z.read(name)
    if name.endswith(".gz"):
        raw = gzip.decompress(raw)
    idx, d = [], []
    for line in raw.decode("utf8").splitlines():
        p = line.split()
        if len(p) == 4 and not line.startswith("#"):
            idx.append(int(p[0]))
            d.append([float(p[1]), float(p[2]), float(p[3])])
    out = np.zeros((n, 3))
    if idx:
        out[np.array(idx)] = np.array(d)
    return out


def sparse(delta, eps=1e-6):
    m = np.abs(delta).max(axis=1) > eps
    i = np.nonzero(m)[0].astype(np.uint32)
    return i, (delta[i] * DM_TO_CM).astype(np.float32)


def main(zip_path, root):
    z = zipfile.ZipFile(zip_path)
    names = set(z.namelist())
    header = z.read("data/3dobjs/base.obj").decode("utf8")
    if "released as CC0" not in header[:600]:
        raise SystemExit("base.obj does not carry the CC0 statement: stop")
    V, VT, faces, fgroups = read_obj(header)
    n = len(V)

    def tpath(cat, stem):
        for p in sorted(names):
            if p.startswith(f"data/targets/{cat}") and (p.endswith(f"/{stem}.target.gz") or p.endswith(f"/{stem}.target")):
                return p
        raise SystemExit(f"missing target {cat}/{stem}")

    T = lambda cat, stem: read_target(z, tpath(cat, stem), n)

    # gender bases: neutral hm08 + the young / average muscle / average weight macro of each sex
    base = {}
    macros = {}
    for g in ("male", "female"):
        # MakeHuman's default macro mix: equal parts of the three ethnic shapes for this sex at "young" (adult) age;
        # the universal average-muscle / average-weight target is the zero point of the weight / muscle targets
        ethnic = sum(T("macrodetails", f"{e}-{g}-young") for e in ("african", "asian", "caucasian")) / 3.0
        avg = T("macrodetails", f"universal-{g}-young-averagemuscle-averageweight")
        base[g] = (V + ethnic + avg) * DM_TO_CM
        macros[g] = {
            "weight+": T("macrodetails", f"universal-{g}-young-averagemuscle-maxweight") - avg,
            "weight-": T("macrodetails", f"universal-{g}-young-averagemuscle-minweight") - avg,
            "muscle+": T("macrodetails", f"universal-{g}-young-maxmuscle-averageweight") - avg,
            "muscle-": T("macrodetails", f"universal-{g}-young-minmuscle-averageweight") - avg,
            "height+": T("macrodetails", f"{g}-young-averagemuscle-averageweight-maxheight"),
            "height-": T("macrodetails", f"{g}-young-averagemuscle-averageweight-minheight"),
        }
    macros["female"]["cup+"] = T("breast", "female-young-averagemuscle-averageweight-maxcup-averagefirmness")
    macros["female"]["cup-"] = T("breast", "female-young-averagemuscle-averageweight-mincup-averagefirmness")

    measure = {}
    for p in sorted(names):
        m = re.match(r"data/targets/([a-z/]+)/(measure-[a-z-]+-(incr|decr))\.target(\.gz)?$", p)
        if m:
            measure[m.group(2)] = read_target(z, p, n)

    # render mesh: body + eyes, triangulated, split where UVs differ
    keep = {"body": 0, "helper-l-eye": 1, "helper-r-eye": 1}
    key_to_r, orig, uvs = {}, [], []
    tris = {0: [], 1: []}
    for f, g in zip(faces, fgroups):
        if g not in keep:
            continue
        ids = []
        for vi, ti in f:
            k = (vi, ti)
            if k not in key_to_r:
                key_to_r[k] = len(orig)
                orig.append(vi)
                uvs.append(VT[ti] if ti >= 0 else (0.0, 0.0))
            ids.append(key_to_r[k])
        for j in range(1, len(ids) - 1):
            tris[keep[g]].append((ids[0], ids[j], ids[j + 1]))
    body_tris = np.array(tris[0], np.uint32).reshape(-1)
    eye_tris = np.array(tris[1], np.uint32).reshape(-1)

    # joint cubes (bone placement) and the Mixamo-compatible rig + weights (both CC0)
    cube_verts = {}
    for f, g in zip(faces, fgroups):
        if g and g.startswith("joint-"):
            cube_verts.setdefault(g, set()).update(vi for vi, _ in f)
    rig = json.loads(z.read("data/rigs/standard/rig.mixamo.json"))["bones"]
    wj = json.loads(z.read("data/rigs/standard/weights.mixamo.json"))
    if wj.get("license") != "CC0":
        raise SystemExit("weights are not marked CC0: stop")
    bone_names = sorted(rig, key=lambda b: (b.count(":") and 0, b))
    # parents before children
    ordered, seen = [], set()
    def visit(b):
        if b in seen:
            return
        p = rig[b].get("parent")
        if p and p in rig:
            visit(p)
        seen.add(b)
        ordered.append(b)
    for b in bone_names:
        visit(b)
    bidx = {b: i for i, b in enumerate(ordered)}

    def anchor(a):
        if a["strategy"] == "CUBE":
            return {"verts": sorted(cube_verts[a["cube_name"]])}
        return {"verts": [int(x) for x in a["vertex_indices"]]}

    bones = [{"name": b.replace("mixamorig:", ""), "parent": rig[b]["parent"].replace("mixamorig:", "") if rig[b].get("parent") in rig else None, "head": anchor(rig[b]["head"]), "tail": anchor(rig[b]["tail"])} for b in ordered]
    W = np.zeros((n, 4), np.float32)
    J = np.zeros((n, 4), np.uint8)
    per = [[] for _ in range(n)]
    for b, lst in wj["weights"].items():
        if b not in bidx:
            continue
        for vi, w in lst:
            per[vi].append((w, bidx[b]))
    for vi, lst in enumerate(per):
        lst.sort(reverse=True)
        lst = lst[:4]
        s = sum(w for w, _ in lst) or 1.0
        for k, (w, j) in enumerate(lst):
            W[vi, k] = w / s
            J[vi, k] = j

    # binary layout
    blobs, layout = [], {}
    def put(key, arr):
        off = sum(len(b) for b in blobs)
        pad = (-off) % 4
        if pad:
            blobs.append(b"\0" * pad)
            off += pad
        data = np.ascontiguousarray(arr).tobytes()
        blobs.append(data)
        layout[key] = {"offset": off, "length": int(np.asarray(arr).size), "type": str(np.asarray(arr).dtype)}
    put("base.male", base["male"].astype(np.float32))
    put("base.female", base["female"].astype(np.float32))
    put("render.orig", np.array(orig, np.uint32))
    put("render.uv", np.array(uvs, np.float32))
    put("render.bodyIndex", body_tris)
    put("render.eyeIndex", eye_tris)
    put("skin.joints", J)
    put("skin.weights", W)
    morphs = []
    def add_morph(mid, delta, sex=None):
        i, d = sparse(delta)
        put(f"m.{mid}.i", i)
        put(f"m.{mid}.d", d)
        morphs.append({"id": mid, "sex": sex, "count": int(len(i))})
    for g in ("male", "female"):
        for k, d in macros[g].items():
            add_morph(f"{g}.{k}", d, g)
    for k, d in measure.items():
        add_morph(k, d)

    # ancestry (MakeHuman's three ethnic shapes, relative to their equal mix), age, expressions and face controls
    for g in ("male", "female"):
        eth = {e: T("macrodetails", f"{e}-{g}-young") for e in ("african", "asian", "caucasian")}
        mean = sum(eth.values()) / 3.0
        for e, d in eth.items():
            add_morph(f"{g}.eth.{e}", d - mean, g)
        old = sum(T("macrodetails", f"{e}-{g}-old") for e in ("african", "asian", "caucasian")) / 3.0
        add_morph(f"{g}.age+", old - mean, g)
    for name in ("eye-left-closure", "eye-right-closure", "mouth-corner-puller", "mouth-elevation", "eyebrows-left-up", "eyebrows-right-up"):
        add_morph(f"expr.{name}", T("expression", name))
    face_controls = []
    def face(cid, label, group, *pairs):
        face_controls.append({"id": cid, "label": label, "group": group, "pairs": [list(p) for p in pairs]})
        for pos, neg in pairs:
            for t in (pos, neg):
                if t and not any(m["id"] == t for m in morphs):
                    add_morph(t, T("", t))
    LR = lambda stem, a, b: ((f"l-{stem}-{a}", f"l-{stem}-{b}"), (f"r-{stem}-{a}", f"r-{stem}-{b}"))
    for shape in ("oval", "round", "square", "rectangular", "triangular", "invertedtriangular", "diamond"):
        add_morph(f"head-{shape}", T("head", f"head-{shape}"))
    face("headWidth", "Head width", "Head", ("head-scale-horiz-incr", "head-scale-horiz-decr"))
    face("headHeight", "Head height", "Head", ("head-scale-vert-incr", "head-scale-vert-decr"))
    face("faceFat", "Face fullness", "Head", ("head-fat-incr", "head-fat-decr"))
    face("forehead", "Forehead height", "Head", ("forehead-scale-vert-incr", "forehead-scale-vert-decr"))
    face("eyeSize", "Eye size", "Eyes", *LR("eye-scale", "incr", "decr"))
    face("eyeSpacing", "Eye spacing", "Eyes", *LR("eye-trans", "out", "in"))
    face("eyeSlant", "Eye slant", "Eyes", *LR("eye-corner2", "up", "down"))
    face("eyeFold", "Eyelid fold", "Eyes", *LR("eye-eyefold", "down", "up"))
    face("browHeight", "Brow height", "Eyes", ("eyebrows-trans-up", "eyebrows-trans-down"))
    face("browAngle", "Brow angle", "Eyes", ("eyebrows-angle-up", "eyebrows-angle-down"))
    face("noseWidth", "Nose width", "Nose", ("nose-scale-horiz-incr", "nose-scale-horiz-decr"))
    face("noseLength", "Nose length", "Nose", ("nose-scale-vert-incr", "nose-scale-vert-decr"))
    face("noseProjection", "Nose projection", "Nose", ("nose-scale-depth-incr", "nose-scale-depth-decr"))
    face("noseBridge", "Bridge", "Nose", ("nose-hump-incr", "nose-hump-decr"))
    face("noseTip", "Tip", "Nose", ("nose-point-up", "nose-point-down"))
    face("nostrils", "Nostril width", "Nose", ("nose-nostrils-width-incr", "nose-nostrils-width-decr"))
    face("mouthWidth", "Mouth width", "Mouth", ("mouth-scale-horiz-incr", "mouth-scale-horiz-decr"))
    face("upperLip", "Upper lip", "Mouth", ("mouth-upperlip-volume-incr", "mouth-upperlip-volume-decr"))
    face("lowerLip", "Lower lip", "Mouth", ("mouth-lowerlip-volume-incr", "mouth-lowerlip-volume-decr"))
    face("mouthCorners", "Mouth corners", "Mouth", ("mouth-angles-up", "mouth-angles-down"))
    face("chinWidth", "Chin width", "Jaw", ("chin-width-incr", "chin-width-decr"))
    face("chinHeight", "Chin height", "Jaw", ("chin-height-incr", "chin-height-decr"))
    face("chinProminence", "Chin prominence", "Jaw", ("chin-prominent-incr", "chin-prominent-decr"))
    face("jaw", "Jaw", "Jaw", ("chin-bones-incr", "chin-bones-decr"))
    face("cheekbones", "Cheekbones", "Cheeks & ears", *LR("cheek-bones", "incr", "decr"))
    face("cheekVolume", "Cheek volume", "Cheeks & ears", *LR("cheek-volume", "incr", "decr"))
    face("earSize", "Ear size", "Cheeks & ears", *LR("ear-scale", "incr", "decr"))
    face("earWing", "Ear angle", "Cheeks & ears", *LR("ear-wing", "incr", "decr"))

    out = os.path.join(root, "public/avatars/human")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "hm08.bin"), "wb") as fo:
        for b in blobs:
            fo.write(b)
    meta = {
        "format": "modverse-human/1", "units": "cm", "up": "+y", "front": "+z", "vertices": n, "renderVertices": len(orig),
        "source": {"name": "MakeHuman base mesh hm08, targets, Mixamo-compatible rig and weights (bundled with MPFB 2)", "licence": "CC0-1.0", "statement": "base.obj: 'This asset was explicitly released as CC0 in september 2020'; weights.mixamo.json: license CC0", "copyright": "Data Collection AB, Joel Palmius, Jonas Hauquier (at the CC0 release)", "url": "https://static.makehumancommunity.org/mpfb.html"},
        "layout": layout, "morphs": morphs, "bones": bones, "faceControls": face_controls,
        "headShapes": ["oval", "round", "square", "rectangular", "triangular", "invertedtriangular", "diamond"],
    }
    with open(os.path.join(out, "hm08.json"), "w") as fo:
        json.dump(meta, fo, separators=(",", ":"))
    print("body", n, "verts,", len(orig), "render verts,", len(body_tris) // 3, "tris,", len(morphs), "morphs,", len(bones), "bones")

    # garments: bind every GLB vertex to the body with the .mhclo data
    lib = os.path.join(root, "public/garment-library")
    count = 0
    for dirpath, _, files in os.walk(lib):
        if not dirpath.endswith("original"):
            continue
        mh = [f for f in files if f.endswith(".mhclo")]
        if not mh:
            continue
        gdir = os.path.dirname(dirpath)
        glbs = [f for f in os.listdir(gdir) if f.endswith(".glb")]
        if not glbs:
            continue
        txt = open(os.path.join(dirpath, mh[0]), encoding="utf8", errors="replace").read()
        if not re.search(r"^basemesh hm08", txt, re.M):
            continue
        objn = re.search(r"^obj_file (.+)$", txt, re.M).group(1).strip()
        gv, _, _, _ = read_obj(open(os.path.join(dirpath, objn), encoding="utf8", errors="replace").read())
        scales, binds, delete, mode = {}, [], [], None
        for line in txt.splitlines():
            p = line.split()
            if not p or p[0].startswith("#"):
                continue
            if p[0] in ("x_scale", "y_scale", "z_scale"):
                scales[p[0][0]] = {"a": int(p[1]), "b": int(p[2]), "den": float(p[3])}
            elif p[0] in ("l_shear_x", "l_shear_y", "l_shear_z", "r_shear_x", "r_shear_y", "r_shear_z"):
                # sheared reference: the distance between the two vertices along the axis, over den1 - den2
                ax = p[0][-1]
                scales.setdefault(ax, {"a": int(p[1]), "b": int(p[2]), "den": float(p[3]) - float(p[4])})
            elif p[0] == "verts":
                mode = "verts"
                continue
            elif p[0] == "delete_verts":
                mode = "delete"
                continue
            elif mode == "verts" and re.match(r"^-?\d", p[0]):
                if len(p) >= 9:
                    binds.append(([int(p[0]), int(p[1]), int(p[2])], [float(p[3]), float(p[4]), float(p[5])], [float(p[6]), float(p[7]), float(p[8])]))
                elif len(p) == 1:
                    binds.append(([int(p[0])] * 3, [1.0, 0.0, 0.0], [0.0, 0.0, 0.0]))
                else:
                    mode = None
            elif mode == "delete":
                toks = line.replace("-", " - ").split()
                k = 0
                while k < len(toks):
                    if k + 2 < len(toks) and toks[k + 1] == "-":
                        delete.extend(range(int(toks[k]), int(toks[k + 2]) + 1))
                        k += 3
                    elif toks[k].isdigit():
                        delete.append(int(toks[k]))
                        k += 1
                    else:
                        k += 1
            elif p[0] in ("material", "z_depth", "max_pole", "name", "uuid", "tag", "obj_file", "basemesh", "license", "author", "homepage"):
                mode = None
        if len(binds) != len(gv) or not set(scales) <= {"x", "y", "z"}:
            print("skip", gdir, len(binds), len(gv), sorted(scales))
            continue
        # GLB vertices → OBJ vertices by exact position (the converter kept positions, ×10)
        glb = open(os.path.join(gdir, glbs[0]), "rb").read()
        jl = struct.unpack("<I", glb[12:16])[0]
        gj = json.loads(glb[20:20 + jl])
        bin_off = 20 + jl + 8
        prim = gj["meshes"][0]["primitives"][0]
        acc = gj["accessors"][prim["attributes"]["POSITION"]]
        bv = gj["bufferViews"][acc["bufferView"]]
        start = bin_off + bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
        P = np.frombuffer(glb[start:start + acc["count"] * 12], np.float32).reshape(-1, 3)
        objcm = gv * DM_TO_CM
        lookup = {tuple(np.round(p, 3)): i for i, p in enumerate(objcm)}
        mapping = []
        miss = 0
        for p in P:
            i = lookup.get(tuple(np.round(p.astype(np.float64), 3)))
            if i is None:
                i = int(np.argmin(((objcm - p) ** 2).sum(axis=1)))
                miss += 1
            mapping.append(i)
        refs = np.array([binds[i][0] for i in mapping], np.uint16)
        # quantised: offsets in 1e-4 dm (0.01 mm), well below the meshes' own precision
        # barycentric weights can be slightly negative or above 1 (points just outside the reference triangle):
        # signed, 1/16384 steps, range ±2
        wts = np.clip(np.round(np.array([binds[i][1] for i in mapping]) * 16384), -32767, 32767).astype(np.int16)
        offs = np.clip(np.round(np.array([binds[i][2] for i in mapping]) * 1e4), -32767, 32767).astype(np.int16)
        with open(os.path.join(gdir, "fit.bin"), "wb") as fo:
            fo.write(refs.tobytes()); fo.write(wts.tobytes()); fo.write(offs.tobytes())
        dl = sorted(set(d for d in delete if 0 <= d < n))
        ranges, k = [], 0
        while k < len(dl):
            j = k
            while j + 1 < len(dl) and dl[j + 1] == dl[j] + 1:
                j += 1
            ranges.append([dl[k], dl[j]])
            k = j + 1
        with open(os.path.join(gdir, "fit.json"), "w") as fo:
            json.dump({"format": "modverse-mhclo-fit/1", "basemesh": "hm08", "vertices": len(P), "scales": scales, "layout": "uint16 refs[3n], int16 weights[3n] (/16384), int16 offsets[3n] (1e-4 dm, scaled per axis by the body)", "offsetUnit": "dm", "hideBody": ranges, "positionMatchMisses": miss}, fo, separators=(",", ":"))
        count += 1
    print("garments fitted", count)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
