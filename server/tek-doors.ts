import { TICK_RATE } from "../shared/coords.ts";
import { SESSION_ALIVE } from "../shared/net/protocol.ts";
import { stanceEye } from "../shared/sim/character.ts";
import { hullTable } from "../shared/world/convex.ts";
import { Found, type PartTable } from "../shared/world/structures.ts";
import type { BuildContext } from "./build.ts";
import type { Client } from "./game.ts";

const REACH = 2, HOLD = 2 * TICK_RATE;
const EVERY = Math.max(1, Math.round(TICK_RATE / 6));

interface DoorWatch {
  gx: number; gy: number; gz: number; shapes: number;
  refs: number[];
}

/** Four tangents enclose the quarter turn, so a body between the two end poses holds the door. */
function sweptLeaf(halfWidth: number, halfHeight: number, thickness: number, hinge: number): PartTable {
  const pad = thickness / 2, radius = 2 * halfWidth + pad;
  const short = radius * Math.tan(Math.PI / 12), diagonal = radius * (Math.sqrt(3) - 1);
  const outline = [[-pad, -pad], [radius, -pad], [radius, short], [diagonal, diagonal], [short, radius], [-pad, radius]] as const;
  const corners = [-halfHeight, halfHeight].flatMap(y => outline.map(([x, z]): [number, number, number] => [hinge + x, y, z]));
  return { start: Uint32Array.of(0, 0), box: new Float32Array(0), hulls: hullTable(1, () => [{ corners }]) };
}

export class TekDoors {
  private readonly ctx: BuildContext;
  private readonly closed: number;
  private readonly open: number;
  private readonly sweep: PartTable;
  private readonly found = new Found(16);
  private readonly watchers = new WeakMap<Client, DoorWatch>();
  private readonly due = new Map<number, number>();
  private readonly shutByHand = new Set<number>();
  private readonly held = new Set<number>();
  private readonly blocked: (ref: number, sweep: PartTable) => boolean;
  private readonly sight: (e: number, ref: number, x: number, y: number, z: number) => boolean;
  private readonly swing: (ref: number, to: number, by: number, sweep: PartTable) => boolean;

  constructor(ctx: BuildContext, sight: TekDoors["sight"], blocked: TekDoors["blocked"], swing: TekDoors["swing"]) {
    this.ctx = ctx;
    this.sight = sight;
    this.blocked = blocked;
    this.swing = swing;
    const { reg } = ctx.world;
    this.closed = reg.index.get("core:door_tek") ?? 0;
    this.open = reg.opens[this.closed] ?? 0;
    const half = reg.halfX[this.closed]!, thick = reg.halfZ[this.closed]! * 2;
    this.sweep = this.open ? sweptLeaf(half, reg.halfY[this.closed]!, thick, reg.forms.def[this.open]?.off ?? -half + thick / 2) : { start: Uint32Array.of(0, 0), box: new Float32Array(0) };
  }

  removed(ref: number): void {
    this.due.delete(ref);
    this.shutByHand.delete(ref);
  }

  manual(ref: number, to: number): void {
    if (to === this.open) this.due.set(ref, this.ctx.world.tick + HOLD);
    if (to === this.closed) {
      this.due.delete(ref);
      this.shutByHand.add(ref);
    }
  }

  /** A saved open leaf starts its clearance interval when the world resumes. */
  restore(): void {
    if (!this.open) return;
    const { world } = this.ctx;
    for (const chunk of world.structs.held) {
      const table = world.structs.chunks[chunk]!;
      for (const i of world.structs.changedSlots(chunk)) if (table.kind[i] === this.open) this.due.set(chunk * 65536 + i, world.tick + HOLD);
      for (let i = table.mapped; i < table.high; i++) if (table.kind[i] === this.open) this.due.set(chunk * 65536 + i, world.tick + HOLD);
    }
  }

  step(): void {
    const { world, game, records, tribes } = this.ctx;
    if (!this.open || world.tick % EVERY !== 0 || (this.due.size === 0 && world.claims.byKind[this.closed] === 0 && world.claims.byKind[this.open] === 0)) return;
    const { ents, structs, reg, tick } = world;
    this.held.clear();
    for (const c of game.clients) {
      if (!c?.active || c.closed || c.ent < 0 || c.state !== SESSION_ALIVE) continue;
      const rec = records.byPid.get(c.pid);
      if (!rec || rec.out || rec.dead) continue;
      const e = c.ent, x = ents.x[e]!, z = ents.z[e]!;
      const y = ents.y[e]! + stanceEye(reg.move[ents.kind[e]!]!, ents.stance[e]!);
      const watch = this.nearby(c, x, y, z);
      for (const ref of watch.refs) {
        const slot = ref & 65535, t = structs.chunks[ref >>> 16];
        if (!t || (t.kind[slot] !== this.closed && t.kind[slot] !== this.open) || !tribes.may(rec, t.owner[slot]!)) continue;
        const tx = t.x[slot]!, ty = t.y[slot]!, tz = t.z[slot]!;
        if ((tx - x) ** 2 + (ty - y) ** 2 + (tz - z) ** 2 > REACH * REACH || !this.sight(e, ref, tx, ty, tz)) continue;
        this.held.add(ref);
        if (t.kind[slot] === this.open || (!this.shutByHand.has(ref) && this.swing(ref, this.open, rec.pid, this.sweep))) this.due.set(ref, tick + HOLD);
      }
    }
    for (const ref of this.shutByHand) if (!this.held.has(ref)) this.shutByHand.delete(ref);
    for (const [ref, at] of this.due) {
      if (this.held.has(ref)) continue;
      const t = structs.chunks[ref >>> 16];
      if (t?.kind[ref & 65535] !== this.open) this.due.delete(ref);
      else if (tick >= at) {
        if (this.swing(ref, this.closed, 0, this.sweep)) this.due.delete(ref);
        else this.due.set(ref, tick + HOLD);
      } else if (this.blocked(ref, this.sweep)) this.due.set(ref, tick + HOLD);
    }
  }

  /** A survivor reuses its local candidates until it changes metre cell or a piece changes shape. */
  private nearby(c: Client, x: number, y: number, z: number): DoorWatch {
    const structs = this.ctx.world.structs, gx = Math.floor(x), gy = Math.floor(y), gz = Math.floor(z);
    let watch = this.watchers.get(c);
    if (!watch) {
      watch = { gx, gy, gz, shapes: -1, refs: [] };
      this.watchers.set(c, watch);
    }
    if (watch.gx === gx && watch.gy === gy && watch.gz === gz && watch.shapes === structs.shapes) return watch;
    watch.gx = gx; watch.gy = gy; watch.gz = gz; watch.shapes = structs.shapes;
    watch.refs.length = 0;
    const n = structs.query(gx - REACH, gz - REACH, gx + 1 + REACH, gz + 1 + REACH, this.found, gy - REACH, gy + 1 + REACH);
    for (let i = 0; i < n; i++) {
      const ref = this.found.refs[i]!, kind = structs.chunks[ref >>> 16]!.kind[ref & 65535];
      if (kind === this.closed || kind === this.open) watch.refs.push(ref);
    }
    return watch;
  }
}
