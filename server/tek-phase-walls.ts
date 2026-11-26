import { CHUNK_SIZE, TICK_RATE } from "../shared/coords.ts";
import { RESULT_INVALID, RESULT_OBSTRUCTED, RESULT_OK } from "../shared/net/protocol.ts";
import { frame, frameOf } from "../shared/world/frame.ts";
import { isTekWall, tekWallKinds, tekWallNeighbours, type TekWallKinds } from "../shared/world/lattice/tek-walls.ts";
import { F_ALIVE, F_PROP } from "../shared/sim/entities.ts";
import { vehicleSolidRadius } from "../shared/world/vehicle-shapes.ts";
import { Found } from "../shared/world/structures.ts";
import type { BuildContext } from "./build.ts";
import { DOOR_REACH, DoorSensor, holds } from "./door-sensor.ts";

const EVERY = Math.max(1, Math.round(TICK_RATE / 6)), HOLD = 2 * TICK_RATE;
const CELL = 4, SIDE = 3;

interface Aperture {
  refs: number[];
  chunks: Set<number>;
  closeAt: number;
  visited: number;
  mixed: boolean;
}

export class TekPhaseWalls {
  private readonly ctx: BuildContext;
  private readonly kinds: TekWallKinds;
  private readonly sensor: DoorSensor;
  private readonly sight: (e: number, ref: number, x: number, y: number, z: number) => boolean;
  private readonly blocked: (ref: number, kind: number, entity?: number) => boolean;
  private readonly swap: (ref: number, kind: number) => void;
  private readonly veto: (ref: number, pid: number) => boolean;
  private readonly shove: (ref: number, kind: number, entity: number) => boolean;
  private readonly inField: number[] = [];
  private readonly active = new Set<Aperture>();
  private readonly byRef = new Map<number, Aperture>();
  private readonly changed = new Set<number>();
  private readonly dirty = new Set<Aperture>();
  private readonly edges = new Int32Array(4);
  private readonly found = new Found(16);
  private readonly cellsX: number;
  private moving = false;
  private reach = 0;

  constructor(ctx: BuildContext, sight: TekPhaseWalls["sight"], blocked: TekPhaseWalls["blocked"],
    swap: TekPhaseWalls["swap"], veto: TekPhaseWalls["veto"], shove: TekPhaseWalls["shove"]) {
    this.ctx = ctx;
    this.shove = shove;
    this.sight = sight;
    this.blocked = blocked;
    this.swap = swap;
    this.veto = veto;
    const { structs, reg, dims } = ctx.world;
    this.kinds = tekWallKinds(reg.index);
    this.sensor = new DoorSensor(ctx, this.kinds.door, this.kinds.open);
    this.cellsX = dims.chunksX * CHUNK_SIZE / CELL;
    const count = structs.onOwned;
    // Owned rows change here on placement, destruction, mode edits and tribe transfers.
    structs.onOwned = (kind, x, z, owner, by) => {
      count?.(kind, x, z, owner, by);
      if (!this.moving && isTekWall(this.kinds, kind, true)) this.changed.add(Math.floor(z / CELL) * this.cellsX + Math.floor(x / CELL));
    };
  }

  accepts(kind: number): boolean { return isTekWall(this.kinds, kind); }

  crosses(from: number, to: number): boolean {
    return from !== to && (from === this.kinds.open || to === this.kinds.open);
  }

  configure(ref: number, door: boolean): number {
    const { solid, open } = this.kinds, from = this.kind(ref);
    if (!open) return RESULT_INVALID;
    if (door === (from !== solid)) return RESULT_OK;
    if (from === open && this.blocked(ref, solid)) return RESULT_OBSTRUCTED;
    this.swap(ref, door ? this.kinds.door : solid);
    this.reconcile();
    return RESULT_OK;
  }

  removed(ref: number): void {
    const field = this.byRef.get(ref);
    if (field) this.dirty.add(field);
  }

  restore(): void {
    if (!this.kinds.open) return;
    const { structs } = this.ctx.world;
    for (const chunk of structs.held) {
      const t = structs.chunks[chunk]!;
      for (const i of structs.changedSlots(chunk)) if (t.kind[i] === this.kinds.open) this.trackOpen(chunk * 65536 + i);
      for (let i = t.mapped; i < t.high; i++) if (t.kind[i] === this.kinds.open) this.trackOpen(chunk * 65536 + i);
    }
  }

  step(): void {
    const { world } = this.ctx, tick = world.tick;
    if (!this.kinds.open || tick % EVERY !== 0) return;
    this.reconcile();
    if (!this.active.size && !world.claims.byKind[this.kinds.door]) return;
    this.sensor.visit((ref, e, pid, x, y, z) => {
      let field = this.byRef.get(ref);
      if (field?.visited === tick || !this.sees(ref, e, x, y, z)) return;
      field ??= this.component(ref);
      if ((!this.active.has(field) || field.mixed) && !this.move(field, this.kinds.open, pid)) return;
      if (!this.active.has(field)) this.remember(field);
      field.mixed = false;
      field.visited = tick;
      field.closeAt = tick + HOLD;
    });
    for (const field of this.active) {
      if (field.visited === tick) continue;
      if (this.occupied(field)) field.closeAt = tick + HOLD;
      else if (tick >= field.closeAt) {
        if (this.clear(field) && this.move(field, this.kinds.door, 0)) this.forget(field);
        else field.closeAt = tick + HOLD;
      }
    }
  }

  /** Only the changed metre cells and the previously open groups touching them need new links. */
  private reconcile(): void {
    if (!this.changed.size && !this.dirty.size) return;
    const { structs } = this.ctx.world, seeds = new Set<number>();
    for (const cell of this.changed) {
      const x = (cell % this.cellsX) * CELL, z = Math.floor(cell / this.cellsX) * CELL;
      const n = structs.query(x - SIDE, z - SIDE, x + CELL + SIDE, z + CELL + SIDE, this.found);
      for (let i = 0; i < n; i++) {
        const ref = this.found.refs[i]!, was = this.byRef.get(ref);
        if (was) this.dirty.add(was);
        if (this.kind(ref) === this.kinds.open) seeds.add(ref);
      }
    }
    this.changed.clear();
    for (const field of this.dirty) {
      for (const ref of field.refs) if (this.kind(ref) === this.kinds.open) seeds.add(ref);
      this.forget(field);
    }
    this.dirty.clear();
    for (const ref of seeds) this.trackOpen(ref);
  }

  private trackOpen(ref: number): void {
    if (this.byRef.has(ref)) return;
    const field = this.component(ref);
    field.mixed = field.refs.some(cell => this.kind(cell) !== this.kinds.open);
    if (field.mixed && this.move(field, this.kinds.open, 0)) field.mixed = false;
    this.remember(field);
  }

  private component(first: number): Aperture {
    const { structs, tick, dims, reg } = this.ctx.world, seen = new Set([first]), refs = [first], chunks = new Set<number>();
    if (!this.reach) {
      this.reach = Math.max(...reg.bodyRadius);
      for (const def of reg.vehicle) if (def) this.reach = Math.max(this.reach, vehicleSolidRadius(def));
      this.reach += Math.hypot(reg.halfX[this.kinds.door]!, reg.halfZ[this.kinds.door]!) + .01;
    }
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i]!, row = structs.chunks[ref >>> 16]!, slot = ref & 65535, x = row.x[slot]!, z = row.z[slot]!;
      const west = Math.max(0, Math.floor((x - this.reach) / CHUNK_SIZE)), north = Math.max(0, Math.floor((z - this.reach) / CHUNK_SIZE));
      const east = Math.min(dims.chunksX - 1, Math.floor((x + this.reach) / CHUNK_SIZE)), south = Math.min(dims.chunksZ - 1, Math.floor((z + this.reach) / CHUNK_SIZE));
      for (let cz = north; cz <= south; cz++) for (let cx = west; cx <= east; cx++) chunks.add(cz * dims.chunksX + cx);
      tekWallNeighbours(structs, this.kinds, refs[i]!, this.edges, true);
      for (const ref of this.edges) if (ref >= 0 && !seen.has(ref)) { seen.add(ref); refs.push(ref); }
    }
    return { refs, chunks, closeAt: tick + HOLD, visited: -1, mixed: false };
  }

  /** Its own tribe's body or any vehicle in the opening holds it. A stranger on foot does not. */
  private occupied(field: Aperture): boolean {
    return this.meeting(field, false) > 0;
  }

  /** Moves strangers out of the opening. True when nobody stands in it after, so that it may reform. */
  private clear(field: Aperture): boolean {
    const found = this.inField;
    this.meeting(field, true);
    for (let i = 0; i < found.length; i += 2) this.shove(found[i + 1]!, this.kinds.door, found[i]!);
    return found.length === 0 || this.meeting(field, true) === 0;
  }

  /**
   * How many bodies stand in the opening that hold it, its own tribe's and vehicles, or with `all` how many of any kind,
   * each listed in `inField` with the cell it stands in. Each nearby body queries the cells it could cover, even when a
   * gate spans hundreds of panels.
   */
  private meeting(field: Aperture, all: boolean): number {
    const { ents, structs, reg } = this.ctx.world, found = this.inField;
    const first = field.refs[0]!, owner = structs.chunks[first >>> 16]?.owner[first & 65535] ?? 0;
    found.length = 0;
    let count = 0;
    for (const chunk of field.chunks) for (let e = ents.chunkHead[chunk]!; e >= 0; e = ents.next[e]!) {
      if ((ents.flags[e]! & (F_ALIVE | F_PROP)) !== F_ALIVE) continue;
      const kind = ents.kind[e]!, vehicle = reg.vehicle[kind];
      if (!all && !vehicle && !holds(ents.team[e]!, owner)) continue;
      const r = vehicle ? vehicleSolidRadius(vehicle) : reg.bodyRadius[kind]!;
      const x = ents.x[e]!, y = ents.y[e]!, z = ents.z[e]!;
      const n = structs.query(x - r, z - r, x + r, z + r, this.found, vehicle ? y - r : y, y + (vehicle ? r : reg.bodyHeight[kind]!));
      for (let i = 0; i < n; i++) {
        const ref = this.found.refs[i]!;
        if (this.byRef.get(ref) !== field || !this.blocked(ref, this.kinds.door, e)) continue;
        if (!all) return 1;
        found.push(e, ref);
        count++;
        break;
      }
    }
    return count;
  }

  private remember(field: Aperture): void {
    this.active.add(field);
    for (const ref of field.refs) {
      const old = this.byRef.get(ref);
      if (old && old !== field) this.forget(old);
      this.byRef.set(ref, field);
    }
  }

  private forget(field: Aperture): void {
    this.active.delete(field);
    for (const ref of field.refs) this.byRef.delete(ref);
  }

  private kind(ref: number): number {
    return this.ctx.world.structs.chunks[ref >>> 16]?.kind[ref & 65535] ?? 0;
  }

  private move(field: Aperture, to: number, pid: number): boolean {
    const { structs } = this.ctx.world;
    for (const ref of field.refs) {
      const from = this.kind(ref);
      if (!isTekWall(this.kinds, from, true) || (from !== to && this.veto(ref, pid))) return false;
    }
    this.moving = true;
    structs.hold();
    try {
      for (const ref of field.refs) if (this.kind(ref) !== to) this.swap(ref, to);
    } finally {
      this.moving = false;
      structs.release();
    }
    return true;
  }

  /** Measure to the closest point on the wall so both approaches work at a seam. */
  private sees(ref: number, e: number, x: number, y: number, z: number): boolean {
    const { structs, reg } = this.ctx.world, row = structs.chunks[ref >>> 16]!, slot = ref & 65535;
    const cx = row.x[slot]!, cy = row.y[slot]!, cz = row.z[slot]!;
    frameOf(row.yaw[slot]!, row.twAt(slot));
    const width = reg.halfX[this.kinds.door]! * frame.stretch, height = reg.halfY[this.kinds.door]!;
    const across = Math.max(-width, Math.min(width, (x - cx) * frame.cos - (z - cz) * frame.sin));
    const tx = cx + frame.cos * across, tz = cz - frame.sin * across, ty = Math.max(cy - height, Math.min(cy + height, y));
    return (tx - x) ** 2 + (ty - y) ** 2 + (tz - z) ** 2 <= DOOR_REACH ** 2 && this.sight(e, ref, tx, ty, tz);
  }
}
