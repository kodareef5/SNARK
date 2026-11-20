// Small details as a pack carries them: the atlas of every asset's detail pictures, every effect with its numbers whole,
// and each creature's cue sheet (planning/reference/round9-details-design.md). Sheets are written by hand as JSON in an
// asset's folder; `readSheet` turns one into these numbers, filling in what it leaves out, and says plainly what is wrong.
//
// The atlas is square, CELL pixels a cell, RGBA8, stored with every mip from its side down to one pixel, largest first.
// A texel holds in red the picture's shade (sRGB), in green the share of the picture's second region, in blue the share
// that is never dyed, and in alpha how much shows. What is left of the shade takes the first region's colour.

/** Pixels across a cell of the atlas. */
export const CELL = 128;
/** The largest atlas the boot file carries. */
export const ATLAS_MOST = 512;

/** The shapes low poly draws in place of a picture, and that a picture names as its own. */
export const FLAT_SHAPES = ["feather", "puff", "drop", "ring", "grain"] as const;
export type FlatShape = (typeof FLAT_SHAPES)[number];

/** The kinds of ground an effect may be made on (client/core/details/ground.ts). */
export const GROUNDS = ["grass", "sand", "stone", "water", "built"] as const;

/** What a body does that a sheet may answer. */
export const OCCASIONS = ["thrown", "land", "struck", "down", "death", "up", "splash", "step", "peck", "take_off", "rotor_wash", "engine_smoke", "boat_wake", "boat_spray"] as const;
export type Occasion = (typeof OCCASIONS)[number];

export interface DetailPicture {
  /** "<owner>/<name>". */
  id: string;
  cell: number;
  /** The body's colour regions its first and second shares take, -1 for none. */
  regions: [number, number];
  /** The mean linear shade where it is dyed. A dye is divided by it, so the dyed picture averages the dye. */
  grey: number;
  /** Index into FLAT_SHAPES. */
  flat: number;
}

export interface DetailEffect {
  /** "<owner>/<name>". */
  id: string;
  /** Indices into the pictures; one is chosen for each particle. */
  pictures: number[];
  count: [number, number];
  /** Where the particles start about the place: a point, within a sphere, on a ring or within a disc on the ground. */
  shape: "point" | "sphere" | "ring" | "disc";
  /** Metres; for a ring or disc from the ground, a share of how wide the body lies. */
  radius: number;
  /** Metres a second at birth, and the share of that pointed up. */
  speed: [number, number];
  up: number;
  /** Metres from end to end, width over length, and how much larger it is at the end of its life. */
  size: [number, number];
  aspect: number;
  grow: number;
  /** Seconds, and the seconds of its end over which it fades. */
  life: [number, number];
  fade: number;
  /** Per second, the rate its velocity comes to the wind's; the share of gravity it feels; the speed it falls at most, 0 for no limit. */
  drag: number;
  gravity: number;
  fall: number;
  /** The share of the ground wind it is carried by. */
  wind: number;
  /** A falling feather: metres it sways and swings a second, radians it rocks, and radians a second it turns. */
  sway: number;
  swayHz: number;
  rock: number;
  turn: number;
  /** Seconds it lies where it lands before it fades. 0: it never lands, and fades in the air. */
  settle: number;
  /** The body's colours by the picture's regions, the ground's, or an sRGB colour. */
  colour: "body" | "ground" | [number, number, number];
  /** How far each particle's colour is shaded from it, as a share. */
  vary: number;
  face: "free" | "camera" | "flat";
  pass: "cutout" | "blend";
  lit: boolean;
  /** Metres from the camera beyond which it is not made. */
  reach: number;
}

/** Where an effect of a cue starts: the torso, the hit point, the ground under the body, the foot that came down, or a socket by name. */
export type DetailFrom = "body" | "hit" | "ground" | string;

export interface DetailEntry {
  /** Index into the effects. */
  effect: number;
  from: DetailFrom;
  /** "now", "down" (where the body meets the ground in the occasion's clip), or seconds. */
  at: "now" | "down" | number;
  count?: [number, number];
  /** The kinds of ground (GROUNDS) it is made on; on any where absent. */
  on?: number[];
}

/** A sound a cue plays, for the sound work to read: a name in the asset's sound/sounds.json, at once, or with its moment as an entry's `at`. */
export type DetailSound = string | { sound: string; at: "now" | "down" | number };

export interface DetailCue {
  sounds?: DetailSound[];
  effects: DetailEntry[];
}

export interface DetailSheet {
  /** The asset, as "<pack>:<name>": a species of that id answers its cues. */
  owner: string;
  cues: Partial<Record<Occasion, DetailCue>>;
}

export interface PackDetails {
  /** A boot file can group channel bytes for Brotli. parsePack restores interleaved RGBA. */
  atlas: { offset: number; side: number; planar?: true };
  pictures: DetailPicture[];
  effects: DetailEffect[];
  sheets: DetailSheet[];
  /** A hash of the files it was made from, so a test can say the pack is older than they are. */
  inputs: string;
}

/** Bytes of an atlas `side` pixels across with all its mips. */
export function atlasBytes(side: number): number {
  let bytes = 0;
  for (let s = side; s >= 1; s >>= 1) bytes += s * s * 4;
  return bytes;
}

/** Where the mip `side >> level` across starts in the atlas's bytes. */
export function mipOffset(side: number, level: number): number {
  let at = 0;
  for (let k = 0, s = side; k < level; k++, s >>= 1) at += s * s * 4;
  return at;
}

/** A sheet as written in an asset's folder. */
export interface SheetSource {
  pictures?: Record<string, { file: string; regions?: string; flat: string }>;
  effects?: Record<string, Record<string, unknown>>;
  cues?: Record<string, { sounds?: DetailSound[]; effects?: { effect: string; from?: string; at?: string | number; count?: [number, number]; on?: string[] }[] }>;
}

const DEFAULTS: Omit<DetailEffect, "id" | "pictures"> = {
  count: [1, 1], shape: "point", radius: 0, speed: [0, 0], up: 0.5, size: [0.1, 0.1], aspect: 1, grow: 1, life: [1, 1], fade: 0.3,
  drag: 2, gravity: 1, fall: 0, wind: 0, sway: 0, swayHz: 1, rock: 0, turn: 0, settle: 0, colour: "body", vary: 0, face: "camera", pass: "blend", lit: true, reach: 40,
};

const pair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n)) && v[0] <= v[1];

/**
 * An effect's numbers from what a sheet writes, `pictureOf` turning a picture's name into its index. A range may be
 * written as one number. Throws, naming the field, for anything that would draw wrong.
 */
export function effectOf(id: string, raw: Record<string, unknown>, pictureOf: (name: string) => number): DetailEffect {
  const out = { ...DEFAULTS, id, pictures: [] as number[] } as DetailEffect & Record<string, unknown>;
  const fail = (what: string): never => {
    throw new Error(`effect ${id}: ${what}`);
  };
  for (const [key, value] of Object.entries(raw)) {
    if (key === "pictures") {
      if (!Array.isArray(value) || value.length === 0) fail("`pictures` is a list of picture names");
      out.pictures = (value as string[]).map((name) => {
        const i = pictureOf(name);
        if (i < 0) fail(`no picture "${name}"`);
        return i;
      });
    } else if (key === "shape") {
      if (value === "point") out.shape = "point";
      else if (value && typeof value === "object" && Object.keys(value).length === 1) {
        const [kind, r] = Object.entries(value as Record<string, number>)[0]!;
        if (kind !== "sphere" && kind !== "ring" && kind !== "disc") fail(`a shape is "point", { "sphere": r }, { "ring": r } or { "disc": r }, not ${kind}`);
        if (!(typeof r === "number" && r >= 0)) fail("a shape's radius is a number of metres");
        out.shape = kind as DetailEffect["shape"];
        out.radius = r;
      } else fail("a shape is \"point\", { \"sphere\": r }, { \"ring\": r } or { \"disc\": r }");
    } else if (key === "flutter") {
      const f = value as Record<string, number>;
      for (const [k, v] of Object.entries(f)) {
        if (!["sway", "hz", "rock", "turn"].includes(k) || typeof v !== "number") fail(`flutter has sway, hz, rock and turn, as numbers`);
        out[k === "hz" ? "swayHz" : k] = v;
      }
    } else if (key === "colour") {
      if (value === "body" || value === "ground") out.colour = value;
      else if (Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number" && n >= 0 && n <= 255)) out.colour = value as [number, number, number];
      else fail("colour is \"body\", \"ground\" or [r, g, b] of 255");
    } else if (key === "face") {
      if (value !== "free" && value !== "camera" && value !== "flat") return fail("face is free, camera or flat");
      out.face = value;
    } else if (key === "pass") {
      if (value !== "cutout" && value !== "blend") return fail("pass is cutout or blend");
      out.pass = value;
    } else if (key === "lit") {
      if (typeof value !== "boolean") return fail("lit is true or false");
      out.lit = value;
    } else if (key in DEFAULTS) {
      const was = DEFAULTS[key as keyof typeof DEFAULTS];
      if (Array.isArray(was)) {
        const v = typeof value === "number" ? [value, value] : value;
        if (!pair(v)) fail(`${key} is a number or [least, most]`);
        out[key] = v;
      } else {
        if (typeof value !== "number" || !Number.isFinite(value)) fail(`${key} is a number`);
        out[key] = value;
      }
    } else fail(`there is no field "${key}"`);
  }
  if (out.pictures.length === 0) fail("it names no pictures");
  if (out.count[0] < 0 || out.life[0] <= 0 || out.size[0] <= 0 || out.aspect <= 0) fail("count, life, size and aspect are more than 0");
  if (out.fade < 0 || out.fade > out.life[0]) fail("its fade is longer than its shortest life");
  return out;
}

/** Whether `from` names a place a cue may start an effect at, given the sockets of nothing in particular. */
export function knownFrom(from: string): boolean {
  return from === "body" || from === "hit" || from === "ground" || from === "foot" || /^[a-z_][a-z0-9_]*$/.test(from);
}
