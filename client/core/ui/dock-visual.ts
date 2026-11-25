// The edge rims use one shared, translucent glass disc. The canvas crops the half nearest the field.
import { K_IMAGE, K_PANEL, type UiFrame, type UiImage } from "./nodes.ts";
import { S_ICE, S_LABEL } from "./style.ts";

const IMAGE_RIM = 43;
const SIDE = 256;
let face: UiImage | undefined;
function wheelFace(): UiImage {
  if (face) return face;
  const data = new Uint8ClampedArray(SIDE * SIDE * 4);
  const center = SIDE / 2;
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
    const dx = x + .5 - center, dy = y + .5 - center, radius = Math.hypot(dx, dy) / center;
    if (radius >= 1) continue;
    const pixels = (y * SIDE + x) * 4;
    const angle = Math.atan2(dy, dx);
    const tick = radius > .92 && Math.abs(Math.sin(48 * angle)) < .1;
    const outer = Math.max(0, 1 - Math.abs(radius - .984) * 110);
    const bevel = Math.max(0, 1 - Math.abs(radius - .90) * 175);
    const inner = Math.max(0, 1 - Math.abs(radius - .57) * 160);
    const silver = Math.max(tick ? .62 : 0, outer, bevel * .67, inner * .69);
    const light = .77 - .23 * Math.sin(angle);
    data[pixels] = 10 + 190 * silver * light;
    data[pixels+1] = 35 + 190 * silver * light;
    data[pixels+2] = 55 + 186 * silver * light;
    data[pixels+3] = Math.min(1, (1 - radius) * center) * (radius > .57 ? 141 + 93 * silver : 51 + 100 * silver);
  }
  return face = { width: SIDE, height: SIDE, data, version: 1, smooth: true };
}

export function rim(f: UiFrame, key: number, left: boolean, edge: number, cy: number, radius: number, alpha: number, reveal = 1): void {
  f.images[IMAGE_RIM] ??= wheelFace();
  const width = radius * reveal, crop = Math.max(1, Math.round(SIDE / 2 * reveal));
  const n = f.add(key, K_IMAGE, left ? edge : edge-width, cy-radius, width, radius*2, S_LABEL);
  n.image = IMAGE_RIM; n.sx = left ? SIDE-crop : 0; n.sy = 0; n.sw = crop; n.sh = SIDE; n.alpha = alpha;
}

export function line(f: UiFrame, key: number, x: number, y: number, w: number, h: number, tint: number, alpha: number): void {
  const n = f.add(key, K_PANEL, x, y, w, h, S_ICE);
  n.tint = tint; n.alpha = alpha;
}
