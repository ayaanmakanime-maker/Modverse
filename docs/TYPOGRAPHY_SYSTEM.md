# Typography system

## Fonts
34 **SIL OFL 1.1** families (136 woff2 files, Latin + Latin-Ext, plus Devanagari, Tamil and Bengali) self-hosted in `public/fonts` by `npm run fonts:sync` from `@fontsource` packages, with licences copied alongside. Categories: sans, serif, display, script, mono, Indian scripts. Each font declares available weights/italics and a minimum printable cap height. OFL permits use in printed products; the font files themselves are not sold.

## Text layers
Content (multiline, Unicode), family, weight, italic, underline, case transform, size (cm), colour, letter spacing, line height, opacity, horizontal/vertical alignment, rotation, position, flip, skew, **curved (arc ±)**, **circular**, **vertical**, outline (mm), shadow (offset/blur — layered text), background (padding/radius), decoration method (print/embroidery), placement presets on front, back, chest, sleeves, collar, pocket, yoke.

## Rendering consistency
The composer emits real SVG `<text>`/`<textPath>`; the 2D editor renders it with the document fonts, and 3D textures/print exports embed the exact woff2 files as data URLs — so 2D, 3D and print use the same glyphs. Text boxes are measured from the rendered glyphs.

## Print validation
Too-small cap height (per font; stricter for embroidery), unsupported fonts, missing glyphs for the script (e.g. Hindi in a Latin-only font, with suggested alternatives), low contrast against the panel (outline-aware), outlines thinner than the method minimum, blurred shadows for screen/embroidery, long circular text, tight embroidery tracking, empty text, kids-inappropriate words.
