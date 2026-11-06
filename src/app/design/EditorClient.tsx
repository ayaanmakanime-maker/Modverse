"use client";
import { Editor, type EditorInitial } from "@/components/editor/Editor";

export function EditorClient(props: { initial: EditorInitial }) {
  return <Editor {...props} />;
}
