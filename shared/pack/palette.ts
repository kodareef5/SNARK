// A vertex stores one byte. Values below REGION_BASE are fixed palette colours. Values REGION_BASE..REGION_BASE+5 mean colour
// region 0..5, whose colour comes from the instance being drawn, so a recoloured instance needs no second mesh or texture.

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
export const WATER_COLOR = 14;

/** A survivor's body colours sit just below the regions. A look stores an index into each list. */
export const SKIN_BASE = 214;
export const SKIN_TONES = 10;
export const HAIR_BASE = 224;
export const HAIR_COLORS = 10;
export const EYE_BASE = 234;
export const EYE_COLORS = 6;

const BODY: readonly (readonly [number, number, number])[] = [
  // skin
  [255, 224, 196], [244, 206, 172], [232, 187, 150], [217, 166, 128], [198, 142, 104],
  [176, 120, 84], [150, 98, 66], [122, 78, 52], [94, 60, 40], [68, 44, 32],
  // hair: blond, dark blond, ginger, brown, dark brown, near black, black, grey, white, dyed red
  [236, 214, 150], [196, 156, 88], [176, 96, 44], [116, 72, 42], [78, 52, 36],
  [46, 36, 32], [22, 20, 24], [136, 136, 140], [230, 230, 232], [170, 40, 44],
  // eyes: brown, dark brown, blue, green, grey, amber
  [104, 66, 38], [58, 38, 28], [78, 124, 176], [86, 140, 92], [124, 134, 142], [170, 124, 48],
];

/** Dyes: this many hues, from red round to rose, at this many lightnesses from dark to light. */
const DYE_HUES = 12;
const DYE_ROWS = 5;
/**
 * Natural tones, in rings round grey: how far a ring's colours are from grey (the spread of their channels, of 1), and
 * the hues on it in degrees. Warm and cool grey; taupe and stone; red-brown, brown, tan and khaki; rust, straw and
 * olive. Each hue of each ring runs from near black to near white in this many steps.
 */
const EARTH: readonly (readonly [number, readonly number[]])[] = [[0.04, [40, 220]], [0.11, [28, 56]], [0.22, [20, 31, 42, 53]], [0.33, [16, 36, 56]]];
const EARTH_STEPS = 12;

/** Entries 22..213: the dyes, row by row, then the natural tones, a run from dark to light for each hue of each ring. */
export function rampColours(): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let row = 0; row < DYE_ROWS; row++) for (let hue = 0; hue < DYE_HUES; hue++) out.push(hsl(hue / DYE_HUES, 0.7, 0.22 + 0.145 * row));
  EARTH.forEach(([spread, hues], ring) => {
    hues.forEach((hue, k) => {
      for (let step = 0; step < EARTH_STEPS; step++) {
        // Neighbouring runs are half a step apart, so the colours of one fall between those of the next.
        const l = 0.09 + (0.83 * (step + ((ring + k) % 2) / 2)) / (EARTH_STEPS - 0.5);
        // Near black and near white there is no room to be far from grey.
        out.push(hsl(hue / 360, Math.min(0.6, spread / (1 - Math.abs(2 * l - 1))), l));
      }
    });
  });
  return out;
}

/** RGBA bytes for all 256 entries. */
export function defaultPalette(): Uint8Array {
  const out = new Uint8Array(PALETTE_SIZE * 4);
  const ramp = rampColours();
  for (let i = 0; i < PALETTE_SIZE; i++) {
    let rgb: readonly [number, number, number] = FIXED[0]!;
    if (i < FIXED.length) rgb = FIXED[i]!;
    else if (i >= SKIN_BASE && i < REGION_BASE) rgb = BODY[i - SKIN_BASE]!;
    else if (i < REGION_BASE) rgb = ramp[i - FIXED.length] ?? FIXED[0]!;
    out[i * 4] = rgb[0];
    out[i * 4 + 1] = rgb[1];
    out[i * 4 + 2] = rgb[2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** The fixed colour nearest an sRGB colour of 255 a channel: a palette index below REGION_BASE, and never 0. */
export function nearestColour(palette: Uint8Array, r: number, g: number, b: number): number {
  let best = 1;
  let least = Infinity;
  for (let i = 1; i < REGION_BASE; i++) {
    const [dr, dg, db] = [palette[i * 4]! - r, palette[i * 4 + 1]! - g, palette[i * 4 + 2]! - b];
    const d = dr * dr + dg * dg + db * db;
    if (d < least) {
      least = d;
      best = i;
    }
  }
  return best;
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

/** The colour of each level of a stress mesh, finest first: red, yellow, green, blue, orange. A picture then shows which level was drawn. */
export const LEVEL_COLOURS: readonly number[] = [8, 6, 7, 14, 3];
