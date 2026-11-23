// Trailers on fifth wheels: who tows whom, the pair's shared step, and coupling when a tractor backs under a kingpin.
import { TEXT_NOTICE } from "../shared/net/protocol.ts";
import { Body } from "../shared/sim/character.ts";
import { F_ALIVE, F_PROP } from "../shared/sim/entities.ts";
import { stepHitchedBodies } from "../shared/sim/vehicle-body.ts";
import { HITCH_BREAK, hitchPoint } from "../shared/sim/vehicle-hitch.ts";
import { isWheelVehicle, type VehicleDefinition, type WheelVehicleDefinition } from "../shared/sim/vehicle.ts";
import type { Client, GameServer } from "./game.ts";
import type { Records } from "./records.ts";
import type { Urban } from "./urban.ts";
import type { ServerWorld } from "./world.ts";

export interface HitchesContext { world: ServerWorld; game: GameServer; records: Records; urban: Urban }
interface SavedHitches { pairs: [number, number][] }

/** How close the kingpin must come over the fifth wheel to latch, sideways and up, metres; and how square, radians. */
const LATCH_ACROSS = .45, LATCH_UP = .45, LATCH_YAW = .5;
const fifth = new Float64Array(3), pin = new Float64Array(3);

export class Hitches {
  /** Tractor record to trailer record, and back. */
  private readonly byTractor = new Map<number, number>();
  private readonly byTrailer = new Map<number, number>();
  private readonly body = new Body();
  /** Trailers let go of that do not latch again until their kingpin is clear of the fifth wheel. */
  private readonly parted = new Set<number>();
  private readonly ctx: HitchesContext;
  readonly saved = { dirty: false, serialize: () => JSON.stringify({ pairs: [...this.byTractor] } satisfies SavedHitches) };
  /** A pair was joined or parted: tractor record, trailer record, joined. */
  onChange: ((tractor: number, trailer: number, joined: boolean) => void) | null = null;

  constructor(ctx: HitchesContext) { this.ctx = ctx; }

  begin(data: string | null): void {
    if (!data) return;
    for (const [tractor, trailer] of (JSON.parse(data) as SavedHitches).pairs) { this.byTractor.set(tractor, trailer); this.byTrailer.set(trailer, tractor); }
  }

  private entity(pid: number | undefined): number {
    if (pid === undefined) return -1;
    const ents = this.ctx.world.ents, e = this.ctx.records.entOf.get(pid) ?? -1;
    return e >= 0 && ents.pid[e] === pid && (ents.flags[e]! & (F_ALIVE | F_PROP)) === F_ALIVE ? e : -1;
  }

  /** The trailer entity on tractor entity `e`'s fifth wheel, or -1. */
  trailerOf(e: number): number { return this.entity(this.byTractor.get(this.ctx.world.ents.pid[e]!)); }
  /** The tractor entity towing trailer entity `e`, or -1. */
  tractorOf(e: number): number { return this.entity(this.byTrailer.get(this.ctx.world.ents.pid[e]!)); }
  /** Trailer record towed by tractor record `pid`, or 0. */
  trailerPid(pid: number): number { return this.byTractor.get(pid) ?? 0; }
  tractorPid(pid: number): number { return this.byTrailer.get(pid) ?? 0; }
  linked(a: number, b: number): boolean {
    const ents = this.ctx.world.ents, pa = ents.pid[a]!, pb = ents.pid[b]!;
    return this.byTractor.get(pa) === pb || this.byTractor.get(pb) === pa;
  }

  couple(tractorPid: number, trailerPid: number): boolean {
    if (this.byTractor.has(tractorPid) || this.byTrailer.has(trailerPid) || tractorPid === trailerPid) return false;
    this.byTractor.set(tractorPid, trailerPid); this.byTrailer.set(trailerPid, tractorPid);
    this.saved.dirty = true;
    const t = this.entity(tractorPid), r = this.entity(trailerPid);
    if (t >= 0) this.ctx.urban.rouse(t);
    if (r >= 0) this.ctx.urban.rouse(r);
    this.onChange?.(tractorPid, trailerPid, true);
    return true;
  }

  /** Parts trailer record `pid` from whatever tows it. */
  release(trailerPid: number): boolean {
    const tractor = this.byTrailer.get(trailerPid);
    if (tractor === undefined) return false;
    this.byTrailer.delete(trailerPid); this.byTractor.delete(tractor);
    this.parted.add(trailerPid);
    this.saved.dirty = true;
    for (const e of [this.entity(tractor), this.entity(trailerPid)]) if (e >= 0) this.ctx.urban.rouse(e);
    this.onChange?.(tractor, trailerPid, false);
    return true;
  }

  /** Steps tractor `e` with its trailer if it has one; false leaves the ordinary single step to the caller. */
  step(e: number, b: Body, moveX: number, moveZ: number, buttons: number, def: VehicleDefinition, pilot: boolean): boolean {
    if (!this.byTractor.size || !isWheelVehicle(def) || !def.spec.fifthWheel) return false;
    const r = this.trailerOf(e);
    if (r < 0) {
      const pid = this.ctx.world.ents.pid[e]!, trailer = this.byTractor.get(pid);
      // A trailer whose record is gone is let go; one only out of reach keeps its hitch for when it is back.
      if (trailer !== undefined && !this.ctx.records.byPid.has(trailer)) this.release(trailer);
      return false;
    }
    const { world, urban } = this.ctx, ents = world.ents, rDef = world.reg.vehicle[ents.kind[r]!];
    if (!rDef || !isWheelVehicle(rDef) || !rDef.spec.kingpin) return false;
    ents.loadBody(r, this.body);
    hitchPoint(pose(b), def.spec.fifthWheel, fifth); hitchPoint(pose(this.body), rDef.spec.kingpin, pin);
    if (Math.hypot(fifth[0]! - pin[0]!, fifth[1]! - pin[1]!, fifth[2]! - pin[2]!) > HITCH_BREAK) {
      this.release(ents.pid[r]!);
      return false;
    }
    stepHitchedBodies(world, b, moveX, moveZ, buttons, def, this.body, rDef as WheelVehicleDefinition, pilot);
    urban.rouse(r);
    ents.storeBody(r, this.body);
    urban.syncAfterContact(r);
    return true;
  }

  /** Driven tractors with an empty fifth wheel couple to a trailer whose kingpin is over it. */
  latch(): void {
    const { world, game, records } = this.ctx, ents = world.ents;
    for (const c of game.clients) {
      if (!c?.active || c.drive < 0) continue;
      const t = c.drive, def = world.reg.vehicle[ents.kind[t]!];
      if (!def || !isWheelVehicle(def) || !def.spec.fifthWheel || this.byTractor.has(ents.pid[t]!)) continue;
      ents.loadBody(t, this.body);
      hitchPoint(pose(this.body), def.spec.fifthWheel, fifth);
      const yaw = this.body.vehicleYaw, driver = records.byPid.get(c.pid);
      // Only a tractor backing up couples: one standing under a kingpin it let go of does not take it again.
      const backing = this.body.vx * Math.sin(yaw) + this.body.vz * Math.cos(yaw) < -.05;
      const chunkX = Math.floor(ents.x[t]! / 64), chunkZ = Math.floor(ents.z[t]! / 64);
      for (let z = Math.max(0, chunkZ - 1); z <= Math.min(world.dims.chunksZ - 1, chunkZ + 1); z++) {
        for (let x = Math.max(0, chunkX - 1); x <= Math.min(world.dims.chunksX - 1, chunkX + 1); x++) {
          for (let r = ents.chunkHead[z * world.dims.chunksX + x]!; r >= 0; r = ents.next[r]!) {
            const rDef = world.reg.vehicle[ents.kind[r]!];
            if (r === t || !rDef || !isWheelVehicle(rDef) || !rDef.spec.kingpin || this.byTrailer.has(ents.pid[r]!)) continue;
            const owner = records.byPid.get(ents.pid[r]!);
            if (!owner || (owner.team !== 0 && owner.team !== driver?.team)) continue;
            const d = ents.vrow[r]!;
            const turned = Math.abs(Math.atan2(Math.sin(ents.vehicleYaw[d]! - yaw), Math.cos(ents.vehicleYaw[d]! - yaw)));
            if (turned > LATCH_YAW) continue;
            hitchPoint({ x: ents.x[r]!, y: ents.y[r]!, z: ents.z[r]!, qx: ents.vehicleQx[d]!, qy: ents.vehicleQy[d]!, qz: ents.vehicleQz[d]!, qw: ents.vehicleQw[d]! } as never, rDef.spec.kingpin, pin);
            const across = Math.hypot(fifth[0]! - pin[0]!, fifth[2]! - pin[2]!);
            if (this.parted.has(ents.pid[r]!)) { if (across > LATCH_ACROSS * 3) this.parted.delete(ents.pid[r]!); continue; }
            if (!backing || across > LATCH_ACROSS || Math.abs(fifth[1]! - pin[1]!) > LATCH_UP) continue;
            if (this.couple(ents.pid[t]!, ents.pid[r]!)) { this.tell(c, "Kingpin locked. The trailer is coupled."); return; }
          }
        }
      }
    }
  }

  tell(c: Client | undefined, text: string): void { if (c) this.ctx.game.sendText(c, TEXT_NOTICE, text); }
}

function pose(b: Body) {
  return { x: b.x, y: b.y, z: b.z, yaw: b.vehicleYaw, pitch: b.vehiclePitch, roll: b.vehicleRoll, qx: b.vehicleQx, qy: b.vehicleQy, qz: b.vehicleQz, qw: b.vehicleQw } as never;
}
