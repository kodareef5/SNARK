// The server's side of bodies blocking one another (shared/sim/blockers.ts). Once a tick, before anything steps, every
// body that may block is put in a grid where it stands, which is where this tick's snapshots will carry it. A walker
// stepping then meets the nearest of them, each rounded as the snapshot rounds it (Replication.viewAround), so that a
// client predicting its own walk meets them in the same places (client/core/session.ts).
//
// What blocks: a grown body of a species, standing in the world, not held, sitting, knocked out or dead, and not of the
// walker's own tribe (tribemates and their tames pass through one another). A body that moves pushes softly.
// A young body neither blocks nor is blocked: the stadium is a grown body's, far past where a hatchling stands.

import { CUE_DEAD, CUE_HELD, CUE_OUT } from "../shared/anim/pose.ts";
import { dequantX, dequantY, quantX, quantY, type SentView } from "../shared/net/view.ts";
import { BLOCK_LIGHT, BLOCK_MOST, Blockers, blockMass, pairing } from "../shared/sim/blockers.ts";
import { F_ALIVE, F_HELD, F_PROP } from "../shared/sim/entities.ts";
import { BodyGrid } from "./bodies.ts";
import { TICK_DT } from "../shared/coords.ts";
import type { ServerWorld } from "./world.ts";

const TAU = Math.PI * 2;
/** Appearances kept a body, newest first, and bodies kept before the record starts again. */
const LOOKS_KEPT = 4;
const LOOKS_MOST = 65536;
/** Metres: the side of a cell of the grid bodies are found in. */
const BLOCK_CELL = 1;

/** Whether body `j` blocks a walker of team `team`, as the snapshot shows it: the client's rule too. */
export function blocks(world: ServerWorld, j: number, team: number): boolean {
  const ents = world.ents, reg = world.reg;
  if ((ents.flags[j]! & (F_ALIVE | F_PROP | F_HELD)) !== F_ALIVE) return false;
  if (!(reg.footRadius[ents.kind[j]!]! > 0) || reg.vehicle[ents.kind[j]!]) return false;
  if (ents.seat[j] !== 0 || ents.grown[j] !== 0 || (ents.cue[j]! & (CUE_OUT | CUE_HELD | CUE_DEAD)) !== 0) return false;
  return team === 0 || ents.team[j] !== team;
}

export class BodyBlocking {
  private readonly world: ServerWorld;
  private readonly grid: BodyGrid;
  readonly list = new Blockers();
  /** SurvivorsBlock is off: survivors pass through one another. The host sets it from the rules each tick. */
  survivorsPass = false;
  /** The widest a body reaches from where it stands, so a search padded by it finds every one that may touch. */
  private readonly reach: number;
  /** For each kind, the most its stadium reaches from where it stands; 0 for one that never blocks. */
  private readonly reachOf: Float64Array;
  /** For each kind, metres it may cover in a tick: twice its sprint, for levels and buffs. */
  private readonly strideOf: Float64Array;
  /** 1 for a survivor's kind: a body a client predicts. */
  private readonly survivor: Uint8Array;
  /** Diagnostics: walkers that met a body, and bodies met. */
  readonly stats = { walkers: 0, met: 0 };

  constructor(world: ServerWorld) {
    this.world = world;
    // Cells a metre across: in a pack, a walker reads little more than the cells its own stadium and its neighbours' reach.
    this.grid = new BodyGrid(world.dims, BLOCK_CELL);
    const reg = world.reg;
    let reach = 0;
    this.reachOf = new Float64Array(reg.footRadius.length);
    this.strideOf = Float64Array.from(reg.move, (m) => (m ? 2 * m.walkSpeed * m.sprintMul * TICK_DT + 0.05 : 1));
    for (let k = 0; k < reg.footRadius.length; k++) {
      const r = reg.footRadius[k]!;
      if (!(r > 0)) continue;
      reach = Math.max(reach, Math.abs(reg.footBack[k]!), Math.abs(reg.footFront[k]!), r);
      // The segment's ends as stadium() makes them, and the radius about them.
      let s0 = reg.footBack[k]! + r, s1 = reg.footFront[k]! - r;
      if (s0 > s1) s0 = s1 = (s0 + s1) / 2;
      if (!reg.vehicle[k]) this.reachOf[k] = Math.max(Math.abs(s0), Math.abs(s1)) + r;
    }
    this.reach = reach;
    this.survivor = Uint8Array.from(reg.defs, (d) => (d?.type === "species" && d.class === "survivor" ? 1 : 0));
  }

  /** Starts a tick: the bodies of `list` (the awake creatures and the sessions' bodies) where they stand. */
  begin(lists: readonly (ArrayLike<number> & { readonly length: number })[], counts: readonly number[]): void {
    const grid = this.grid, ents = this.world.ents;
    grid.clear();
    if (this.looks.size > LOOKS_MOST) this.looks.clear();
    for (let l = 0; l < lists.length; l++) {
      const list = lists[l]!;
      for (let k = 0; k < counts[l]!; k++) {
        const j = list[k]!;
        if (j < 0 || (ents.flags[j]! & F_ALIVE) === 0) continue;
        this.remember(j);
        const reach = this.reachOf[ents.kind[j]!]!;
        if (reach > 0) grid.add(j, ents.x[j]!, ents.z[j]!, reach + this.strideOf[ents.kind[j]!]!);
      }
    }
  }

  /**
   * Keeps body `j`'s team, seat and growth by the appearance revision they were sent under (EntityStore.rev, which each
   * of them bumps), the last LOOKS_KEPT of them, so that a walker meets a body as the snapshot its client stepped with
   * showed it even while that body boards a car, joins a tribe or comes of age.
   */
  private remember(j: number): void {
    const ents = this.world.ents;
    let ring = this.looks.get(j);
    if (!ring || ring[1] !== ents.gen[j]) {
      ring = new Float64Array(2 + LOOKS_KEPT * 4).fill(-1);
      ring[1] = ents.gen[j]!;
      this.looks.set(j, ring);
    }
    const rev = ents.rev[j]!;
    if (ring[2] === rev && ring[3] === ents.team[j] && ring[4] === ents.seat[j] && ring[5] === ents.grown[j]) return;
    ring.copyWithin(6, 2, 2 + (LOOKS_KEPT - 1) * 4);
    ring[2] = rev; ring[3] = ents.team[j]!; ring[4] = ents.seat[j]!; ring[5] = ents.grown[j]!;
  }

  /** Body `id`'s team, seat and growth as it was sent at appearance revision `rev`, into `shown`; its present ones where not kept. */
  private shownAt(id: number, rev: number): void {
    const ents = this.world.ents, ring = this.looks.get(id), shown = this.shown;
    shown[0] = ents.team[id]!; shown[1] = ents.seat[id]!; shown[2] = ents.grown[id]!;
    if (!ring || ring[1] !== ents.gen[id]) return;
    for (let k = 0; k < LOOKS_KEPT; k++) {
      const at = 2 + k * 4;
      if (ring[at] !== rev) continue;
      shown[0] = ring[at + 1]!; shown[1] = ring[at + 2]!; shown[2] = ring[at + 3]!;
      return;
    }
  }
  private readonly looks = new Map<number, Float64Array>();
  /** `around`'s bodies that may touch, nearest first, and the square of each one's distance. */
  private near = new Int32Array(64);
  private nearFar = new Float64Array(64);
  private readonly shown = new Float64Array(3);

  /**
   * The bodies walker `e`, of team `team`, standing at (x, y, z) with radius `r`, may meet this tick; null where none. A
   * creature nobody drives (`creature`) meets every survivor and ridden mount as solid whatever it weighs: what a client
   * predicts is never pushed by what the server alone steps.
   */
  around(e: number, x: number, y: number, z: number, r: number, team: number, creature = false, skip = -1): Blockers | null {
    const world = this.world, ents = world.ents, grid = this.grid, list = this.list;
    list.clear();
    if (creature && ents.grown[e] !== 0) return null;
    // A body is met where the two stadiums, each as far as it reaches, come within a stride of the walker's. They were put
    // in the grid where they stood at the start of the tick, each with room for its own stride since.
    const own = Math.max(r, this.reachOf[ents.kind[e]!]!) + this.strideOf[ents.kind[e]!]!;
    const n = grid.touching(x, z, own);
    if (n === 0) return null;
    const found = grid.found, reachOf = this.reachOf;
    // Those that may touch. The list keeps the nearest BLOCK_MOST (ties by id), so they are offered nearest first and the
    // rest are passed over before their shapes are made.
    if (this.near.length < n) {
      this.near = new Int32Array(n * 2);
      this.nearFar = new Float64Array(n * 2);
    }
    const near = this.near, nearFar = this.nearFar, light = blockMass(world.reg, ents.kind[e]!) * BLOCK_LIGHT;
    let m = 0;
    for (let k = 0; k < n; k++) {
      const j = found[k]!;
      // Measured where it is, unrounded: the snapshot's rounding is a few millimetres, well inside the walker's stride.
      const dx = ents.x[j]! - x, dz = ents.z[j]! - z, reach = own + reachOf[ents.kind[j]!]!;
      const far = dx * dx + dz * dz;
      if (far > reach * reach) continue;
      if (j === e || j === skip || !blocks(world, j, team) || pairing(ents.emote[e]!, ents.emote[j]!)) continue;
      if (!creature && this.survivorsPass && this.survivor[ents.kind[j]!] === 1 && this.survivor[ents.kind[e]!] === 1) continue;
      const always = creature && (ents.driven[j] !== 0 || this.survivor[ents.kind[j]!] === 1);
      if (!always && blockMass(world.reg, ents.kind[j]!) < light) continue;
      near[m] = j;
      nearFar[m++] = far;
    }
    // The nearest left each time, until the list is full. A creature is pushed softly out of one it stands in; any other
    // walker passes it over, and it takes no place, so no more than twice the list's room are offered.
    const offers = Math.min(m, 2 * BLOCK_MOST);
    for (let k = 0; k < offers && list.count < BLOCK_MOST; k++) {
      let best = k;
      for (let i = k + 1; i < m; i++) if (nearFar[i]! < nearFar[best]! || (nearFar[i] === nearFar[best] && near[i]! < near[best]!)) best = i;
      const j = near[best]!;
      near[best] = near[k]!;
      nearFar[best] = nearFar[k]!;
      const always = creature && (ents.driven[j] !== 0 || this.survivor[ents.kind[j]!] === 1);
      // What a client predicts is solid to a creature even as it moves: the creature gives way to it at once.
      list.add(world.reg, j, ents.kind[j]!, dequantX(quantX(ents.x[j]!)), dequantY(quantY(ents.y[j]!)), dequantX(quantX(ents.z[j]!)), ((ents.yaw[j]! >>> 6) * TAU) / 1024, !always && (ents.anim[j]! & 15) !== 0, ents.kind[e]!, x, y, z, ents.yaw[e]!, always, creature);
    }
    return this.done();
  }

  /**
   * The bodies walker `e`, of team `team`, standing at (x, y, z) with radius `r`, meets as the snapshot `view` showed
   * them: the one its client had when it stepped this tick, so its prediction meets them where they were to the bit,
   * still or moving. Read as the client reads its own copy of that snapshot (client/core/session.ts gatherBlockers).
   */
  inView(e: number, view: SentView, x: number, y: number, z: number, r: number, team: number): Blockers | null {
    const world = this.world, ents = world.ents, reg = world.reg, list = this.list;
    list.clear();
    const far = this.reach + r + 1;
    for (let j = 0; j < view.count; j++) {
      const id = view.id[j]!, kind = view.kind[j]!;
      if (id === e || !(reg.footRadius[kind]! > 0) || reg.vehicle[kind] || (view.flags[j]! & (F_PROP >>> 1)) !== 0) continue;
      if ((view.cue[j]! & (CUE_OUT | CUE_HELD | CUE_DEAD)) !== 0 || ents.gen[id] !== view.gen[j]) continue;
      // Its seat, growth and tribe as that snapshot showed them, which its client judges by too.
      this.shownAt(id, view.rev[j]!);
      const shown = this.shown;
      if (shown[1] !== 0 || shown[2] !== 0 || (team !== 0 && shown[0] === team)) continue;
      if (this.survivorsPass && this.survivor[kind] === 1 && this.survivor[ents.kind[e]!] === 1) continue;
      const bx = dequantX(view.qx[j]!), bz = dequantX(view.qz[j]!);
      if (Math.abs(bx - x) > far || Math.abs(bz - z) > far) continue;
      list.add(reg, id, kind, bx, dequantY(view.qy[j]!), bz, (view.yaw[j]! * TAU) / 1024, (view.anim[j]! & 15) !== 0, ents.kind[e]!, x, y, z, ents.yaw[e]!);
    }
    return this.done();
  }

  private done(): Blockers | null {
    const list = this.list;
    if (list.count === 0) return null;
    this.stats.walkers++;
    this.stats.met += list.count;
    return list;
  }
}

