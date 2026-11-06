export type LibraryAssetKind = "graphic" | "pattern" | "template" | "palette" | "element";

export interface TemplateText {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontWeight: string;
  fill: string;
  letterSpacing: number;
  anchor: "start" | "middle" | "end";
  fontFamily: string;
}

export interface LibraryAsset {
  id: string;
  kind: LibraryAssetKind;
  name: string;
  collection: string;
  collectionName: string;
  /** Original relative path inside ModVerse_Original_Creative_Library (preserved). */
  sourceFile: string | null;
  /** Public URL of the sanitised copy. */
  url: string | null;
  /** Templates only: sanitised copy with editable text removed (text becomes typography layers). */
  baseUrl?: string | null;
  format: string;
  license: string | null;
  width: number;
  height: number;
  viewBox: [number, number, number, number];
  colors: string[];
  tags: string[];
  editableTexts?: TemplateText[];
  bytes: number;
}

export interface LibraryIndex {
  brand: string;
  version: string;
  generatedAt: string;
  source: { archive: string; archiveSha256: string; directory: string; studio?: { directory: string; version: string } | null };
  counts: Record<LibraryAssetKind, number>;
  collections: { slug: string; name: string; counts: Record<LibraryAssetKind, number>; palette: string[] }[];
  assets: LibraryAsset[];
}
