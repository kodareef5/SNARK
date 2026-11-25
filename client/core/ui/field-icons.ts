// The field sheet holds illustrated HUD controls and the equipment shared by the dock and bag.
import type { UiFrame, UiImage } from "./nodes.ts";

declare const __FIELD_ICONS_URL__: string;
declare const __FIELD_EQUIPMENT_URL__: string;
declare const __FIELD_TOUCH_URL__: string;
const url = typeof __FIELD_ICONS_URL__ === "string" ? __FIELD_ICONS_URL__ : "";
export const IMAGE_FIELD_ICONS = 34;
const IMAGE_EQUIPMENT = 37;
const equipment = typeof __FIELD_EQUIPMENT_URL__ === "string" ? __FIELD_EQUIPMENT_URL__ : "";
const contacts = typeof __FIELD_TOUCH_URL__ === "string" ? __FIELD_TOUCH_URL__ : "";
const contactNames = ["ui:glass-touch-move", "ui:glass-touch-look", "ui:glass-touch-knob", "ui:glass-touch-emblem"];
const cell = 64, columns = 8;
const cells = new Map<string, number>();
const add = (prefix: string, names: string) => {
  for (const name of names.split(" ")) cells.set(prefix + name, cells.size);
};
add("core:", "pick hatchet spear bow waterskin torch spyglass bola berry flint fiber wood stone thatch hide ingot");
add("ui:glass-", "emblem bag craft map survivor radio settings whistles kit gestures follow stay attack-target drink eat spyglass wave point salute");
add("ui:glass-", "health stamina food water oxygen torpor weight");

export const FIELD_WIDTH = cell * columns, FIELD_HEIGHT = cell * Math.ceil(cells.size / columns);

export function installFieldIcons(frame: UiFrame, sheetUrl = url, touchUrl = contacts, equipmentUrl = equipment): void {
  if (!sheetUrl) return;
  const catalogue = frame.icons;
  const image: UiImage = { width: FIELD_WIDTH, height: FIELD_HEIGHT,
    data: new Uint8ClampedArray(0), url: sheetUrl, version: 1, smooth: true };
  frame.images[IMAGE_FIELD_ICONS] = image;
  if (touchUrl) frame.images[IMAGE_FIELD_ICONS + 1] = { ...image, width: 352, height: 352, url: touchUrl };
  if (equipmentUrl) frame.images[IMAGE_EQUIPMENT] = { ...image, width: 768, height: 768, url: equipmentUrl };
  frame.icons = {
    place(node, owner) {
      if (touchUrl && owner.startsWith("ui:glass-touch-")) {
        const contact = contactNames.indexOf(owner);
        if (contact >= 0) {
          node.image = IMAGE_FIELD_ICONS + 1;
          node.sx = contact % 2 * 176;
          node.sy = Math.floor(contact / 2) * 176;
          node.sw = node.sh = 176;
          return true;
        }
      }
      const detail = owner.startsWith("ui:inspect/");
      if (detail) owner = owner.slice("ui:inspect/".length);
      const index = cells.get(owner);
      if (index === undefined) return catalogue?.place(node, owner) ?? false;
      const large = detail && equipmentUrl && index < 16;
      const side = large ? 192 : cell, across = large ? 4 : columns;
      node.image = large ? IMAGE_EQUIPMENT : IMAGE_FIELD_ICONS;
      node.sx = index % across * side;
      node.sy = Math.floor(index / across) * side;
      node.sw = node.sh = side;
      return true;
    },
  };
}
