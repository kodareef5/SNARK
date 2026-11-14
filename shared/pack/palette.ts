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
/** The first of the colours made by rule (rampColours), which run up to SKIN_BASE. */
export const RAMP_BASE = FIXED.length;

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
 * Natural tones, in rings round grey in OKLab, where equal steps look equal: a ring's chroma, how many colours each of
 * its runs has from dark to light, and how many hues it has, spread evenly from the first to the last in degrees.
 */
const EARTH: readonly (readonly [chroma: number, steps: number, hues: number, first: number, last: number])[] = [
  [0.016, 12, 2, 244, 78], // slate and warm grey
  [0.061, 10, 4, 33, 153], // dusky rose, umber to buff, olive grey, grey-green
  [0.086, 8, 4, 124, 65], // moss, olive, khaki, tan
  [0.115, 8, 3, 43, 139], // rust, mustard, leaf
  [0.124, 6, 2, 52, 79], // dull orange, ochre
];
/** Lightness of the darkest and lightest colours of the longest runs, and of the middle of the shorter ones. */
const EARTH_LIGHT = [0.273, 0.912, 0.585] as const;
/** Below this lightness chroma falls in proportion toward black. */
const EARTH_DARK = 0.59;
/** Degrees a run's hue turns a unit of lightness from its middle: lighter is yellower, as in bark, hide and soil. */
const EARTH_TURN = 35;

/** Entries 22..213: the dyes, row by row, then the natural tones, a run from dark to light for each hue of each ring. */
export function rampColours(): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let row = 0; row < DYE_ROWS; row++) for (let hue = 0; hue < DYE_HUES; hue++) out.push(hsl(hue / DYE_HUES, 0.7, 0.22 + 0.145 * row));
  const [lo, hi, mid] = EARTH_LIGHT;
  const longest = Math.max(...EARTH.map((ring) => ring[1]));
  const step = (hi - lo) / (longest - 0.5);
  EARTH.forEach(([chroma, steps, hues, first, last], ring) => {
    for (let k = 0; k < hues; k++) {
      const hue = hues === 1 ? first : first + ((last - first) * k) / (hues - 1);
      // Neighbouring runs, on a ring and from ring to ring, are half a step apart, so the colours of one fall between those of the next.
      const start = (steps === longest ? lo : mid - ((steps - 1) / 2) * step) + (((ring + k) % 2) * step) / 2;
      for (let s = 0; s < steps; s++) {
        const l = start + s * step;
        out.push(oklch(l, chroma * Math.min(1, l / EARTH_DARK), hue + EARTH_TURN * (l - mid)));
      }
    }
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

/** sRGB of 255 a channel from OKLab lightness, chroma and hue in degrees, clipped to what sRGB holds. */
function oklch(l: number, c: number, hue: number): [number, number, number] {
  const a = c * Math.cos((hue * Math.PI) / 180);
  const b = c * Math.sin((hue * Math.PI) / 180);
  const [m1, m2, m3] = [(l + 0.3963377774 * a + 0.2158037573 * b) ** 3, (l - 0.1055613458 * a - 0.0638541728 * b) ** 3, (l - 0.0894841775 * a - 1.291485548 * b) ** 3];
  const linear = [4.0767416621 * m1 - 3.3077115913 * m2 + 0.2309699292 * m3, -1.2684380046 * m1 + 2.6097574011 * m2 - 0.3413193965 * m3, -0.0041960863 * m1 - 0.7034186147 * m2 + 1.707614701 * m3];
  const [r, g, bl] = linear.map((v) => {
    const x = Math.min(1, Math.max(0, v));
    return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
  });
  return [r!, g!, bl!];
}

/** The colour of each level of a stress mesh, finest first: red, yellow, green, blue, orange. A picture then shows which level was drawn. */
export const LEVEL_COLOURS: readonly number[] = [8, 6, 7, 14, 3];
