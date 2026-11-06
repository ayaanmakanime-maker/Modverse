/**
 * Display metadata for the 20 collections of the supplied
 * ModVerse Original Creative Library v0.1.
 *
 * Collection slugs come from the library manifest (`category` field).
 * Descriptions and search keywords below are ModVerse editorial additions used
 * for search/filtering; they do not alter the supplied assets.
 */
export interface CollectionMeta {
  slug: string;
  name: string;
  description: string;
  keywords: string[];
  mood: "dark" | "light" | "vivid";
}

const V01_COLLECTIONS: CollectionMeta[] = [
  { slug: "Cyberpunk_Futurism", name: "Cyberpunk Futurism", description: "Neon circuitry, digital horizons and night-city signals.", keywords: ["neon", "cyber", "tech", "future", "circuit", "digital", "sci-fi"], mood: "dark" },
  { slug: "Japanese_Streetwear", name: "Japanese Streetwear", description: "Rising-sun geometry, wave motifs and Tokyo street energy.", keywords: ["japan", "tokyo", "street", "wave", "sun", "kanji", "urban"], mood: "dark" },
  { slug: "Minimalist_Geometric", name: "Minimalist Geometric", description: "Quiet shapes, precise lines and restrained compositions.", keywords: ["minimal", "geometric", "clean", "lines", "shapes", "simple"], mood: "light" },
  { slug: "Vintage_Retro", name: "Vintage Retro", description: "Sunset stripes, badges and warm nostalgic tones.", keywords: ["vintage", "retro", "70s", "sunset", "badge", "classic"], mood: "dark" },
  { slug: "Gothic_Dark", name: "Gothic Dark", description: "Moody arches, sharp ornaments and midnight palettes.", keywords: ["gothic", "dark", "goth", "moody", "night", "occult"], mood: "dark" },
  { slug: "Graffiti_Urban", name: "Graffiti Urban", description: "Spray-paint energy, tags and city walls.", keywords: ["graffiti", "urban", "street", "spray", "hip-hop", "tag"], mood: "vivid" },
  { slug: "Botanical_Nature", name: "Botanical Nature", description: "Leaves, blooms and organic growth.", keywords: ["botanical", "nature", "leaf", "flower", "plant", "organic", "green"], mood: "light" },
  { slug: "Abstract_Surreal", name: "Abstract Surreal", description: "Dreamlike forms and unexpected compositions.", keywords: ["abstract", "surreal", "dream", "art", "shapes"], mood: "vivid" },
  { slug: "Space_Astronomy", name: "Space Astronomy", description: "Planets, orbits, stars and cosmic depth.", keywords: ["space", "astronomy", "planet", "star", "galaxy", "cosmic", "moon"], mood: "dark" },
  { slug: "Automotive_Racing", name: "Automotive Racing", description: "Chequered speed, racing stripes and motorsport heritage.", keywords: ["racing", "car", "motorsport", "speed", "automotive", "checkered"], mood: "dark" },
  { slug: "Typography", name: "Typography", description: "Letterform-led graphics and bold type compositions.", keywords: ["typography", "type", "letters", "text", "font", "words"], mood: "light" },
  { slug: "Fantasy_Mythology", name: "Fantasy Mythology", description: "Mythic emblems, legends and enchanted symbols.", keywords: ["fantasy", "myth", "legend", "dragon", "magic", "mythology"], mood: "dark" },
  { slug: "Sports_Athletics", name: "Sports Athletics", description: "Varsity numbers, track lines and athletic badges.", keywords: ["sports", "athletic", "varsity", "team", "jersey", "gym"], mood: "dark" },
  { slug: "3D_Liquid_Chrome", name: "3D Liquid Chrome", description: "Metallic blobs, reflective forms and Y2K chrome.", keywords: ["chrome", "liquid", "metal", "3d", "y2k", "metallic"], mood: "dark" },
  { slug: "Architecture_Brutalism", name: "Architecture Brutalism", description: "Concrete blocks, grids and monumental structure.", keywords: ["architecture", "brutalism", "concrete", "grid", "structure", "building"], mood: "dark" },
  { slug: "Pop_Comics", name: "Pop Comics", description: "Halftones, speech bursts and pop-art colour.", keywords: ["pop", "comic", "halftone", "pop-art", "cartoon", "burst"], mood: "vivid" },
  { slug: "Music_Psychedelic", name: "Music Psychedelic", description: "Sound waves, groovy swirls and festival colour.", keywords: ["music", "psychedelic", "groovy", "festival", "sound", "wave"], mood: "vivid" },
  { slug: "Glitch_Digital", name: "Glitch Digital", description: "Corrupted pixels, scanlines and data noise.", keywords: ["glitch", "digital", "pixel", "error", "data", "scanline"], mood: "dark" },
  { slug: "Luxury_Ornamental", name: "Luxury Ornamental", description: "Gilded frames, crests and refined ornament.", keywords: ["luxury", "ornamental", "gold", "crest", "royal", "elegant"], mood: "dark" },
  { slug: "Experimental_Collage", name: "Experimental Collage", description: "Layered cut-outs and experimental compositions.", keywords: ["collage", "experimental", "cutout", "mixed", "layers", "art"], mood: "vivid" },
];

import { STUDIO_COLLECTIONS } from "./studio-collections";

/** v0.1 supplied collections first, then the ModVerse Studio Library collections. */
export const COLLECTIONS: CollectionMeta[] = [...V01_COLLECTIONS, ...STUDIO_COLLECTIONS];

export const COLLECTION_BY_SLUG = new Map(COLLECTIONS.map((c) => [c.slug, c]));

export function collectionName(slug: string): string {
  return COLLECTION_BY_SLUG.get(slug)?.name ?? slug.replace(/_/g, " ");
}
