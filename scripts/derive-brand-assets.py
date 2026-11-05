#!/usr/bin/env python3
"""Derive responsive ModVerse logo variants from the ORIGINAL supplied logo.

The master file public/brand/modverse-logo-original.png is never modified.
Every variant below is either:
  * an exact crop of the original pixels, or
  * an alpha-masked version of the original where alpha is derived from the
    original luminance (white-on-black artwork -> artwork-on-transparent),
    preserving the exact letterforms and anti-aliasing.
Nothing is redrawn, re-typeset or re-proportioned.

Usage: python3 -I scripts/derive-brand-assets.py
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER = os.path.join(ROOT, "public", "brand", "modverse-logo-original.png")
OUT = os.path.join(ROOT, "public", "brand", "derived")
APP = os.path.join(ROOT, "src", "app")
EXPECTED_SHA256 = "ba8167c48c035c6b729c9fe24e53e8cadd692f5793a5721ca71df62d5249baac"

# Regions measured from the original (rows/cols of non-background pixels).
MONOGRAM = (662, 142, 1092, 442)  # left, top, right, bottom (exclusive)
WORDMARK = (381, 488, 1394, 649)
TAGLINE = (476, 694, 1297, 720)
LOCKUP = (381, 142, 1394, 720)  # monogram + wordmark + tagline

LIGHT_INK = (243, 239, 232)  # measured mean letter colour of the original
DARK_INK = (10, 10, 10)


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def pad(box, p, w, h):
    l, t, r, b = box
    return (max(0, l - p), max(0, t - p), min(w, r + p), min(h, b + p))


def alpha_variant(img: Image.Image, ink) -> Image.Image:
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    lum = a.mean(axis=2)
    # Background noise in the original peaks at ~6 (JPEG artefacts); floor at 8.
    bg, fg = 8.0, 238.0  # background noise floor / measured letter luminance
    alpha = np.clip((lum - bg) / (fg - bg), 0.0, 1.0)
    out = np.zeros((a.shape[0], a.shape[1], 4), dtype=np.uint8)
    out[..., 0] = ink[0]
    out[..., 1] = ink[1]
    out[..., 2] = ink[2]
    out[..., 3] = (alpha * 255).round().astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def square_on_black(img: Image.Image, size: int, fill=0.78) -> Image.Image:
    """Centre a crop on a black square (the original background colour)."""
    canvas = Image.new("RGB", (size, size), (3, 3, 3))
    w, h = img.size
    scale = (size * fill) / max(w, h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    resized = img.resize((nw, nh), Image.LANCZOS)
    canvas.paste(resized, ((size - nw) // 2, (size - nh) // 2))
    return canvas


def main() -> int:
    digest = sha256(MASTER)
    if digest != EXPECTED_SHA256:
        print(f"Master logo checksum mismatch: {digest}", file=sys.stderr)
        return 1
    os.makedirs(OUT, exist_ok=True)
    master = Image.open(MASTER).convert("RGB")
    W, H = master.size

    crops = {
        "modverse-lockup": pad(LOCKUP, 24, W, H),
        "modverse-monogram": pad(MONOGRAM, 12, W, H),
        "modverse-wordmark": pad(WORDMARK, 8, W, H),
        "modverse-tagline": pad(TAGLINE, 6, W, H),
    }
    written = []
    for name, box in crops.items():
        crop = master.crop(box)
        p = os.path.join(OUT, f"{name}-on-black.png")
        crop.save(p, optimize=True)
        written.append(p)
        for suffix, ink in (("light", LIGHT_INK), ("dark", DARK_INK)):
            p = os.path.join(OUT, f"{name}-{suffix}.png")
            alpha_variant(crop, ink).save(p, optimize=True)
            written.append(p)

    # Full-frame transparent versions (same canvas as the original).
    for suffix, ink in (("light", LIGHT_INK), ("dark", DARK_INK)):
        p = os.path.join(OUT, f"modverse-logo-transparent-{suffix}.png")
        alpha_variant(master, ink).save(p, optimize=True)
        written.append(p)

    # App icons / favicon: original monogram pixels on the original black.
    mono = master.crop(pad(MONOGRAM, 12, W, H))
    os.makedirs(APP, exist_ok=True)
    square_on_black(mono, 512).save(os.path.join(APP, "icon.png"), optimize=True)
    square_on_black(mono, 180).save(os.path.join(APP, "apple-icon.png"), optimize=True)
    for s in (192, 512):
        p = os.path.join(OUT, f"modverse-app-icon-{s}.png")
        square_on_black(mono, s).save(p, optimize=True)
        written.append(p)
    ico = square_on_black(mono, 256, fill=0.86)
    ico.save(os.path.join(APP, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

    manifest = {
        "master": "public/brand/modverse-logo-original.png",
        "master_sha256": digest,
        "master_size": [W, H],
        "note": "Derived variants are crops / luminance-alpha masks of the original pixels. "
        "The master file is never modified.",
        "regions": {"monogram": MONOGRAM, "wordmark": WORDMARK, "tagline": TAGLINE, "lockup": LOCKUP},
        "files": sorted(os.path.relpath(p, ROOT) for p in written),
    }
    with open(os.path.join(OUT, "brand-manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"Derived {len(written)} brand files from master ({digest[:12]}…)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
