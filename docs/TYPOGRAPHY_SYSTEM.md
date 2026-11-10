# Typography system

## Fonts
34 **SIL OFL 1.1** families (136 woff2 files, Latin + Latin-Ext, plus Devanagari, Tamil and Bengali) self-hosted in `public/fonts` by `npm run fonts:sync` from `@fontsource` packages, with licences copied alongside. Categories: sans, serif, display, script, mono, Indian scripts. Each font declares available weights/italics and a minimum printable cap height. OFL permits use in printed products; the font files themselves are not sold.

## Customer fonts (V2)
Signed-in customers can upload **TTF, OTF, WOFF or WOFF2** fonts (≤ 6 MB) in Text → *Your fonts* or the font picker. The server detects the format from the file signature (client MIME ignored), requires an explicit confirmation that the customer owns the font or its licence permits printed products (stored with a timestamp), stores it privately, and serves it only to the owner and staff. A unique, CSS-safe family name (e.g. `Brand Script MV1a2b3c`) is generated. The browser registers it with the FontFace API for 2D; 3D textures and print exports embed the same file as a data URL. Validation reports `CUSTOM_FONT` (info) — glyph coverage of third-party fonts is **not** verified automatically.

## Typography styles (V2)
`src/lib/typography/presets.ts` — 20 curated, fully editable styles in seven categories (names & numbers, slogans, monograms incl. a cuff monogram, badges & circular, script, Indian scripts, layered effects). They appear in Library → Typography, on `/library`, and in the Text panel; click or drag them onto any compatible surface. They are ordinary text layers built only from the bundled OFL fonts — not image assets.

## Text layers
Content (multiline, Unicode), family, weight, italic, underline, case transform (none, UPPER, lower, **True Title Case** — minor words lower-case, acronyms preserved — and Capitalise Every Word), size (cm), colour, letter spacing, line height, opacity, horizontal/vertical alignment, rotation, position, flip, skew, **curved (arc ±)**, **circular**, **vertical**, outline (mm), shadow (offset/blur), **layered effects** (V2: up to four stacked strokes, hard/soft shadows, stepped 3D extrusion and glow, each with colour, size/offset, blur and opacity, drawn behind the glyphs), background (padding/radius), decoration method (print/embroidery), placement presets on front, back, chest, sleeves, collar, pocket, yoke.

## Rendering consistency
The composer emits real SVG `<text>`/`<textPath>`; the 2D editor renders it with the document fonts, and 3D textures/print exports embed the exact woff2 files as data URLs — so 2D, 3D and print use the same glyphs. Text boxes are measured from the rendered glyphs.

## Print validation
Too-small cap height (per font; stricter for embroidery), unsupported fonts, missing glyphs for the script (e.g. Hindi in a Latin-only font, with suggested alternatives), low contrast against the panel (outline-aware), outlines thinner than the method minimum, blurred shadows or soft effects for screen/embroidery, thin layered strokes, extra screens for effect colours, long circular text, tight embroidery tracking, empty text, kids-inappropriate words.


## Added scripts and styles (studio upgrade)
Noto Sans Telugu, Noto Sans Gujarati, Noto Naskh Arabic, Noto Nastaliq Urdu (right-to-left, shaped by the browser; not yet proofed in print output), Great Vibes (copperplate calligraphy), Kaushan Script (brush lettering), Pirata One (blackletter), Cinzel (classical capitals). All OFL-1.1 via Fontsource; two candidates (Rock Salt, Special Elite) were left out because they are Apache-2.0 and the library states OFL. Japanese, Chinese and Korean are not included yet. Script detection now also recognises Telugu, Gujarati, Korean and the extended Arabic blocks, so the editor warns when the chosen font lacks them.
