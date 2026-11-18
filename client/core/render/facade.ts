// What a building's front wears over its world finish: frames, glass and the rooms behind it, doors, shutters, sign
// bands and clearance bars. Each is a painted element laid over a box of a facade module (content/ruins.ts), which is
// known by its colour and its face's size in metres. Glass shows a room that is not modelled: a box behind the pane
// whose faces come from the rooms' atlas, met by the eye's ray (interior mapping), and over it the sky and the street's
// far side. The maths is here twice, as functions on numbers for the software rasterizer and as GLSL, from the same
// constants. Directions are in the world; a face's own frame is x to the right of a reader facing it, y up, z out.

import type { PackMaterial } from "../../../shared/pack/pack.ts";
import type { Tier } from "../assets/tiers.ts";
import { FRAME, type FramePacket } from "./packet.ts";

type Numbers = ArrayLike<number>;
type Out = Float64Array | number[];

/** The side of both atlases at their finest, and the elements' pixels a metre there. */
export const FACADE_TOP = 2048;
export const DENSITY = 128;
const GAP = 16;

/** Each element: its name, its width and height in metres, how many painted variants, and its pixels a metre where not DENSITY. */
export const ELEMENTS: readonly (readonly [string, number, number, number, number?])[] = [
  ["window", 1.4, 2, 3], ["slider", 0.9, 2.2, 2], ["casement", 1.4, 1.4, 2], ["strip", 6.8, 0.8, 1], ["curtain", 2, 2.6, 2],
  ["display", 5, 2.4, 2], ["shutter", 7.2, 2.9, 3], ["sign", 7.2, 0.9, 16, 80], ["bar", 6.8, 0.25, 2], ["door", 1, 2.2, 3],
  ["blind", 1, 1, 1], ["drape", 1, 2, 2], ["boards", 1.2, 2.4, 2], ["shards", 1.5, 1.5, 2],
];

/** An element's variant in the atlas: pixels at FACADE_TOP, rows from the top. */
export interface Placed { readonly name: string; readonly variant: number; readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/** Items laid into an atlas FACADE_TOP across at `density` pixels a metre or their own: the largest first, each on the lowest run of columns it fits, GAP apart. */
function lay(list: readonly (readonly [string, number, number, number, number?])[], density: number): Placed[] {
  const items = list.flatMap(([name, w, h, n, d = density]) => Array.from({ length: n }, (_, variant) => ({ name, variant, w: Math.ceil((w * d) / 8) * 8, h: Math.ceil((h * d) / 8) * 8 })));
  const order = items.map((_, i) => i).sort((a, b) => items[b]!.w * items[b]!.h - items[a]!.w * items[a]!.h || a - b);
  const sky = new Int32Array(FACADE_TOP / 8).fill(GAP);
  const at = new Array<{ x: number; y: number }>(items.length);
  for (const i of order) {
    const it = items[i]!, cols = (it.w + GAP) / 8;
    let best = -1, low = Infinity;
    for (let c = GAP / 8; c + cols <= FACADE_TOP / 8; c++) {
      let y = 0;
      for (let k = c; k < c + cols; k++) y = Math.max(y, sky[k]!);
      if (y < low) {
        low = y;
        best = c;
      }
    }
    if (low + it.h + GAP > FACADE_TOP) throw new Error(`facade: no room in the atlas for ${it.name}`);
    for (let k = best; k < best + cols; k++) sky[k] = low + it.h + GAP;
    at[i] = { x: best * 8, y: low };
  }
  return items.map((it, i) => ({ ...it, ...at[i]! }));
}
/** The elements laid into their atlas, in ELEMENTS order. */
export const PLACED: readonly Placed[] = lay(ELEMENTS, DENSITY);
const first = (name: string): number => PLACED.findIndex((p) => p.name === name);

/** The marks painted on walls: posters, sprayed tags, large pieces, a garage's stencils, and vinyl left on a shop's glass; laid at MARK_DENSITY pixels a metre into their own atlas. */
export const MARKS: readonly (readonly [string, number, number, number])[] = [["poster", 0.6, 0.9, 14], ["tag", 1, 0.5, 8], ["piece", 3.2, 1.2, 7], ["stencil", 0.6, 0.8, 4], ["vinyl", 1.2, 0.8, 3]];
const MARK_DENSITY = 256;
export const MARKS_PLACED: readonly Placed[] = lay(MARKS, MARK_DENSITY);
const mark = (name: string): number => MARKS_PLACED.findIndex((p) => p.name === name);
const marks = (name: string): number => MARKS.find((q) => q[0] === name)![3];

/** The rooms' atlas: 4 by 4 rooms, each four squares, back wall and side wall over floor and ceiling. */
export const ROOMS = 16;
export const ROOM_FACES = ["back", "side", "floor", "ceiling"] as const;

/**
 * The colours a facade module's parts are drawn in (content/ruins.ts), and the class each gives a vertex: a dark opening,
 * a pane, a shutter's painted steel, a sign band, a clearance bar. Any other colour is class 0.
 */
export const FACADE_COLOURS: Readonly<Record<number, number>> = { 83: 1, 92: 2, 5: 3, 135: 4, 6: 5 };

export const KIND = { none: 0, window: 1, slider: 2, casement: 3, strip: 4, display: 5, curtain: 6, shutter: 7, sign: 8, bar: 9, door: 10, jamb: 11, pier: 12 } as const;
/**
 * A kind of part: its colour class, its face's width and height in metres (0 for any width), its element, and where it
 * is glass the room behind it, in metres from the face: how far it runs past the face's left and right edges, below its
 * foot and above its head, how deep it is, and the rooms it may be. Rooms of a curtain wall are cells of `cell` metres.
 */
interface Kind { colour: number; w: number; h: number; element: string; room?: { left: number; right: number; below: number; above: number; depth: number; rooms: readonly number[]; cell?: number } }
const HOMES = [0, 1, 2, 3, 4, 5, 0, 1, 3, 15];
export const KINDS: readonly Kind[] = [
  { colour: -1, w: 0, h: 0, element: "" },
  { colour: 1, w: 1.4, h: 2, element: "window", room: { left: 1.3, right: 1.3, below: 1, above: 0.2, depth: 4.5, rooms: HOMES } },
  { colour: 1, w: 0.9, h: 2.2, element: "slider", room: { left: 0.5, right: 2.6, below: 0, above: 0.7, depth: 4.5, rooms: HOMES } },
  { colour: 1, w: 1.4, h: 1.4, element: "casement", room: { left: 2, right: 0.6, below: 0.9, above: 0.6, depth: 4.5, rooms: HOMES } },
  { colour: 1, w: 6.8, h: 0.8, element: "strip", room: { left: 0.6, right: 0.6, below: 2.3, above: 0.4, depth: 6, rooms: [13, 13, 14] } },
  { colour: 1, w: 5, h: 2.4, element: "display", room: { left: 0, right: 2.2, below: 0.5, above: 0.1, depth: 6, rooms: [10, 11, 12, 10, 12, 15] } },
  { colour: 2, w: 0, h: 2.6, element: "curtain", room: { left: 0, right: 0, below: 1, above: 0, depth: 8, rooms: [6, 7, 8, 9, 6, 8], cell: 8 } },
  { colour: 3, w: 7.2, h: 2.9, element: "shutter" },
  { colour: 4, w: 7.2, h: 0.9, element: "sign" },
  { colour: 5, w: 6.8, h: 0.25, element: "bar" },
  { colour: 1, w: 1, h: 2.2, element: "door", room: { left: 1.5, right: 1.5, below: 0, above: 0.7, depth: 6, rooms: [13, 14] } },
  { colour: 0, w: 1.25, h: 2.9, element: "door" },
  { colour: 0, w: 0.7, h: 3.6, element: "" },
];
/** How near a face's size must be to a kind's, in metres. */
const NEAR = 0.04;
/**
 * A room's light behind glass as a share of the daylight on the face it looks out of, and how much of that is gone at
 * its back wall: a room lit by its window is darker than the street, and darker deeper in.
 */
const ROOM_LIGHT = 0.55;
const ROOM_DEPTH = 0.7;
/**
 * A room behind glass is lit by the sky's share at the top of its opening, ROOM_OUT metres out over the street, so a
 * canopy or a balcony over the front shades it only as far as it reaches, and never less than ROOM_OPEN_LEAST of it.
 */
export const ROOM_OUT = 3;
export const ROOM_OPEN_LEAST = 0.55;
/** Dirty glass: the film's own albedo at its thickest, and how much of the room it hides there. */
const FILM_ALBEDO = 0.35;
const FILM_HIDES = 0.45;
/** How far the glass stands behind the face of its frame, and a blind and a curtain behind the glass, in metres. */
const SET_BACK = 0.04;
const BLIND_BACK = 0.08;
const DRAPE_BACK = 0.12;

/**
 * What each tier draws: the elements' atlas and the rooms' at their sides (0 for none), and whether glass shows its room
 * and the street's far side; without them glass is a dark recess. Low poly draws none of it.
 */
export interface FacadeTier { readonly elements: number; readonly rooms: number; readonly marks: number; readonly reflect: boolean }
export const FACADE_TIERS: Readonly<Record<string, FacadeTier | null>> = {
  lowpoly: null,
  medium: { elements: 1024, rooms: 0, marks: 1024, reflect: false },
  high: { elements: 2048, rooms: 2048, marks: 2048, reflect: true },
  ultra: { elements: 2048, rooms: 2048, marks: 2048, reflect: true },
};
/** The pack's materials of the atlases (tools/facade/build.ts): the elements' base colour, normal and packed map, and the rooms' and the marks' base colours. */
export const FACADE_MATERIALS = ["core:facade_elements", "core:facade_rooms", "core:facade_marks"] as const;

/** The height in the world, in metres, of the line the last flood left on every wall, by city; none where a city has none. */
export const FACADE_FLOOD: Readonly<Record<string, number>> = { miami: 1.6 };
export const NO_FLOOD = -1e4;

/**
 * Each placed element's mean at its finest, which it fades to far off: linear red, green and blue of its solid part,
 * its cover (base alpha), its roughness; each mark's, linear red, green and blue where it covers, and its cover; and each
 * room's, linear red, green and blue. tools/facade/build.ts measures them from the atlases it makes.
 */
export const ELEMENT_MEANS: readonly number[] = [0.5726, 0.567, 0.477, 0.2566, 0.2085, 0.1426, 0.109, 0.07729, 0.2566, 0.2077, 0.5379, 0.5212, 0.4229, 0.2566, 0.2651, 0.5907, 0.5848, 0.4916, 0.2535, 0.2023, 0.1575, 0.1224, 0.08767, 0.2535, 0.2031, 0.5515, 0.5461, 0.4589, 0.2158, 0.1881, 0.1449, 0.1119, 0.08002, 0.211, 0.1837, 0.5499, 0.5438, 0.4577, 0.207, 0.1753, 0.09125, 0.1097, 0.09978, 0.3799, 0.1181, 0.07765, 0.05798, 0.04474, 0.3799, 0.1171, 0.3531, 0.3658, 0.3331, 0.1306, 0.1646, 0.1392, 0.1075, 0.07665, 0.1306, 0.1649, 0.1593, 0.2302, 0.2598, 1, 0.7903, 0.3903, 0.4049, 0.3726, 0.9989, 0.6862, 0.4834, 0.4333, 0.2989, 1, 0.793, 0.3262, 0.3778, 0.3094, 1, 0.8576, 0.5013, 0.454, 0.4006, 1, 0.8539, 0.4916, 0.43, 0.3224, 1, 0.8594, 0.318, 0.3761, 0.3868, 1, 0.8574, 0.27, 0.2791, 0.2667, 1, 0.8511, 0.423, 0.3027, 0.2663, 1, 0.8589, 0.3688, 0.2813, 0.1739, 1, 0.8359, 0.2698, 0.2815, 0.2711, 1, 0.6855, 0.3499, 0.3035, 0.1827, 1, 0.7229, 0.4357, 0.3767, 0.3038, 1, 0.7407, 0.2534, 0.3098, 0.2801, 1, 0.834, 0.345, 0.3251, 0.3618, 1, 0.8399, 0.181, 0.1886, 0.1707, 1, 0.6779, 0.4902, 0.4755, 0.4222, 1, 0.8355, 0.2599, 0.1684, 0.1487, 1, 0.7179, 0.3893, 0.2746, 0.2265, 1, 0.7481, 0.3321, 0.2574, 0.0921, 1, 0.7832, 0.4679, 0.3507, 0.1155, 1, 0.7789, 0.3135, 0.3356, 0.2979, 0.5187, 0.4147, 0.1143, 0.2159, 0.1813, 0.9577, 0.7781, 0.2457, 0.1304, 0.09312, 1, 0.8017, 0.5906, 0.5515, 0.4119, 0.8226, 0.5917, 0.5793, 0.4899, 0.3497, 0.9647, 0.8438, 0.2261, 0.2843, 0.3053, 0.9627, 0.8438, 0.3105, 0.2664, 0.217, 0.9925, 0.8496, 0.2983, 0.2633, 0.2175, 0.5663, 0.8514, 0.4215, 0.4536, 0.3792, 0.1455, 0.07263, 0.4171, 0.4514, 0.3785, 0.1464, 0.07176];
export const MARK_MEANS: readonly number[] = [0.4116, 0.3295, 0.1334, 0.8442, 0.5495, 0.459, 0.3242, 0.85, 0.5145, 0.4908, 0.4103, 0.7845, 0.4971, 0.3622, 0.2594, 0.8477, 0.5358, 0.5078, 0.418, 0.8251, 0.4526, 0.478, 0.4487, 0.8134, 0.6639, 0.3739, 0.3548, 0.8729, 0.5467, 0.3209, 0.2095, 0.8522, 0.5581, 0.4295, 0.307, 0.8537, 0.3422, 0.3693, 0.3043, 0.8682, 0.5777, 0.4284, 0.2307, 0.8599, 0.3081, 0.1138, 0.06147, 0.8572, 0.5668, 0.4167, 0.3356, 0.7955, 0.392, 0.3248, 0.2808, 0.8394, 0.04228, 0.04228, 0.03818, 0.1901, 0.4903, 0.2012, 0.2083, 0.2458, 0.1945, 0.3323, 0.4339, 0.1386, 0.3714, 0.3754, 0.3375, 0.3122, 0.6942, 0.687, 0.5909, 0.1893, 0.3055, 0.387, 0.2709, 0.1758, 0.5148, 0.2541, 0.1195, 0.2146, 0.3717, 0.2965, 0.4183, 0.1753, 0.3228, 0.3694, 0.33, 0.574, 0.3067, 0.3124, 0.2731, 0.5021, 0.273, 0.2735, 0.2742, 0.4449, 0.2162, 0.1766, 0.07111, 0.3749, 0.5102, 0.2035, 0.1324, 0.5592, 0.5536, 0.3367, 0.3393, 0.4949, 0.4769, 0.2652, 0.1761, 0.4901, 0.4099, 0.4037, 0.3459, 0.2263, 0.3384, 0.2746, 0.1084, 0.2344, 0.7258, 0.7111, 0.6067, 0.1991, 0.304, 0.2488, 0.1025, 0.2356, 0.7526, 0.7348, 0.6509, 0.1135, 0.6555, 0.6083, 0.4844, 0.05289, 0.5977, 0.6585, 0.6109, 0.1635];
export const ROOM_MEANS: readonly number[] = [0.2983, 0.2752, 0.192, 0.2211, 0.2479, 0.233, 0.2763, 0.2707, 0.2117, 0.2314, 0.2265, 0.1938, 0.2664, 0.2406, 0.1757, 0.3243, 0.3099, 0.2531, 0.1549, 0.1495, 0.1317, 0.2371, 0.2168, 0.1959, 0.2354, 0.2187, 0.1953, 0.1742, 0.1609, 0.132, 0.2351, 0.2149, 0.1754, 0.2418, 0.2283, 0.1915, 0.2559, 0.2261, 0.2009, 0.247, 0.2757, 0.2113, 0.2402, 0.2221, 0.1803, 0.09239, 0.08356, 0.07712];

const fract = (x: number): number => x - Math.floor(x);
const clamp = (x: number, a = 0, b = 1): number => (x < a ? a : x > b ? b : x);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** A number from 0 to 1 from three integers. */
export function facadeHash(x: number, y: number, z: number): number {
  let h = (Math.imul(x | 0, 1597334677) ^ Math.imul(y | 0, 3812015801) ^ Math.imul(z | 0, 2798796415)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0;
  return ((h ^ (h >>> 13)) >>> 8) / 16777216;
}

/** The kind of a face of colour class `colour`, `w` by `h` metres, whose normal's height is `up`; 0 for none. */
export function facadeKind(colour: number, w: number, h: number, up: number): number {
  if (!(w > 0 && h > 0) || Math.abs(up) > 0.5) return 0;
  for (let k = 1; k < KINDS.length; k++) {
    const d = KINDS[k]!;
    if (d.colour === colour && Math.abs(h - d.h) < NEAR && (d.w === 0 ? w > 1.9 : Math.abs(w - d.w) < NEAR)) return k;
  }
  return 0;
}

/**
 * A seed for a place on a static: (px, pz) is its instance's origin in quarter metres (whole numbers), x and z a point
 * in the instance's own frame and y its height in the world, in metres, each taken to half a metre on a grid set off so
 * a module's round numbers do not fall on its lines. Glass of one room gives one seed, and storeys stacked on one bay
 * differ.
 */
export function facadeSeed(px: number, pz: number, x: number, y: number, z: number): number {
  const q = (a: number): number => Math.floor(a * 2 + 0.37);
  return facadeHash(px + Math.imul(q(x), 7919), pz + Math.imul(q(z), 7919), q(y));
}

/** A building's seed: its instance's place to 48 m, which one building's bays share but where one crosses that grid. */
export function facadeFamily(px: number, pz: number): number {
  return facadeHash(Math.floor(px / 192), Math.floor(pz / 192), 7);
}

/** A texture read: `texture` 0 to 4 the elements' base, normal and packed maps, the rooms' and the marks'; (u, v) from the top left; `lod` the level below the finest. */
export type FacadeSample = (texture: number, u: number, v: number, lod: number, out: Float64Array) => void;

/** What facadeSurface gives: the element's surface, the room's light through the glass, the street's far side mirrored. */
export interface FacadeOut {
  albedo: Float64Array;
  orm: Float64Array;
  normal: Float64Array;
  /** The room, as an albedo the daylight on the face lights (LIT multiplies it by the sky's light on the face). */
  room: Float64Array;
  /** The far side's albedo, which the sky's light on a face turned to this one lights, and its share of what glass mirrors. */
  far: Float64Array;
  farShare: number;
  /** Whether the pixel mirrors the sky as a picture. */
  sharp: boolean;
  /** Metres up the face to the top of its opening, where the room's share of the sky is read (ROOM_OPEN_LEAST). */
  roomUp: number;
}
export function facadeOut(): FacadeOut {
  return { albedo: new Float64Array(3), orm: new Float64Array(3), normal: new Float64Array(3), room: new Float64Array(3), far: new Float64Array(3), farShare: 0, sharp: false, roomUp: 0 };
}


const base = new Float64Array(4), bump = new Float64Array(4), packed = new Float64Array(4), read = new Float64Array(4);

/**
 * Element `e` (an index into PLACED) at (u, v) across it, 0 to 1 from its left and its foot, on a face `metres` wide at
 * `footprint` metres a pixel, from an atlas `size` across: its base colour and cover into `base`, and with `maps` its
 * normal's lean right and up into `bump` and its occlusion, roughness and metal into `packed`. Past the coarsest level at
 * which the atlas keeps it apart from its neighbours it fades to its mean.
 */
function element(e: number, u: number, v: number, metres: number, footprint: number, size: number, sample: FacadeSample, maps: boolean): void {
  const p = PLACED[e]!, m = e * 5;
  const lod = Math.log2(Math.max((footprint * p.w * size) / (metres * FACADE_TOP), 1e-6));
  const most = Math.log2(size / 256);
  const fade = clamp((lod - most) / 1.5);
  const l = clamp(lod, 0, most), inset = (0.5 * 2 ** Math.ceil(l)) / size;
  const au = clamp((p.x + u * p.w) / FACADE_TOP, p.x / FACADE_TOP + inset, (p.x + p.w) / FACADE_TOP - inset);
  const av = clamp((p.y + (1 - v) * p.h) / FACADE_TOP, p.y / FACADE_TOP + inset, (p.y + p.h) / FACADE_TOP - inset);
  read.fill(0);
  if (fade < 1) sample(0, au, av, l, read);
  for (let c = 0; c < 4; c++) base[c] = read[c]! * (1 - fade) + ELEMENT_MEANS[m + c]! * fade;
  if (!maps) return;
  read.fill(0);
  if (fade < 1) sample(1, au, av, l, read);
  bump[0] = fade < 1 ? ((read[0]! * 255 - 128) / 127) * (1 - fade) : 0;
  bump[1] = fade < 1 ? ((read[1]! * 255 - 128) / 127) * (1 - fade) : 0;
  read.fill(0);
  if (fade < 1) sample(2, au, av, l, read);
  packed[0] = read[0]! * (1 - fade) + fade;
  packed[1] = read[1]! * (1 - fade) + ELEMENT_MEANS[m + 4]! * fade;
  packed[2] = read[2]! * (1 - fade);
}

const seen = new Float64Array(3);
/**
 * Room `k` behind glass into `out`, as albedo darkened with depth: the ray from (gx, gy) on the glass along (dx, dy, dz),
 * dz into the room, meets the box x0..x1 by y0..y1 by `depth`, and reads that face's square in an atlas `size` across, at
 * `footprint` metres a pixel on glass `dist` metres from the eye.
 */
function room(out: Out, k: number, gx: number, gy: number, dx: number, dy: number, dz: number, x0: number, x1: number, y0: number, y1: number, depth: number, footprint: number, dist: number, size: number, sample: FacadeSample): void {
  const tx = dx > 0 ? (x1 - gx) / dx : dx < 0 ? (x0 - gx) / dx : 1e9;
  const ty = dy > 0 ? (y1 - gy) / dy : dy < 0 ? (y0 - gy) / dy : 1e9;
  const tz = depth / dz;
  const t = Math.max(0, Math.min(tx, ty, tz));
  const w = x1 - x0, h = y1 - y0;
  const f = clamp((dz * t) / depth), across = clamp((gx + dx * t - x0) / w), up = clamp((gy + dy * t - y0) / h);
  // The face met: back 0, side 1, floor 2, ceiling 3; where on its square from the square's top left, and its metres across.
  const face = tz <= Math.min(tx, ty) ? 0 : tx <= ty ? 1 : dy < 0 ? 2 : 3;
  const s = face === 1 ? f : across;
  const r = face < 2 ? 1 - up : face === 2 ? 1 - f : f;
  const metres = face === 1 ? depth : w;
  const lod = Math.log2(Math.max((footprint * (1 + t / dist) * 256 * size) / (metres * FACADE_TOP), 1e-6));
  const most = Math.log2(size) - 7;
  const fade = clamp((lod - most) / 1.5);
  const l = clamp(lod, 0, most), inset = (0.5 * 2 ** Math.ceil(l)) / size;
  const ox = (k % 4) * 0.25 + (face & 1) * 0.125, oy = Math.floor(k / 4) * 0.25 + (face >> 1) * 0.125;
  seen.fill(0);
  if (fade < 1) sample(3, clamp(ox + s * 0.125, ox + inset, ox + 0.125 - inset), clamp(oy + r * 0.125, oy + inset, oy + 0.125 - inset), l, seen);
  const light = ROOM_LIGHT * (1 - ROOM_DEPTH * f) * (face === 3 ? 0.7 : face === 1 ? 0.85 : 1);
  for (let c = 0; c < 3; c++) out[c] = (seen[c]! * (1 - fade) + ROOM_MEANS[k * 3 + c]! * fade) * light;
}

/**
 * The street's far side as glass at `gx` across its face, `over` metres over the ground, mirrors it along (rx, ry, rz)
 * in the face's frame, rz out: a street 12 to 30 m wide and over it a front of 8 to 38 m with a pane a bay and storey,
 * by `seed`. Its albedo into `out`; returns its share, 0 where the sky is mirrored.
 */
function farSide(out: Out, gx: number, rx: number, ry: number, rz: number, over: number, seed: number): number {
  out[0] = out[1] = out[2] = 0;
  if (rz <= 0.02) return 0;
  const street = 12 + 18 * fract(seed * 13.7), tall = 8 + 30 * fract(seed * 7.3);
  const t = street / rz, hy = Math.min(over, 60) + ry * t;
  if (hy < 0) {
    out[0] = out[1] = 0.07;
    out[2] = 0.075;
    return 1;
  }
  const along = gx + rx * t + seed * 40, storey = hy - Math.floor(hy / 4) * 4, bay = along - Math.floor(along / 3.5) * 3.5;
  const wall = 0.25 + 0.2 * fract(seed * 3.1);
  const pane = storey > 1 && storey < 2.7 && bay > 0.6 && bay < 2.5;
  out[0] = out[1] = pane ? 0.03 : wall;
  out[2] = pane ? 0.03 : wall * 0.92;
  return clamp((tall - hy) / 1.5);
}

/** What glass of each kind is dressed with, by its seed's state from 0 to 1: broken below the first, boarded below the second, a blind above the third, a curtain above the fourth (homes only). */
const DRESS: Readonly<Record<string, readonly number[]>> = { curtain: [0.12, 0.2, 0.6, 2], display: [0.1, 0.32, 0.9, 2], strip: [0.1, 0.25, 0.85, 2] };
const DRESS_HOMES = [0.1, 0.18, 0.82, 0.64];

/**
 * The room behind glass of `kind` met at gx across a face w by h: its least and most x and y in metres across and up
 * the face, the face's own box where the kind has no room. Glass of one room gives one box and so one seed.
 */
export function facadeRoomBox(kind: number, gx: number, w: number, h: number): [number, number, number, number] {
  const r = KINDS[kind]!.room;
  if (!r) return [0, w, 0, h];
  const x0 = r.cell ? Math.floor(gx / r.cell) * r.cell : -r.left;
  return [x0, r.cell ? x0 + r.cell : w + r.right, -r.below, h + r.above];
}

/** What glass of `kind` with room seed `seed` is dressed with. */
export function facadeDress(kind: number, seed: number): "broken" | "boards" | "blind" | "drape" | "clear" {
  const state = fract(seed * 5.77), d = DRESS[KINDS[kind]!.element] ?? DRESS_HOMES;
  return state < d[0]! ? "broken" : state < d[1]! ? "boards" : state > d[2]! ? "blind" : state > d[3]! ? "drape" : "clear";
}

const glassRoom = new Float64Array(3), far = new Float64Array(3), frame = new Float64Array(8);
/**
 * A pixel of a facade part into `o`. `kind` is facadeKind's; (x, y) metres across the face from its left edge and up
 * from its foot, as a reader facing it sees it, on a face `w` by `h`; `n` the face's normal and `v` the way to the eye
 * in the world; `corner` the face's left foot in its instance's own frame and `right` the face's right there (length 1);
 * (px, pz) the instance's place in quarter metres; `height` the point's height in the world and `over` over the ground;
 * `footprint` metres a pixel at `dist` metres from the eye; `tier` what the tier draws. `o` holds the world finish's
 * albedo, occlusion, roughness and metal, and normal as it comes, which a part keeps where its element does not reach.
 */
export function facadeSurface(o: FacadeOut, kind: number, x: number, y: number, w: number, h: number, n: Numbers, v: Numbers, corner: Numbers, right: Numbers, px: number, pz: number, height: number, over: number, footprint: number, dist: number, tier: FacadeTier, sample: FacadeSample): void {
  const d = KINDS[kind]!, r = d.room;
  const rl = Math.hypot(n[2]!, n[0]!) || 1, rx = n[2]! / rl, rz = -n[0]! / rl;
  const vx = v[0]! * rx + v[2]! * rz, vy = v[1]!, vz = Math.max(v[0]! * n[0]! + v[1]! * n[1]! + v[2]! * n[2]!, 0.02);
  // Where the eye's ray meets the glass, behind the frame's face, and the room it looks into, whose middle seeds it.
  const gx = x - (vx / vz) * SET_BACK, gy = y - (vy / vz) * SET_BACK;
  const [x0, x1, y0, y1] = facadeRoomBox(kind, gx, w, h);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const seed = facadeSeed(px, pz, corner[0]! + right[0]! * cx, height - y + cy, corner[2]! + right[2]! * cx);
  const family = facadeFamily(px, pz);
  const count = ELEMENTS.find((q) => q[0] === d.element)?.[3] ?? 1;
  const pick = kind === KIND.jamb ? 0 : d.element === "sign" ? facadeSign(corner, right, rx, rz, w, px, pz, count) : Math.min(Math.floor((d.element === "shutter" || d.element === "door" ? seed : family) * count), count - 1);
  o.room.fill(0);
  o.roomUp = h - y;
  far.fill(0);
  o.far.fill(0);
  o.farShare = 0;
  o.sharp = false;
  // A shop door's jamb: the door swung open flat against it, 1 m wide in its middle and 2.2 m high; round it, and on a
  // garage's pier at its way in, the reveal keeps its finish, darker toward the head and the foot.
  const ex = kind === KIND.jamb ? x - (w - 1) / 2 : 0;
  if (kind === KIND.pier || (kind === KIND.jamb && (ex < 0 || ex > 1 || y > 2.2))) {
    o.orm[0]! *= (0.55 + 0.45 * smooth(0, 0.5, h - y)) * (0.7 + 0.3 * smooth(0, 0.3, y));
    return;
  }
  if (kind === KIND.jamb) element(first(d.element), ex, y / 2.2, 1, footprint, tier.elements, sample, true);
  else element(first(d.element) + pick, d.w === 0 ? fract(x / 2) : x / w, y / h, d.w === 0 ? 2 : w, footprint, tier.elements, sample, true);
  const a = base[3]!;
  for (let c = 0; c < 3; c++) frame[c] = base[c]!;
  frame[3] = packed[0]!;
  frame[4] = packed[1]!;
  frame[5] = packed[2]!;
  const bz = Math.sqrt(Math.max(0, 1 - bump[0]! * bump[0]! - bump[1]! * bump[1]!));
  o.normal[0] = n[0]! * bz + rx * bump[0]!;
  o.normal[1] = n[1]! * bz + bump[1]!;
  o.normal[2] = n[2]! * bz + rz * bump[0]!;
  const film = [base[0]!, base[1]!, base[2]!], rough = packed[1]!;
  // Glass with no room behind it, or on a tier without rooms, and a hole through a shutter, are a dark recess.
  let ga = 0.02, gr = r ? 0.5 : rough, share = 0, filmed = 0, shard = 1;
  const dressed = facadeDress(kind, seed);
  const broken = dressed === "broken", boards = dressed === "boards", blind = dressed === "blind", drape = dressed === "drape";
  if (r && a < 1 && tier.reflect) {
    const flip = fract(seed * 11.3) < 0.5;
    const k = r.rooms[Math.min(Math.floor(fract(seed * 3.31) * r.rooms.length), r.rooms.length - 1)]!;
    room(glassRoom, k, flip ? x0 + x1 - gx : gx, gy, flip ? vx : -vx, -vy, vz, x0, x1, y0, y1, r.depth, footprint, dist, tier.rooms, sample);
    if (broken) {
      element(first("shards") + (fract(seed * 17.9) < 0.5 ? 0 : 1), gx / w, gy / h, w, footprint, tier.elements, sample, false);
      shard = base[3]!;
    }
    if (blind) {
      const bx = x - (vx / vz) * BLIND_BACK, by = y - (vy / vz) * BLIND_BACK, drop = h * (0.75 - 0.6 * fract(seed * 9.1));
      if (by > drop) {
        element(first("blind"), fract(bx), fract(by - drop), 1, footprint, tier.elements, sample, false);
        const rail = by - drop < 0.04 ? 1 : 0, c2 = Math.max(base[3]!, rail);
        for (let c = 0; c < 3; c++) glassRoom[c] = glassRoom[c]! * (1 - c2) + (rail ? 0.35 : base[c]!) * c2;
      }
    }
    if (drape) {
      const dx = x - (vx / vz) * DRAPE_BACK, dy = y - (vy / vz) * DRAPE_BACK;
      const left = w * (0.1 + 0.35 * fract(seed * 4.3)), rightEdge = w * (0.9 - 0.35 * fract(seed * 6.1));
      if (dx < left || dx > rightEdge) {
        element(first("drape") + (fract(seed * 2.9) < 0.5 ? 0 : 1), fract(dx), clamp(dy / h), 1, footprint, tier.elements, sample, false);
        for (let c = 0; c < 3; c++) glassRoom[c] = glassRoom[c]! * (1 - base[3]!) + base[c]! * 0.8 * base[3]!;
      }
    }
    filmed = clamp((rough - 0.05) / 0.45);
    const fresnel = 0.04 + 0.96 * (1 - vz) ** 5;
    const through = ((1 - fresnel) * (1 - FILM_HIDES * filmed) * shard + (1 - shard)) * (broken ? 0.5 : 1);
    for (let c = 0; c < 3; c++) o.room[c] = glassRoom[c]! * through * (1 - a);
    ga = FILM_ALBEDO * filmed * shard;
    gr = shard >= 0.5 ? rough : 1;
    // The ray mirrored keeps its way across and up the face and turns back out of it.
    if (shard >= 0.5) share = farSide(far, gx, -vx, -vy, vz, over + gy - y, fract(family * 7.7 + seed * 0.1)) * (1 - a);
    o.sharp = shard >= 0.5 && a < 0.5;
  }
  for (let c = 0; c < 3; c++) o.albedo[c] = (r && tier.reflect ? film[c]! * ga : ga) * (1 - a) + frame[c]! * a;
  o.orm[0] = frame[3]! * a + (1 - a);
  o.orm[1] = frame[4]! * a + gr * (1 - a);
  o.orm[2] = frame[5]! * a;
  for (let c = 0; c < 3; c++) o.far[c] = far[c]!;
  o.farShare = share;
  if (r && boards) {
    // Boards are 1.2 m sheets or planks, side by side across the glass, cut to its height.
    element(first("boards") + (fract(seed * 23.1) < 0.5 ? 0 : 1), fract(x / 1.2), y / h, 1.2, footprint, tier.elements, sample, true);
    const b = base[3]!, bz2 = Math.sqrt(Math.max(0, 1 - bump[0]! * bump[0]! - bump[1]! * bump[1]!));
    for (let c = 0; c < 3; c++) {
      o.albedo[c] = o.albedo[c]! * (1 - b) + base[c]! * b;
      o.room[c]! *= 1 - b;
    }
    o.orm[0] = o.orm[0]! * (1 - b) + packed[0]! * b;
    o.orm[1] = o.orm[1]! * (1 - b) + packed[1]! * b;
    o.orm[2] = o.orm[2]! * (1 - b) + packed[2]! * b;
    o.normal[0] = o.normal[0]! * (1 - b) + (n[0]! * bz2 + rx * bump[0]!) * b;
    o.normal[1] = o.normal[1]! * (1 - b) + (n[1]! * bz2 + bump[1]!) * b;
    o.normal[2] = o.normal[2]! * (1 - b) + (n[2]! * bz2 + rz * bump[0]!) * b;
    o.farShare *= 1 - b;
    o.sharp &&= b < 0.5;
  }
  if (kind === KIND.display && a < 1 && !boards) {
    const c = shopGlass(gx, gy, w, seed, footprint, tier.marks, sample) * (1 - a);
    if (c > 0) {
      for (let k = 0; k < 3; k++) {
        o.albedo[k] = o.albedo[k]! * (1 - c) + decal[k]! * c;
        o.room[k]! *= 1 - c;
      }
      o.orm[0] = o.orm[0]! * (1 - c) + c;
      o.orm[1] = o.orm[1]! * (1 - c) + 0.9 * c;
      o.orm[2] = o.orm[2]! * (1 - c);
      o.farShare *= 1 - c;
      o.sharp &&= c < 0.5;
    }
  }
  const nl = Math.hypot(o.normal[0]!, o.normal[1]!, o.normal[2]!) || 1;
  for (let c = 0; c < 3; c++) o.normal[c]! /= nl;
}

/**
 * The sign band a shop wears, of `count` (16): by the middle of its module, half a bay in from the band's middle, on an
 * 8 m grid turned with the building, so a band split over faces and a corner shop's two bands agree and the next shops
 * along a street, a cell apart, wear others (5 or 7 apart). `corner` and `right` are the face's left foot and its way
 * across in the instance's own frame, (rx, rz) that way in the world, and (px, pz) the instance's place in quarter metres.
 */
export function facadeSign(corner: Numbers, right: Numbers, rx: number, rz: number, w: number, px: number, pz: number, count: number): number {
  const ol = Math.hypot(right[0]!, right[2]!) || 1, ox = right[0]! / ol, oz = right[2]! / ol;
  const cs = ox * rx + oz * rz, sn = ox * rz - oz * rx;
  const cx = corner[0]! + ox * w * 0.5, cz = corner[2]! + oz * w * 0.5;
  const kx = px * 0.25 + cs * cx - sn * cz + rz * 4, kz = pz * 0.25 + sn * cx + cs * cz - rx * 4;
  // The building's way, the same for its four sides: a quarter turn kept between -37 and 53 degrees.
  const turn = Math.atan2(rz, rx), t = turn - 1.5707963 * Math.floor((turn + 0.6457718) / 1.5707963);
  const ex = Math.cos(t), ez = Math.sin(t);
  const k = 5 * Math.floor((kx * ex + kz * ez) / 8 + 0.37) + 7 * Math.floor((kz * ex - kx * ez) / 8 + 0.37) + 3;
  return k - count * Math.floor(k / count);
}

/** A mark on a shop's glass: which (into MARKS_PLACED), its left foot on the glass in metres, and its size. */
export interface GlassMark { m: number; x0: number; y0: number; dw: number; dh: number }

/** What is left on a display's glass `w` metres wide by its seed: at most one vinyl and two posters, each at a place of its own. */
export function facadeShopGlass(seed: number, w: number): GlassMark[] {
  const out: GlassMark[] = [];
  if (fract(seed * 13.7) < 0.5) out.push({ m: mark("vinyl") + Math.min(Math.floor(fract(seed * 29.3) * marks("vinyl")), marks("vinyl") - 1), x0: 0.15 + fract(seed * 5.9) * (w - 1.5), y0: 0.35 + fract(seed * 7.3) * 0.7, dw: 1.2, dh: 0.8 });
  for (let k = 0; k < 2; k++) {
    if (fract(seed * (17.1 + k * 4.3)) >= 0.4) continue;
    out.push({ m: mark("poster") + Math.min(Math.floor(fract(seed * (31.7 + k * 3.1)) * marks("poster")), marks("poster") - 1), x0: 0.15 + fract(seed * (8.9 + k * 2.7)) * (w - 0.9), y0: 0.5 + fract(seed * (6.1 + k)) * 0.6, dw: 0.6, dh: 0.9 });
  }
  return out;
}

/** The marks on a display's glass read at (gx, gy) on it, the front one's colour into `decal`. Returns its cover. */
function shopGlass(gx: number, gy: number, w: number, seed: number, footprint: number, size: number, sample: FacadeSample): number {
  let cover = 0;
  const kept = [0, 0, 0, 0];
  for (const g of facadeShopGlass(seed, w)) {
    const c = markAt(g.m, gx, gy, g.x0, g.y0, g.dw, g.dh, footprint, size, sample);
    if (c <= cover) continue;
    cover = c;
    for (let k = 0; k < 4; k++) kept[k] = decal[k]!;
  }
  for (let k = 0; k < 4; k++) decal[k] = kept[k]!;
  return cover;
}

/** What the facades need of the textures' residency (assets/residency.ts). */
export interface FacadeResidency {
  material(m: number, pixels: number, distance: number, roles?: number): void;
  holds(t: number): number;
}

/**
 * The facades' atlases a frame at a time, on a tier that draws them with its finishes in full: each is asked for as wide
 * as the tier draws it, and the frame names the textures for the card's facade units (FramePacket `facadeSlots`) and
 * says in fFacade the city's flood line and whether every atlas the tier reads has come.
 */
export class FacadeAtlases {
  private readonly materials: readonly number[];
  private readonly textures: readonly number[];
  private readonly flood: number;

  constructor(materials: readonly PackMaterial[], city: string) {
    this.materials = FACADE_MATERIALS.map((id) => materials.findIndex((m) => m.id === id));
    const [e, r, k] = this.materials.map((m) => materials[m]);
    this.textures = e && r && k ? [e.base, e.normal, e.mro, r.base, k.base] : [];
    this.flood = FACADE_FLOOD[city.split(":").pop()!] ?? NO_FLOOD;
  }

  frame(p: FramePacket, residency: FacadeResidency, tier: Tier): void {
    const t = FACADE_TIERS[tier.name];
    p.facadeSlots.fill(-1);
    p.frame[FRAME.facade] = this.flood;
    p.frame[FRAME.facade + 1] = 0;
    if (!t || !tier.lit || tier.finish !== "full" || this.textures.length === 0) return;
    const [elements, rooms, marks] = this.materials;
    residency.material(elements!, t.elements, 1, 3);
    if (t.rooms > 0) residency.material(rooms!, t.rooms, 1, 1);
    residency.material(marks!, t.marks, 1, 1);
    let ready = 1;
    this.textures.forEach((slot, k) => {
      if (k === 3 && t.rooms === 0) return;
      p.facadeSlots[k] = slot;
      if (residency.holds(slot) < 0) ready = 0;
    });
    p.frame[FRAME.facade + 1] = ready;
  }
}

/** A smooth noise along a line, 0 to 1, a value a metre where t is in metres. */
function noise1(t: number, seed: number): number {
  const i = Math.floor(t), f = t - i, s = f * f * (3 - 2 * f);
  return facadeHash(i, seed, 91) * (1 - s) + facadeHash(i + 1, seed, 91) * s;
}

/** Slots of a wall face, in metres across and up, each of which may carry one painted or pasted mark. */
const SLOT_W = 6;
const SLOT_H = 4;
const decal = new Float64Array(4);

/**
 * Mark `m` (an index into MARKS_PLACED) laid with its left foot at (x0, y0), `dw` by `dh` metres, read at (x, y) on its
 * face at `footprint` metres a pixel from an atlas `size` across, into `decal`: its colour and cover. Past the coarsest
 * level the atlas keeps it apart from its neighbours, its mean.
 */
function markAt(m: number, x: number, y: number, x0: number, y0: number, dw: number, dh: number, footprint: number, size: number, sample: FacadeSample): number {
  const u = (x - x0) / dw, v = (y - y0) / dh;
  if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
  const p = MARKS_PLACED[m]!;
  const lod = Math.log2(Math.max((footprint * p.w * size) / (dw * FACADE_TOP), 1e-6));
  const most = Math.log2(size / 256);
  const fade = clamp((lod - most) / 1.5);
  const l = clamp(lod, 0, most), inset = (0.5 * 2 ** Math.ceil(l)) / size;
  read.fill(0);
  if (fade < 1) sample(4, clamp((p.x + u * p.w) / FACADE_TOP, p.x / FACADE_TOP + inset, (p.x + p.w) / FACADE_TOP - inset), clamp((p.y + (1 - v) * p.h) / FACADE_TOP, p.y / FACADE_TOP + inset, (p.y + p.h) / FACADE_TOP - inset), l, read);
  for (let c = 0; c < 4; c++) decal[c] = read[c]! * (1 - fade) + MARK_MEANS[m * 4 + c]! * fade;
  return decal[3]!;
}

/**
 * The marks over a wall face, or over a shutter, a door or a garage's pier, into `o`'s albedo, occlusion, roughness and
 * metal and normal as they stand: the flood's line at `flood` metres in the world (NO_FLOOD for none) with its silt below;
 * cracks from the face's corners at its outer edges (`edges`, bits for its left, right, foot and head, as a reader facing
 * it sees them); and in each slot of SLOT_W by SLOT_H metres by its seed, a patch of repair, a burst of bullet scars, and
 * one of the marks' atlas: a poster, a tag or a large piece low on a wall, a tag or a piece on a shutter, a level's number
 * and a striped foot on a pier. The face, its corner, its right, its place and the rest are as facadeSurface takes them.
 */
export function facadeMarks(o: FacadeOut, kind: number, x: number, y: number, w: number, h: number, edges: number, n: Numbers, corner: Numbers, right: Numbers, px: number, pz: number, height: number, over: number, flood: number, footprint: number, tier: FacadeTier, sample: FacadeSample): void {
  if (w < 0.3 || h < 0.3) return;
  const rl = Math.hypot(n[2]!, n[0]!) || 1, rx = n[2]! / rl, rz = -n[0]! / rl;
  const seed = facadeSeed(px, pz, corner[0]! + right[0]! * w * 0.5, height - y + h * 0.5, corner[2]! + right[2]! * w * 0.5);
  const fp = Math.max(footprint, 1e-4);
  let tx = 0, ty = 0;
  // The flood's line, wandering a centimetre, and silt fading over the 0.7 m below it.
  if (flood > NO_FLOOD) {
    const dh = height - flood + 0.03 * (noise1(x * 1.7, 5) - 0.5) + 0.01 * (noise1(x * 9, 6) - 0.5);
    if (dh < 0.02 && dh > -0.7) {
      // A dark crisp top edge, a band of brown silt 5 cm under it, and a stain fading over 0.7 m.
      const line = 1 - smooth(0.003, 0.008 + fp * 0.5, Math.abs(dh));
      const band = dh < 0 ? 1 - smooth(0.035, 0.06 + fp * 0.5, -dh) : 0;
      const silt = Math.min(1, (dh < 0 ? (1 + dh / 0.7) * (1 + dh / 0.7) * 0.35 : 0) + 0.5 * band);
      for (let c = 0; c < 3; c++) o.albedo[c] = o.albedo[c]! * (1 - silt + silt * [0.78, 0.68, 0.52][c]!) * (1 - 0.45 * line);
      o.orm[1] = o.orm[1]! + (1 - o.orm[1]!) * Math.max(line, silt);
    }
  }
  // Cracks from the corners at an outer edge, three straight runs turning a little, narrowing from 4 mm to 1 mm.
  let crack = 0;
  if (Math.min(w, h) >= 0.4) {
    for (let c = 0; c < 4; c++) {
      const right1 = c & 1, top = c >> 1;
      if ((edges & ((right1 ? 2 : 1) | (top ? 8 : 4))) === 0 || fract(seed * (7.13 + c * 3.31)) >= 0.35) continue;
      const length = Math.min(0.3 + 0.7 * fract(seed * (5.1 + c * 1.7)), 0.7 * Math.min(w, h));
      let ax = right1 ? w : 0, ay = top ? h : 0;
      if (Math.hypot(x - ax, y - ay) > length + 0.05) continue;
      const sx = right1 ? -1 : 1, sy = top ? -1 : 1;
      let along = 0;
      for (let k = 0; k < 3; k++) {
        const angle = 0.5 + 0.5 * fract(seed * (3.7 + c)) + 0.35 * (fract(seed * (11.3 + c * 2.1 + k * 5.7)) - 0.5);
        const bx = ax + sx * Math.cos(angle) * length / 3, by = ay + sy * Math.sin(angle) * length / 3;
        const ex = bx - ax, ey = by - ay, t = clamp(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey));
        const qx = x - ax - ex * t, qy = y - ay - ey * t, d = Math.hypot(qx, qy);
        const half = 0.0012 + 0.0028 * (1 - (along + t * length / 3) / length);
        const cover = clamp((half + 0.5 * fp - d) / fp) * Math.min(1, (2 * half) / fp);
        if (cover > crack) {
          crack = cover;
          tx = d > 1e-6 ? -qx / d : 0;
          ty = d > 1e-6 ? -qy / d : 0;
        }
        along += length / 3;
        ax = bx;
        ay = by;
      }
    }
  }
  const slotX = Math.floor(x / SLOT_W), slotY = Math.floor(y / SLOT_H);
  const sx0 = slotX * SLOT_W, sy0 = slotY * SLOT_H, sx1 = Math.min(sx0 + SLOT_W, w), sy1 = Math.min(sy0 + SLOT_H, h);
  const slot = facadeHash(Math.floor(seed * 16777216), slotX, slotY);
  const foot = over - y + sy0;
  // A patch of repair: a rectangle of cement with a wandering edge, standing a little proud.
  let patch = 0, px2 = 0, py2 = 0;
  if (kind === KIND.none && fract(slot * 3.1) < 0.1 && sx1 - sx0 >= 1.2 && sy1 - sy0 >= 0.8) {
    const pw = Math.min(0.6 + fract(slot * 5.3), sx1 - sx0 - 0.2), ph = Math.min(0.4 + 0.6 * fract(slot * 7.9), sy1 - sy0 - 0.2);
    const cx = sx0 + 0.1 + pw / 2 + fract(slot * 9.7) * (sx1 - sx0 - pw - 0.2), cy = sy0 + 0.1 + ph / 2 + fract(slot * 2.9) * (sy1 - sy0 - ph - 0.2);
    const ex = Math.abs(x - cx) - pw / 2, ey = Math.abs(y - cy) - ph / 2;
    const sd = Math.max(ex, ey) + 0.12 * (noise1((x + y) * 2.5, Math.floor(slot * 4096)) - 0.5) + 0.03 * (noise1((x - y) * 11, 3) - 0.5);
    patch = clamp(0.5 - sd / fp);
    const lip = (1 - smooth(0, 0.012, Math.abs(sd))) * Math.min(1, 0.012 / fp);
    px2 = ex > ey ? Math.sign(x - cx) * lip : 0;
    py2 = ex > ey ? 0 : Math.sign(y - cy) * lip;
    const tone = 0.85 + 0.3 * fract(slot * 13.3);
    for (let c = 0; c < 3; c++) o.albedo[c] = o.albedo[c]! + ([0.36, 0.35, 0.33][c]! * tone - o.albedo[c]!) * 0.45 * patch;
    o.orm[1] = o.orm[1]! + (0.95 - o.orm[1]!) * patch;
  }
  // A burst of bullet scars, a dark hole in a pale broken ring, low enough to have been aimed at someone.
  let scar = 0, sxn = 0, syn = 0;
  if (kind === KIND.none && fract(slot * 11.9) < 0.07 && sx1 - sx0 >= 1.4 && sy1 - sy0 >= 1.4) {
    const cx = sx0 + 0.7 + fract(slot * 4.7) * (sx1 - sx0 - 1.4), cy = clamp(0.8 + 1.6 * fract(slot * 6.1) - (over - y), sy0 + 0.7, sy1 - 0.7);
    if (Math.hypot(x - cx, y - cy) < 0.65) {
      for (let k = 0; k < 10; k++) {
        const a = 6.2832 * fract(slot * (17.3 + k * 3.9)), r = 0.5 * Math.sqrt(fract(slot * (23.1 + k * 7.3)));
        const hx = cx + Math.cos(a) * r, hy = cy + Math.sin(a) * r, rad = 0.012 + 0.014 * fract(slot * (31.7 + k * 2.3));
        const d = Math.hypot(x - hx, y - hy);
        if (d >= rad) continue;
        scar = d < 0.45 * rad ? 2 : 1;
        sxn = -(x - hx) / rad * 0.7;
        syn = -(y - hy) / rad * 0.7;
      }
      if (scar > 0) {
        for (let c = 0; c < 3; c++) o.albedo[c]! *= scar === 2 ? 0.35 : 1.25;
        o.orm[1] = 1;
      }
    }
  }
  // One mark of the atlas in the slot, where it fits inside the slot and the face.
  const r = fract(slot * 2.3);
  let m = -1, dw = 0, dh = 0, x0 = 0, y0 = 0, m2 = -1;
  const lie = (name: string, count: number, width: number, high: number, bottom: number): void => {
    m = mark(name) + Math.min(Math.floor(fract(slot * 19.7) * count), count - 1);
    dw = width;
    dh = high;
    x0 = sx0 + 0.05 + fract(slot * 4.1) * Math.max(0, sx1 - sx0 - width - 0.1);
    y0 = Math.max(sy0, bottom);
  };
  if (kind === KIND.none && foot < 2.5) {
    if (r < 0.1 && sx1 - sx0 >= 3.4 && sy1 - sy0 >= 1.6) lie("piece", marks("piece"), 3.2, 1.2, sy0 + 0.4 - foot);
    else if (r < 0.28 && sx1 - sx0 >= 0.8 && sy1 - sy0 >= 1.2) lie("poster", marks("poster"), 0.6, 0.9, sy0 + 1.1 + 0.5 * fract(slot * 8.3) - foot);
    else if (r < 0.55 && sx1 - sx0 >= 1.2) lie("tag", 8, 1, 0.5, sy0 + 0.5 + 1.4 * fract(slot * 8.3) - foot);
  } else if (kind === KIND.shutter) {
    if (r < 0.25) lie("piece", marks("piece"), 3.2, 1.2, 0.4);
    else if (r < 0.7) lie("tag", 8, 1, 0.5, 0.5 + 1.2 * fract(slot * 8.3));
  } else if (kind === KIND.door && r < 0.3) lie("tag", 8, 1, 0.5, 0.6 + fract(slot * 8.3));
  else if (kind === KIND.pier) {
    if (r < 0.75) lie("stencil", 3, 0.6, 0.8, 1.2);
    if (fract(slot * 6.7) < 0.5) m2 = mark("stencil") + 3;
  }
  let cover = 0;
  if (m >= 0 && x0 + dw <= sx1 - 0.04 && y0 + dh <= sy1) cover = markAt(m, x, y, x0, y0, dw, dh, fp, tier.marks, sample);
  if (cover > 0) {
    const paper = MARKS_PLACED[m]!.name === "poster";
    for (let c = 0; c < 3; c++) o.albedo[c] = o.albedo[c]! + (decal[c]! - o.albedo[c]!) * cover;
    o.orm[1] = o.orm[1]! + ((paper ? 0.95 : 0.65) - o.orm[1]!) * cover;
    o.orm[2] = o.orm[2]! * (1 - cover);
  }
  if (m2 >= 0 && (cover = markAt(m2, x, y, (w - 0.6) / 2, 0, 0.6, 0.8, fp, tier.marks, sample)) > 0) {
    for (let c = 0; c < 3; c++) o.albedo[c] = o.albedo[c]! + (decal[c]! - o.albedo[c]!) * cover;
    o.orm[1] = o.orm[1]! + (0.65 - o.orm[1]!) * cover;
  }
  if (crack > 0) {
    for (let c = 0; c < 3; c++) o.albedo[c]! *= 1 - 0.7 * crack;
    o.orm[1] = o.orm[1]! + (1 - o.orm[1]!) * crack;
  }
  // The relief of a crack's sides, a patch's lip and a scar's crater, across the face (its right) and up.
  const bx = tx * 0.6 * crack + px2 * 0.35 + (scar > 0 ? sxn : 0), by = ty * 0.6 * crack + py2 * 0.35 + (scar > 0 ? syn : 0);
  if (bx !== 0 || by !== 0) {
    o.normal[0] = o.normal[0]! + rx * bx;
    o.normal[1] = o.normal[1]! + by;
    o.normal[2] = o.normal[2]! + rz * bx;
    const l = Math.hypot(o.normal[0]!, o.normal[1]!, o.normal[2]!);
    for (let c = 0; c < 3; c++) o.normal[c]! /= l;
  }
}

const fl = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));
const vecs = (type: string, rows: readonly (readonly number[])[]): string => `${type}[${rows.length}](${rows.map((r) => `${type}(${r.map(fl).join(",")})`).join(",")})`;
const ROOM_LIST = KINDS.flatMap((k) => k.room?.rooms ?? []);
const roomFirst = (k: number): number => KINDS.slice(0, k).reduce((sum, q) => sum + (q.room?.rooms.length ?? 0), 0);
const pickOf = (k: Kind, i: number): number => (i === KIND.jamb || i === KIND.pier ? 2 : k.element === "sign" ? 3 : k.element === "shutter" || k.element === "door" ? 1 : 0);

/**
 * facadeSurface's twin, with how a pixel finds its face: `facade` reads a fragment of a static of colour class `colour`
 * (FACADE_COLOURS) at `face` across and up its face (the corner bits, world-surfaces.ts ownVertex's vFace), `own` in its
 * instance's frame and `place` its instance's place, `rel` from the eye, and each one's steps to the next pixels, which
 * LIT takes where every pixel of a quad takes them. `height` is its height in the world and `over` over the ground, in
 * metres. Where the face is a part it
 * writes albedo, orm and n, the room's light to add (as an albedo the face's daylight lights) and the far side mirrored
 * (its albedo and share), and returns 1, or 2 where the pixel mirrors the sky as a picture; else 0. FACADE_NORMAL is the
 * normal map's channels in the texture's variant. It is in a text only where FACADE is defined, and without
 * FACADE_ROOMS glass is a dark recess.
 */
export const FACADE_GLSL = `#ifdef FACADE
uniform highp sampler2D uFacadeBase, uFacadeNormal, uFacadeOrm, uFacadeRooms, uFacadeMarks;
const vec4 MP[${MARKS_PLACED.length}] = ${vecs("vec4", MARKS_PLACED.map((p) => [p.x, p.y, p.w, p.h]))};
const vec4 MM[${MARKS_PLACED.length}] = ${vecs("vec4", MARKS_PLACED.map((_, m) => MARK_MEANS.slice(m * 4, m * 4 + 4)))};
const vec4 FP[${PLACED.length}] = ${vecs("vec4", PLACED.map((p) => [p.x, p.y, p.w, p.h]))};
const vec4 FM[${PLACED.length}] = ${vecs("vec4", PLACED.map((_, e) => ELEMENT_MEANS.slice(e * 5, e * 5 + 4)))};
const float FR[${PLACED.length}] = float[${PLACED.length}](${PLACED.map((_, e) => fl(ELEMENT_MEANS[e * 5 + 4]!)).join(",")});
const vec3 RM[${ROOMS}] = ${vecs("vec3", Array.from({ length: ROOMS }, (_, k) => ROOM_MEANS.slice(k * 3, k * 3 + 3)))};
const vec4 KS[${KINDS.length}] = ${vecs("vec4", KINDS.map((k) => [k.colour, k.w, k.h, k.room ? 1 : 0]))};
const vec4 KE[${KINDS.length}] = ${vecs("vec4", KINDS.map((k, i) => (k.element ? [first(k.element), ELEMENTS.find((q) => q[0] === k.element)![3], pickOf(k, i), 0] : [0, 1, 2, 0])))};
const vec4 KR[${KINDS.length}] = ${vecs("vec4", KINDS.map((k) => (k.room ? [k.room.left, k.room.right, k.room.below, k.room.above] : [0, 0, 0, 0])))};
const vec4 KD[${KINDS.length}] = ${vecs("vec4", KINDS.map((k, i) => (k.room ? [k.room.depth, k.room.cell ?? 0, roomFirst(i), k.room.rooms.length] : [1, 0, 0, 0])))};
const vec4 KW[${KINDS.length}] = ${vecs("vec4", KINDS.map((k) => DRESS[k.element] ?? DRESS_HOMES))};
const int KROOMS[${ROOM_LIST.length}] = int[${ROOM_LIST.length}](${ROOM_LIST.join(",")});
float facadeHash(ivec3 p) {
  uint h = uint(p.x) * 1597334677u ^ uint(p.y) * 3812015801u ^ uint(p.z) * 2798796415u;
  h = (h ^ (h >> 16u)) * 2246822519u;
  return float((h ^ (h >> 13u)) >> 8u) / 16777216.0;
}
float facadeSeed(vec2 place, vec3 at) {
  ivec3 q = ivec3(floor(at * 2.0 + 0.37));
  return facadeHash(ivec3(int(place.x) + q.x * 7919, int(place.y) + q.z * 7919, q.y));
}
int facadeKind(int colour, float w, float h, float up) {
  if (!(w > 0.0 && h > 0.0) || abs(up) > 0.5) return 0;
  for (int k = 1; k < ${KINDS.length}; k++) {
    vec4 d = KS[k];
    if (int(d.x) == colour && abs(h - d.z) < ${fl(NEAR)} && (d.y == 0.0 ? w > 1.9 : abs(w - d.y) < ${fl(NEAR)})) return k;
  }
  return 0;
}
vec4 fBase;
vec2 fBump;
vec3 fPacked;
void facadeElement(int e, vec2 uv, float metres, float footprint, bool maps) {
  vec4 p = FP[e];
  float size = float(textureSize(uFacadeBase, 0).x);
  float lod = log2(max(footprint * p.z * size / (metres * ${fl(FACADE_TOP)}), 1e-6));
  float most = log2(size / 256.0);
  float fade = clamp((lod - most) / 1.5, 0.0, 1.0);
  float l = clamp(lod, 0.0, most), inset = 0.5 * exp2(ceil(l)) / size;
  vec2 at = clamp((p.xy + vec2(uv.x, 1.0 - uv.y) * p.zw) / ${fl(FACADE_TOP)}, p.xy / ${fl(FACADE_TOP)} + inset, (p.xy + p.zw) / ${fl(FACADE_TOP)} - inset);
  fBase = mix(fade < 1.0 ? textureLod(uFacadeBase, at, l) : vec4(0.0), FM[e], fade);
  if (!maps) return;
  fBump = fade < 1.0 ? (textureLod(uFacadeNormal, at, l).FACADE_NORMAL * 255.0 - 128.0) / 127.0 * (1.0 - fade) : vec2(0.0);
  vec3 m = fade < 1.0 ? textureLod(uFacadeOrm, at, l).rgb : vec3(0.0);
  fPacked = vec3(m.r * (1.0 - fade) + fade, m.g * (1.0 - fade) + FR[e] * fade, m.b * (1.0 - fade));
}
#ifdef FACADE_ROOMS
vec3 facadeRoom(int k, vec2 g, vec3 d, vec4 box, float depth, float footprint, float dist) {
  float tx = d.x > 0.0 ? (box.y - g.x) / d.x : d.x < 0.0 ? (box.x - g.x) / d.x : 1e9;
  float ty = d.y > 0.0 ? (box.w - g.y) / d.y : d.y < 0.0 ? (box.z - g.y) / d.y : 1e9;
  float tz = depth / d.z;
  float t = max(0.0, min(tx, min(ty, tz)));
  float w = box.y - box.x, h = box.w - box.z;
  float f = clamp(d.z * t / depth, 0.0, 1.0), across = clamp((g.x + d.x * t - box.x) / w, 0.0, 1.0), up = clamp((g.y + d.y * t - box.z) / h, 0.0, 1.0);
  int face = tz <= min(tx, ty) ? 0 : tx <= ty ? 1 : d.y < 0.0 ? 2 : 3;
  float s = face == 1 ? f : across;
  float r = face < 2 ? 1.0 - up : face == 2 ? 1.0 - f : f;
  float metres = face == 1 ? depth : w;
  float size = float(textureSize(uFacadeRooms, 0).x);
  float lod = log2(max(footprint * (1.0 + t / dist) * 256.0 * size / (metres * ${fl(FACADE_TOP)}), 1e-6));
  float most = log2(size) - 7.0;
  float fade = clamp((lod - most) / 1.5, 0.0, 1.0);
  float l = clamp(lod, 0.0, most), inset = 0.5 * exp2(ceil(l)) / size;
  vec2 o = vec2(float(k % 4) * 0.25 + float(face & 1) * 0.125, float(k / 4) * 0.25 + float(face >> 1) * 0.125);
  vec3 seen = fade < 1.0 ? textureLod(uFacadeRooms, clamp(o + vec2(s, r) * 0.125, o + inset, o + 0.125 - inset), l).rgb : vec3(0.0);
  return mix(seen, RM[k], fade) * ${fl(ROOM_LIGHT)} * (1.0 - ${fl(ROOM_DEPTH)} * f) * (face == 3 ? 0.7 : face == 1 ? 0.85 : 1.0);
}
float facadeFar(out vec3 albedo, float gx, vec3 r, float over, float seed) {
  albedo = vec3(0.0);
  if (r.z <= 0.02) return 0.0;
  float street = 12.0 + 18.0 * fract(seed * 13.7), tall = 8.0 + 30.0 * fract(seed * 7.3);
  float t = street / r.z, hy = min(over, 60.0) + r.y * t;
  if (hy < 0.0) {
    albedo = vec3(0.07, 0.07, 0.075);
    return 1.0;
  }
  float along = gx + r.x * t + seed * 40.0, storey = hy - floor(hy / 4.0) * 4.0, bay = along - floor(along / 3.5) * 3.5;
  float wall = 0.25 + 0.2 * fract(seed * 3.1);
  albedo = storey > 1.0 && storey < 2.7 && bay > 0.6 && bay < 2.5 ? vec3(0.03) : vec3(wall, wall, wall * 0.92);
  return clamp((tall - hy) / 1.5, 0.0, 1.0);
}
#endif
int facadeSign(vec3 corner, vec3 right, vec3 side, float w, vec2 place, int count) {
  vec2 o = normalize(right.xz), r = normalize(side.xz);
  float cs = dot(o, r), sn = o.x * r.y - o.y * r.x;
  vec2 c = corner.xz + o * (w * 0.5);
  vec2 k = place * 0.25 + vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y) + vec2(r.y, -r.x) * 4.0;
  float turn = atan(r.y, r.x), t = turn - 1.5707963 * floor((turn + 0.6457718) / 1.5707963);
  vec2 e = vec2(cos(t), sin(t));
  int n = 5 * int(floor(dot(k, e) / 8.0 + 0.37)) + 7 * int(floor((k.y * e.x - k.x * e.y) / 8.0 + 0.37)) + 3;
  return n - count * int(floor(float(n) / float(count)));
}
vec4 fDecal;
float facadeMark(int m, float x, float y, float x0, float y0, float dw, float dh, float footprint);
float facadeShopGlass(vec2 g, float w, float seed, float footprint) {
  float cover = 0.0;
  vec4 kept = vec4(0.0);
  if (fract(seed * 13.7) < 0.5) {
    float c = facadeMark(${mark("vinyl")} + min(int(floor(fract(seed * 29.3) * ${fl(marks("vinyl"))})), ${marks("vinyl") - 1}), g.x, g.y, 0.15 + fract(seed * 5.9) * (w - 1.5), 0.35 + fract(seed * 7.3) * 0.7, 1.2, 0.8, footprint);
    if (c > cover) {
      cover = c;
      kept = fDecal;
    }
  }
  for (int k = 0; k < 2; k++) {
    if (fract(seed * (17.1 + float(k) * 4.3)) >= 0.4) continue;
    int m = ${mark("poster")} + min(int(floor(fract(seed * (31.7 + float(k) * 3.1)) * ${fl(marks("poster"))})), ${marks("poster") - 1});
    float c = facadeMark(m, g.x, g.y, 0.15 + fract(seed * (8.9 + float(k) * 2.7)) * (w - 0.9), 0.5 + fract(seed * (6.1 + float(k))) * 0.6, 0.6, 0.9, footprint);
    if (c > cover) {
      cover = c;
      kept = fDecal;
    }
  }
  fDecal = kept;
  return cover;
}
int facadePart(inout vec3 albedo, inout vec3 orm, inout vec3 n, inout vec3 room, inout vec4 far, int kind, float x, float y, float w, float h, vec3 corner, vec3 right, vec3 nn, vec3 side, vec2 place, vec3 rel, float footprint, float height, float over) {
  vec3 v = -normalize(rel);
  float dist = length(rel);
  vec3 view = vec3(dot(v, side), v.y, max(dot(v, nn), 0.02));
  vec4 ks = KS[kind], ke = KE[kind], kr = KR[kind], kd = KD[kind];
  bool glassy = ks.w > 0.5;
  vec2 g = vec2(x, y) - view.xy / view.z * ${fl(SET_BACK)};
  vec4 box = glassy ? vec4(-kr.x, w + kr.y, -kr.z, h + kr.w) : vec4(0.0, w, 0.0, h);
  if (kd.y > 0.0) box.xy = floor(g.x / kd.y) * kd.y + vec2(0.0, kd.y);
  vec2 mid = (box.xz + box.yw) * 0.5;
  vec3 middle = corner + right * mid.x;
  float seed = facadeSeed(place, vec3(middle.x, height - y + mid.y, middle.z));
  float family = facadeHash(ivec3(floor(place / 192.0), 7));
  int pick = ke.z > 2.5 ? facadeSign(corner, right, side, w, place, int(ke.y)) : ke.z > 1.5 ? 0 : min(int(floor((ke.z > 0.5 ? seed : family) * ke.y)), int(ke.y) - 1);
  float ex = kind == ${KIND.jamb} ? x - (w - 1.0) * 0.5 : 0.0;
  if (kind == ${KIND.pier} || (kind == ${KIND.jamb} && (ex < 0.0 || ex > 1.0 || y > 2.2))) {
    orm.r *= (0.55 + 0.45 * smoothstep(0.0, 0.5, h - y)) * (0.7 + 0.3 * smoothstep(0.0, 0.3, y));
    return 1;
  }
  if (kind == ${KIND.jamb}) facadeElement(int(ke.x), vec2(ex, y / 2.2), 1.0, footprint, true);
  else facadeElement(int(ke.x) + pick, vec2(ks.y == 0.0 ? fract(x / 2.0) : x / w, y / h), ks.y == 0.0 ? 2.0 : w, footprint, true);
  float a = fBase.a;
  vec3 frame = fBase.rgb, framePacked = fPacked, film = fBase.rgb;
  float rough = fPacked.g;
  float bz = sqrt(max(0.0, 1.0 - dot(fBump, fBump)));
  vec3 bent = nn * bz + side * fBump.x + vec3(0.0, fBump.y, 0.0);
  float ga = 0.02, gr = glassy ? 0.5 : rough, share = 0.0, shard = 1.0;
  int sharp = 1;
  vec4 dress = KW[kind];
  float state = fract(seed * 5.77);
  bool broken = state < dress.x, boards = !broken && state < dress.y, blind = !broken && !boards && state > dress.z, drape = !broken && !boards && !blind && state > dress.w;
#ifdef FACADE_ROOMS
  vec3 far3 = vec3(0.0);
  if (glassy && a < 1.0) {
    bool flip = fract(seed * 11.3) < 0.5;
    int k = KROOMS[int(kd.z) + min(int(floor(fract(seed * 3.31) * kd.w)), int(kd.w) - 1)];
    vec3 seen = facadeRoom(k, vec2(flip ? box.x + box.y - g.x : g.x, g.y), vec3(flip ? view.x : -view.x, -view.y, view.z), box, kd.x, footprint, dist);
    if (broken) {
      facadeElement(${first("shards")} + (fract(seed * 17.9) < 0.5 ? 0 : 1), g / vec2(w, h), w, footprint, false);
      shard = fBase.a;
    }
    if (blind) {
      vec2 b = vec2(x, y) - view.xy / view.z * ${fl(BLIND_BACK)};
      float drop = h * (0.75 - 0.6 * fract(seed * 9.1));
      if (b.y > drop) {
        facadeElement(${first("blind")}, fract(vec2(b.x, b.y - drop)), 1.0, footprint, false);
        float rail = b.y - drop < 0.04 ? 1.0 : 0.0, c2 = max(fBase.a, rail);
        seen = mix(seen, rail > 0.5 ? vec3(0.35) : fBase.rgb, c2);
      }
    }
    if (drape) {
      vec2 c = vec2(x, y) - view.xy / view.z * ${fl(DRAPE_BACK)};
      float left = w * (0.1 + 0.35 * fract(seed * 4.3)), rightEdge = w * (0.9 - 0.35 * fract(seed * 6.1));
      if (c.x < left || c.x > rightEdge) {
        facadeElement(${first("drape")} + (fract(seed * 2.9) < 0.5 ? 0 : 1), vec2(fract(c.x), clamp(c.y / h, 0.0, 1.0)), 1.0, footprint, false);
        seen = seen * (1.0 - fBase.a) + fBase.rgb * 0.8 * fBase.a;
      }
    }
    float filmed = clamp((rough - 0.05) / 0.45, 0.0, 1.0);
    float through = ((1.0 - (0.04 + 0.96 * pow(1.0 - view.z, 5.0))) * (1.0 - ${fl(FILM_HIDES)} * filmed) * shard + (1.0 - shard)) * (broken ? 0.5 : 1.0);
    room = seen * through * (1.0 - a);
    ga = ${fl(FILM_ALBEDO)} * filmed * shard;
    gr = shard >= 0.5 ? rough : 1.0;
    if (shard >= 0.5) share = facadeFar(far3, g.x, vec3(-view.x, -view.y, view.z), over + g.y - y, fract(family * 7.7 + seed * 0.1)) * (1.0 - a);
    sharp = shard >= 0.5 && a < 0.5 ? 2 : 1;
  }
  albedo = (glassy ? film * ga : vec3(ga)) * (1.0 - a) + frame * a;
  far = vec4(far3, share);
#else
  albedo = vec3(ga) * (1.0 - a) + frame * a;
#endif
  orm = vec3(framePacked.r * a + (1.0 - a), framePacked.g * a + gr * (1.0 - a), framePacked.b * a);
  n = bent;
  if (glassy && boards) {
    facadeElement(${first("boards")} + (fract(seed * 23.1) < 0.5 ? 0 : 1), vec2(fract(x / 1.2), y / h), 1.2, footprint, true);
    float b = fBase.a;
    albedo = mix(albedo, fBase.rgb, b);
    room *= 1.0 - b;
    orm = mix(orm, fPacked, b);
    n = mix(n, nn * sqrt(max(0.0, 1.0 - dot(fBump, fBump))) + side * fBump.x + vec3(0.0, fBump.y, 0.0), b);
    far.a *= 1.0 - b;
    if (b >= 0.5) sharp = 1;
  }
  if (kind == ${KIND.display} && a < 1.0 && !boards) {
    float c = facadeShopGlass(g, w, seed, footprint) * (1.0 - a);
    if (c > 0.0) {
      albedo = mix(albedo, fDecal.rgb, c);
      room *= 1.0 - c;
      orm = vec3(orm.x * (1.0 - c) + c, orm.y * (1.0 - c) + 0.9 * c, orm.z * (1.0 - c));
      far.a *= 1.0 - c;
      if (c >= 0.5) sharp = 1;
    }
  }
  n = normalize(n);
  return sharp;
}
float facadeNoise(float t, int seed) {
  float i = floor(t), f = t - i, s = f * f * (3.0 - 2.0 * f);
  return mix(facadeHash(ivec3(int(i), seed, 91)), facadeHash(ivec3(int(i) + 1, seed, 91)), s);
}
float facadeMark(int m, float x, float y, float x0, float y0, float dw, float dh, float footprint) {
  float u = (x - x0) / dw, v = (y - y0) / dh;
  if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) return 0.0;
  vec4 p = MP[m];
  float size = float(textureSize(uFacadeMarks, 0).x);
  float lod = log2(max(footprint * p.z * size / (dw * ${fl(FACADE_TOP)}), 1e-6));
  float most = log2(size / 256.0);
  float fade = clamp((lod - most) / 1.5, 0.0, 1.0);
  float l = clamp(lod, 0.0, most), inset = 0.5 * exp2(ceil(l)) / size;
  vec2 at = clamp((p.xy + vec2(u, 1.0 - v) * p.zw) / ${fl(FACADE_TOP)}, p.xy / ${fl(FACADE_TOP)} + inset, (p.xy + p.zw) / ${fl(FACADE_TOP)} - inset);
  fDecal = mix(fade < 1.0 ? textureLod(uFacadeMarks, at, l) : vec4(0.0), MM[m], fade);
  return fDecal.a;
}
void facadeMarks(inout vec3 albedo, inout vec3 orm, inout vec3 n, int kind, float x, float y, float w, float h, uint edges, vec3 nn, vec3 side, vec3 corner, vec3 right, vec2 place, float height, float over, float footprint) {
  if (w < 0.3 || h < 0.3) return;
  float seed = facadeSeed(place, vec3(corner.x + right.x * w * 0.5, height - y + h * 0.5, corner.z + right.z * w * 0.5));
  float fp = max(footprint, 1e-4), tx = 0.0, ty = 0.0;
  if (fFacade.x > ${fl(NO_FLOOD)}) {
    float dh = height - fFacade.x + 0.03 * (facadeNoise(x * 1.7, 5) - 0.5) + 0.01 * (facadeNoise(x * 9.0, 6) - 0.5);
    if (dh < 0.02 && dh > -0.7) {
      float line = 1.0 - smoothstep(0.003, 0.008 + fp * 0.5, abs(dh));
      float band = dh < 0.0 ? 1.0 - smoothstep(0.035, 0.06 + fp * 0.5, -dh) : 0.0;
      float silt = min(1.0, (dh < 0.0 ? (1.0 + dh / 0.7) * (1.0 + dh / 0.7) * 0.35 : 0.0) + 0.5 * band);
      albedo *= (1.0 - silt + silt * vec3(0.78, 0.68, 0.52)) * (1.0 - 0.45 * line);
      orm.y += (1.0 - orm.y) * max(line, silt);
    }
  }
  float crack = 0.0;
  if (min(w, h) >= 0.4) {
    for (int c = 0; c < 4; c++) {
      int right1 = c & 1, top = c >> 1;
      uint want = uint((right1 == 1 ? 2 : 1) | (top == 1 ? 8 : 4));
      if ((edges & want) == 0u || fract(seed * (7.13 + float(c) * 3.31)) >= 0.35) continue;
      float length1 = min(0.3 + 0.7 * fract(seed * (5.1 + float(c) * 1.7)), 0.7 * min(w, h));
      vec2 a = vec2(right1 == 1 ? w : 0.0, top == 1 ? h : 0.0);
      if (length(vec2(x, y) - a) > length1 + 0.05) continue;
      vec2 sgn = vec2(right1 == 1 ? -1.0 : 1.0, top == 1 ? -1.0 : 1.0);
      float along = 0.0;
      for (int k = 0; k < 3; k++) {
        float angle = 0.5 + 0.5 * fract(seed * (3.7 + float(c))) + 0.35 * (fract(seed * (11.3 + float(c) * 2.1 + float(k) * 5.7)) - 0.5);
        vec2 b = a + sgn * vec2(cos(angle), sin(angle)) * length1 / 3.0;
        vec2 e = b - a;
        float t = clamp(dot(vec2(x, y) - a, e) / dot(e, e), 0.0, 1.0);
        vec2 q = vec2(x, y) - a - e * t;
        float d = length(q);
        float half1 = 0.0012 + 0.0028 * (1.0 - (along + t * length1 / 3.0) / length1);
        float cover = clamp((half1 + 0.5 * fp - d) / fp, 0.0, 1.0) * min(1.0, 2.0 * half1 / fp);
        if (cover > crack) {
          crack = cover;
          tx = d > 1e-6 ? -q.x / d : 0.0;
          ty = d > 1e-6 ? -q.y / d : 0.0;
        }
        along += length1 / 3.0;
        a = b;
      }
    }
  }
  float slotX = floor(x / ${fl(SLOT_W)}), slotY = floor(y / ${fl(SLOT_H)});
  float sx0 = slotX * ${fl(SLOT_W)}, sy0 = slotY * ${fl(SLOT_H)}, sx1 = min(sx0 + ${fl(SLOT_W)}, w), sy1 = min(sy0 + ${fl(SLOT_H)}, h);
  float slot = facadeHash(ivec3(int(seed * 16777216.0), int(slotX), int(slotY)));
  float foot = over - y + sy0;
  float px2 = 0.0, py2 = 0.0;
  if (kind == 0 && fract(slot * 3.1) < 0.1 && sx1 - sx0 >= 1.2 && sy1 - sy0 >= 0.8) {
    float pw = min(0.6 + fract(slot * 5.3), sx1 - sx0 - 0.2), ph = min(0.4 + 0.6 * fract(slot * 7.9), sy1 - sy0 - 0.2);
    float cx = sx0 + 0.1 + pw / 2.0 + fract(slot * 9.7) * (sx1 - sx0 - pw - 0.2), cy = sy0 + 0.1 + ph / 2.0 + fract(slot * 2.9) * (sy1 - sy0 - ph - 0.2);
    float ex = abs(x - cx) - pw / 2.0, ey = abs(y - cy) - ph / 2.0;
    float sd = max(ex, ey) + 0.12 * (facadeNoise((x + y) * 2.5, int(floor(slot * 4096.0))) - 0.5) + 0.03 * (facadeNoise((x - y) * 11.0, 3) - 0.5);
    float mended = clamp(0.5 - sd / fp, 0.0, 1.0);
    float lip = (1.0 - smoothstep(0.0, 0.012, abs(sd))) * min(1.0, 0.012 / fp);
    px2 = ex > ey ? sign(x - cx) * lip : 0.0;
    py2 = ex > ey ? 0.0 : sign(y - cy) * lip;
    albedo += (vec3(0.36, 0.35, 0.33) * (0.85 + 0.3 * fract(slot * 13.3)) - albedo) * 0.45 * mended;
    orm.y += (0.95 - orm.y) * mended;
  }
  int scar = 0;
  float sxn = 0.0, syn = 0.0;
  if (kind == 0 && fract(slot * 11.9) < 0.07 && sx1 - sx0 >= 1.4 && sy1 - sy0 >= 1.4) {
    float cx = sx0 + 0.7 + fract(slot * 4.7) * (sx1 - sx0 - 1.4), cy = clamp(0.8 + 1.6 * fract(slot * 6.1) - (over - y), sy0 + 0.7, sy1 - 0.7);
    if (length(vec2(x - cx, y - cy)) < 0.65) {
      for (int k = 0; k < 10; k++) {
        float a = 6.2832 * fract(slot * (17.3 + float(k) * 3.9)), r = 0.5 * sqrt(fract(slot * (23.1 + float(k) * 7.3)));
        vec2 hole = vec2(cx + cos(a) * r, cy + sin(a) * r);
        float rad = 0.012 + 0.014 * fract(slot * (31.7 + float(k) * 2.3));
        float d = length(vec2(x, y) - hole);
        if (d >= rad) continue;
        scar = d < 0.45 * rad ? 2 : 1;
        sxn = -(x - hole.x) / rad * 0.7;
        syn = -(y - hole.y) / rad * 0.7;
      }
      if (scar > 0) {
        albedo *= scar == 2 ? 0.35 : 1.25;
        orm.y = 1.0;
      }
    }
  }
  float r = fract(slot * 2.3);
  int m = -1, m2 = -1;
  float dw = 0.0, dh = 0.0, bottom = 0.0;
  if (kind == 0 && foot < 2.5) {
    if (r < 0.1 && sx1 - sx0 >= 3.4 && sy1 - sy0 >= 1.6) { m = ${mark("piece")} + min(int(floor(fract(slot * 19.7) * ${fl(marks("piece"))})), ${marks("piece") - 1}); dw = 3.2; dh = 1.2; bottom = sy0 + 0.4 - foot; }
    else if (r < 0.28 && sx1 - sx0 >= 0.8 && sy1 - sy0 >= 1.2) { m = ${mark("poster")} + min(int(floor(fract(slot * 19.7) * ${fl(marks("poster"))})), ${marks("poster") - 1}); dw = 0.6; dh = 0.9; bottom = sy0 + 1.1 + 0.5 * fract(slot * 8.3) - foot; }
    else if (r < 0.55 && sx1 - sx0 >= 1.2) { m = ${mark("tag")} + min(int(floor(fract(slot * 19.7) * 8.0)), 7); dw = 1.0; dh = 0.5; bottom = sy0 + 0.5 + 1.4 * fract(slot * 8.3) - foot; }
  } else if (kind == ${KIND.shutter}) {
    if (r < 0.25) { m = ${mark("piece")} + min(int(floor(fract(slot * 19.7) * ${fl(marks("piece"))})), ${marks("piece") - 1}); dw = 3.2; dh = 1.2; bottom = 0.4; }
    else if (r < 0.7) { m = ${mark("tag")} + min(int(floor(fract(slot * 19.7) * 8.0)), 7); dw = 1.0; dh = 0.5; bottom = 0.5 + 1.2 * fract(slot * 8.3); }
  } else if (kind == ${KIND.door} && r < 0.3) { m = ${mark("tag")} + min(int(floor(fract(slot * 19.7) * 8.0)), 7); dw = 1.0; dh = 0.5; bottom = 0.6 + fract(slot * 8.3); }
  else if (kind == ${KIND.pier}) {
    if (r < 0.75) { m = ${mark("stencil")} + min(int(floor(fract(slot * 19.7) * 3.0)), 2); dw = 0.6; dh = 0.8; bottom = 1.2; }
    if (fract(slot * 6.7) < 0.5) m2 = ${mark("stencil")} + 3;
  }
  float x0 = sx0 + 0.05 + fract(slot * 4.1) * max(0.0, sx1 - sx0 - dw - 0.1), y0 = max(sy0, bottom), cover = 0.0;
  if (m >= 0 && x0 + dw <= sx1 - 0.04 && y0 + dh <= sy1) cover = facadeMark(m, x, y, x0, y0, dw, dh, fp);
  if (cover > 0.0) {
    bool paper = m >= ${mark("poster")} && m < ${mark("poster") + marks("poster")};
    albedo += (fDecal.rgb - albedo) * cover;
    orm.y += ((paper ? 0.95 : 0.65) - orm.y) * cover;
    orm.z *= 1.0 - cover;
  }
  if (m2 >= 0 && (cover = facadeMark(m2, x, y, (w - 0.6) * 0.5, 0.0, 0.6, 0.8, fp)) > 0.0) {
    albedo += (fDecal.rgb - albedo) * cover;
    orm.y += (0.65 - orm.y) * cover;
  }
  if (crack > 0.0) {
    albedo *= 1.0 - 0.7 * crack;
    orm.y += (1.0 - orm.y) * crack;
  }
  vec2 bent = vec2(tx, ty) * 0.6 * crack + vec2(px2, py2) * 0.35 + (scar > 0 ? vec2(sxn, syn) : vec2(0.0));
  if (bent.x != 0.0 || bent.y != 0.0) n = normalize(n + side * bent.x + vec3(0.0, bent.y, 0.0));
}
int facade(inout vec3 albedo, inout vec3 orm, inout vec3 n, out vec3 room, out vec4 far, out vec4 roomAt, int colour, vec2 face, vec2 fx, vec2 fy, vec3 own, vec3 ox, vec3 oy, vec2 place, uint edges, vec3 rel, vec3 dpx, vec3 dpy, vec3 geometric, float height, float over) {
  room = vec3(0.0);
  far = vec4(0.0);
  roomAt = vec4(rel, over);
  float det = fx.x * fy.y - fy.x * fx.y;
  if (abs(det) < 1e-12 || abs(geometric.y) > 0.5) return 0;
  vec3 pu = (dpx * fy.y - dpy * fx.y) / det, pv = (dpy * fx.x - dpx * fy.x) / det;
  vec3 qu = (ox * fy.y - oy * fx.y) / det, qv = (oy * fx.x - ox * fy.x) / det;
  // A face whose corners run up before across is read the other way round, so neither way is near level by chance.
  if (abs(pu.y) > abs(pv.y)) {
    vec3 t = pu;
    pu = pv;
    pv = t;
    t = qu;
    qu = qv;
    qv = t;
    face = face.yx;
    edges = ((edges & 3u) << 2) | ((edges & 12u) >> 2);
  }
  vec3 nn = geometric, side = normalize(vec3(nn.z, 0.0, -nn.x) + 1e-9);
  // Across the face as a reader facing it reads, and up; its outer edges' bits follow.
  if (dot(pu, side) < 0.0) { face.x = 1.0 - face.x; pu = -pu; qu = -qu; edges = (edges & 12u) | ((edges & 1u) << 1) | ((edges & 2u) >> 1); }
  if (pv.y < 0.0) { face.y = 1.0 - face.y; pv = -pv; qv = -qv; edges = (edges & 3u) | ((edges & 4u) << 1) | ((edges & 8u) >> 1); }
  float w = length(pu), h = length(pv);
  int kind = facadeKind(colour, w, h, nn.y);
  float x = face.x * w, y = face.y * h, footprint = max(length(dpx), length(dpy));
  roomAt = vec4(rel + vec3(0.0, h - y, 0.0) + vec3(nn.x, 0.0, nn.z) * ${fl(ROOM_OUT)}, over + h - y);
  vec3 corner = own - qu * face.x - qv * face.y, right = qu / max(length(qu), 1e-6);
  int part = kind == 0 ? 0 : facadePart(albedo, orm, n, room, far, kind, x, y, w, h, corner, right, nn, side, place, rel, footprint, height, over);
  if (kind == 0 || kind == ${KIND.shutter} || kind == ${KIND.door} || kind == ${KIND.pier}) facadeMarks(albedo, orm, n, kind, x, y, w, h, edges, nn, side, corner, right, place, height, over, footprint);
  return part;
}
#endif
`;

/** What glass is seen as far off, past its room and its reflection's detail: a dark blue-grey, as light. */
const GLASS_FAR = [0.07, 0.085, 0.1];
/** The mean of a colour class's glazed elements far off, frame and glass by their cover, as light: windows, doors and displays (1), a curtain wall (2). */
function farMean(colour: number): number[] {
  const out = [0, 0, 0];
  let n = 0;
  KINDS.forEach((k) => {
    if (k.colour !== colour || !k.room) return;
    PLACED.forEach((p, e) => {
      if (p.name !== k.element) return;
      const cover = ELEMENT_MEANS[e * 5 + 3]!;
      for (let c = 0; c < 3; c++) out[c]! += ELEMENT_MEANS[e * 5 + c]! * cover + GLASS_FAR[c]! * (1 - cover);
      n++;
    });
  });
  return out.map((v) => v / Math.max(n, 1));
}
const toSrgb = (l: number): number => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);

/**
 * The far program's vertex text on a tier that draws facades (programs.ts): a dark opening's and a pane's palette
 * colours (FACADE_COLOURS) as the mean of their glazed elements, so a window fading out far off, or handed over, is
 * the average of its bay, a grey of frame and glass, and not a hole.
 */
export function facadeFarVertex(vertex: string): string {
  const fetch = "  vColor = texelFetch(uPalette, ivec2(int(i), 0), 0).rgb;\n";
  if (!vertex.includes(fetch)) throw new Error("facadeFarVertex: not a flat vertex text");
  const lines = FAR_COLOURS.map(([i, c], k) => `  ${k ? "else " : ""}if (i == ${i}u) vColor = vec3(${c.map((v) => v.toFixed(4)).join(", ")});\n`);
  return vertex.replace(fetch, fetch + lines.join(""));
}
/** The palette colours facadeFarVertex draws as their bay's mean, and that mean as a display value, to four places. */
const FAR_COLOURS: readonly (readonly [number, readonly number[]])[] = Object.entries(FACADE_COLOURS).filter(([, c]) => c === 1 || c === 2).sort((a, b) => a[1] - b[1]).map(([i, c]) => [Number(i), farMean(c).map((v) => Number(toSrgb(v).toFixed(4)))]);
/** facadeFarVertex's twin: the display value palette colour `i` is drawn in where no facade's part is, or null for its own. */
export function facadeFarColour(i: number): readonly number[] | null {
  return FAR_COLOURS.find(([k]) => k === i)?.[1] ?? null;
}

/** The class each palette colour gives a vertex, by FACADE_COLOURS, put into FLAT's mesh vertex text as vFacade. */
export function facadeVertex(vertex: string): string {
  if (!vertex.includes("out vec3 vRel;") || !vertex.includes("  vRel = p;")) throw new Error("facadeVertex: not a flat mesh vertex text");
  const table = Array.from({ length: 256 }, (_, i) => FACADE_COLOURS[i] ?? 0);
  return vertex.replace("out vec3 vRel;", `out vec3 vRel;\nflat out int vFacade;\nconst int FACADE_CLASS[256] = int[256](${table.join(",")});`)
    .replace("  vRel = p;", "  vFacade = FACADE_CLASS[int(i)];\n  vRel = p;");
}
