// The server's side of bodies blocking one another (shared/sim/blockers.ts). Once a tick, before anything steps, every
// body that may block is put in a grid where it stands, which is where this tick's snapshots will carry it. A walker
// stepping then meets the nearest of them, each rounded as the snapshot rounds it (GameServer.viewAround), so that a
// client predicting its own walk meets them in the same places (client/core/session.ts).
//
// What blocks: a grown body of a species, standing in the world, not held, sitting, knocked out or dead, and not of the
// walker's own tribe (tribemates and their tames pass through one another). A body that moves pushes softly.

import { CUE_DEAD, CUE_HELD, CUE_OUT } from "../shared/anim/pose.ts";
import { dequantX, dequantY, quantX, quantY, type SentView } from "../shared/net/view.ts";
import { Blockers, blocksSession, pairing } from "../shared/sim/blockers.ts";
import { F_ALIVE, F_HELD, F_PROP } from "../shared/sim/entities.ts";
import { BodyGrid } from "./bodies.ts";
import type { ServerWorld } from "./world.ts";

const TAU = Math.PI * 2;
/** Appearances kept a body, newest first, and bodies kept before the record starts again. */
const LOOKS_KEPT = 4;
const LOOKS_MOST = 65536;

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
  /** 1 for a survivor's kind: a body a client predicts. */
  private readonly survivor: Uint8Array;
  /** Diagnostics: walkers that met a body, and bodies met. */
  readonly stats = { walkers: 0, met: 0 };

  constructor(world: ServerWorld) {
    this.world = world;
    this.grid = new BodyGrid(world.dims);
    const reg = world.reg;
    let reach = 0;
    for (let k = 0; k < reg.footRadius.length; k++) {
      const r = reg.footRadius[k]!;
      if (r > 0) reach = Math.max(reach, Math.abs(reg.footBack[k]!), Math.abs(reg.footFront[k]!), r);
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
        grid.add(j, ents.x[j]!, ents.z[j]!);
        this.remember(j);
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
  private readonly shown = new Float64Array(3);

  /**
   * The bodies walker `e`, of team `team`, standing at (x, y, z) with radius `r`, may meet this tick; null where none. A
   * creature nobody drives (`creature`) meets every survivor and ridden mount as solid whatever it weighs: what a client
   * predicts is never pushed by what the server alone steps.
   */
  around(e: number, x: number, y: number, z: number, r: number, team: number, creature = false, skip = -1): Blockers | null {
    const world = this.world, ents = world.ents, grid = this.grid, list = this.list;
    list.clear();
    const far = this.reach + r + 1;
    const n = grid.near(x, z, far);
    if (n === 0) return null;
    const found = grid.found;
    for (let k = 0; k < n; k++) {
      const j = found[k]!;
      if (j === e || j === skip || !blocks(world, j, team) || pairing(ents.emote[e]!, ents.emote[j]!)) continue;
      const bx = dequantX(quantX(ents.x[j]!)), bz = dequantX(quantX(ents.z[j]!));
      if (Math.abs(bx - x) > far || Math.abs(bz - z) > far) continue;
      const moving = (ents.anim[j]! & 15) !== 0;
      if (!creature && !blocksSession(world.reg, ents.kind[j]!, moving)) continue;
      if (!creature && this.survivorsPass && this.survivor[ents.kind[j]!] === 1 && this.survivor[ents.kind[e]!] === 1) continue;
      const always = creature && (ents.driven[j] !== 0 || this.survivor[ents.kind[j]!] === 1);
      list.add(world.reg, j, ents.kind[j]!, bx, dequantY(quantY(ents.y[j]!)), bz, ((ents.yaw[j]! >>> 6) * TAU) / 1024, moving, ents.kind[e]!, x, y, z, ents.yaw[e]!, always);
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
      if (!blocksSession(reg, kind, (view.anim[j]! & 15) !== 0)) continue;
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

