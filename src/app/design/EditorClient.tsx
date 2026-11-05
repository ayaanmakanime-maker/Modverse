"use client";
import { Editor, type EditorInitial } from "@/components/editor/Editor";

export function EditorClient(props: { initial: EditorInitial; childProfiles?: { id: string; nickname: string }[] }) {
  return <Editor {...props} />;
}
