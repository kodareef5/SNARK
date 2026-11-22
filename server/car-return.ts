// Puts a found car or vessel back in the place the map parked or berthed it, some days after it went, destroyed or driven
// off: owned by nobody, its condition and fuel rolled again in the map's ranges. Each place is checked on a deadline of its
// own, so a world costs nothing between checks. The days are FoundCarReturnDays for a car and FoundBoatReturnDays for a
// vessel, of the game's clock; 0 brings none back.

import { CHUNK_SIZE, TICK_RATE } from "../shared/coords.ts";
import { cycleTicks } from "../shared/sim/clock.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { isBoatVehicle, isWheelVehicle } from "../shared/sim/vehicle.ts";
import type { MapVehicle } from "../shared/world/mapfile.ts";
import type { GameServer } from "./game.ts";
import type { Records } from "./records.ts";
import type { Rules } from "./settings/rules.ts";
import { basedNear } from "./supply/ground.ts";
import { foundVehicle, VEHICLE_ORIGIN, type VehicleStart } from "./vehicle-service.ts";
import type { ServerWorld } from "./world.ts";

/** 12 and 13 are kept for the item program and 14 for W5 (tests/unit/weapons-contracts.test.ts). */
export const DEADLINE_CAR = 15;
/** Seconds between a place's checks. */
export const CAR_CHECK_SECONDS = 600;
/** Metres. A car this near its place is still there: one shoved aside has not gone. */
export const GONE_RANGE = 12;
/** Metres. No car comes back this near anything a tribe built. */
export const BASE_RANGE = 60;
/** Metres round its body and the door room its seats need that another body keeps a car from coming back into. */
const ROOM = 1;
/** Metres of water under a vessel's keel at rest that its berth must still have. */
const UNDER_KEEL = .2;

export interface CarReturnContext {
  world: ServerWorld;
  game: GameServer;
  records: Records;
  rules: Rules;
  deadlines: DeadlineHeap;
  /** The world's seed: the map's first roll is foundVehicle's with it, and each return's with it plus how many came before. */
  seed: number;
  /** Sets a car down as the map's are set down, owned by nobody. Its entity, or -1. */
  park(placement: MapVehicle, start: VehicleStart): number;
}

interface Place {
  readonly at: MapVehicle;
  readonly origin: string;
  /** Half its width and length with the door room and the margin, in metres. */
  readonly side: number;
  readonly end: number;
  /** A vessel's draught, or -1 for a car. */
  readonly draft: number;
  /** The records that came from it, the map's car and those that came back. */
  readonly pids: number[];
  /** The tick it was first found without its car, or -1 while its car is there. */
  gone: number;
  /** How many times a car has come back to it. */
  times: number;
  due: number;
}

export class CarReturn {
  readonly places: Place[] = [];
  /** Places looked at, and cars put back, since the server started. */
  checks = 0;
  returned = 0;
  /** What the save keeps: for each place that has lost its car or had one back, the tick it went and how many came back. */
  readonly saved = { dirty: false, serialize: (): string => JSON.stringify(Object.fromEntries(this.places.filter((p) => p.gone >= 0 || p.times > 0).map((p) => [p.origin, [p.gone, p.times]]))) };
  private readonly ctx: CarReturnContext;
  private readonly checkTicks = CAR_CHECK_SECONDS * TICK_RATE;
  private stamps = 0;

  /** The map's parked vehicles: those on wheels and the vessels the content has are places one comes back to. */
  constructor(ctx: CarReturnContext, placements: readonly MapVehicle[]) {
    this.ctx = ctx;
    const reg = ctx.world.reg;
    for (const at of placements) {
      const kind = reg.index.get(at.kind), def = kind === undefined ? undefined : reg.vehicle[kind];
      if (!def || !(isWheelVehicle(def) || isBoatVehicle(def))) continue;
      const door = Math.max(def.spec.halfWidth, ...def.seats.map((s) => Math.abs(s.entry[0])));
      this.places.push({ at, origin: foundVehicle(ctx.world.mapId, at, ctx.seed).origin!, side: door + ROOM, end: def.spec.halfLength + ROOM, draft: isBoatVehicle(def) ? def.spec.draft : -1, pids: [], gone: -1, times: 0, due: 0 });
    }
  }

  /** Call once, after the world's records are in: finds each place's cars by the origin they carry, and starts the checks. */
  begin(saved: string | null): void {
    const by = new Map(this.places.map((p) => [p.origin, p]));
    for (const [origin, [gone, times]] of Object.entries(JSON.parse(saved ?? "{}") as Record<string, [number, number]>)) {
      const p = by.get(origin);
      if (p) { p.gone = gone; p.times = times; }
    }
    const text = new TextDecoder();
    for (const rec of this.ctx.records.byPid.values()) {
      const origin = rec.extra.get(VEHICLE_ORIGIN);
      if (origin) by.get(text.decode(origin))?.pids.push(rec.pid);
    }
    // Spread over one period, so the checks do not come together.
    const tick = this.ctx.world.tick, n = this.places.length;
    this.places.forEach((_, i) => this.schedule(i, tick + 1 + Math.floor((i * this.checkTicks) / n)));
  }

  /** A DEADLINE_CAR came due for place `i`. */
  due(i: number, stamp: number): void {
    const p = this.places[i];
    if (!p || p.due !== stamp) return;
    this.checks++;
    const { world, rules } = this.ctx, tick = world.tick, days = rules.num(p.draft < 0 ? "FoundCarReturnDays" : "FoundBoatReturnDays");
    if (this.there(p)) {
      if (p.gone >= 0) { p.gone = -1; this.saved.dirty = true; }
    } else if (days > 0) {
      if (p.gone < 0) { p.gone = tick; this.saved.dirty = true; }
      else if (tick - p.gone >= days * cycleTicks(world.clock) && this.clear(p)) this.bring(p);
    }
    this.schedule(i, tick + this.checkTicks);
  }

  /** Whether a car that came from the place, not destroyed, stands within GONE_RANGE of it. */
  there(p: Place): boolean {
    const { records, world } = this.ctx, ents = world.ents;
    for (let k = p.pids.length - 1; k >= 0; k--) {
      const rec = records.byPid.get(p.pids[k]!);
      if (!rec || rec.dead) { p.pids.splice(k, 1); continue; }
      const e = records.entOf.get(rec.pid);
      const x = e === undefined ? rec.x : ents.x[e]!, z = e === undefined ? rec.z : ents.z[e]!;
      if (Math.hypot(x - p.at.x, z - p.at.z) < GONE_RANGE) return true;
    }
    return false;
  }

  /** Whether one may come back now: nobody is shown its chunk, nothing a tribe built is near, no body is in its room, and a vessel's berth still floats it. */
  clear(p: Place): boolean {
    return !this.seen(p) && !this.based(p) && !this.taken(p) && this.afloat(p);
  }

  /** Whether a car's place, or water as deep as a vessel's draught and a margin under its keel, is there. */
  afloat(p: Place): boolean {
    const hf = this.ctx.world.hf;
    return p.draft < 0 || hf.waterAt(p.at.x, p.at.z) - hf.heightAt(p.at.x, p.at.z) >= p.draft + UNDER_KEEL;
  }

  /** Whether a session is sent the bodies of the place's chunk, or of one beside it. */
  seen(p: Place): boolean {
    const { game, world } = this.ctx, w = world.dims.chunksX, reach = game.opts.entityRadius + 1;
    const cx = Math.floor(p.at.x / CHUNK_SIZE), cz = Math.floor(p.at.z / CHUNK_SIZE);
    for (const c of game.clients) {
      if (!c?.active || c.closed) continue;
      if (Math.abs((c.chunk % w) - cx) <= reach && Math.abs(Math.floor(c.chunk / w) - cz) <= reach) return true;
    }
    return false;
  }

  /** Whether anything a tribe built stands within BASE_RANGE. */
  based(p: Place): boolean {
    return basedNear(this.ctx.world, p.at.x, p.at.z, BASE_RANGE);
  }

  /** Whether any body, living or not, stands in the car's room: its envelope, the door room its seats need and a margin. */
  taken(p: Place): boolean {
    const { world } = this.ctx, { dims } = world, ents = world.ents, { x, z } = p.at;
    const yaw = (p.at.yaw / 65536) * 2 * Math.PI, sn = Math.sin(yaw), cs = Math.cos(yaw), reach = Math.hypot(p.side, p.end) + 4;
    for (let cz = Math.max(0, Math.floor((z - reach) / CHUNK_SIZE)); cz <= Math.min(dims.chunksZ - 1, Math.floor((z + reach) / CHUNK_SIZE)); cz++) {
      for (let cx = Math.max(0, Math.floor((x - reach) / CHUNK_SIZE)); cx <= Math.min(dims.chunksX - 1, Math.floor((x + reach) / CHUNK_SIZE)); cx++) {
        for (let e = ents.chunkHead[cz * dims.chunksX + cx]!; e >= 0; e = ents.next[e]!) {
          // In the car's frame: across along (cos, -sin) of its yaw, along it (sin, cos).
          const dx = ents.x[e]! - x, dz = ents.z[e]! - z, r = world.reg.bodyRadius[ents.kind[e]!]!;
          if (Math.abs(dx * cs - dz * sn) < p.side + r && Math.abs(dx * sn + dz * cs) < p.end + r) return true;
        }
      }
    }
    return false;
  }

  private bring(p: Place): void {
    const { world } = this.ctx;
    const e = this.ctx.park(p.at, foundVehicle(world.mapId, p.at, this.ctx.seed + p.times + 1));
    if (e < 0) return;
    p.pids.push(world.ents.pid[e]!);
    p.times++; p.gone = -1; this.returned++;
    this.saved.dirty = true;
  }

  private schedule(i: number, tick: number): void {
    const p = this.places[i]!;
    p.due = ++this.stamps;
    this.ctx.deadlines.push(tick, DEADLINE_CAR, i, p.due);
  }
}
