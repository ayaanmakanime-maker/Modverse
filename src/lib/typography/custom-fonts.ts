"use client";
/** Client store of the signed-in customer's uploaded fonts (private to their account). */
import { create } from "zustand";
import { api } from "../client/api";

export interface CustomFont {
  id: string;
  url: string;
  mime: string;
  displayName: string;
  family: string;
}

interface CustomFontState {
  fonts: CustomFont[];
  loaded: boolean;
  load(): Promise<void>;
  upload(file: File, name: string): Promise<CustomFont>;
  remove(id: string): Promise<void>;
}

export const FONT_ACCEPT = ".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2";

export const useCustomFonts = create<CustomFontState>((set, get) => ({
  fonts: [],
  loaded: false,
  async load() {
    if (get().loaded) return;
    try {
      const r = await api<{ fonts: CustomFont[] }>("/api/fonts");
      set({ fonts: r.fonts, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  async upload(file, name) {
    const form = new FormData();
    form.append("file", file);
    form.append("name", name);
    form.append("rightsConfirmed", "true");
    const r = await api<{ font: CustomFont }>("/api/fonts", { form });
    set({ fonts: [r.font, ...get().fonts] });
    return r.font;
  },
  async remove(id) {
    await api("/api/fonts", { method: "DELETE", body: { id } });
    set({ fonts: get().fonts.filter((f) => f.id !== id) });
  },
}));
