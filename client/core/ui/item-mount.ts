// The round mount an inspected item stands on: the field parts' (field-icons.ts FIELD_PARTS), or the HUD's glass.
import type { UiFrame } from "./nodes.ts";
import { glass } from "./skin.ts";
import { S_LABEL } from "./style.ts";

/** A part's rim is this share of its picture (tools/ui/field-art.ts). */
const PART_BODY = 0.8;

export function itemMount(f: UiFrame, key: number, x: number, y: number, width: number): void {
  const side = width / PART_BODY, off = (side - width) / 2;
  if (!f.picture(key, x - off, y - off, side, side, S_LABEL, "ui:part-mount")) glass(f, key, x, y, width, width, 0.7);
}
