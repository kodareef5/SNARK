import type { UiNode } from "./nodes.ts";

export interface UiEvents {
  text(key: number, value: string): void;
  /** `kind` is 0 for down, 1 for up, 2 for move. The position is in canvas units. */
  pointer(kind: number, key: number, x: number, y: number, button: number): void;
}

/** Forwards edits for the lifetime of a text field, across frame rebuilds. */
export function bindTextInput(node: UiNode, field: { readonly value: string }, events: Pick<UiEvents, "text">): () => void {
  // Frame nodes are pooled by position. After a rebuild this object may describe an entirely different control.
  const key = node.key;
  return () => events.text(key, field.value);
}
