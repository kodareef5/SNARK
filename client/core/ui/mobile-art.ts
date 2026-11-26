// The mobile sheet is fetched when a wheel or thumb pad is drawn.
import type { UiFrame } from "./nodes.ts";

declare const __MOBILE_ART__: string;
const sprites = ["ui:mobile-wheel", "ui:mobile-fan", "ui:glass-touch-move", "ui:glass-touch-look", "ui:glass-touch-look-lit", "ui:glass-touch-knob", "ui:mobile-radio", "ui:mobile-help"];
const IMAGE_MOBILE = 39;

export function installMobileArt(f: UiFrame, url = typeof __MOBILE_ART__ === "string" ? __MOBILE_ART__ : ""): void {
  if (!url || f.images[IMAGE_MOBILE]) return;
  f.images[IMAGE_MOBILE] = { width: 768, height: 768, data: new Uint8ClampedArray(0), url, smooth: true, version: 1 };
  const previous = f.icons;
  f.icons = {
    place(node, owner) {
      const i = sprites.indexOf(owner);
      if (i < 0) return previous?.place(node, owner) ?? false;
      node.image = IMAGE_MOBILE;
      node.sx = (i % 3) * 256;
      node.sy = Math.floor(i / 3) * 256;
      node.sw = node.sh = 256;
      return true;
    },
  };
}
