// Draws the examples' pictures: `bun tools/blender/example/demo/pictures.ts`. A real asset's are painted, and only
// named in its asset.ts. These are small and made by rule, so that the examples show every kind of picture a material
// may have and what the check says of each.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodePng, type Picture } from "../../../pack/image.ts";

const SIZE = 64;

function write(folder: string, name: string, channels: 1 | 3, depth: 8 | 16, pixel: (x: number, y: number) => number[]): void {
  const data = depth === 8 ? new Uint8Array(SIZE * SIZE * channels) : new Uint16Array(SIZE * SIZE * channels);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) data.set(pixel(x, y), (y * SIZE + x) * channels);
  const picture: Picture = { width: SIZE, height: SIZE, channels, depth, data };
  mkdirSync(join(import.meta.dir, folder), { recursive: true });
  writeFileSync(join(import.meta.dir, folder, name), encodePng(picture));
}

/** A whole layer set from a height, 0 to 1, that wraps: base colour, the height itself, the normal it gives, and a packed map. */
function layers(folder: string, name: string, height: (x: number, y: number) => number, base: (x: number, y: number, h: number) => number[], rough: number): void {
  const h = (x: number, y: number): number => height((x + SIZE) % SIZE, (y + SIZE) % SIZE);
  write(folder, `${name}_base.png`, 3, 8, (x, y) => base(x, y, h(x, y)));
  write(folder, `${name}_height.png`, 1, 16, (x, y) => [Math.round(h(x, y) * 65535)]);
  // Red leans away from a rise to the right. Green points up the picture, so it leans up from a rise further down.
  write(folder, `${name}_normal.png`, 3, 8, (x, y) => {
    const n = [(h(x - 1, y) - h(x + 1, y)) * 2, (h(x, y + 1) - h(x, y - 1)) * 2, 1];
    const length = Math.hypot(n[0]!, n[1]!, n[2]!);
    return n.map((c) => Math.round((c / length / 2 + 0.5) * 255));
  });
  // Occlusion in red, darker in the hollows. Roughness in green. Nothing is metal.
  write(folder, `${name}_packed.png`, 3, 8, (x, y) => [Math.round(155 + 100 * h(x, y)), Math.round(rough * 255), 0]);
}

// The crate's planks: four boards across a picture one metre wide, with a groove between each and a faint grain. The
// picture wraps in the middle of a board.
const groove = (x: number): number => Math.min(1, Math.min((x + 8) % 16, 15 - ((x + 8) % 16)) / 2);
const grain = (x: number, y: number): number => 0.5 + 0.5 * Math.sin((y * Math.PI) / 16 + (((x + 8) % SIZE) >> 4) * 2);
layers("structures/crate/tex", "planks", (x, y) => groove(x) * (0.85 + 0.15 * grain(x, y)), (x, y, h) => [150, 112, 70].map((c) => Math.round(c * (0.55 + 0.45 * h) * (0.94 + 0.06 * grain(x, y + 5)))), 0.8);

// The pup's hide, laid out as model.py maps it: the body over the top three quarters, the legs along the bottom. It is
// light grey where a region dyes it. The snout, the last rows of the body, is dark and is never dyed.
const BODY = SIZE * 0.75;
const SNOUT = BODY - 4;
const fur = (x: number, y: number): number => 0.5 + 0.25 * Math.sin((x * Math.PI) / 4) * Math.sin((y * Math.PI) / 8) + 0.25 * Math.sin((x * Math.PI) / 16);
layers("creatures/pup/tex", "hide", fur, (x, y, h) => (y >= SNOUT && y < BODY ? [58, 48, 46] : [0, 0, 0].map(() => Math.round(176 + 48 * h))), 0.9);
// The region map, in flat colours: red is region 0, the coat, and green region 1, the legs. Black takes no dye.
write("creatures/pup/tex", "hide_regions.png", 3, 8, (_x, y) => (y >= BODY ? [0, 255, 0] : y >= SNOUT ? [0, 0, 0] : [255, 0, 0]));
console.log("drew the crate's planks and the pup's hide");
