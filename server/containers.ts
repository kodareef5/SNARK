// What a session has open, and what its use key acts on. A client never names what it opens. The server casts a ray from
// the body's eye. The bags and caches themselves, and their time, are Death's (server/death.ts).

import { TEXT_NOTICE } from "../shared/net/protocol.ts";
import { BTN_USE, stanceEye } from "../shared/sim/character.ts";
import { youngScale } from "../shared/sim/breeding.ts";
import { useVehicle } from "../shared/sim/vehicle-frame.ts";
import { F_PROP } from "../shared/sim/entities.ts";
import { chunkCx, chunkCz } from "../shared/coords.ts";
import { castWorld, lookDirection, rayBox, rayHit, HIT_NONE, HIT_STRUCTURE } from "../shared/world/ray.ts";
import type { Corpses } from "./corpses.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";
import { Signal, Veto } from "./signal.ts";

/** Metres from the eye. */
export const REACH = 3.5;

export interface ContainersContext {
  readonly world: ServerWorld;
  /** Its sessions, and what a session is told: a refusal's words, a result code, a module's leave to open. */
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
}

export class Containers {
  /** Shared current posed eye for seated interactions; absent on small standalone fixtures. */
  eye: ((entity: number, out: Float64Array) => void) | null = null;
  private readonly eyeAt = new Float64Array(3);
  /** The use button found nothing here to act on. Another system may want it (a bush to pick). */
  readonly onUse = new Signal<[c: Client]>();
  /** The use button was pressed looking at a structure (`ref`) with nothing nearer. Returns a result code, or -1 if it has no use. */
  onUseBuilt: ((c: Client, ref: number) => number) | null = null;
  /** Whether a session may open a creature that is awake (one of its tribe's). Any listener may refuse; while none listens, nobody may. */
  readonly canOpen = new Veto<[c: Client, rec: EntityRecord]>(true);
  /** Whether a session that has the built container at `ref` open may go on using it. */
  keepsBuilt: ((c: Client, ref: number) => boolean) | null = null;
  /** Reach and authorization for a live hull or a salvage hull opened at its stern. */
  keepsBoatCargo: ((c: Client, e: number) => boolean) | null = null;
  /** Riding hooks. onRide gets the entity the use button was pressed on and returns a result code, or -1 if it does not take the press. */
  riding: ((c: Client) => boolean) | null = null;
  offMount: ((c: Client) => void) | null = null;
  onRide: ((c: Client, e: number) => number) | null = null;
  /** A session shut `rec`, which it had open. */
  readonly onShut = new Signal<[rec: EntityRecord]>();
  /**
   * Why `c` may not open the thing lying there, or "": a rule of the game's own, asked at every use (a supply drop's
   * level, server/supply.ts). It is not a `container.open` handler: the bus is the modules', and switches one off that fails.
   * The first listener with a reason gives it.
   */
  readonly gate = new Veto<[c: Client, box: EntityRecord], string>("");
  /** `c` opened `box`. */
  readonly onOpened = new Signal<[c: Client, box: EntityRecord]>();
  /** `box` is about to be removed: emptied, out of time, or cleared away. Its record is still whole. */
  readonly onRemoved = new Signal<[box: EntityRecord]>();
  /** Removes a bag or cache a session had open and emptied (Death.remove). Without it one stays, empty. */
  emptied: ((box: EntityRecord) => void) | null = null;
  /** Where a creature's body lies, for the ray to meet it there. */
  corpses: Corpses | null = null;
  /** Ref of the structure the last target() call hit, or -1. */
  private struck = -1;
  private readonly ctx: ContainersContext;
  /** The record kind of a creature's body, or -1. */
  private readonly corpse: number;
  private readonly dir = [0, 0, 0];

  constructor(ctx: ContainersContext) {
    this.ctx = ctx;
    this.corpse = ctx.world.reg.index.get("core:corpse") ?? -1;
  }

  /**
   * What the session has open, or null. Whether it still may is asked here, at every use, because its tribe, the lock or the
   * PIN may have changed since it opened it. One it may not is shut.
   */
  openOf(c: Client): EntityRecord | null {
    const box = c.open === 0 ? undefined : this.ctx.records.byPid.get(c.open);
    if (!box) return null;
    if (!this.allowed(c, box)) {
      this.close(c);
      return null;
    }
    return box;
  }

  /** A built container asks keepsBuilt. A creature that is awake asks canOpen. Anything else lying open is anyone's. */
  private allowed(c: Client, box: EntityRecord): boolean {
    // A tame kept in a soul ball has no body, and is not a thing lying open.
    if (box.stored !== 0) return false;
    if (box.at >= 0) return this.keepsBuilt?.(c, box.at) ?? true;
    const e = this.ctx.records.entOf.get(box.pid);
    if (e !== undefined && this.isBoat(e)) return this.keepsBoatCargo?.(c, e) ?? false;
    if (e !== undefined && (this.ctx.world.ents.flags[e]! & F_PROP) !== 0 && this.gate.ask(c, box) !== "") return false;
    if (e === undefined || (this.ctx.world.ents.flags[e]! & F_PROP) !== 0 || box.out) return true;
    return this.opens(c, box);
  }

  private opens(c: Client, rec: EntityRecord): boolean {
    return this.canOpen.size > 0 && this.canOpen.ask(c, rec);
  }

  private isBoat(e: number): boolean {
    const { world } = this.ctx;
    return world.reg.vehicle[world.ents.kind[e]!]?.movement === "boat";
  }

  close(c: Client): void {
    const was = c.open !== 0 ? this.ctx.records.byPid.get(c.open) : undefined;
    c.open = 0;
    if (was) this.onShut.emit(was);
  }

  /** `box` is about to be removed: it is shut for whoever has it open, and the listeners are told. */
  removing(box: EntityRecord): void {
    for (const c of this.ctx.game.clients) if (c?.open === box.pid) this.close(c);
    this.onRemoved.emit(box);
  }

  /** Once per tick. Handles the use button, closes a container that is gone or out of reach, and has an emptied cache or bag removed. */
  step(): void {
    const { world, records, items, game } = this.ctx;
    const ents = world.ents;
    for (const c of game.clients) {
      if (!c?.active) continue;
      if (c.open !== 0) {
        const box = records.byPid.get(c.open);
        const e = box ? records.entOf.get(box.pid) : undefined;
        if (box && box.at >= 0 && c.ent >= 0) {
          // A built container has no entity. It stays open, empty or not, while it stands, its user is near and may use it.
          const dx = box.x - ents.x[c.ent]!;
          const dy = box.y - ents.y[c.ent]!;
          const dz = box.z - ents.z[c.ent]!;
          if (dx * dx + dy * dy + dz * dz > (REACH + 2.5) * (REACH + 2.5) || !this.allowed(c, box)) this.close(c);
        } else if (!box || e === undefined || c.ent < 0) this.close(c);
        else if ((ents.flags[e]! & F_PROP) !== 0 && box.kind !== this.corpse && items.inv(box).used() === 0) this.emptied?.(box);
        // A creature that woke up closes unless canOpen allows it.
        else if (!this.allowed(c, box)) this.close(c);
        else if (!this.isBoat(e)) {
          const dx = ents.x[e]! - ents.x[c.ent]!;
          const dy = ents.y[e]! - ents.y[c.ent]!;
          const dz = ents.z[e]! - ents.z[c.ent]!;
          if (dx * dx + dy * dy + dz * dz > (REACH + 1.5) * (REACH + 1.5)) this.close(c);
        }
      }
      if (c.ent >= 0 && (c.pressed & BTN_USE) !== 0 && !records.byPid.get(c.pid)?.out) this.use(c);
    }
  }

  /** Index of the entity the body looks at within `reach`, or -1. World geometry nearer than the entity hides it. */
  target(c: Client, reach: number): number {
    const world = this.ctx.world;
    const ents = world.ents;
    const reg = world.reg;
    const e = c.ent;
    this.eyeAt[0] = ents.x[e]!; this.eyeAt[1] = ents.y[e]! + stanceEye(reg.move[ents.kind[e]!]!, ents.stance[e]!); this.eyeAt[2] = ents.z[e]!;
    this.eye?.(e, this.eyeAt);
    const ox = this.eyeAt[0]!, oy = this.eyeAt[1]!, oz = this.eyeAt[2]!;
    const d = this.dir;
    lookDirection(c.heldYaw, c.heldPitch, d);
    const what = castWorld(world, ox, oy, oz, d[0]!, d[1]!, d[2]!, reach);
    let best = what === HIT_NONE ? reach : rayHit.t;
    this.struck = what === HIT_STRUCTURE ? rayHit.ref : -1;
    let hit = -1;
    const dims = world.dims;
    const ccx = chunkCx(dims, ents.chunk[e]!);
    const ccz = chunkCz(dims, ents.chunk[e]!);
    const span = Math.ceil(reach / 64);
    for (let cz = ccz - span; cz <= ccz + span; cz++) {
      for (let cx = ccx - span; cx <= ccx + span; cx++) {
        if (cx < 0 || cz < 0 || cx >= dims.chunksX || cz >= dims.chunksZ) continue;
        for (let i = ents.chunkHead[cz * dims.chunksX + cx]!; i >= 0; i = ents.next[i]!) {
          if (i === e) continue;
          // A young creature's box is scaled as the client draws it.
          const size = ents.grown[i] !== 0 && (ents.flags[i]! & F_PROP) === 0 ? youngScale(reg.birthScale[ents.kind[i]!]!, ents.span[i]!, ents.grown[i]!, world.tick) : 1;
          const r = reg.bodyRadius[ents.kind[i]!]! * size;
          // A creature's body is met where it lies, as a blow meets it.
          const body = this.corpses?.at(i);
          const car = reg.vehicle[ents.kind[i]!], v = ents.vrow[i]!;
          // A vehicle is looked at by its hull, nose to tail and up to its roof; a boat's open cockpit too.
          const t = car && !body ? useVehicle(car, ents.x[i]!, ents.y[i]!, ents.z[i]!, ents.vehicleYaw[v]!, ox, oy, oz, d[0]!, d[1]!, d[2]!, {
            pitch: ents.vehiclePitch[v]!, roll: ents.vehicleRoll[v]!, steering: ents.steering[v]!,
            qx: ents.vehicleQx[v]!, qy: ents.vehicleQy[v]!, qz: ents.vehicleQz[v]!, qw: ents.vehicleQw[v]!,
          }) : body ? this.corpses!.hit(i, ox, oy, oz, d[0]!, d[1]!, d[2]!, best) : rayBox(ox, oy, oz, d[0]!, d[1]!, d[2]!, ents.x[i]! - r, ents.y[i]!, ents.z[i]! - r, ents.x[i]! + r, ents.y[i]! + reg.bodyHeight[ents.kind[i]!]! * size, ents.z[i]! + r);
          if (t < best) {
            best = t;
            hit = i;
          }
        }
      }
    }
    return hit;
  }

  private use(c: Client): void {
    const ents = this.ctx.world.ents;
    if (this.riding?.(c)) {
      this.offMount?.(c);
      return;
    }
    const hit = this.target(c, REACH);
    if (hit >= 0 && (ents.flags[hit]! & F_PROP) === 0 && this.onRide) {
      const code = this.onRide(c, hit);
      if (code > 0) this.ctx.game.notify(c, code);
      if (code >= 0) return;
    }
    // A prop (a cache or a bag), an unconscious creature, or one that canOpen allows. Never an egg or a survivor.
    const there = hit >= 0 ? this.ctx.records.byPid.get(ents.pid[hit]!) : undefined;
    const pid = hit >= 0 && there?.egg == null && ((ents.flags[hit]! & F_PROP) !== 0 || (there !== undefined && there.keyHash === null && (there.out || this.opens(c, there)))) ? ents.pid[hit]! : 0;
    const box = pid !== 0 ? there : undefined;
    if (box && c.open !== pid) {
      const why = (ents.flags[hit]! & F_PROP) !== 0 ? this.gate.ask(c, box) : "";
      if (why !== "") this.ctx.game.sendText(c, TEXT_NOTICE, why);
      else if (this.ctx.game.mayOpen(c, pid)) {
        c.open = pid;
        this.onOpened.emit(c, box);
      }
      return;
    }
    // A structure with nothing in front of it, such as a door or a box. A refusal code is sent to the session.
    if (hit < 0 && this.struck >= 0 && this.onUseBuilt) {
      const code = this.onUseBuilt(c, this.struck);
      if (code > 0) this.ctx.game.notify(c, code);
      if (code >= 0) return;
    }
    const had = c.open !== 0;
    this.close(c);
    if (!had && !box) this.onUse.emit(c);
  }
}
