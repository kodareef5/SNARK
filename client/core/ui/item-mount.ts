// The inspection plate is one cached image behind the actual inventory picture.
import { K_IMAGE, type UiFrame, type UiImage } from "./nodes.ts";
import { S_LABEL } from "./style.ts";

const IMAGE_MOUNT = 44, size = 144;
let plate: UiImage | undefined;
function buildPlate(): UiImage {
  const data = new Uint8ClampedArray(size * size * 4), radius = size * .46;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + .5 - size / 2) / radius, dy = (y + .5 - size / 2) / radius;
    const r = Math.hypot(dx, dy), angle = Math.atan2(dy, dx), at = (y * size + x) * 4;
    const spoke = Math.cos(angle * 48);
    const bezel = r > .974 && r < 1 || r > .86 && r < .872;
    const tick = r < .95 && r > (Math.cos(angle * 8) > .9 ? .886 : .918) && spoke > .92;
    const shine = Math.max(0, Math.cos(angle + 2.3));
    if (bezel || tick) {
      data.set([102 + 115 * shine, 167 + 67 * shine, 192 + 58 * shine, tick ? 167 : 90 + 105 * shine], at);
    } else if (r < .972) {
      data.set([12 + 14 * shine, 36 + 15 * shine, 54 + 18 * shine, 68 + 48 * r], at);
    }
  }
  return { data, width: size, height: size, version: 1, smooth: true };
}

export function itemMount(f: UiFrame, key: number, x: number, y: number, width: number): void {
  f.images[IMAGE_MOUNT] ??= plate ??= buildPlate();
  f.add(key, K_IMAGE, x, y, width, width, S_LABEL).image = IMAGE_MOUNT;
}
