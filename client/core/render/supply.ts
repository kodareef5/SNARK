// The supply capsule's pieces as they stand at a moment (planning/workstreams/supply.md): where each is in the
// capsule's own frame and how it is turned, as the rows of the one bone it is drawn with. The model
// (assets/source/core/structures/supply-capsule/model.py) and this file build to the same measurements
// (shared/world/supply-capsule.json): a leg about its hinge, a slat of a louvre about its axle, the hatch about its
// pin, the hoop about the capsule's axis, a collar for each step of the tier, the top-mark on the mast.
//
// Everything here is arithmetic on what a drop's pose gives (shared/sim/supply.ts): the scene asks for a piece's rows
// and draws it (scene.ts showSupply).

import profile from "../../../shared/world/supply-capsule.json" with { type: "json" };
import { MARKS } from "../../../shared/sim/supply.ts";

export const CAPSULE = profile;
/** The pieces by the name of their mesh, `core:supply_capsule/<name>`. */
export const PIECES = ["hull", "leg", "shutter", "hatch", "collar", "hoop", "lights", ...MARKS.map((m) => `mark_${m}`), "shaft", "sheath", "halo", "jet", "foot", ...MARKS.map((m) => `figure_${m}`)] as const;
/** Where each kind of piece is in PIECES. */
export const PIECE = { hull: 0, leg: 1, shutter: 2, hatch: 3, collar: 4, hoop: 5, lights: 6, mark: 7, shaft: 7 + MARKS.length, sheath: 8 + MARKS.length, halo: 9 + MARKS.length, jet: 10 + MARKS.length, foot: 11 + MARKS.length, figure: 12 + MARKS.length } as const;
/** Slats in the whole lantern, a bay to each pair of legs. */
export const SLATS = profile.legs * profile.lantern.slats;
/** Metres past which a capsule is not drawn: its shaft carries it. */
export const CAPSULE_REACH = 450;
/** Metres past which its louvres' slats are not drawn one by one. */
export const SLAT_REACH = 70;
/** Radians a second the hoop of a ringed drop turns. */
export const HOOP_RATE = 0.45;

// The shaft, which is modelled a metre in radius and SHAFT_HEIGHT tall and sized by its bone.
export const SHAFT_HEIGHT = 600;
/** Its radius at hand, in metres, and how many times wider a ringed drop's sheath is. */
export const SHAFT_RADIUS = 0.42;
export const SHEATH_WIDER = 2.7;
/** The fewest pixels wide it is drawn, however far off. */
export const SHAFT_PIXELS = 2;
/** The most shafts a frame draws, the nearest first as the server lists them. */
export const SHAFTS_MOST = 16;
/** Metres from the eye over which the farthest shafts fade out. */
export const SHAFT_FADE_FROM = 6000;
export const SHAFT_FADE_TO = 8000;
/** How much of a shaft the haze may take: it is a signal, and is never lost in it. */
export const SHAFT_HAZE = 0.56;
/** Metres up the shaft its class's figure of light stands, three metres tall; and how far under its head the same stands thirty metres tall. */
export const FIGURE_NEAR = 12;
export const FIGURE_UNDER_HEAD = 70;
export const FIGURE_FAR_SIZE = 10;
/** A ringed drop's halos: how many climb its shaft at once, metres a second, and the metres each climbs before it is gone. */
export const HALOS = 3;
export const HALO_RATE = 3.2;
export const HALO_CLIMB = 54;
/** Metres the glow at its foot reaches. */
export const FOOT_REACH = 6;

/** How wide a shaft is drawn `far` metres off, as a radius in metres: its own, or what SHAFT_PIXELS pixels are there. */
export function shaftRadius(far: number, fovY: number, pixelsTall: number, wider = 1): number {
  const floor = (far * fovY * SHAFT_PIXELS) / (2 * Math.max(1, pixelsTall));
  return Math.max(SHAFT_RADIUS * wider, floor * (wider > 1 ? 1.6 : 1));
}

/** How much of its light a shaft keeps `far` metres off, through haze that takes `fog` (0 to 1) of what is there. */
export function shaftKeeps(far: number, fog: number): number {
  const lost = Math.min(SHAFT_HAZE, fog * fog);
  return (1 - lost) * (1 - smooth((far - SHAFT_FADE_FROM) / (SHAFT_FADE_TO - SHAFT_FADE_FROM)));
}

/** How high halo `k` of a ringed drop is over its foot at `seconds`, and how strongly it shows: it comes up out of the foot and is gone before it would turn back. */
export function haloAt(seconds: number, k: number, out: { height: number; strength: number }): void {
  const t = (seconds * HALO_RATE + (k * HALO_CLIMB) / HALOS) % HALO_CLIMB;
  out.height = 2.5 + t;
  out.strength = smooth(t / 5) * (1 - smooth((t - HALO_CLIMB + 14) / 12));
}

/** Metres from the eye within which a flying capsule's trail is drawn as a piece of light wherever its streak is; and the most it is long. */
export const TRAIL_REACH = 1500;
export const TRAIL_MOST = 140;

/**
 * A piece of light whose own +Y lies along a unit way (dx, dy, dz) from where it is put, `long` times its modelled
 * length along it and `wide` times across: a jet's plume, which is modelled a metre down from its bell, turned to
 * trail behind a capsule.
 */
export function alongBone(out: Float32Array, at: number, x: number, y: number, z: number, dx: number, dy: number, dz: number, wide: number, long: number): void {
  // Right is level and square to the way; the third axis is the way crossed with it.
  let rx = dz;
  let rz = -dx;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-6) {
    rx = 1;
    rz = 0;
  } else {
    rx /= rl;
    rz /= rl;
  }
  out[at] = rx * wide;
  out[at + 1] = dx * long;
  out[at + 2] = -dy * rz * wide;
  out[at + 3] = x;
  out[at + 4] = 0;
  out[at + 5] = dy * long;
  out[at + 6] = (dx * rz - dz * rx) * wide;
  out[at + 7] = y;
  out[at + 8] = rz * wide;
  out[at + 9] = dz * long;
  out[at + 10] = dy * rx * wide;
  out[at + 11] = z;
}

/**
 * A piece of light that stands upright where it is put and is sized by its bone: `wide` times its modelled size
 * across and `tall` times up.
 */
export function uprightBone(out: Float32Array, at: number, x: number, y: number, z: number, wide: number, tall: number): void {
  out.fill(0, at, at + 12);
  out[at] = wide;
  out[at + 3] = x;
  out[at + 5] = tall;
  out[at + 7] = y;
  out[at + 10] = wide;
  out[at + 11] = z;
}

const TAU = 2 * Math.PI;
const smooth = (v: number): number => {
  const a = v < 0 ? 0 : v > 1 ? 1 : v;
  return a * a * (3 - 2 * a);
};

/** How a capsule stands: where its feet's middle is, how it is turned about its axis, and how far each of its moving parts has come. */
export interface CapsuleStance {
  x: number;
  y: number;
  z: number;
  /** Radians about its axis. */
  yaw: number;
  /** 0 folded up the drum to 1 splayed. */
  legs: number;
  /** 0 shut to 1 open, the slats opening one after another from the top. */
  shutters: number;
  /** 0 shut to 1 ajar. */
  hatch: number;
  /** Radians the hoop has turned. */
  hoop: number;
}

/**
 * Writes the rows of a bone at `at` of `out`: a piece whose own axes are X, Y and Z and whose origin is `o`, all in the
 * capsule's frame, as the capsule stands.
 */
function place(out: Float32Array, at: number, s: CapsuleStance, ox: number, oy: number, oz: number, xx: number, xy: number, xz: number, yx: number, yy: number, yz: number, zx: number, zy: number, zz: number): void {
  // The capsule's turn takes its own +X to (cos, 0, -sin) and its +Z to (sin, 0, cos).
  const c = Math.cos(s.yaw);
  const n = Math.sin(s.yaw);
  out[at] = xx * c + xz * n;
  out[at + 1] = yx * c + yz * n;
  out[at + 2] = zx * c + zz * n;
  out[at + 3] = s.x + ox * c + oz * n;
  out[at + 4] = xy;
  out[at + 5] = yy;
  out[at + 6] = zy;
  out[at + 7] = s.y + oy;
  out[at + 8] = -xx * n + xz * c;
  out[at + 9] = -yx * n + yz * c;
  out[at + 10] = -zx * n + zz * c;
  out[at + 11] = s.z - ox * n + oz * c;
}

/** A piece that stands as the capsule does, `up` metres over its feet: the hull, the lights, a collar, the top-mark. */
export function fixedBone(out: Float32Array, at: number, s: CapsuleStance, up = 0): void {
  place(out, at, s, 0, up, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1);
}

/** Collar `k`, counted from the lowest. */
export function collarBone(out: Float32Array, at: number, s: CapsuleStance, k: number): void {
  fixedBone(out, at, s, profile.collar.first + k * profile.collar.pitch);
}

/** The top-mark, on the mast's head. */
export function markBone(out: Float32Array, at: number, s: CapsuleStance): void {
  fixedBone(out, at, s, profile.mast.head);
}

/** Leg `k`: about its hinge on the lower belt, from folded up the drum to splayed. */
export function legBone(out: Float32Array, at: number, s: CapsuleStance, k: number): void {
  const t = (TAU * k) / profile.legs;
  const rx = Math.cos(t);
  const rz = Math.sin(t);
  const fold = (1 - smooth(s.legs)) * profile.legFolded;
  const c = Math.cos(fold);
  const n = Math.sin(fold);
  // Its own +X is out from the drum and its +Z along the belt; folding turns +X up.
  place(out, at, s, profile.hinge[0]! * rx, profile.hinge[1]!, profile.hinge[0]! * rz, c * rx, n, c * rz, -n * rx, c, -n * rz, -rz, 0, rx);
}

/** How far slat `j` of bay `k` has opened when the lantern is `shutters` open: the top row first, a bay after a bay. */
export function slatOpen(shutters: number, k: number, j: number): number {
  const order = (j * profile.legs + k) / (SLATS - 1);
  return smooth(shutters * 2.2 - 1.2 * order);
}

/** Slat `j` of bay `k`, counted from the top: about its axle, its foot swinging out as it opens. */
export function slatBone(out: Float32Array, at: number, s: CapsuleStance, k: number, j: number): void {
  const t = (TAU * (k + 0.5)) / profile.legs;
  const nx = Math.cos(t);
  const nz = Math.sin(t);
  const lantern = profile.lantern;
  const reach = (lantern.radius - 0.02) * Math.cos(Math.PI / profile.legs) + lantern.slatProud;
  const tilt = slatOpen(s.shutters, k, j) * lantern.slatOpen;
  const c = Math.cos(tilt);
  const n = Math.sin(tilt);
  // Its own +X is along the bay, +Y up and +Z out of it.
  place(out, at, s, reach * nx, lantern.slatTop - j * lantern.slatPitch, reach * nz, nz, 0, -nx, -n * nx, c, -n * nz, c * nx, n, c * nz);
}

/** The hatch: about the pin at its edge, its free edge swinging out. */
export function hatchBone(out: Float32Array, at: number, s: CapsuleStance): void {
  const h = profile.hatch;
  const pin = h.azimuth - h.half;
  const a = smooth(s.hatch) * h.ajar;
  const c = Math.cos(a);
  const n = Math.sin(a);
  place(out, at, s, h.radius * Math.cos(pin), 0, h.radius * Math.sin(pin), c, 0, -n, 0, 1, 0, n, 0, c);
}

/** The hoop of a ringed drop: turned about the capsule's axis. */
export function hoopBone(out: Float32Array, at: number, s: CapsuleStance): void {
  const c = Math.cos(s.hoop);
  const n = Math.sin(s.hoop);
  place(out, at, s, 0, 0, 0, c, 0, -n, 0, 1, 0, n, 0, c);
}
