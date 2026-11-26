// The field art: four sheets cut by tools/ui/field-art.ts from generated plates (assets/source/ui/field). Each is a file
// the browser fetches the first time something on it is shown. A build without them draws the plain stand-ins.
import type { UiFrame, UiImage } from "./nodes.ts";

/** Each sheet's file, "" where the build has none: the build sets it (tools/ui/assets.ts). */
declare const __FIELD_ART__: { icons: string; equipment: string; parts: string; touch: string };
const ART = typeof __FIELD_ART__ === "object" ? __FIELD_ART__ : { icons: "", equipment: "", parts: "", touch: "" };

/** A sheet: its picture's slot in the frame, its cell's side in pixels, its columns, and the names of its cells in order. */
export interface FieldSheet { readonly image: number; readonly cell: number; readonly columns: number; readonly names: readonly string[] }

const words = (prefix: string, names: string) => names.split(" ").map((n) => prefix + n);

/** The items the hotbar starts with, the menus, the vitals, and the commands' glyphs. */
export const FIELD_ICONS: FieldSheet = {
  image: 34, cell: 128, columns: 8,
  names: [
    ...words("core:", "pick hatchet spear bow waterskin torch spyglass bola berry flint fiber wood stone thatch hide ingot"),
    ...words("ui:glass-", "emblem bag craft map survivor radio settings whistles kit gestures follow stay attack-target drink eat spyglass wave point salute"),
    ...words("ui:glass-", "health stamina food water oxygen torpor weight"),
    ...words("ui:glyph-", "close more back zoom-out zoom-in pin atlas save telemetry unpin inspect assign"),
  ],
};
/** The same items larger, for a card that shows one. */
export const FIELD_EQUIPMENT: FieldSheet = { image: 37, cell: 384, columns: 4, names: FIELD_ICONS.names.slice(0, 16) };
/** Glass a desktop draws with: a tile at rest and selected, an item's mount, and a dial's face. */
export const FIELD_PARTS: FieldSheet = { image: 38, cell: 512, columns: 2, names: words("ui:part-", "tile tile-lit mount dial") };
/** The thumbs' pads by touch. */
export const FIELD_TOUCH: FieldSheet = { image: 35, cell: 256, columns: 2, names: words("ui:glass-touch-", "move look look-lit knob") };

export const sheetWidth = (s: FieldSheet): number => s.cell * s.columns;
export const sheetHeight = (s: FieldSheet): number => s.cell * Math.ceil(s.names.length / s.columns);

/**
 * Puts the field sheets in the frame and answers for their names before the item catalogue's. "ui:inspect/" before an
 * item's id asks for its larger picture.
 */
export function installFieldIcons(frame: UiFrame, art = ART): void {
  const sheets: [FieldSheet, string][] = [[FIELD_ICONS, art.icons], [FIELD_EQUIPMENT, art.equipment], [FIELD_PARTS, art.parts], [FIELD_TOUCH, art.touch]];
  const at = new Map<string, [FieldSheet, number]>();
  for (const [s, url] of sheets) {
    if (!url) continue;
    const image: UiImage = { width: sheetWidth(s), height: sheetHeight(s), data: new Uint8ClampedArray(0), url, version: 1, smooth: true };
    frame.images[s.image] = image;
    s.names.forEach((name, i) => at.set(s === FIELD_EQUIPMENT ? "ui:inspect/" + name : name, [s, i]));
  }
  if (at.size === 0) return;
  const catalogue = frame.icons;
  frame.icons = {
    place(node, owner) {
      const plain = owner.startsWith("ui:inspect/") ? owner.slice("ui:inspect/".length) : owner;
      const found = at.get(owner) ?? at.get(plain);
      if (!found) return catalogue?.place(node, plain) ?? false;
      const [s, i] = found;
      node.image = s.image;
      node.sx = (i % s.columns) * s.cell;
      node.sy = Math.floor(i / s.columns) * s.cell;
      node.sw = node.sh = s.cell;
      return true;
    },
  };
}
