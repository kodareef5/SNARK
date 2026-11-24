// What a city piece throws as it breaks, and how each thing thrown moves. A set is the rigid groups one break throws:
// what leaves a piece on its way into a form, what stood of a form, or both. A group's pose is a closed form of the
// break, the group's seed and the time since the server's tick, so every client draws it alike and none keeps a state.
// These are pictures: nothing here collides or is read by the simulation.

import { coreFaces, leavesOf, paintOf, skinOf } from "../../content/breaks/leaves.ts";
import { FORM_BREACH_A, FORM_BREACH_B, FORM_HEAP, FORM_HUNG, FORM_OPEN, FORM_WHOLE, formKind } from "../../shared/content/breaks.ts";
import type { ShapeBox } from "../../shared/content/defs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { STRUCT_UNITS, YAW_UNITS } from "../../shared/coords.ts";
import { WRECK, formOf, variantAt } from "../../shared/world/breaking.ts";
import { hullPoint } from "../../shared/world/convex.ts";
import { GONE_BLAST, GONE_FELL } from "../../shared/world/structures.ts";

type Corner = readonly [number, number, number];

/** One convex solid of a set, in its piece's own frame. */
export interface SetChunk {
  readonly corners: readonly Corner[];
  /** A palette colour of its own, or 0 for the piece's finish. */
  readonly color: number;
  /** Its faces that show the bared core, a bit a face in the order hullOf gives its rings. */
  readonly core: number;
}

export interface BreakSet {
  /** Its form kind and which of SET_LEAVES, SET_STOOD and SET_ALL it is: `kind * 4 + which`. */
  readonly key: number;
  /** Its rigid groups, each its chunks. MOST_GROUPS at most. */
  readonly groups: readonly (readonly SetChunk[])[];
  /** The box round each group and then round the whole set: its centre and half extents, six numbers each. */
  readonly boxes: Float32Array;
  /**
   * The set a piece of this one is drawn as where it is drawn as one thing: the same of its form's first variant, since
   * from where that is done one cut looks like another. What leaves alone is its own, as a hole is where its cut put it.
   */
  readonly lump: BreakSet;
}

/** What leaves a piece on its way into a form; what stood of a form; both. */
export const SET_LEAVES = 0, SET_STOOD = 1, SET_ALL = 2;
/** The most groups a set has, each a bone of a piece drawn in fragments. */
export const MOST_GROUPS = 12;
/** The most groups what stood is thrown as: alone, and beside what leaves. */
const STOOD_ALONE = 4, STOOD_BESIDE = 3;
/** The form a piece that goes whole or breached is thrown as: the first of these it has. */
const THROWN_AS = [FORM_OPEN, FORM_HUNG, FORM_BREACH_B, FORM_BREACH_A];
/** Sets kept. Past it they are all let go: a piece falling keeps its own, and one is made again from content alike. */
const MOST_SETS = 512;

function boxChunk(b: ShapeBox): SetChunk {
  const corners: Corner[] = [];
  for (let k = 0; k < 8; k++) corners.push([b.at[0] + (k & 1 ? 1 : -1) * b.half[0], b.at[1] + (k & 2 ? 1 : -1) * b.half[1], b.at[2] + (k & 4 ? 1 : -1) * b.half[2]]);
  return { corners, color: b.color ?? 0, core: 0 };
}

/** The box round `chunks` into `out` at `at`: centre, then half extents. */
function boxInto(chunks: readonly SetChunk[], out: Float32Array | number[], at: number): void {
  for (let a = 0; a < 3; a++) {
    let lo = Infinity, hi = -Infinity;
    for (const c of chunks) for (const p of c.corners) {
      if (p[a]! < lo) lo = p[a]!;
      if (p[a]! > hi) hi = p[a]!;
    }
    out[at + a] = (lo + hi) / 2;
    out[at + 3 + a] = (hi - lo) / 2;
  }
}

/** `groups` with the smallest joined into its nearest neighbour until there are `most`. */
function joined(groups: SetChunk[][], most: number): SetChunk[][] {
  const out = groups.filter((g) => g.length > 0);
  const box: number[] = [];
  while (out.length > Math.max(1, most)) {
    out.forEach((g, i) => boxInto(g, box, i * 6));
    let small = 0, least = Infinity;
    for (let i = 0; i < out.length; i++) {
      const v = box[i * 6 + 3]! * box[i * 6 + 4]! * box[i * 6 + 5]!;
      if (v < least) { least = v; small = i; }
    }
    let near = -1, nearest = Infinity;
    for (let i = 0; i < out.length; i++) {
      if (i === small) continue;
      const d = Math.hypot(box[i * 6]! - box[small * 6]!, box[i * 6 + 1]! - box[small * 6 + 1]!, box[i * 6 + 2]! - box[small * 6 + 2]!);
      if (d < nearest) { nearest = d; near = i; }
    }
    out[near]!.push(...out[small]!);
    out.splice(small, 1);
  }
  return out;
}

/** The break sets of a registry's form kinds, each made from content when first asked for. */
export class BreakSets {
  private readonly reg: Registry;
  private readonly known = new Map<number, BreakSet | null>();

  constructor(reg: Registry) {
    this.reg = reg;
  }

  /** The set `which` of form kind `kind`, or null where it would be empty. */
  of(kind: number, which: number): BreakSet | null {
    const key = kind * 4 + which;
    let set = this.known.get(key);
    if (set !== undefined) return set;
    const leaves = which === SET_STOOD ? [] : joined(this.leaves(kind), MOST_GROUPS - (which === SET_ALL ? STOOD_BESIDE : 0));
    const stood = which === SET_LEAVES ? [] : joined(this.stood(kind).map((c) => [c]), which === SET_ALL ? Math.min(STOOD_BESIDE, MOST_GROUPS - leaves.length) : STOOD_ALONE);
    const groups = [...leaves, ...stood];
    if (this.known.size >= MOST_SETS) this.known.clear();
    if (groups.length === 0) {
      this.known.set(key, null);
      return null;
    }
    const boxes = new Float32Array((groups.length + 1) * 6);
    groups.forEach((g, i) => boxInto(g, boxes, i * 6));
    boxInto(groups.flat(), boxes, groups.length * 6);
    const made: { key: number; groups: SetChunk[][]; boxes: Float32Array; lump: BreakSet | null } = { key, groups, boxes, lump: null };
    this.known.set(key, made as BreakSet);
    const first = which === SET_LEAVES ? kind : formKind(this.reg, kind, this.reg.breakForm[kind]!, 0);
    made.lump = (first !== kind && first !== 0 ? this.of(first, which) : null) ?? (made as BreakSet);
    return made as BreakSet;
  }

  /**
   * What a city piece throws as its slot is emptied or takes its heap: `kind` is what it was as it went, `map` what the
   * map placed, at (x, y, z). A piece whole or breached throws what its open form sheds and what stood of that; one
   * already opened, what stood of it. Null for a piece with no forms, which falls whole, and for a wreck, whose lesser
   * looks are meshes of its own and no cuts of it.
   */
  rubble(kind: number, map: number, x: number, y: number, z: number): BreakSet | null {
    const reg = this.reg;
    if (map === 0 || reg.breakSet[map] === 0 || reg.breakSet[kind] !== reg.breakSet[map] || reg.breakFamily[map] === WRECK) return null;
    const form = formOf(reg, kind);
    if (form !== FORM_WHOLE && form !== FORM_BREACH_A && form !== FORM_BREACH_B) return this.of(kind, SET_STOOD);
    const variant = variantAt(x, y, z);
    for (const to of THROWN_AS) {
      const into = formKind(reg, map, to, variant);
      if (into !== 0) return this.of(into, SET_ALL);
    }
    // A heap is a row of its own, so only what left on the way to it is thrown.
    const heap = formKind(reg, map, FORM_HEAP, variant);
    return heap !== 0 ? this.of(heap, SET_LEAVES) : null;
  }

  /** What a city piece throws as its row turns from `was` into form `kind` in place, or null where nothing leaves: a wreck's rung throws nothing. */
  swap(was: number, kind: number): BreakSet | null {
    const reg = this.reg;
    if (reg.breakSet[was] === 0 || reg.breakSet[was] !== reg.breakSet[kind] || reg.breakFamily[was] === WRECK) return null;
    const from = formOf(reg, was), to = formOf(reg, kind);
    if (to === FORM_WHOLE || to === from) return null;
    const breached = from === FORM_BREACH_A || from === FORM_BREACH_B;
    if (from !== FORM_WHOLE && !(breached && (to === FORM_OPEN || to === FORM_HUNG))) return null;
    return this.of(kind, SET_LEAVES);
  }

  /** The things that leave a piece on its way into form kind `kind`, each its chunks. */
  private leaves(kind: number): SetChunk[][] {
    const left = leavesOf(this.reg, kind);
    const skin = skinOf(this.reg.breakShape[kind] ?? "");
    return (left?.things ?? []).map((thing) => thing.map((c): SetChunk => ({ corners: c.corners, color: c.color ?? 0, core: skin ? coreFaces(c, skin) : 0 })));
  }

  /** What is drawn of form kind `kind` standing, a chunk a part: its shape's look, or its solid parts where it has none. */
  private stood(kind: number): SetChunk[] {
    const reg = this.reg, def = reg.defs[kind];
    const shape = def?.type === "structure" && def.shape !== undefined ? reg.defs[reg.index.get(def.shape) ?? 0] : undefined;
    if (shape?.type !== "shape") return [];
    const boxes = shape.look ? (shape.look.boxes ?? []) : shape.boxes;
    const hulls = shape.look ? (shape.look.hulls ?? []) : (shape.hulls ?? []);
    const paint = shape.look ? paintOf(reg, kind) : null;
    return [...boxes.map(boxChunk), ...hulls.map((h, i): SetChunk => ({ corners: h.corners.map((c): Corner => hullPoint(c, h.sixty === true)), color: paint?.color[i] ?? 0, core: paint?.core[i] ?? 0 }))];
  }
}

/** A break as a group's pose is worked out from it. */
export interface Broken {
  /** GONE_DESTROYED, GONE_FELL or GONE_BLAST. */
  cause: number;
  /** The piece's place, and its turn in yaw units. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Where the break began: a blast's centre, where support was lost, or the piece's own place. */
  ox: number;
  oy: number;
  oz: number;
  /** A blast's reach in metres. */
  radius: number;
  /** Seconds after the tick at which the piece lets go: its place in a fall's front. */
  wait: number;
  /** The floor under the piece's place as it broke. */
  under: number;
  set: BreakSet;
}

/** Metres per second squared. */
export const GRAVITY = 9.81;
/** The share of its speed a thing keeps on its one bounce, and the most it leaves the floor at. */
const RESTITUTION = 0.25, MOST_REBOUND = 2.5;
/** Seconds a thing slides after its bounce, and the share of its speed and spin it keeps from its first landing on. */
export const SLIDE = 0.3;
const KEPT = 0.5;
/** A blast's throw at its centre in metres a second, and the least share of it at its edge. */
const BLAST_SPEED = 6, BLAST_LEAST = 0.15;
/** The fastest a thing turns, in radians a second, and the fastest its corners go round its middle, in metres a second. */
const MOST_SPIN = 9, CORNER_SPEED = 10;
/** A fallen slab's drift away from where the fall began, in metres a second. */
const DRIFT = 0.9;
/** A piece this many times taller than it is thick tips over; and only while the floor is this near under its foot. */
const TALL = 1.5, STANDS = 0.3;
/** The angle at which a tipping piece lets go of its base edge. */
const LETS_GO = Math.PI / 3;
/** The side of a falling slab nearest where the fall began lingers this long, in seconds: from the first, as far as both. */
const LINGER = 0.08, LINGER_MORE = 0.07;
/** A pose's numbers: twelve of a 3 by 4 matrix by rows, the group's middle, when it rests, and the height of its lowest point. */
export const POSE = { centre: 12, settled: 15, low: 16, length: 17 } as const;

/** A group's seed: the piece's place on the structures' lattice and the group's number. */
export function fragmentSeed(x: number, y: number, z: number, group: number): number {
  let h = Math.imul(Math.round(x * STRUCT_UNITS) | 0, 0x9e3779b1);
  h = Math.imul(h ^ (Math.round(y * STRUCT_UNITS) | 0), 0x85ebca6b);
  h = Math.imul(h ^ (Math.round(z * STRUCT_UNITS) | 0), 0xc2b2ae35);
  return Math.imul(h ^ (group + 1), 0x27d4eb2f) >>> 0;
}

/** The `k`th number from 0 up to 1 of a seed. */
function rand(seed: number, k: number): number {
  let h = (seed + Math.imul(k + 1, 0x9e3779b9)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Where group `g` of a break's set is `t` seconds after the server's tick, into `out` (POSE): the matrix that takes a
 * point of the piece's own frame to the world, the group's middle, the time by which it rests and its lowest height.
 * Group `set.groups.length` is the whole set as one thing. `floor` is the height of what is solid under where the
 * group lands, which never counts as higher than the group's own underside as it broke.
 *
 * A blast throws it outward and a little up, slower the farther from the centre. A piece destroyed crumbles down and
 * a little out. A fallen wall or column tips about its base edge away from where the fall began and comes apart past
 * LETS_GO; a fallen slab drops, the side nearest the beginning last. Each then lands, bounces once, slides and rests
 * on a face of its box.
 */
export function fragmentPose(e: Broken, g: number, floor: number, t: number, out: Float64Array): void {
  const boxes = e.set.boxes, n = e.set.groups.length, b = g * 6, w = n * 6;
  const cx = boxes[b]!, cy = boxes[b + 1]!, cz = boxes[b + 2]!, hx = boxes[b + 3]!, hy = boxes[b + 4]!, hz = boxes[b + 5]!;
  const turn = (e.yaw / YAW_UNITS) * 2 * Math.PI, cosYaw = Math.cos(turn), sinYaw = Math.sin(turn);
  const x0 = e.x + cosYaw * cx + sinYaw * cz, y0 = e.y + cy, z0 = e.z - sinYaw * cx + cosYaw * cz;
  const under = Math.min(floor, y0 - hy);
  const seed = fragmentSeed(e.x, e.y, e.z, g), shared = fragmentSeed(e.x, e.y, e.z, -1);
  // The whole set's box, and the way from where the break began to this group, level.
  const wcx = boxes[w]!, wcy = boxes[w + 1]!, wcz = boxes[w + 2]!, whx = boxes[w + 3]!, why = boxes[w + 4]!, whz = boxes[w + 5]!;
  let ax = x0 - e.ox, az = z0 - e.oz;
  const flat = Math.hypot(ax, az);
  if (flat < 0.05) {
    const any = rand(seed, 0) * 2 * Math.PI;
    ax = Math.cos(any);
    az = Math.sin(any);
  } else {
    ax /= flat;
    az /= flat;
  }
  // How far along the piece's own level axes that way lies: its +X is (cosYaw, -sinYaw) in the world, its +Z (sinYaw, cosYaw).
  const alongX = ax * cosYaw - az * sinYaw, alongZ = ax * sinYaw + az * cosYaw;
  const fell = e.cause === GONE_FELL, blast = e.cause === GONE_BLAST;
  const tips = fell && why > TALL * Math.min(whx, whz) && e.y + wcy - why - e.under < STANDS;

  // It turns about one of the piece's level axes, its +X where `aboutX` and else its +Z, the top going over by `sign` of the other.
  let aboutX: boolean, sign: number, start = e.wait, lets = 0, from = 0, total = 0, sway = 0, twist = 0;
  let xr = x0, zr = z0, vx = 0, vz = 0, high = y0 - hy - under, rise = 0;
  // A tipping piece: its pivot, and the group's middle from it along the pivot, toward the fall and up.
  let px = 0, py = 0, pz = 0, dx = 0, dz = 0, beside = 0, behind = 0, over = 0;
  if (tips) {
    aboutX = whz <= whx;
    const cwx = e.x + cosYaw * wcx + sinYaw * wcz, cwz = e.z - sinYaw * wcx + cosYaw * wcz;
    const tx = aboutX ? sinYaw : cosYaw, tz = aboutX ? cosYaw : -sinYaw;
    const away = (cwx - e.ox) * tx + (cwz - e.oz) * tz;
    sign = Math.abs(away) < 0.05 ? (rand(shared, 1) < 0.5 ? -1 : 1) : away < 0 ? -1 : 1;
    dx = tx * sign;
    dz = tz * sign;
    const thick = aboutX ? whz : whx;
    px = cwx + dx * thick;
    py = e.y + wcy - why;
    pz = cwz + dz * thick;
    beside = (x0 - px) * dz - (z0 - pz) * dx;
    behind = (x0 - px) * dx + (z0 - pz) * dz;
    over = y0 - py;
    lets = Math.min(1.5, Math.max(0.4, 0.45 * Math.sqrt(2 * why)));
    from = LETS_GO;
    total = Math.PI / 2;
    twist = (rand(seed, 2) - 0.5) * 0.4;
    // As it lets go: where its middle is, how fast it moves, and how high and how fast its lowest point is over the floor.
    const rate = (2 * LETS_GO) / lets, c = Math.cos(LETS_GO), s = Math.sin(LETS_GO), across = aboutX ? hz : hx;
    const along = behind * c + over * s, up = over * c - behind * s;
    xr = px + beside * dz + dx * along;
    zr = pz - beside * dx + dz * along;
    const speed = (over * c - behind * s) * rate;
    vx = dx * speed;
    vz = dz * speed;
    const support = s * across + c * hy;
    high = Math.max(0, py + up - under - support);
    rise = (-over * s - behind * c) * rate - (c * across - s * hy) * rate;
  } else {
    // It comes to rest on its largest face: thinnest up needs no quarter turn, any other an odd number of them.
    const thin = hy <= hx && hy <= hz ? 1 : hz <= hx ? 2 : 0;
    aboutX = thin === 2 || (thin === 1 && Math.abs(alongX) < Math.abs(alongZ));
    const roll = aboutX ? alongZ : alongX;
    sign = Math.abs(roll) < 0.05 ? (rand(seed, 1) < 0.5 ? -1 : 1) : roll < 0 ? -1 : 1;
    let quarters = thin === 1 ? 0 : 1, speed = 0, spread = 0;
    // A large thing is thrown less far and turns less.
    const light = Math.min(1, Math.max(0.3, 1.2 / (0.6 + Math.hypot(hx, hy, hz))));
    if (blast) {
      const far = Math.hypot(x0 - e.ox, y0 - e.oy, z0 - e.oz);
      const near = Math.min(1, Math.max(BLAST_LEAST, 1 - far / Math.max(e.radius, 1)));
      speed = BLAST_SPEED * near * light * (0.6 + 0.8 * rand(seed, 3));
      spread = (rand(seed, 4) - 0.5) * 0.9;
      rise = Math.min(3.5, Math.max(0, (1 + 2.2 * rand(seed, 5) + 1.5 * Math.min(1, Math.max(-0.5, (y0 - e.oy) / Math.max(far, 0.5)))) * near * light));
      quarters += 2 * Math.min(2, Math.floor(rand(seed, 6) * (1 + 2 * near) * light));
      twist = (rand(seed, 2) - 0.5) * 3 * light;
    } else if (fell) {
      // The side of the piece nearest where the fall began lets go last.
      const reach = Math.hypot(whx, whz);
      const mid = Math.hypot(e.x + cosYaw * wcx + sinYaw * wcz - e.ox, e.z - sinYaw * wcx + cosYaw * wcz - e.oz);
      const nearness = g === n || reach < 0.01 ? 0.5 : Math.min(1, Math.max(0, (mid + reach - flat) / (2 * reach)));
      start += (LINGER + LINGER_MORE * rand(shared, 0)) * nearness;
      speed = DRIFT * (0.4 + 0.8 * rand(seed, 3));
      sway = (rand(seed, 5) - 0.5) * 0.5 * light;
      twist = (rand(seed, 2) - 0.5) * 0.4 * light;
    } else {
      // A wall crumbles out of its own plane, to the side away from where it was struck.
      const wall = why > Math.min(whx, whz) && Math.min(whx, whz) < 0.5 * Math.max(whx, whz);
      if (wall) {
        const off = whz <= whx ? alongZ : alongX;
        const side = Math.abs(off) < 0.2 ? (rand(shared, 1) < 0.5 ? -1 : 1) : off < 0 ? -1 : 1;
        ax = (whz <= whx ? sinYaw : cosYaw) * side;
        az = (whz <= whx ? cosYaw : -sinYaw) * side;
      }
      speed = 0.5 + 1.2 * rand(seed, 3);
      spread = (rand(seed, 4) - 0.5) * 1.2;
      sway = (rand(seed, 5) - 0.5) * 0.7 * light;
      twist = (rand(seed, 2) - 0.5) * 0.8 * light;
    }
    const c = Math.cos(spread), s = Math.sin(spread);
    vx = (ax * c - az * s) * speed;
    vz = (ax * s + az * c) * speed;
    total = (quarters * Math.PI) / 2;
  }
  const across = aboutX ? hz : hx;

  // After it lets go: it lands at `lands`, bounces until `down`, slides until `still`. `run` is time as its travel
  // counts it: whole in the air, a share of it from the first landing on, none once it lies.
  const hit = Math.sqrt(rise * rise + 2 * GRAVITY * high);
  const lands = (rise + hit) / GRAVITY;
  const rebound = Math.min(hit * RESTITUTION, MOST_REBOUND);
  const down = lands + (2 * rebound) / GRAVITY, still = down + SLIDE;
  const whole = lands + KEPT * (down - lands) + (KEPT * SLIDE) / 2;
  // It turns for as long as it travels, and longer where that would whip its corners round: a slab on the floor rolls over slowly.
  const most = Math.min(MOST_SPIN, CORNER_SPEED / Math.max(0.15, Math.hypot(hx, hy, hz)));
  const turns = Math.max(still, (2 * (Math.abs(total - from) + Math.PI * Math.abs(sway) + Math.abs(twist))) / most);
  const settled = start + lets + turns;

  const since = t - start;
  let x = x0, y = y0, z = z0, angle = 0, yawed = 0;
  if (since <= 0) {
    // As it stood.
  } else if (since < lets) {
    const share = since / lets;
    angle = from * share * share;
    const c = Math.cos(angle), s = Math.sin(angle);
    const along = behind * c + over * s;
    x = px + beside * dz + dx * along;
    z = pz - beside * dx + dz * along;
    y = Math.max(py + over * c - behind * s, under + s * across + c * hy);
  } else {
    const u = Math.min(since - lets, still);
    const slid = u - down;
    const run = u < lands ? u : u < down ? lands + KEPT * (u - lands) : whole - (KEPT * (SLIDE - slid) * (SLIDE - slid)) / (2 * SLIDE);
    const left = 1 - Math.min(since - lets, turns) / turns, share = 1 - left * left;
    angle = from + (total - from) * share + sway * Math.sin(Math.PI * share);
    yawed = twist * share;
    x = xr + vx * run;
    z = zr + vz * run;
    const air = u < lands ? high + rise * u - 0.5 * GRAVITY * u * u : u < down ? rebound * (u - lands) - 0.5 * GRAVITY * (u - lands) * (u - lands) : 0;
    y = under + Math.abs(Math.sin(angle)) * across + Math.abs(Math.cos(angle)) * hy + Math.max(0, air);
  }

  out[POSE.centre] = x;
  out[POSE.centre + 1] = y;
  out[POSE.centre + 2] = z;
  out[POSE.settled] = settled;
  if (since <= 0) {
    out[0] = cosYaw; out[1] = 0; out[2] = sinYaw; out[3] = e.x;
    out[4] = 0; out[5] = 1; out[6] = 0; out[7] = e.y;
    out[8] = -sinYaw; out[9] = 0; out[10] = cosYaw; out[11] = e.z;
    out[POSE.low] = y0 - hy;
    return;
  }
  // The piece's own yaw, then the turn about a level axis, the top going over the way it rolls, then the twist about the upright.
  const nx = (aboutX ? cosYaw : -sinYaw) * sign, nz = (aboutX ? -sinYaw : -cosYaw) * sign;
  const c = Math.cos(angle), s = Math.sin(angle), k = 1 - c;
  const r00 = c + k * nx * nx, r02 = k * nx * nz, r22 = c + k * nz * nz;
  const r01 = -s * nz, r10 = s * nz, r12 = -s * nx, r21 = s * nx;
  const a00 = r00 * cosYaw - r02 * sinYaw, a02 = r00 * sinYaw + r02 * cosYaw;
  const a10 = r10 * cosYaw - r12 * sinYaw, a12 = r10 * sinYaw + r12 * cosYaw;
  const a20 = r02 * cosYaw - r22 * sinYaw, a22 = r02 * sinYaw + r22 * cosYaw;
  const ct = Math.cos(yawed), st = Math.sin(yawed);
  out[0] = ct * a00 + st * a20; out[1] = ct * r01 + st * r21; out[2] = ct * a02 + st * a22;
  out[4] = a10; out[5] = c; out[6] = a12;
  out[8] = ct * a20 - st * a00; out[9] = ct * r21 - st * r01; out[10] = ct * a22 - st * a02;
  out[3] = x - (out[0]! * cx + out[1]! * cy + out[2]! * cz);
  out[7] = y - (out[4]! * cx + out[5]! * cy + out[6]! * cz);
  out[11] = z - (out[8]! * cx + out[9]! * cy + out[10]! * cz);
  out[POSE.low] = y - (Math.abs(out[4]!) * hx + Math.abs(out[5]!) * hy + Math.abs(out[6]!) * hz);
}

/** Shrinks a pose to `share` of its size about the point of the floor under its middle. */
export function shrinkPose(pose: Float64Array, share: number): void {
  for (let i = 0; i < 12; i++) pose[i]! *= share;
  pose[3]! += pose[POSE.centre]! * (1 - share);
  pose[7]! += pose[POSE.low]! * (1 - share);
  pose[11]! += pose[POSE.centre + 2]! * (1 - share);
}
