// The palette: every colour drawn in the world is one of 256 entries.
//
// A vertex stores one byte. Values below REGION_BASE are fixed palette colours.
// Values REGION_BASE..REGION_BASE+5 mean "colour region 0..5": the colour comes
// from the instance being drawn, not the mesh. Creature colour regions,
// mutations, dyed armour and painted structures are all that one mechanism, and
// none of them needs a second mesh, texture or material.

export const PALETTE_SIZE = 256;
export const REGION_BASE = 240;
export const REGION_COUNT = 6;

const FIXED: readonly (readonly [number, number, number])[] = [
  [255, 0, 255], // 0 missing
  [200, 200, 196], // 1 plaza
  [150, 152, 156], // 2 concrete
  [232, 140, 48], // 3 dev orange
  [92, 98, 110], // 4 slate
  [120, 146, 178], // 5 wall blue
  [236, 208, 72], // 6 marker yellow
  [96, 176, 104], // 7 step green
  [208, 72, 72], // 8 survivor red
  [64, 170, 170], // 9 creature teal
  [245, 245, 245], // 10 white
  [20, 20, 24], // 11 black
  [132, 150, 112], // 12 rough ground
  [150, 190, 230], // 13 sky
  [60, 110, 170], // 14 water
  [128, 128, 128], // 15 neutral
  [120, 190, 110], // 16 slope 10 degrees
  [160, 196, 100], // 17 slope 20
  [200, 196, 90], // 18 slope 30
  [224, 170, 80], // 19 slope 40
  [228, 130, 70], // 20 slope 50
  [220, 90, 70], // 21 slope 60
];

export const SKY_COLOR = 13;

/** RGBA bytes for all 256 entries. Entries 22..239 are a hue and lightness ramp for dyes. */
export function defaultPalette(): Uint8Array {
  const out = new Uint8Array(PALETTE_SIZE * 4);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    let rgb: readonly [number, number, number] = FIXED[0]!;
    if (i < FIXED.length) rgb = FIXED[i]!;
    else if (i < REGION_BASE) {
      const n = i - FIXED.length;
      const hue = (n % 24) / 24;
      const row = Math.floor(n / 24);
      rgb = hsl(hue, row % 3 === 2 ? 0.35 : 0.7, 0.18 + 0.09 * row);
    }
    out[i * 4] = rgb[0];
    out[i * 4 + 1] = rgb[1];
    out[i * 4 + 2] = rgb[2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * (l < 0.5 ? l : 1 - l);
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    const m = k - 3 < 9 - k ? k - 3 : 9 - k;
    return Math.round(255 * (l - a * (m < -1 ? -1 : m > 1 ? 1 : m)));
  };
  return [f(0), f(8), f(4)];
}
