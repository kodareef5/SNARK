import type { UiNode } from "./nodes.ts";

export interface UiEvents {
  text(key: number, value: string): void;
  /** `kind` is 0 for down, 1 for up, 2 for move. The position is in canvas units. `finger` is 0 for a mouse, else a touch's own number. */
  pointer(kind: number, key: number, x: number, y: number, button: number, finger: number): void;
}

/** Forwards edits for the lifetime of a field, across frame rebuilds. A range sends its position as a fraction of its maximum. */
export function bindTextInput(node: UiNode, field: { readonly value: string; readonly type?: string; readonly max?: string }, events: Pick<UiEvents, "text">): () => void {
  // Frame nodes are pooled by position. After a rebuild this object may describe an entirely different control.
  const key = node.key;
  return () => events.text(key, field.type === "range" ? String(Number(field.value) / Number(field.max)) : field.value);
}
