# Graphics Library and registry

The Creative Library now holds **19,265 graphics** (1,232 ModVerse graphics + 18,033 openly licensed graphics from 11 sources), plus the existing patterns, templates, palettes and stickers. Every open graphic has a registry entry with its source, creator, licence and terms.

## Where the graphics come from
Pinterest and Canva were used only as a **reference for how people browse** (grouped categories, search-first, "refine" chips). Their content is not licensed for reuse and none of it was copied. The artwork comes from openly licensed icon and emoji sets, installed from npm at pinned versions (package-lock.json) through Iconify's JSON packages, which carry the upstream licence in each package's `info.json`.

| Source | Package | Creator | Licence | Credit on the product | Graphics |
|---|---|---|---|---|---|
| Fluent Emoji (flat) | `@iconify-json/fluent-emoji-flat@1.2.6` | Microsoft Corporation | MIT | not required | 1,590 |
| Noto Emoji | `@iconify-json/noto@1.2.10` | Google | Apache-2.0 | not required | 1,685 |
| Twemoji | `@iconify-json/twemoji@1.2.5` | Twitter, Inc and other contributors | CC-BY-4.0 | **required** | 1,939 |
| Streamline Emojis | `@iconify-json/streamline-emojis@1.2.4` | Streamline | CC-BY-4.0 | **required** | 785 |
| Game-icons.net | `@iconify-json/game-icons@1.2.4` | Game-icons.net contributors (Lorc, Delapouite and others) | CC-BY-3.0 | **required** | 4,034 |
| Healthicons | `@iconify-json/healthicons@1.2.18` | Resolve to Save Lives and contributors | MIT | not required | 1,552 |
| Tabler Icons | `@iconify-json/tabler@1.2.44` | Paweł Kuna and contributors | MIT | not required | 5,258 |
| Circle Flags | `@iconify-json/circle-flags@1.2.14` | HatScripts | MIT | not required | 251 |
| Maki | `@iconify-json/maki@1.2.6` | Mapbox | CC0-1.0 | not required | 215 |
| Temaki | `@iconify-json/temaki@1.2.7` | Bryan Housel and contributors | CC0-1.0 | not required | 557 |
| Map Icons | `@iconify-json/map@1.2.3` | Scott de Jonge | OFL-1.1 | not required | 167 |

Emoji names, keywords and Unicode groups come from `emojibase-data@18.0.0` (MIT; derived from Unicode CLDR). MIT / Apache-2.0 / OFL require their licence notice to travel with **redistributed files** (kept in the registry and in `node_modules`); printing a graphic on a garment does not redistribute the file. CC BY sources require a credit line: ModVerse adds it to the design's tech pack and order documents automatically (`assetCreditsFor` → `buildTechSpec`), and the library shows it on every asset.

## Excluded at import (7,541, each recorded with its reason)
| Reason | Count |
|---|---|
| Skin-tone duplicates (the default tone is kept) | 5,626 |
| Duplicate variants (Tabler "off", Healthicons negative / 24 px, Maki size variants) | 1,095 |
| Trademarks and third-party characters (all brand logos; product names such as iPad, Xbox, PlayStation, AirPods, Bluetooth; characters such as Pac-Man, Mickey, LEGO, Pokémon, Star Wars, Zelda, Metroid, Marvel) | 520 |
| Sub-national, regional, language or disputed flags | 190 |
| Realistic firearms and explosives | 77 |
| Offensive gesture | 19 |
| Gore, violence or self-harm | 12 |
| Hate symbol | 1 |
| Not an ISO 3166-1 country | 1 |

Notes kept with categories: religious and traditional symbols carry a respectful-use note; the Flags category notes that the Indian national flag must not be printed on garments below the waist or on undergarments (Flag Code of India, 2002; Prevention of Insults to National Honour Act, 1971). Nothing implies endorsement by any source.

**Not imported (and why):** OpenMoji (CC BY-SA 4.0: share-alike could extend to customers' designs; needs an owner decision). Openclipart / LibreClipart (public domain, but their APIs refused automated access from the build environment). SVG Repo, Wikimedia Commons, Openverse (mixed licences per file; each file must be checked individually: a per-item import path is the next step). The Met Open Access (CC0, but photographs of objects; they need curation before they are useful as print graphics). Kenney (CC0; mostly game sprites in PNG; can be added the same way).

## Registry
* `npm run graphics:import` (`scripts/import-open-graphics.ts`) checks each package's licence against the expected one (and stops on a mismatch), applies the exclusions, sanitises every SVG with the allowlist sanitiser, writes `public/library/open/<source>/<name>.svg` (512 px, `currentColor` → near-black ink that the recolour control changes) and `public/library/open/registry.json`.
* The database seed imports it into `graphic_sources` (one row per source: name, source URL, package and version, creator, licence and licence URL, commercial use, attribution, redistribution terms, original and optimised format, download date, approval) and `creative_assets` (new columns: source, source URL, creator, attribution, categories, style, search text, approval). Migration `0009_v25_graphics_registry.sql` is additive.
* `/admin/graphics`: every source with its terms; approve, suspend or reject a whole source (its graphics disappear from search at once; existing designs keep their copy; audited). **Download registry (CSV)** gives one line per asset with the brief's fields: asset ID, name, category, source URL, creator, licence, commercial permissions, attribution requirements, redistribution restrictions, original format, optimised format, download date, approval status.

## Categories and search
* `src/lib/library/taxonomy.ts`: the brief's 60 categories plus 27 more that people search for (fashion, beauty, money, tools, sweets, boats, pets, ocean, weather, hearts, people, health, time, party, awards, shapes, lines, silhouettes, interface icons, fantasy, zodiac, religious symbols…), in 14 groups. Emoji are classified by Unicode subgroup and keywords; icon sets by their names; ModVerse artwork by name, tags and collection keywords. Each graphic can be in several categories.
* Search (`/api/library`): whole-word matching on a prepared search text, plural stemming, synonyms (including Indian English and Hinglish: *haathi → elephant*, *chai → tea*, *gaadi → car*, *phool → flower*, *tiranga → flag*), prefix matching while typing (4+ letters), ranking (word in the name > synonym in the name > keyword), ModVerse artwork first on ties, category facets with counts, category suggestions, and filters for style, source and "no credit line needed".
* UI: the Creative Library page has a large search box with instant category suggestions, recent and popular searches, the grouped category browser with live counts, "Refine" chips, filters, licence and credit details per asset, "Use in a design" (places the graphic on the chosen garment) and **Upload your own PNG**. The editor's library panel has the same search, a grouped category menu with counts, a style menu, the credit filter and a **Your PNG** button that opens Upload; not signed in, Upload offers a one-click guest account so the open design is kept.

## Tests
* `tests/unit/graphics-taxonomy.test.ts`: categories, stemming, synonyms, classification, search text, term sanitising, suggestions.
* `tests/e2e/graphics-library.spec.ts`: category browsing, Hinglish synonym search, suggestions, refine chips, empty state, licence and required credit, no-credit filter, placing a graphic through "Use in a design"; editor category + style filter, guest upload of a PNG; admin registry, CSV header, suspending and re-approving a source.
