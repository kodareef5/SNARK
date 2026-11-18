// What a building's front wears over its world finish: frames, glass and the rooms behind it, doors, shutters, sign
// bands and clearance bars. Each is a painted element laid over a box of a facade module (content/ruins.ts), which is
// known by its colour and its face's size in metres. Glass shows a room that is not modelled: a box behind the pane
// whose faces come from the rooms' atlas, met by the eye's ray (interior mapping), and over it the sky and the street's
// far side. The maths is here twice, as functions on numbers for the software rasterizer and as GLSL, from the same
// constants. Directions are in the world; a face's own frame is x to the right of a reader facing it, y up, z out.

type Numbers = ArrayLike<number>;
type Out = Float64Array | number[];

/** The side of both atlases at their finest, and the elements' pixels a metre there. */
export const FACADE_TOP = 2048;
const DENSITY = 128;
const GAP = 16;

/** Each element: its name, its width and height in metres, how many painted variants. */
export const ELEMENTS: readonly (readonly [string, number, number, number])[] = [
  ["window", 1.4, 2, 3], ["slider", 0.9, 2.2, 2], ["casement", 1.4, 1.4, 2], ["strip", 6.8, 0.8, 1], ["curtain", 2, 2.6, 2],
  ["display", 5, 2.4, 2], ["shutter", 7.2, 2.9, 3], ["sign", 7.2, 0.9, 6], ["bar", 6.8, 0.25, 2], ["door", 1, 2.2, 3],
  ["blind", 1, 1, 1], ["drape", 1, 2, 2], ["boards", 1.2, 2.4, 2], ["shards", 1.5, 1.5, 2],
];

/** An element's variant in the atlas: pixels at FACADE_TOP, rows from the top. */
export interface Placed { readonly name: string; readonly variant: number; readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/** The elements laid into the atlas, in ELEMENTS order: the largest first, each on the lowest run of columns it fits, GAP apart. */
export const PLACED: readonly Placed[] = (() => {
  const items = ELEMENTS.flatMap(([name, w, h, n]) => Array.from({ length: n }, (_, variant) => ({ name, variant, w: Math.ceil((w * DENSITY) / 8) * 8, h: Math.ceil((h * DENSITY) / 8) * 8 })));
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
})();
const first = (name: string): number => PLACED.findIndex((p) => p.name === name);

/** The rooms' atlas: 4 by 4 rooms, each four squares, back wall and side wall over floor and ceiling. */
export const ROOMS = 16;
export const ROOM_FACES = ["back", "side", "floor", "ceiling"] as const;

/**
 * The colours a facade module's parts are drawn in (content/ruins.ts), and the class each gives a vertex: a dark opening,
 * a pane, a shutter's painted steel, a sign band, a clearance bar. Any other colour is class 0.
 */
export const FACADE_COLOURS: Readonly<Record<number, number>> = { 83: 1, 92: 2, 5: 3, 135: 4, 6: 5 };

export const KIND = { none: 0, window: 1, slider: 2, casement: 3, strip: 4, display: 5, curtain: 6, shutter: 7, sign: 8, bar: 9, door: 10, jamb: 11 } as const;
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
];
/** How near a face's size must be to a kind's, in metres. */
const NEAR = 0.04;
/** How far the glass stands behind the face of its frame, and a blind and a curtain behind the glass, in metres. */
const SET_BACK = 0.04;
const BLIND_BACK = 0.08;
const DRAPE_BACK = 0.12;

/**
 * What each tier draws: the elements' atlas and the rooms' at their sides (0 for none), and whether glass shows its room
 * and the street's far side; without them glass is a dark recess. Low poly draws none of it.
 */
export interface FacadeTier { readonly elements: number; readonly rooms: number; readonly reflect: boolean }
export const FACADE_TIERS: Readonly<Record<string, FacadeTier | null>> = {
  lowpoly: null,
  medium: { elements: 1024, rooms: 0, reflect: false },
  high: { elements: 2048, rooms: 2048, reflect: true },
  ultra: { elements: 2048, rooms: 2048, reflect: true },
};

/**
 * Each placed element's mean at its finest, which it fades to far off: linear red, green and blue of its solid part,
 * its cover (base alpha), its roughness. Then each room's mean, linear red, green and blue. tools/facade/build.ts
 * measures both from the atlases it makes and a test holds them to it.
 */
export const ELEMENT_MEANS: readonly number[] = [0.5726, 0.567, 0.477, 0.2566, 0.2086, 0.1426, 0.109, 0.07729, 0.2566, 0.2077, 0.5379, 0.5212, 0.4229, 0.2566, 0.2651, 0.5907, 0.5848, 0.4916, 0.2535, 0.2024, 0.1575, 0.1224, 0.08767, 0.2535, 0.2031, 0.5515, 0.5461, 0.4589, 0.2158, 0.1882, 0.1449, 0.1119, 0.08002, 0.211, 0.1837, 0.5499, 0.5438, 0.4577, 0.207, 0.1753, 0.09125, 0.1097, 0.09978, 0.3799, 0.1182, 0.07765, 0.05798, 0.04474, 0.3799, 0.1171, 0.3531, 0.3658, 0.3331, 0.1306, 0.1647, 0.1463, 0.1145, 0.08198, 0.1332, 0.1667, 0.1593, 0.2302, 0.2597, 1, 0.7903, 0.3906, 0.4051, 0.3727, 0.9989, 0.6864, 0.4837, 0.4335, 0.299, 1, 0.7931, 0.3176, 0.404, 0.2948, 1, 0.7554, 0.5774, 0.4986, 0.4119, 1, 0.7516, 0.5707, 0.4681, 0.2915, 1, 0.7575, 0.3017, 0.4015, 0.426, 1, 0.755, 0.2482, 0.2648, 0.248, 1, 0.7481, 0.5, 0.2863, 0.2288, 1, 0.756, 0.3321, 0.2574, 0.0921, 1, 0.7832, 0.4679, 0.3507, 0.1155, 1, 0.7789, 0.3135, 0.3356, 0.2979, 0.5187, 0.4151, 0.1143, 0.2159, 0.1813, 0.9577, 0.7783, 0.2457, 0.1304, 0.09312, 1, 0.8017, 0.5906, 0.5515, 0.4119, 0.8226, 0.5917, 0.6317, 0.5342, 0.3811, 0.9643, 0.8439, 0.2425, 0.3051, 0.3276, 0.9623, 0.8438, 0.3105, 0.2664, 0.217, 0.9925, 0.8496, 0.2983, 0.2633, 0.2175, 0.5663, 0.8514, 0.4215, 0.4536, 0.3792, 0.1455, 0.07263, 0.4171, 0.4514, 0.3785, 0.1464, 0.07176];
export const ROOM_MEANS: readonly number[] = [0.2518, 0.2313, 0.1813, 0.2092, 0.2171, 0.2358, 0.2364, 0.2313, 0.2063, 0.1973, 0.1922, 0.1755, 0.2518, 0.2313, 0.1813, 0.2092, 0.2171, 0.2358, 0.2364, 0.2313, 0.2063, 0.1973, 0.1922, 0.1755, 0.2518, 0.2313, 0.1813, 0.2092, 0.2171, 0.2358, 0.2364, 0.2313, 0.2063, 0.1973, 0.1922, 0.1755, 0.2518, 0.2313, 0.1813, 0.2092, 0.2171, 0.2358, 0.2364, 0.2313, 0.2063, 0.1973, 0.1922, 0.1755];

const fract = (x: number): number => x - Math.floor(x);
const clamp = (x: number, a = 0, b = 1): number => (x < a ? a : x > b ? b : x);

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

/** What a tier draws and a texture read: `texture` 0 to 3 the elements' base, normal and packed maps and the rooms'; (u, v) from the top left; `lod` the level below the finest. */
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
}
export function facadeOut(): FacadeOut {
  return { albedo: new Float64Array(3), orm: new Float64Array(3), normal: new Float64Array(3), room: new Float64Array(3), far: new Float64Array(3), farShare: 0, sharp: false };
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
  const light = (1 - 0.55 * f) * (face === 3 ? 0.7 : face === 1 ? 0.85 : 1);
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
 * `footprint` metres a pixel at `dist` metres from the eye; `tier` what the tier draws.
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
  const count = ELEMENTS.find((q) => q[0] === d.element)![3];
  const pick = kind === KIND.jamb ? 0 : Math.min(Math.floor((d.element === "sign" || d.element === "shutter" || d.element === "door" ? seed : family) * count), count - 1);
  const across = d.w === 0 ? 2 : w;
  element(first(d.element) + pick, d.w === 0 ? fract(x / 2) : x / w, y / h, across, footprint, tier.elements, sample, true);
  const a = r ? base[3]! : 1;
  for (let c = 0; c < 3; c++) frame[c] = base[c]!;
  frame[3] = packed[0]!;
  frame[4] = packed[1]!;
  frame[5] = packed[2]!;
  const bz = Math.sqrt(Math.max(0, 1 - bump[0]! * bump[0]! - bump[1]! * bump[1]!));
  o.normal[0] = n[0]! * bz + rx * bump[0]!;
  o.normal[1] = n[1]! * bz + bump[1]!;
  o.normal[2] = n[2]! * bz + rz * bump[0]!;
  const film = [base[0]!, base[1]!, base[2]!], rough = packed[1]!;
  o.room.fill(0);
  far.fill(0);
  o.sharp = false;
  let ga = 0.02, gr = 0.5, share = 0, filmed = 0, shard = 1;
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
    const through = ((1 - fresnel) * (1 - 0.6 * filmed) * shard + (1 - shard)) * (broken ? 0.5 : 1);
    for (let c = 0; c < 3; c++) o.room[c] = glassRoom[c]! * through * (1 - a);
    ga = 0.6 * filmed * shard;
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
  const nl = Math.hypot(o.normal[0]!, o.normal[1]!, o.normal[2]!) || 1;
  for (let c = 0; c < 3; c++) o.normal[c]! /= nl;
}

const fl = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));
const vecs = (type: string, rows: readonly (readonly number[])[]): string => `${type}[${rows.length}](${rows.map((r) => `${type}(${r.map(fl).join(",")})`).join(",")})`;
const ROOM_LIST = KINDS.flatMap((k) => k.room?.rooms ?? []);
const roomFirst = (k: number): number => KINDS.slice(0, k).reduce((sum, q) => sum + (q.room?.rooms.length ?? 0), 0);
const pickOf = (k: Kind, i: number): number => (i === KIND.jamb ? 2 : k.element === "sign" || k.element === "shutter" || k.element === "door" ? 1 : 0);

/**
 * facadeSurface's twin, with how a pixel finds its face: `facade` reads a fragment of a static of colour class `colour`
 * (FACADE_COLOURS) at `face` across and up its face (the corner bits, world-surfaces.ts ownVertex's vFace), `own` in its
 * instance's frame and `place` its instance's place, `rel` from the eye, and each one's steps to the next pixels, which
 * LIT takes where every pixel of a quad takes them. `height` is its height in the world and `over` over the ground, in
 * metres. Where the face is a part it
 * writes albedo, orm and n, the room's light to add (as an albedo the face's daylight lights) and the far side mirrored
 * (its albedo and share), and returns 1, or 2 where the pixel mirrors the sky as a picture; else 0. FACADE_NORMAL is the
 * normal map's channels in the texture's variant. Without FACADE_ROOMS glass is a dark recess.
 */
export const FACADE_GLSL = `uniform highp sampler2D uFacadeBase, uFacadeNormal, uFacadeOrm, uFacadeRooms;
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
  return mix(seen, RM[k], fade) * (1.0 - 0.55 * f) * (face == 3 ? 0.7 : face == 1 ? 0.85 : 1.0);
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
int facade(inout vec3 albedo, inout vec3 orm, inout vec3 n, out vec3 room, out vec4 far, int colour, vec2 face, vec2 fx, vec2 fy, vec3 own, vec3 ox, vec3 oy, vec2 place, vec3 rel, vec3 dpx, vec3 dpy, vec3 geometric, float height, float over) {
  room = vec3(0.0);
  far = vec4(0.0);
  float det = fx.x * fy.y - fy.x * fx.y;
  if (abs(det) < 1e-12) return 0;
  vec3 pu = (dpx * fy.y - dpy * fx.y) / det, pv = (dpy * fx.x - dpx * fy.x) / det;
  vec3 qu = (ox * fy.y - oy * fx.y) / det, qv = (oy * fx.x - ox * fy.x) / det;
  vec3 nn = geometric, side = normalize(vec3(nn.z, 0.0, -nn.x) + 1e-9);
  // Across the face as a reader facing it reads, and up.
  if (dot(pu, side) < 0.0) { face.x = 1.0 - face.x; pu = -pu; qu = -qu; }
  if (pv.y < 0.0) { face.y = 1.0 - face.y; pv = -pv; qv = -qv; }
  float w = length(pu), h = length(pv);
  int kind = facadeKind(colour, w, h, nn.y);
  if (kind == 0) return 0;
  float x = face.x * w, y = face.y * h;
  vec3 corner = own - qu * face.x - qv * face.y, right = qu / max(length(qu), 1e-6);
  vec3 v = -normalize(rel);
  float dist = length(rel), footprint = max(length(dpx), length(dpy));
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
  int pick = ke.z > 1.5 ? 0 : min(int(floor((ke.z > 0.5 ? seed : family) * ke.y)), int(ke.y) - 1);
  facadeElement(int(ke.x) + pick, vec2(ks.y == 0.0 ? fract(x / 2.0) : x / w, y / h), ks.y == 0.0 ? 2.0 : w, footprint, true);
  float a = glassy ? fBase.a : 1.0;
  vec3 frame = fBase.rgb, framePacked = fPacked, film = fBase.rgb;
  float rough = fPacked.g;
  float bz = sqrt(max(0.0, 1.0 - dot(fBump, fBump)));
  vec3 bent = nn * bz + side * fBump.x + vec3(0.0, fBump.y, 0.0);
  float ga = 0.02, gr = 0.5, share = 0.0, shard = 1.0;
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
    float through = ((1.0 - (0.04 + 0.96 * pow(1.0 - view.z, 5.0))) * (1.0 - 0.6 * filmed) * shard + (1.0 - shard)) * (broken ? 0.5 : 1.0);
    room = seen * through * (1.0 - a);
    ga = 0.6 * filmed * shard;
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
  n = normalize(n);
  return sharp;
}
`;

/** The class each palette colour gives a vertex, by FACADE_COLOURS, put into FLAT's mesh vertex text as vFacade. */
export function facadeVertex(vertex: string): string {
  if (!vertex.includes("out vec3 vRel;") || !vertex.includes("  vRel = p;")) throw new Error("facadeVertex: not a flat mesh vertex text");
  const table = Array.from({ length: 256 }, (_, i) => FACADE_COLOURS[i] ?? 0);
  return vertex.replace("out vec3 vRel;", `out vec3 vRel;\nflat out int vFacade;\nconst int FACADE_CLASS[256] = int[256](${table.join(",")});`)
    .replace("  vRel = p;", "  vFacade = FACADE_CLASS[int(i)];\n  vRel = p;");
}
