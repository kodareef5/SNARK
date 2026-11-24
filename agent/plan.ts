// The grunt protocol's build helper for SNARK (grunt/protocol.md "Building"), worked with a player's own place
// command. A plan's pieces sit on a grid of foundation cells; each is resolved to what a builder would aim at (a slot
// that the tribe's pieces offer, or open ground) by the pose the game itself gives the slot (shared/world/lattice/place.ts
// slotsNear), so no table of places is written here and a base turned any way is joined as it stands. A whole plan is
// checked before anything is sent, on a scratch copy of the structure store, with the server's own checks in the
// server's order (as client/core/build.ts previews a piece): terrain, room, enemies, support.
//
// Frames: the protocol's x grows east and z south; SNARK's x grows west and z north. A base's grid is its first
// foundation: cell 0, 0 is that foundation, turned by quarters (its yaw), so a base is found again from any session.

import type { ClientSession } from "../client/core/session.ts";
import { RISE, SPAN } from "../content/building.ts";
import type { Building, FormSpec, Plan, PlanPiece, PieceVerdict, Side } from "../grunt/protocol.ts";
import { STRUCT_UNITS, YAW_UNITS } from "../shared/coords.ts";
import { LIFT_MAX, LIFT_MIN, ROLE_CEILING, ROLE_DOOR, ROLE_FOUNDATION, ROLE_PILLAR, ROLE_STAIRS, ROLE_THING, ROLE_WALL, freePose, restPose, tooHigh, type Pose } from "../shared/world/snap.ts";
import { RESULT_OBSTRUCTED } from "../shared/net/protocol.ts";
import { poseOf, type LatticeKey, type LatticePose } from "../shared/world/lattice/frames.ts";
import { makeCandidates, makeVerdict, slotsNear, startBase, validate, validateFree, type Site } from "../shared/world/lattice/place.ts";
import { Found, StructureStore } from "../shared/world/structures.ts";
import { Support } from "../shared/world/support.ts";
import { shortName } from "./observe.ts";

const QUARTER = YAW_UNITS / 4;
const OUT: Record<Side, [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
/** How near a predicted pose must come to where the grid wants a piece, metres. */
const NEAR = 0.3;
/** The server refuses a foundation of another tribe's within this, and a pillar within the second (server/build.ts). */
const ENEMY_FOUNDATION = 50, ENEMY_PILLAR = 10;

/** The quarter turn nearest a yaw. */
function quarters(yaw: number): number {
  return Math.round(yaw / QUARTER) & 3;
}

/** What is left of a yaw past its nearest quarter turn, in radians. */
function past(yaw: number): number {
  return ((yaw - Math.round(yaw / QUARTER) * QUARTER) / YAW_UNITS) * Math.PI * 2;
}

/**
 * (dx, dz) on a grid turned `yaw`: by its nearest quarter turn, each taking (dx, dz) to (-dz, dx), and then by what is
 * left of the yaw along the base's own axes, so a cell of the grid is a square of the base however it stands.
 */
function turned(dx: number, dz: number, yaw: number): [number, number] {
  for (let t = 0; t < quarters(yaw); t++) [dx, dz] = [-dz, dx];
  const a = past(yaw);
  return a === 0 ? [dx, dz] : [dx * Math.cos(a) + dz * Math.sin(a), dz * Math.cos(a) - dx * Math.sin(a)];
}

/** `turned` the other way. */
function unturned(dx: number, dz: number, yaw: number): [number, number] {
  const a = past(yaw);
  if (a !== 0) [dx, dz] = [dx * Math.cos(a) - dz * Math.sin(a), dz * Math.cos(a) + dx * Math.sin(a)];
  for (let t = 0; t < (4 - quarters(yaw)) % 4; t++) [dx, dz] = [-dz, dx];
  return [dx, dz];
}

/** A form's class of place, from the role its structure has (grunt's FormSpec.place). */
function placeOf(role: number, doorway: boolean): FormSpec["place"] {
  if (role === ROLE_FOUNDATION || role === ROLE_CEILING) return "floor";
  if (role === ROLE_WALL) return "edge";
  if (role === ROLE_PILLAR) return "corner";
  if (role === ROLE_DOOR) return "in_frame";
  if (role === ROLE_STAIRS) return "centre";
  if (role === ROLE_THING) return "thing";
  return doorway ? "edge" : "edge";
}

/** Where a plan lies on SNARK's ground: cell 0, 0's middle, its turn, the height of its floor's top. */
export interface Frame {
  x: number;
  z: number;
  /** The quarter turn nearest its yaw, for the protocol, and the yaw itself: a base stands at any. */
  turns: number;
  yaw: number;
  /** The first foundation's middle, metres: the base's height. NaN until known. */
  y: number;
  /** The base's first foundation, once it stands. */
  base: number;
  /** Cells the grid is moved by on a base found by a point on its grid. */
  off: [number, number];
}

/** How a piece goes on: in a slot of a base, on top of a floor, or on open ground. */
export interface Resolution {
  kind: number;
  variant: number;
  item: string;
  form: string;
  how: "slot" | "top" | "ground";
  /** On top: the floor. */
  target: number;
  /** In a slot: its base's frame and its key, the piece's turn in it. */
  fr: number;
  k0: number;
  k1: number;
  /** Open ground: steps of an eighth of a metre. */
  lift: number;
  pose: Pose;
}

export interface Verdict {
  status: PieceVerdict;
  by?: string;
  fix?: string;
}

export class Planner {
  readonly session: ClientSession;
  private readonly found = new Found();
  private readonly pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  private readonly made: LatticePose = { x: 0, y: 0, z: 0, yaw: 0, tw: 0 };
  private readonly slots = makeCandidates();
  private readonly verdict = makeVerdict();

  constructor(session: ClientSession) {
    this.session = session;
  }

  private get reg() {
    return this.session.registry;
  }

  private get team(): number {
    return this.session.tribe.team;
  }

  private heightAt = (x: number, z: number): number => this.session.world!.hf.heightAt(x, z);

  /** What the shared slot rules read of `store`. Bodies, enemies and support are judged here, as `judge` orders them. */
  private site(store: StructureStore): Site {
    return { structs: store, tables: this.reg, heightAt: this.heightAt };
  }

  // --- What the game builds ----------------------------------------------------------------------------------------

  /** The building capability, from the game's content: every piece item's forms by tier, each form's class of place. */
  building(): Building {
    const reg = this.reg;
    const tiers: Building["tiers"] = {};
    const forms = new Map<string, FormSpec>();
    const things: string[] = [];
    for (let item = 1; item < reg.ids.length; item++) {
      const places = reg.places[item];
      if (!places || places.length === 0) continue;
      const id = shortName(reg.ids[item]);
      for (const kind of places) {
        const role = reg.role[kind]!;
        if (role === ROLE_THING) {
          if (!things.includes(id)) things.push(id);
          continue;
        }
        const m = /^(.*)_([a-z]+)$/.exec(shortName(reg.ids[kind]));
        if (!m) continue;
        const [, form, tier] = m as unknown as [string, string, string];
        (tiers[tier] ??= {})[form] = id;
        if (!forms.has(form)) {
          const place = placeOf(role, reg.doorway[kind] === 1);
          forms.set(form, { form, place, ...(role === ROLE_FOUNDATION ? { ground: true } : {}), ...(role === ROLE_DOOR ? { frame: "doorframe" } : {}) });
        }
      }
    }
    // Things set down on a floor (boxes, beds, fires): one form, the item says which.
    if (things.length) forms.set("thing", { form: "thing", place: "thing" });
    return { cell: SPAN, storey: RISE, reach: 10, rate: 2, max_pieces: 120, tiers, forms: [...forms.values()], pickup_s: 30, things };
  }

  /** The structure kind a plan piece is, and its place among its item's forms: null if the game has no such. */
  kindOf(p: PlanPiece): { kind: number; variant: number } | null {
    const reg = this.reg;
    const item = reg.index.get(`core:${p.item}`);
    const places = item === undefined ? undefined : reg.places[item];
    if (!places) return null;
    if (p.form === "thing" || places.length === 1) return { kind: places[0]!, variant: 0 };
    const v = places.findIndex((k) => shortName(reg.ids[k]).startsWith(`${p.form}_`));
    return v < 0 ? null : { kind: places[v]!, variant: v };
  }

  // --- The grid ----------------------------------------------------------------------------------------------------

  /** SNARK's x and z of a point on the grid: `dx`, `dz` metres east and south of cell 0, 0's middle, turned. */
  at(f: Frame, dx: number, dz: number): [number, number] {
    dx += f.off[0] * SPAN;
    dz += f.off[1] * SPAN;
    [dx, dz] = turned(dx, dz, f.yaw);
    // The protocol's east and south are SNARK's -x and -z.
    return [f.x - dx, f.z - dz];
  }

  /** A side of the grid as a direction in SNARK's ground. */
  dir(f: Frame, side: Side): [number, number] {
    const [dx, dz] = turned(OUT[side][0], OUT[side][1], f.yaw);
    return [-dx, -dz];
  }

  /** The frame of a plan's anchor: a point (joined to one of the tribe's bases if it lies on one's grid), or a base. */
  frame(plan: Plan): Frame | string {
    const s = this.session, world = s.world!;
    if ("base" in plan.anchor) {
      const ref = this.foundationOf(String(plan.anchor.base));
      const row = ref < 0 ? null : this.row(world.structs, ref);
      if (!row) return `${plan.anchor.base} is not a piece of a base`;
      return { x: row.x, z: row.z, y: row.y, turns: quarters(row.yaw), yaw: row.yaw, base: ref, off: [0, 0] };
    }
    const turns = (((plan.anchor.turns ?? 0) % 4) + 4) % 4;
    const [x, z] = [-plan.anchor.at[0], -plan.anchor.at[1]];
    // A point on the grid of one of the tribe's bases near: the plan joins it, as a builder's pieces snap to what stands.
    const n = world.structs.query(x - 40, z - 40, x + 40, z + 40, this.found);
    for (let i = 0; i < n; i++) {
      const ref = this.found.refs[i]!;
      const r = this.row(world.structs, ref)!;
      if (this.reg.role[r.kind] !== ROLE_FOUNDATION || r.owner !== this.team || this.team === 0 || quarters(r.yaw) !== turns) continue;
      // The point in the base's cells: back through its turn.
      const [dx, dz] = unturned(-(x - r.x), -(z - r.z), r.yaw);
      const [ci, cj] = [dx / SPAN, dz / SPAN];
      if (Math.abs(ci - Math.round(ci)) < 0.1 && Math.abs(cj - Math.round(cj)) < 0.1) return { x: r.x, z: r.z, y: r.y, turns, yaw: r.yaw, base: ref, off: [Math.round(ci), Math.round(cj)] };
    }
    return { x, z, y: NaN, turns, yaw: turns * QUARTER, base: -1, off: [0, 0] };
  }

  /** The foundation a base is known by, from its id or any piece of it (a door, a wall, a box set down): the piece
   * itself if a foundation, else the nearest foundation of the same owner's under or beside it. -1 if none. */
  foundationOf(id: string): number {
    const store = this.session.world!.structs;
    const ref = Number(String(id).replace(/^s/, ""));
    const r = Number.isInteger(ref) ? this.row(store, ref) : null;
    if (!r) return -1;
    if (this.reg.role[r.kind] === ROLE_FOUNDATION) return ref;
    const n = store.query(r.x - 8, r.z - 8, r.x + 8, r.z + 8, this.found);
    let best = -1, bestD = Infinity;
    for (const f of this.found.refs.slice(0, n)) {
      const q = this.row(store, f);
      if (!q || q.owner !== r.owner || this.reg.role[q.kind] !== ROLE_FOUNDATION) continue;
      const d = Math.hypot(q.x - r.x, q.z - r.z);
      if (d < bestD) (bestD = d), (best = f);
    }
    return best;
  }

  private row(store: StructureStore, ref: number) {
    const t = store.chunks[Math.floor(ref / 65536)];
    const slot = ref & 0xffff;
    if (!t || slot >= t.high || t.kind[slot] === 0) return null;
    return { kind: t.kind[slot]!, x: t.x[slot]!, y: t.y[slot]!, z: t.z[slot]!, yaw: t.yaw[slot]!, owner: t.owner[slot]!, hp: t.hp[slot]! };
  }

  /** Where the grid wants a piece: its middle on the ground (SNARK's x, z), its height above the base's foundation. */
  private expected(f: Frame, p: PlanPiece, place: FormSpec["place"]): { x: number; z: number; up: number } {
    let dx = p.cell[0] * SPAN, dz = p.cell[1] * SPAN;
    const side = p.side ?? p.half;
    if ((place === "edge" || place === "edge_top" || place === "in_frame") && side) (dx += (OUT[side][0] * SPAN) / 2), (dz += (OUT[side][1] * SPAN) / 2);
    if (p.half && place === "floor") (dx += (OUT[p.half][0] * SPAN) * 0.62), (dz += (OUT[p.half][1] * SPAN) * 0.62);
    if (place === "corner") (dx -= SPAN / 2), (dz -= SPAN / 2);
    if (place === "thing" && p.spot && p.spot !== "c") (dx += OUT[p.spot][0] * 0.9), (dz += OUT[p.spot][1] * 0.9);
    const [x, z] = this.at(f, dx, dz);
    // Heights above the foundation's middle: a storey a wall high; a ceiling roofs its storey.
    const storey = p.level * RISE;
    const up = p.form === "foundation" ? 0 : place === "floor" ? storey + RISE : place === "thing" ? storey + 0.6 : storey + RISE / 2;
    return { x, z, up };
  }

  /** A base's standing pieces as a plan's pieces on its grid (the inverse of `expected`): the tribe's pieces joined to
   * its first foundation, each with its id and health; and the grid, in the protocol's frame. */
  survey(base: string): { pieces: (PlanPiece & { id: string; health: number })[]; base: string; frame: { at: [number, number]; turns: number } } | null {
    const reg = this.reg, store = this.session.world!.structs;
    const ref0 = this.foundationOf(base);
    const r0 = ref0 < 0 ? null : this.row(store, ref0);
    if (!r0) return null;
    const f: Frame = { x: r0.x, z: r0.z, y: r0.y, turns: quarters(r0.yaw), yaw: r0.yaw, base: ref0, off: [0, 0] };
    // The base: the tribe's pieces reached from its foundation, piece to piece within a cell.
    const seen = new Set([ref0]), todo = [ref0];
    while (todo.length) {
      const r = this.row(store, todo.pop()!)!;
      const n = store.query(r.x - SPAN * 1.2, r.z - SPAN * 1.2, r.x + SPAN * 1.2, r.z + SPAN * 1.2, this.found);
      for (const ref of this.found.refs.slice(0, n)) {
        const q = this.row(store, ref);
        if (seen.has(ref) || !q || q.owner !== r0.owner || Math.hypot(q.x - r.x, q.z - r.z) > SPAN * 1.2) continue;
        seen.add(ref);
        todo.push(ref);
      }
    }
    // Back from SNARK's ground to the grid: metres east and south of cell 0, 0, unturned.
    const unturn = (x: number, z: number): [number, number] => {
      return unturned(f.x - x, f.z - z, f.yaw);
    };
    const sideOf = (dx: number, dz: number): Side => {
      const best = (Object.entries(OUT) as [Side, [number, number]][]).sort((a, b) => b[1][0] * dx + b[1][1] * dz - (a[1][0] * dx + a[1][1] * dz))[0]!;
      return best[0];
    };
    const itemOf = (kind: number): string | null => {
      for (let item = 1; item < reg.ids.length; item++) if (reg.places[item]?.includes(kind)) return shortName(reg.ids[item]);
      return null;
    };
    const rows = [...seen].map((ref) => ({ ref, ...this.row(store, ref)! }));
    const floors = new Set<string>();
    const out: (PlanPiece & { id: string; health: number })[] = [];
    // Floors first, so an edge is told on a cell that has one.
    rows.sort((a, b) => Number(reg.role[b.kind] === ROLE_FOUNDATION || reg.role[b.kind] === ROLE_CEILING) - Number(reg.role[a.kind] === ROLE_FOUNDATION || reg.role[a.kind] === ROLE_CEILING));
    for (const r of rows) {
      const role = reg.role[r.kind]!, item = itemOf(r.kind);
      if (!item) continue;
      const name = shortName(reg.ids[r.kind]);
      const form = role === ROLE_THING ? "thing" : (/^(.*)_[a-z]+$/.exec(name)?.[1] ?? name);
      const place = role === ROLE_THING ? "thing" : placeOf(role, reg.doorway[r.kind] === 1);
      const [dx, dz] = unturn(r.x, r.z);
      const up = r.y - f.y;
      const piece: PlanPiece & { id: string; health: number } = { form, item, cell: [0, 0], level: 0, id: `s${r.ref}`, health: Math.max(0, r.hp) / (reg.maxHp[r.kind] || 1) };
      if (place === "floor") {
        piece.cell = [Math.round(dx / SPAN), Math.round(dz / SPAN)];
        piece.level = role === ROLE_FOUNDATION ? 0 : Math.max(0, Math.round((up - RISE) / RISE));
        floors.add(`${piece.cell[0]},${piece.cell[1]},${role === ROLE_FOUNDATION ? 0 : piece.level + 1}`);
      } else if (place === "corner") {
        piece.cell = [Math.round((dx + SPAN / 2) / SPAN), Math.round((dz + SPAN / 2) / SPAN)];
        piece.level = Math.max(0, Math.round((up - RISE / 2) / RISE));
      } else if (place === "edge" || place === "edge_top" || place === "in_frame") {
        piece.level = Math.max(0, Math.round((up - RISE / 2) / RISE));
        const [fx, fz] = [dx / SPAN, dz / SPAN];
        // Along x between two cells (an east or west side) or along z (north or south): the cell with a floor.
        const ew = Math.abs(fx - Math.round(fx)) > Math.abs(fz - Math.round(fz));
        const [a, b]: [[number, number], [number, number]] = ew ? [[Math.floor(fx), Math.round(fz)], [Math.floor(fx) + 1, Math.round(fz)]] : [[Math.round(fx), Math.floor(fz)], [Math.round(fx), Math.floor(fz) + 1]];
        const hasB = floors.has(`${b[0]},${b[1]},${piece.level}`) && !floors.has(`${a[0]},${a[1]},${piece.level}`);
        piece.cell = hasB ? b : a;
        piece.side = hasB ? (ew ? "w" : "n") : ew ? "e" : "s";
      } else {
        piece.cell = [Math.round(dx / SPAN), Math.round(dz / SPAN)];
        piece.level = Math.max(0, Math.round((up - (place === "thing" ? 0.6 : RISE / 2)) / RISE));
        if (place === "centre") {
          // Stairs climb along their +Z: SNARK's (sin, cos) of the yaw, the protocol's the other way, unturned.
          const a = (r.yaw / YAW_UNITS) * Math.PI * 2;
          const [ux, uz] = unturn(f.x + Math.sin(a), f.z + Math.cos(a));
          piece.up = sideOf(ux, uz);
        }
        if (place === "thing") {
          const [rx, rz] = [dx - piece.cell[0] * SPAN, dz - piece.cell[1] * SPAN];
          if (Math.hypot(rx, rz) > 0.45) piece.spot = sideOf(rx, rz);
        }
      }
      out.push(piece);
    }
    return { pieces: out, base: `s${ref0}`, frame: { at: [-f.x, -f.z], turns: f.turns } };
  }

  // --- One piece ---------------------------------------------------------------------------------------------------

  /** How `p` goes on in `store`: the slot the tribe's pieces offer whose pose is where the grid wants it, else (a
   * foundation, a pillar on the ground, a thing) open ground or a floor's top. */
  resolve(store: StructureStore, f: Frame, p: PlanPiece, spec: FormSpec): Resolution | null {
    const reg = this.reg;
    const k = this.kindOf(p);
    if (!k) return null;
    const role = reg.role[k.kind]!;
    const e = this.expected(f, p, spec.place);
    const ey = Number.isNaN(f.y) ? NaN : f.y + e.up;
    const base = { kind: k.kind, variant: k.variant, item: p.item, form: p.form, lift: 0, target: -1, fr: 0, k0: 0, k1: 0 };
    // A thing: on top of the floor under the spot (or on the ground).
    if (role === ROLE_THING) {
      const floor = this.floorUnder(store, e.x, e.z, ey);
      const yaw = f.yaw & (YAW_UNITS - 1);
      if (floor >= 0 && restPose(store, reg, floor, k.kind, e.x, e.z, yaw, this.pose)) return { ...base, how: "top", target: floor, pose: { ...this.pose } };
      if (!freePose(this.heightAt, reg, k.kind, e.x, e.z, yaw, 0, this.pose)) return null;
      return { ...base, how: "ground", pose: { ...this.pose } };
    }
    // Every slot the tribe's pieces offer near, at every turn: the pose nearest where the grid wants it.
    let best: Resolution | null = null, bestScore = Infinity;
    const want = p.up ? this.dir(f, p.up) : null;
    // A wall faces out of the cell it is told on: its own +Z along that side.
    const out = !want && spec.place !== "floor" && p.side ? this.dir(f, p.side) : null;
    const forms = reg.forms;
    const turns = forms.turns[k.kind] ?? 1;
    const slots = this.slots;
    const n = slotsNear(this.site(store), k.kind, this.team, e.x, Number.isNaN(ey) ? this.heightAt(e.x, e.z) + RISE / 2 : ey, e.z, slots);
    for (let s = 0; s < n; s++) {
      const frame = store.frames.get(slots.fr[s]!)!;
      for (let t = 0; t < turns; t++) {
        const k1 = (slots.k1[s]! | (t << 26)) >>> 0;
        poseOf(frame, slots.k0[s]!, k1, forms, k.kind, this.made);
        const px = this.made.x / STRUCT_UNITS, py = this.made.y / STRUCT_UNITS, pz = this.made.z / STRUCT_UNITS;
        const d = Math.hypot(px - e.x, pz - e.z);
        if (d > NEAR) continue;
        if (!Number.isNaN(ey) && Math.abs(py - ey) > 1.3) continue;
        let score = d + (Number.isNaN(ey) ? 0 : Math.abs(py - ey) * 0.2);
        // Stairs climb toward the side asked: their +Z (sin, cos of the yaw) along it.
        const a = (this.made.yaw / YAW_UNITS) * Math.PI * 2;
        if (want) score += (1 - (Math.sin(a) * want[0] + Math.cos(a) * want[1])) * 2;
        else if (out) score += (1 - (Math.sin(a) * out[0] + Math.cos(a) * out[1])) * 0.01;
        if (score < bestScore) (bestScore = score), (best = { ...base, how: "slot", fr: slots.fr[s]!, k0: slots.k0[s]!, k1, pose: { x: this.made.x, y: this.made.y, z: this.made.z, yaw: this.made.yaw } });
      }
    }
    if (best) return best;
    // Nothing to join: on the ground, if it stands there by itself (and is the ground storey).
    if ((role === ROLE_FOUNDATION || role === ROLE_PILLAR) && p.level === 0) {
      const yaw = f.yaw & (YAW_UNITS - 1);
      const lift = role === ROLE_FOUNDATION && !Number.isNaN(f.y) ? this.liftFor(e.x, e.z, k.kind, yaw, f.y) : 0;
      if (!freePose(this.heightAt, reg, k.kind, e.x, e.z, yaw, lift, this.pose)) return null;
      return { ...base, lift, how: "ground", pose: { ...this.pose } };
    }
    return null;
  }

  /** The lift (eighths of a metre) that brings a free foundation's middle nearest `y`. */
  private liftFor(x: number, z: number, kind: number, yaw: number, y: number): number {
    freePose(this.heightAt, this.reg, kind, x, z, yaw, 0, this.pose);
    const steps = Math.round((y - this.pose.y / STRUCT_UNITS) * 8);
    return Math.max(LIFT_MIN, Math.min(LIFT_MAX, steps));
  }

  /** The tribe's floor (a foundation or a ceiling) whose top is under (x, z) at about height y. */
  private floorUnder(store: StructureStore, x: number, z: number, y: number): number {
    const n = store.query(x - 0.1, z - 0.1, x + 0.1, z + 0.1, this.found);
    let best = -1, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const ref = this.found.refs[i]!;
      const r = this.row(store, ref)!;
      const role = this.reg.role[r.kind];
      if (role !== ROLE_FOUNDATION && role !== ROLE_CEILING) continue;
      const d = Number.isNaN(y) ? -r.y : Math.abs(r.y - y);
      if (d < bestD) (bestD = d), (best = ref);
    }
    return best;
  }

  /** A piece of the same kind already where the grid wants it, as the store has it. */
  private standing(store: StructureStore, kind: number, pose: Pose): number {
    const x = pose.x / STRUCT_UNITS, y = pose.y / STRUCT_UNITS, z = pose.z / STRUCT_UNITS;
    const n = store.query(x - 0.3, z - 0.3, x + 0.3, z + 0.3, this.found);
    for (let i = 0; i < n; i++) {
      const r = this.row(store, this.found.refs[i]!)!;
      if (r.kind === kind && Math.hypot(r.x - x, r.z - z) < 0.3 && Math.abs(r.y - y) < 0.5) return this.found.refs[i]!;
    }
    return -1;
  }

  /** Another piece in the same place (a wall where a doorframe is wanted): what a builder sees as taken. */
  private taking(store: StructureStore, kind: number, pose: Pose): number {
    const reg = this.reg, role = reg.role[kind];
    const x = pose.x / STRUCT_UNITS, y = pose.y / STRUCT_UNITS, z = pose.z / STRUCT_UNITS;
    const n = store.query(x - 0.3, z - 0.3, x + 0.3, z + 0.3, this.found);
    for (let i = 0; i < n; i++) {
      const r = this.row(store, this.found.refs[i]!)!;
      if (r.kind !== kind && reg.role[r.kind] === role && Math.hypot(r.x - x, r.z - z) < 0.3 && Math.abs(r.y - y) < 0.5) return this.found.refs[i]!;
    }
    return -1;
  }

  /**
   * A piece's verdict in `store`, as the server would judge it placed now, in the server's order: its place, the
   * ground, room (structures, then bodies), enemies near, support. Bodies and enemies are judged from what this client
   * has been sent, as a builder's preview judges them.
   */
  judge(store: StructureStore, f: Frame, p: PlanPiece, spec: FormSpec | undefined, support: Support): { verdict: Verdict; res: Resolution | null } {
    const reg = this.reg;
    if (!spec) return { verdict: { status: "not_in_game", fix: `this game has no ${p.form} yet` }, res: null };
    const k = this.kindOf(p);
    if (!k) return { verdict: { status: "not_in_tier", by: p.item, fix: `${p.item} does not place a ${p.form}` }, res: null };
    const res = this.resolve(store, f, p, spec);
    if (!res) return { verdict: { status: "no_support", fix: "nothing it joins stands yet: build what holds it first" }, res: null };
    const pose = res.pose;
    const already = this.standing(store, res.kind, pose);
    if (already >= 0) return { verdict: { status: "built", by: `s${already}` }, res };
    const other = this.taking(store, res.kind, pose);
    if (other >= 0) return { verdict: { status: "occupied", by: `s${other}`, fix: "another piece is there: replace swaps it" }, res };
    if (tooHigh(this.heightAt, reg, res.kind, pose)) return { verdict: { status: "too_high", fix: "the ground falls away there: another site, or stand it on pillars" }, res };
    const x = pose.x / STRUCT_UNITS, y = pose.y / STRUCT_UNITS, z = pose.z / STRUCT_UNITS;
    // A piece that joins is asked by its slot, as the server asks it: its neighbours are not in its way.
    const joined = res.how === "slot";
    const taken = (joined ? validate(this.site(store), res.kind, this.team, res.fr, res.k0, res.k1, x, y, z, this.verdict) : validateFree(this.site(store), res.kind, pose, x, y, z, this.verdict)) === RESULT_OBSTRUCTED;
    if (taken) return { verdict: { status: "blocked", by: this.nearestRow(store, x, z), fix: "something built is in the way" }, res };
    const body = this.bodyIn(res.kind, x, y, z);
    if (body) return { verdict: { status: "blocked", by: body, fix: body === "you" ? "step out of its way" : "wait for it to move" }, res };
    const enemy = this.enemyNear(res.kind, x, z);
    if (enemy) return { verdict: { status: "enemy_near", by: enemy, fix: "another tribe builds near: build farther off" }, res };
    if (!(joined ? support.standsAt(res.kind, res.fr, res.k0, res.k1) : support.stands(res.kind, pose.x, pose.y, pose.z))) return { verdict: { status: "no_support", fix: "nothing holds it up: a wall or pillar near, or a floor under it" }, res };
    return { verdict: { status: "ok" }, res };
  }

  private nearestRow(store: StructureStore, x: number, z: number): string {
    const n = store.query(x - 2, z - 2, x + 2, z + 2, this.found);
    let best = -1, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const r = this.row(store, this.found.refs[i]!)!;
      const d = Math.hypot(r.x - x, r.z - z);
      if (d < bestD) (bestD = d), (best = this.found.refs[i]!);
    }
    return best >= 0 ? `s${best}` : "a structure";
  }

  /** A body in the piece's room: the character's own, or one of those it has been sent. */
  private bodyIn(kind: number, x: number, y: number, z: number): string | null {
    const reg = this.reg, s = this.session;
    const hx = Math.max(reg.halfX[kind]!, reg.halfZ[kind]!) + 0.4, hy = reg.halfY[kind]! + 0.9;
    const inside = (bx: number, by: number, bz: number) => Math.abs(bx - x) < hx && Math.abs(bz - z) < hx && Math.abs(by + 0.9 - y) < hy;
    // A piece set in a frame or on a floor never has a body in its way that matters to it here.
    const role = reg.role[kind];
    if (role === ROLE_DOOR || role === ROLE_CEILING) return null;
    if (inside(s.own.x, s.own.y, s.own.z)) return "you";
    return null;
  }

  /** Another tribe's foundation (or pillar) near enough that the server refuses a foundation here. */
  private enemyNear(kind: number, x: number, z: number): string | null {
    const reg = this.reg;
    if (reg.role[kind] !== ROLE_FOUNDATION && reg.role[kind] !== ROLE_PILLAR) return null;
    const live = this.session.world!.structs;
    const n = live.query(x - ENEMY_FOUNDATION, z - ENEMY_FOUNDATION, x + ENEMY_FOUNDATION, z + ENEMY_FOUNDATION, this.found);
    for (let i = 0; i < n; i++) {
      const r = this.row(live, this.found.refs[i]!)!;
      if (r.owner === this.team || r.owner === 0) continue;
      const d = Math.hypot(r.x - x, r.z - z);
      const role = reg.role[r.kind];
      if ((role === ROLE_FOUNDATION && d < ENEMY_FOUNDATION) || (role === ROLE_PILLAR && d < ENEMY_PILLAR)) return `s${this.found.refs[i]!}`;
    }
    return null;
  }

  // --- A whole plan ------------------------------------------------------------------------------------------------

  /** A copy of what stands about a plan's site, each base under its own number, to check a plan on without touching what the client holds. */
  scratch(f: Frame, pieces: PlanPiece[]): StructureStore {
    const s = this.session, world = s.world!, reg = this.reg;
    const store = new StructureStore(world.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
    let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of pieces) {
      const [x, z] = this.at(f, p.cell[0] * SPAN, p.cell[1] * SPAN);
      [x0, z0, x1, z1] = [Math.min(x0, x), Math.min(z0, z), Math.max(x1, x), Math.max(z1, z)];
    }
    const n = world.structs.query(x0 - 15, z0 - 15, x1 + 15, z1 + 15, this.found);
    const refs = this.found.refs.slice(0, n);
    const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };
    for (const ref of refs) {
      const r = this.row(world.structs, ref)!;
      if (!world.structs.keyAt(ref, key)) {
        store.add(r.kind, r.x, r.y, r.z, r.yaw, r.owner, r.hp);
        continue;
      }
      const from = world.structs.frames.get(key.fr)!;
      if (!store.frames.get(key.fr)) store.frames.make(from.ox, from.oy, from.oz, from.yaw, from.team, key.fr);
      store.place(r.kind, key.fr, key.k0, key.k1, r.owner, r.hp);
    }
    return store;
  }

  /**
   * Checks a whole plan: each piece judged in order as though the pieces before it that can go had gone. The first
   * foundation sets the base's height (open ground, levelled by lift toward the middle of the site's ground).
   */
  check(plan: Plan, specs: Map<string, FormSpec>): { verdicts: Verdict[]; frame: Frame | null; base: string | null } {
    const f = this.frame(plan);
    if (typeof f === "string") return { verdicts: plan.pieces.map(() => ({ status: "blocked" as const, fix: f })), frame: null, base: null };
    const store = this.scratch(f, plan.pieces);
    const support = new Support(store, this.reg, this.heightAt);
    const verdicts: Verdict[] = [];
    for (const p of plan.pieces) {
      const { verdict, res } = this.judge(store, f, p, specs.get(p.form), support);
      verdicts.push(verdict);
      // A piece that can go (or a builder standing in its way, who steps aside) stands for what follows.
      const goes = verdict.status === "ok" || (verdict.status === "blocked" && verdict.by === "you");
      if (res && goes) {
        const hp = this.reg.maxHp[res.kind] ?? 1;
        // As the server sets it down: in its slot, as a new base's first piece, or a thing by its pose.
        const ref = res.how === "slot" ? store.place(res.kind, res.fr, res.k0, res.k1, this.team, hp)
          : this.reg.forms.cls[res.kind]! >= 0 ? startBase(store, res.kind, res.pose, this.team, hp)
          : store.add(res.kind, res.pose.x / STRUCT_UNITS, res.pose.y / STRUCT_UNITS, res.pose.z / STRUCT_UNITS, res.pose.yaw, this.team, hp);
        if (Number.isNaN(f.y) && this.reg.role[res.kind] === ROLE_FOUNDATION) (f.y = res.pose.y / STRUCT_UNITS), (f.base = ref);
      } else if (res && verdict.status === "built" && Number.isNaN(f.y) && this.reg.role[res.kind] === ROLE_FOUNDATION) f.y = res.pose.y / STRUCT_UNITS;
    }
    return { verdicts, frame: f, base: f.base >= 0 && "base" in plan.anchor ? String(plan.anchor.base) : null };
  }
}
