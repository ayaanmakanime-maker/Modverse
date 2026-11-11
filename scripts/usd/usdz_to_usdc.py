"""Converts a USDZ written by ModVerse into a binary USD crate (.usdc) plus its textures.

Run by /api/export/usdc with the Python interpreter named in MODVERSE_USD_PYTHON (needs OpenUSD: pip install usd-core).
Usage: python -I usdz_to_usdc.py <in.usdz> <out_dir>
Only .usda / .usdc / .png / .jpg / .jpeg members are extracted, and only to paths inside the working folder.
"""
import os
import sys
import zipfile

from pxr import Usd, UsdUtils  # noqa: E402  (OpenUSD)

ALLOWED = (".usda", ".usdc", ".png", ".jpg", ".jpeg")


def main(src: str, out: str) -> None:
    work = os.path.join(out, "_in")
    os.makedirs(work, exist_ok=True)
    root = None
    with zipfile.ZipFile(src) as z:
        names = z.namelist()
        if len(names) > 200:
            raise SystemExit("too many files in the package")
        for n in names:
            if not n.lower().endswith(ALLOWED) or n.startswith(("/", "\\")) or ".." in n.replace("\\", "/").split("/"):
                continue
            target = os.path.realpath(os.path.join(work, n))
            if not target.startswith(os.path.realpath(work) + os.sep):
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with z.open(n) as fi, open(target, "wb") as fo:
                fo.write(fi.read(64 * 1024 * 1024))
            if root is None and n.lower().endswith((".usda", ".usdc")):
                root = target
    if root is None:
        raise SystemExit("no USD layer in the package")
    stage = Usd.Stage.Open(root)
    if stage is None:
        raise SystemExit("could not open the USD stage")
    # one self-contained crate: sub-layers (geometry files) are flattened in; texture paths are made relative again
    flat = stage.Flatten()
    base = os.path.realpath(work)

    def relative(p: str) -> str:
        rp = os.path.realpath(p) if os.path.isabs(p) else p
        return os.path.relpath(rp, base).replace(os.sep, "/") if os.path.isabs(p) and rp.startswith(base + os.sep) else p

    UsdUtils.ModifyAssetPaths(flat, relative)
    dst = os.path.join(out, "model.usdc")
    if not flat.Export(dst, args={"format": "usdc"}):
        raise SystemExit("export failed")
    # textures keep their relative paths next to the crate
    for dirpath, _, files in os.walk(work):
        for f in files:
            if f.lower().endswith((".png", ".jpg", ".jpeg")):
                rel = os.path.relpath(os.path.join(dirpath, f), work)
                os.makedirs(os.path.dirname(os.path.join(out, rel)) or out, exist_ok=True)
                os.replace(os.path.join(dirpath, f), os.path.join(out, rel))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
