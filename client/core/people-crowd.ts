// The people bench's crowd (tools/bench/people.ts). A bench page told `?people=` stands survivors in front of its held
// view: one close enough to fill it, 40 at 8 to 25 m, or 200 at 8 to 80 m, in one shared look, each in a look of its own,
// or each in its own look and its own mix of clothes and armour; or each in its own look and one of four outfits of
// garments, all in the first outfit, or in it with a print of its own on the tee (`dressed`, `uniform`, `printed`). They
// are written into each sample after the session's own, so the renderer draws them as it draws a crowd that came over
// the link, and the link does not limit how many.

import { SLOT_NAMES } from "../../shared/anim/human.ts";
import { LOOK_BYTES, LOOK_SEX, defaultLook, randomLook } from "../../shared/anim/look.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { MAX_VIEW } from "../../shared/net/view.ts";
import { Rng } from "../../shared/rng.ts";
import { F_ALIVE, F_GROUNDED, GEAR_COUNT, GEAR_HELD, GEAR_WORN, WORN_FIELDS, WORN_LENGTH } from "../../shared/sim/entities.ts";
import { WARDROBE_NAMES } from "../../shared/sim/items.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import type { EditionPrint } from "../../shared/people/doc.ts";
import { noVehicle, type RemoteSample } from "./session.ts";

export const CROWD_SCENES = ["portrait", "near", "far"] as const;
export type CrowdScene = (typeof CROWD_SCENES)[number];
export const CROWD_LOOKS = ["shared", "unique", "gear", "dressed", "uniform", "printed"] as const;
export type CrowdLooks = (typeof CROWD_LOOKS)[number];

/** How many stand in each scene, and how near and far from the viewer, in metres. */
export const CROWD_SHAPES: Readonly<Record<CrowdScene, { count: number; near: number; far: number }>> = {
  portrait: { count: 1, near: 1.6, far: 1.6 },
  near: { count: 40, near: 8, far: 25 },
  far: { count: 200, near: 8, far: 80 },
};

/** Where the viewer stands: the proving ground's spawn, facing south over the open plaza (devicescene.ts LOOK.crowd). */
export const CROWD_VIEWER = { x: PROVING_SPAWN.x, z: PROVING_SPAWN.z, yaw: Math.PI };
/** Half the width the crowd is laid out in, radians: inside a 16:9 view at 70 degrees high, which shows 51 each side. */
export const CROWD_WEDGE = 0.6;
/** The least room between two bodies' middles, metres. */
export const CROWD_SPACING = 1.1;
/** The survivor's eye over its feet, metres (the species' eyeHeight). */
export const CROWD_EYE = 1.62;
/** Ids the crowd's bodies take, clear of the server's and of the device page's copies (devicescene.ts BodyCopies). */
const CROWD_ID = 0x50000000;

/** The worn sets a body in mixed gear is dressed from, by the id stem of their pieces. */
export const OUTFITS = ["bare", "cloth", "hide", "flak", "meridian", "mixed"] as const;
const SETS = ["cloth", "hide", "chitin", "flak", "meridian"] as const;
const PIECES: Readonly<Record<string, string>> = { head: "hat", torso: "shirt", hands: "gloves", legs: "pants", feet: "boots" };

export interface Spot {
  x: number;
  z: number;
  yaw: number;
}

/**
 * Where each body of `scene` stands: in a wedge ahead of `viewer`, spread evenly over its area, at least CROWD_SPACING
 * apart, each facing the viewer give or take 35 degrees. The portrait's one body stands straight ahead facing it.
 */
export function crowdSpots(scene: CrowdScene, viewer: Spot = CROWD_VIEWER, seed = 1): Spot[] {
  const { count, near, far } = CROWD_SHAPES[scene];
  const rng = new Rng(seed);
  const out: Spot[] = [];
  for (let tries = 0; out.length < count && tries < count * 200; tries++) {
    const d = count === 1 ? near : Math.sqrt(near * near + (far * far - near * near) * rng.float());
    const a = count === 1 ? 0 : rng.range(-CROWD_WEDGE, CROWD_WEDGE);
    const way = viewer.yaw + a;
    const x = viewer.x + Math.sin(way) * d, z = viewer.z + Math.cos(way) * d;
    if (out.some((s) => Math.hypot(s.x - x, s.z - z) < CROWD_SPACING)) continue;
    const turn = count === 1 ? 0 : rng.range(-0.6, 0.6);
    out.push({ x, z, yaw: wrap(way + Math.PI + turn) });
  }
  return out;
}

const wrap = (a: number): number => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

/** The way the view is held for `scene`, yaw and pitch in radians: the portrait looks down at the body's middle. */
export function crowdView(scene: CrowdScene, viewer: Spot = CROWD_VIEWER): { yaw: number; pitch: number } {
  return { yaw: viewer.yaw, pitch: scene === "portrait" ? -Math.atan2(CROWD_EYE - 0.95, CROWD_SHAPES.portrait.near) : -0.04 };
}

/** The look of each of `n` bodies: one look for all, or one each from `randomLook`, males and females by turns. A printed crowd's are unique. */
export function crowdLooks(n: number, looks: CrowdLooks, seed = 1): Uint8Array[] {
  if (looks === "shared") {
    const one = defaultLook();
    return Array.from({ length: n }, () => one);
  }
  const rng = new Rng(seed);
  return Array.from({ length: n }, (_, k) => {
    const look = randomLook(rng);
    look[LOOK_SEX] = k % 2;
    return look;
  });
}

/** How many of `looks` are not alike. */
export function distinctLooks(looks: readonly Uint8Array[]): number {
  return new Set(looks.map((l) => Array.prototype.join.call(l.subarray(0, LOOK_BYTES)))).size;
}

/**
 * What each of `n` bodies wears and holds, GEAR_COUNT content indices each: nothing, but in mixed gear each body takes
 * the next of OUTFITS from Meridian on (a mixed one draws each slot from the sets or bare), and every third body from
 * the first holds a rifle and every third from the second a hatchet. An item the content lacks is left off.
 */
export function crowdGear(n: number, looks: CrowdLooks, reg: Registry, seed = 1): Uint16Array {
  const out = new Uint16Array(n * GEAR_COUNT);
  if (looks !== "gear") return out;
  const id = (name: string): number => reg.index.get(`core:${name}`) ?? 0;
  const rng = new Rng(seed + 17);
  for (let k = 0; k < n; k++) {
    const at = k * GEAR_COUNT;
    const outfit = OUTFITS[(k + OUTFITS.indexOf("meridian")) % OUTFITS.length]!;
    SLOT_NAMES.forEach((slot, s) => {
      const set = outfit === "mixed" ? (rng.int(SETS.length + 1) === 0 ? "bare" : SETS[rng.int(SETS.length)]!) : outfit;
      if (set !== "bare") out[at + GEAR_WORN + s] = id(`${set}_${PIECES[slot]}`);
    });
    out[at + GEAR_HELD] = k % 3 === 0 ? id("rifle") : k % 3 === 1 ? id("hatchet") : 0;
  }
  return out;
}

/** Four outfits of garments, by wardrobe slot: what a dressed crowd and `bun tools/snap.ts --dress` wear. */
export const DRESSES: readonly Readonly<Partial<Record<(typeof WARDROBE_NAMES)[number], string>>>[] = [
  { top: "tee", bottom: "jeans", shoes: "trainers" },
  { top: "loose_tee", bottom: "shorts", shoes: "trainers" },
  { top: "tee", outer: "hoodie", bottom: "jeans", shoes: "trainers" },
  { top: "tee", outer: "apron", bottom: "jeans", shoes: "trainers" },
];

/** Outfit `dress` of DRESSES as a wardrobe, WORN_LENGTH numbers at `at` of `out`, each slot dyed `dye`. A garment the content lacks is left off. */
export function dressIn(out: Uint32Array, at: number, dress: number, reg: Registry, dye = 0): void {
  out.fill(0, at, at + WORN_LENGTH);
  WARDROBE_NAMES.forEach((slot, k) => {
    const name = DRESSES[dress]![slot], item = name ? (reg.index.get(`core:${name}`) ?? 0) : 0;
    if (item !== 0) out.set([item, 0, dye], at + k * WORN_FIELDS);
  });
}

/** What each of `n` bodies wears in its wardrobe: nothing, but dressed each the next of DRESSES, and in a uniform all the first. */
export function crowdWardrobes(n: number, looks: CrowdLooks, reg: Registry): Uint32Array {
  const out = new Uint32Array(n * WORN_LENGTH);
  if (looks === "dressed" || looks === "uniform" || looks === "printed") for (let k = 0; k < n; k++) dressIn(out, k * WORN_LENGTH, looks === "dressed" ? k % DRESSES.length : 0, reg);
  // A printed crowd's tees are each an edition of their own (crowdEdition).
  if (looks === "printed") for (let k = 0; k < n; k++) out[k * WORN_LENGTH + 1] = CROWD_EDITION + k;
  return out;
}

/** The tee's print sheet's chest, where a crowd's print is laid (shared/people/cuts.ts CUTS.tee.print). */
export const CROWD_PRINT_PLACE = { u: 0.06, v: 0.12, w: 0.25, h: 0.2 } as const;
/** The edition of the tee body k of a printed crowd wears is this plus k: none the people store gives out so soon. */
export const CROWD_EDITION = 0x40000000;
/** The first hash of the crowd's prints: print k is this plus k, in 16 hex digits, which the bench's server serves. */
export const CROWD_PRINT_FIRST = 0xc0de0000;
export const crowdPrintHash = (k: number): string => (CROWD_PRINT_FIRST + k).toString(16).padStart(16, "0");

/** The print each of `n` bodies wears, none but in a printed crowd: a picture of its own, every third twice as wide, turned a little. */
export function crowdPrints(n: number, looks: CrowdLooks): (EditionPrint | null)[] {
  return Array.from({ length: n }, (_, k) => {
    if (looks !== "printed") return null;
    const wide = k % 3 === 2;
    return { hash: crowdPrintHash(k), width: 512, height: wide ? 256 : 512, place: { ...CROWD_PRINT_PLACE, scale: 0.9, turn: ((k % 5) - 2) * 0.12 } };
  });
}

/** What the page's address asks: `?people=<scene>&looks=<looks>`, or null where it asks for no crowd. */
export function crowdAsked(get: (name: string) => string | null): { scene: CrowdScene; looks: CrowdLooks } | null {
  const scene = get("people") as CrowdScene, looks = (get("looks") ?? "shared") as CrowdLooks;
  return CROWD_SCENES.includes(scene) && CROWD_LOOKS.includes(looks) ? { scene, looks } : null;
}

/** The pose word of body `k`: three in four standing, the fourth walking in place, so some are posed every frame. */
export function crowdAnim(k: number): number {
  const st = new AnimState();
  st.speed = k % 4 === 3 ? 4 : 0;
  st.dir = 0;
  st.grounded = true;
  return st.pack();
}

/** The crowd itself: it wraps `session.sampleRemote`, and each sample then ends with its bodies. */
export class Crowd {
  readonly spots: Spot[];
  readonly looks: Uint8Array[];
  readonly gear: Uint16Array;
  readonly wardrobes: Uint32Array;
  /** 1 for each body that wears something in its wardrobe. */
  private readonly dressed: Uint8Array;
  readonly prints: (EditionPrint | null)[];
  private readonly human: number;
  private readonly ground: number[];
  private readonly anims: number[];

  constructor(session: { sampleRemote(out: RemoteSample, delayTicks?: number): void }, hf: Heightfield, reg: Registry, scene: CrowdScene, looks: CrowdLooks) {
    this.spots = crowdSpots(scene);
    const n = this.spots.length;
    this.looks = crowdLooks(n, looks);
    this.gear = crowdGear(n, looks, reg);
    this.wardrobes = crowdWardrobes(n, looks, reg);
    this.dressed = Uint8Array.from({ length: n }, (_, k) => (this.wardrobes.subarray(k * WORN_LENGTH, (k + 1) * WORN_LENGTH).some((v) => v !== 0) ? 1 : 0));
    this.prints = crowdPrints(n, looks);
    this.human = reg.index.get("core:survivor") ?? 0;
    this.ground = this.spots.map((s) => Math.max(hf.heightAt(s.x, s.z), hf.waterAt(s.x, s.z)));
    this.anims = this.spots.map((_, k) => crowdAnim(k));
    const sample = session.sampleRemote.bind(session);
    session.sampleRemote = (out, delayTicks) => {
      sample(out, delayTicks);
      this.add(out);
    };
  }

  /** The print of edition `edition` of a printed crowd's tee, or undefined for an edition not the crowd's. */
  printOf(edition: number): EditionPrint | null | undefined {
    const k = edition - CROWD_EDITION;
    return k >= 0 && k < this.prints.length ? this.prints[k] : undefined;
  }

  private add(out: RemoteSample): void {
    for (let k = 0; k < this.spots.length && out.count < MAX_VIEW; k++) {
      const to = out.count++, s = this.spots[k]!;
      [out.id[to], out.gen[to], out.kind[to], out.flags[to], out.level[to], out.name[to]] = [CROWD_ID + k, 0, this.human, F_ALIVE | F_GROUNDED, 1, ""];
      [out.x[to], out.y[to], out.z[to], out.yaw[to]] = [s.x, this.ground[k]!, s.z, s.yaw];
      [out.anim[to], out.cue[to], out.emote[to], out.react[to], out.stride[to], out.on[to]] = [this.anims[k]!, 0, 0, 0, 0, 0];
      out.colors.fill(0, to * 6, to * 6 + 6);
      out.hasLook[to] = 1;
      out.look.set(this.looks[k]!.subarray(0, LOOK_BYTES), to * LOOK_BYTES);
      out.gear.set(this.gear.subarray(k * GEAR_COUNT, (k + 1) * GEAR_COUNT), to * GEAR_COUNT);
      out.wardrobe.set(this.wardrobes.subarray(k * WORN_LENGTH, (k + 1) * WORN_LENGTH), to * WORN_LENGTH);
      out.hasWardrobe[to] = this.dressed[k]!;
      out.team[to] = out.seat[to] = out.seatSlot[to] = out.seatGen[to] = out.span[to] = out.grown[to] = 0;
      if (out.bare[to] === 0) noVehicle(out, to);
      out.bare[to] = 1;
    }
  }
}
