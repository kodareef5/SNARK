// Maintenance and deployment share inventory transactions with every other item use. No client owns a vehicle by naming it.
import type { BitReader } from "../shared/net/codec.ts";
import { handleGen, handleIndex } from "../shared/ids.ts";
import { CHUNK_SIZE, TICK_RATE, WORLD_MAX_Y, WORLD_MIN_Y } from "../shared/coords.ts";
import { hashString } from "../shared/hash.ts";
import { Rng } from "../shared/rng.ts";
import { RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_FULL, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_NO_SUPPORT, RESULT_OBSTRUCTED, RESULT_OK, RESULT_SHORT, SESSION_ALIVE, TEXT_NOTICE, VEHICLE_DEPLOY, VEHICLE_INSPECT, VEHICLE_REFUEL, VEHICLE_REPAIR, VEHICLE_RECOVER } from "../shared/net/protocol.ts";
import { stanceEye, stanceHeight } from "../shared/sim/character.ts";
import { F_ALIVE, F_GROUNDED, F_PROP } from "../shared/sim/entities.ts";
import { FLAG_BLUEPRINT } from "../shared/sim/items.ts";
import { V_HEALTH } from "../shared/sim/vitals.ts";
import { VEHICLE_FUEL_PER_GASOLINE as FUEL_PER_ITEM, VEHICLE_REPAIR_STEP as REPAIR_STEP, VEHICLE_REPAIR_BILL as REPAIR_BILL } from "../shared/sim/vehicle-maintenance.ts";
import { isBoatVehicle, isRotorVehicle, type VehicleDefinition } from "../shared/sim/vehicle.ts";
import { boatRestY } from "../shared/sim/boat.ts";
import { boatPlacement, boatMeetsCapsule, boatMeetsVehicle } from "../shared/world/boat.ts";
import { capsuleFree, groundUnder, type CollisionWorld } from "../shared/world/collide.ts";
import { helicopterPlacement, helicopterMeetsCapsule, helicopterMeetsVehicle } from "../shared/world/helicopter.ts";
import type { MapVehicle } from "../shared/world/mapfile.ts";
import { castWorld, HIT_NONE, rayHit } from "../shared/world/ray.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Survival } from "./survival.ts";
import type { Urban } from "./urban.ts";
import type { ServerWorld } from "./world.ts";

/** Stable authored origin kept by the normal component codec. It never changes when a found aircraft is repaired. */
export const VEHICLE_ORIGIN = 0x766f72;
export interface VehicleStart { y?: number; hull?: number; engine?: number; rotor?: number; fuel?: number; origin?: string }

/** Placement identity, not array position, seeds a found vehicle's condition. Rolls happen only while creating its record. */
export function foundVehicle(map: string, placement: MapVehicle, seed: number): VehicleStart {
  const origin = `${map}/${placement.id ?? `${placement.kind}@${placement.x},${placement.y ?? "ground"},${placement.z}`}`;
  const random = new Rng(hashString(origin, seed));
  const roll = (range: readonly [number, number] | undefined, fallback: number): number => range ? range[0] + random.float() * (range[1] - range[0]) : fallback;
  return { ...(placement.y !== undefined ? { y: placement.y } : {}), hull: roll(placement.condition, 1),
    engine: roll(placement.condition, 1), rotor: roll(placement.condition, 1), fuel: roll(placement.fuel, 1), origin };
}

export interface VehicleServiceContext {
  world: ServerWorld; game: GameServer; records: Records; items: Items; survival: Survival; urban: Urban;
  may(actor: EntityRecord, vehicle: EntityRecord): boolean;
  spawn(kind: string, x: number, z: number, team: number, yaw: number, start: VehicleStart): number;
  /** Rolls back only the new record if an inventory hook changed the assembly during spawn. */
  discard(e: number): void;
}

/** Fraction of a full repair per action. The complete bill is intentionally much less than a new assembly. */
const REACH = 5;
const DEPLOY_REACH = 12;

export class VehicleService {
  readonly ctx: VehicleServiceContext;
  private readonly pushedAt = new Map<number, number>();
  constructor(ctx: VehicleServiceContext) { this.ctx = ctx; }

  command(c: Client, r: BitReader): number {
    const action = r.u8();
    if (action === VEHICLE_DEPLOY) {
      const slot = r.u8(), x = r.f32(), y = r.f32(), z = r.f32(), yaw = r.u16();
      return r.overflow ? RESULT_INVALID : this.deploy(c, slot, x, y, z, yaw * Math.PI * 2 / 65536);
    }
    const handle = r.u32(), count = action === VEHICLE_REFUEL ? r.u8() : 0;
    if (r.overflow) return RESULT_INVALID;
    if (action === VEHICLE_INSPECT) return this.inspect(c, handle);
    if (action === VEHICLE_REFUEL) return this.refuel(c, handle, count);
    if (action === VEHICLE_REPAIR) return this.repair(c, handle);
    if (action === VEHICLE_RECOVER) return this.recover(c, handle);
    return RESULT_INVALID;
  }

  private actor(c: Client): EntityRecord | null {
    const rec = this.ctx.records.byPid.get(c.pid);
    return c.active && !c.closed && c.state === SESSION_ALIVE && c.ent >= 0 && rec && !rec.dead && !rec.out ? rec : null;
  }

  private target(c: Client, handle: number, stopped: boolean): { e: number; rec: EntityRecord; actor: EntityRecord; def: VehicleDefinition } | number {
    const { world, records } = this.ctx, ents = world.ents, actor = this.actor(c);
    if (!actor) return RESULT_DENIED;
    const e = handleIndex(handle), def = world.reg.vehicle[ents.kind[e] ?? 0];
    if (e >= ents.cap || !def || ents.gen[e] !== handleGen(handle) || (ents.flags[e]! & F_ALIVE) === 0) return RESULT_INVALID;
    const rec = records.byPid.get(ents.pid[e]!);
    if (!rec || rec.dead) return RESULT_INVALID;
    // Salvage keeps the aircraft's render kind, but its record and machinery are no longer a live vehicle.
    if (stopped && (ents.flags[e]! & F_PROP) !== 0) return RESULT_INVALID;
    if (!this.ctx.may(actor, rec)) return RESULT_NOT_YOURS;
    if (Math.hypot(ents.x[c.ent]! - ents.x[e]!, ents.y[c.ent]! - ents.y[e]!, ents.z[c.ent]! - ents.z[e]!) > REACH + def.spec.halfWidth) return RESULT_FAR;
    if (!this.visible(c, ents.x[e]!, ents.y[e]! + Math.min(1.3, def.spec.height / 2), ents.z[e]!)) return RESULT_OBSTRUCTED;
    if (stopped) {
      const grounded = (ents.flags[e]! & F_GROUNDED) !== 0;
      const water = world.hf.waterAt(ents.x[e]!, ents.z[e]!);
      const floating = isBoatVehicle(def) && Number.isFinite(water) && water > world.hf.heightAt(ents.x[e]!, ents.z[e]!) + .1 &&
        Math.abs(ents.y[e]! - boatRestY(def.spec, water, ents.vehiclePayloadMass[e]!)) < .45 &&
        Math.abs(ents.vehiclePitch[e]!) < .35 && Math.abs(ents.vehicleRoll[e]!) < .45;
      if ((!grounded && !floating) || Math.hypot(ents.vx[e]!, ents.vy[e]!, ents.vz[e]!) > .15 ||
        (isBoatVehicle(def) && (ents.vehicleEngineOn[e] !== 0 || Math.hypot(ents.vehicleYawRate[e]!, ents.vehiclePitchRate[e]!, ents.vehicleRollRate[e]!) > .12)) ||
        (isRotorVehicle(def) && (ents.vehicleEngineOn[e] !== 0 || ents.vehicleRotorRpm[e]! > 30))) return RESULT_BUSY;
    }
    return { e, rec, actor, def };
  }

  private visible(c: Client, x: number, y: number, z: number): boolean {
    const { world } = this.ctx, ents = world.ents, p = world.reg.move[ents.kind[c.ent]!]!;
    const ox = ents.x[c.ent]!, oy = ents.y[c.ent]! + stanceEye(p, ents.stance[c.ent]!), oz = ents.z[c.ent]!;
    const dx = x - ox, dy = y - oy, dz = z - oz, distance = Math.hypot(dx, dy, dz);
    return distance < .001 || castWorld(world, ox, oy, oz, dx / distance, dy / distance, dz / distance, distance) === HIT_NONE || rayHit.t >= distance - .05;
  }

  inspect(c: Client, handle: number): number {
    const target = this.target(c, handle, false);
    if (typeof target === "number") return target;
    const { e, rec, def } = target, { world, game } = this.ctx, ents = world.ents;
    if ((ents.flags[e]! & F_PROP) !== 0) game.sendText(c, TEXT_NOTICE, `${rec.name || "Vehicle"}: salvage wreck. Recover cargo or harvest the remaining materials.`);
    else {
      const hp = this.health(rec), engine = Math.round(ents.vehicleEngineCondition[e]! * 100), rotor = Math.round(ents.vehicleRotorCondition[e]! * 100);
      game.sendText(c, TEXT_NOTICE, `${rec.name || "Vehicle"}: hull ${Math.round(hp * 100)}%, fuel ${ents.fuel[e]!.toFixed(1)}/${def.spec.fuelCapacity}${isRotorVehicle(def) ? `, engine ${engine}%, rotor ${rotor}%` : isBoatVehicle(def) ? `, propulsion ${engine}%, flooding ${Math.round(ents.vehicleFlooding[e]! * 100)}%` : ""}.`);
    }
    if (c.open !== rec.pid && !game.mayOpen(c, rec.pid)) return RESULT_DENIED;
    c.open = c.open === rec.pid ? 0 : rec.pid;
    return RESULT_OK;
  }

  refuel(c: Client, handle: number, count = 0): number {
    const target = this.target(c, handle, true);
    if (typeof target === "number") return target;
    if (!Number.isInteger(count) || count < 0 || count > 255) return RESULT_INVALID;
    const { e, actor, def } = target, { world, items, urban, game } = this.ctx, ents = world.ents;
    const missing = def.spec.fuelCapacity - ents.fuel[e]!;
    if (missing < .001) return RESULT_FULL;
    const fuel = world.reg.index.get("core:gasoline");
    if (fuel === undefined) return RESULT_INVALID;
    const n = Math.min(count || 255, Math.ceil(missing / FUEL_PER_ITEM), items.inv(actor).total(fuel));
    if (n < 1 || !items.burnItem(actor, fuel, n)) return RESULT_SHORT;
    const add = Math.min(missing, n * FUEL_PER_ITEM);
    ents.fuel[e] = Math.fround(ents.fuel[e]! + add);
    urban.changed(e);
    game.sendText(c, TEXT_NOTICE, `Added ${add.toFixed(1)} fuel.`);
    return RESULT_OK;
  }

  repair(c: Client, handle: number): number {
    const target = this.target(c, handle, true);
    if (typeof target === "number") return target;
    const { e, rec, actor, def } = target, { world, items, survival, urban, game } = this.ctx, ents = world.ents;
    const hull = Math.min(REPAIR_STEP, 1 - this.health(rec));
    const engine = isRotorVehicle(def) || isBoatVehicle(def) ? Math.min(REPAIR_STEP, 1 - ents.vehicleEngineCondition[e]!) : 0;
    const rotor = isRotorVehicle(def) ? Math.min(REPAIR_STEP, 1 - ents.vehicleRotorCondition[e]!) : 0;
    const flooding = isBoatVehicle(def) ? Math.min(REPAIR_STEP, ents.vehicleFlooding[e]!) : 0;
    const fraction = Math.max(hull, engine, rotor, flooding);
    if (fraction < .00001) return RESULT_FULL;
    const costs = REPAIR_BILL.map(([id, full]) => [world.reg.index.get(id) ?? 0, Math.ceil(full * fraction)] as const);
    const inv = items.inv(actor);
    if (costs.some(([item, n]) => item === 0 || inv.total(item) < n)) {
      game.sendText(c, TEXT_NOTICE, `Repair needs ${costs[0]![1]} metal ingots, ${costs[1]![1]} polymer and ${costs[2]![1]} electronics.`);
      return RESULT_SHORT;
    }
    // Every cost was checked before any is spent. All edits join the same ordinary persistence commit.
    for (const [item, n] of costs) items.burnItem(actor, item, n);
    survival.add(rec, V_HEALTH, hull * (rec.vitals?.max[V_HEALTH] ?? 0) / 1e6);
    if (isRotorVehicle(def) || isBoatVehicle(def)) ents.vehicleEngineCondition[e] = Math.fround(Math.min(1, ents.vehicleEngineCondition[e]! + engine));
    if (isRotorVehicle(def)) ents.vehicleRotorCondition[e] = Math.fround(Math.min(1, ents.vehicleRotorCondition[e]! + rotor));
    if (isBoatVehicle(def)) {
      ents.vehicleFlooding[e] = Math.fround(Math.max(0, ents.vehicleFlooding[e]! - flooding));
      ents.vehicleHullCondition[e] = Math.fround(this.health(rec));
    }
    urban.changed(e);
    game.sendText(c, TEXT_NOTICE, "Repaired the hull and mechanical systems by up to 25%.");
    return RESULT_OK;
  }

  private health(rec: EntityRecord): number {
    return rec.vitals ? rec.vitals.at(V_HEALTH, this.ctx.world.tick) / Math.max(1, rec.vitals.max[V_HEALTH]!) : 1;
  }

  /** A nearby survivor can shove a stranded hull toward deeper water. The solver still owns every centimetre moved. */
  recover(c: Client, handle: number): number {
    const target = this.target(c, handle, true);
    if (typeof target === "number") return target;
    const { e, rec, def } = target, { world, urban, game } = this.ctx, ents = world.ents;
    if (!isBoatVehicle(def) || c.drive >= 0 || ents.seat[c.ent] !== 0) return RESULT_DENIED;
    const tick = world.tick;
    if (tick - (this.pushedAt.get(rec.pid) ?? -10000) < 3 * TICK_RATE) return RESULT_BUSY;
    const dx = ents.x[e]! - ents.x[c.ent]!, dz = ents.z[e]! - ents.z[c.ent]!, distance = Math.hypot(dx, dz);
    if (distance < .01) return RESULT_OBSTRUCTED;
    const sn = Math.sin(ents.vehicleYaw[e]!), cs = Math.cos(ents.vehicleYaw[e]!);
    const lx = cs * dx - sn * dz, lz = sn * dx + cs * dz;
    const outside = Math.hypot(Math.max(0, Math.abs(lx) - def.spec.halfWidth), Math.max(0, Math.abs(lz) - def.spec.halfLength));
    if (outside < .05 || outside > 1.5 || Math.abs(ents.y[c.ent]! - ents.y[e]!) > 2) return RESULT_FAR;
    const nx = dx / distance, nz = dz / distance, x = ents.x[e]!, z = ents.z[e]!;
    const move = world.reg.move[ents.kind[c.ent]!]!, height = stanceHeight(move, ents.stance[c.ent]!);
    for (let reach = 0; reach <= Math.max(0, outside - move.radius); reach += .15) {
      const px = ents.x[c.ent]! + nx * reach, pz = ents.z[c.ent]! + nz * reach;
      if (!capsuleFree(world, px, ents.y[c.ent]!, pz, move.radius, height)) return RESULT_OBSTRUCTED;
    }
    const water = world.hf.waterAt(x, z), ground = world.hf.heightAt(x, z);
    const depth = Number.isFinite(water) ? water - ground : -Infinity;
    let deeper = false;
    for (const reach of [2, 4, 6, 8]) {
      const px = x + nx * reach, pz = z + nz * reach;
      if (px < 0 || pz < 0 || px >= world.hf.sizeX || pz >= world.hf.sizeZ) return RESULT_NO_SUPPORT;
      const floor = world.hf.heightAt(px, pz), surface = world.hf.waterAt(px, pz);
      // Never launch uphill, over a seawall, or toward an unrelated raised lake.
      if (floor > ground + .2 || (Number.isFinite(water) && Math.abs(surface - water) > .1)) return RESULT_NO_SUPPORT;
      if (Number.isFinite(surface) && surface - floor > Math.max(def.spec.draft + .15, depth + .1)) deeper = true;
    }
    if (!deeper) return RESULT_NO_SUPPORT;
    const push = Math.min(1.25, Math.sqrt(1800 / Math.max(50, def.spec.mass + urban.payloadMass(e))));
    ents.vx[e] = Math.fround(ents.vx[e]! + nx * push); ents.vz[e] = Math.fround(ents.vz[e]! + nz * push);
    for (const [pid, at] of this.pushedAt) if (tick - at >= 3 * TICK_RATE) this.pushedAt.delete(pid);
    this.pushedAt.set(rec.pid, tick);
    urban.changed(e); ents.pose(e, tick);
    game.sendText(c, TEXT_NOTICE, "Pushed toward deeper water. Move around the hull to change direction.");
    return RESULT_OK;
  }

  deploy(c: Client, slot: number, x: number, y: number, z: number, yaw: number): number {
    const { world, items } = this.ctx, actor = this.actor(c), ents = world.ents;
    if (!actor || c.drive >= 0 || ents.seat[c.ent] !== 0) return RESULT_DENIED;
    const inv = items.inv(actor);
    if (!Number.isInteger(slot) || slot < 0 || slot >= inv.cap || (inv.flags[slot]! & FLAG_BLUEPRINT) !== 0 || inv.count[slot]! < 1) return RESULT_INVALID;
    const item = inv.item[slot]!, kind = world.reg.vehicleDeploy[item]!, def = world.reg.vehicle[kind];
    if (!def || ![x, y, z, yaw].every(Number.isFinite)) return RESULT_INVALID;
    if (Math.hypot(x - ents.x[c.ent]!, y - ents.y[c.ent]!, z - ents.z[c.ent]!) > DEPLOY_REACH) return RESULT_FAR;
    if (y < WORLD_MIN_Y || y > WORLD_MAX_Y || !this.visible(c, x, y + 1, z)) return RESULT_OBSTRUCTED;
    if (!vehiclePlaceFree(world, x, y, z, yaw, def)) return RESULT_NO_SUPPORT;
    const e = this.ctx.spawn(world.reg.ids[kind]!, x, z, actor.team, yaw, { y, fuel: 0, hull: 1, engine: 1, rotor: 1 });
    if (e < 0) return RESULT_OBSTRUCTED;
    if (inv.item[slot] !== item || !items.burn(actor, slot, 1)) { this.ctx.discard(e); return RESULT_INVALID; }
    this.ctx.game.sendText(c, TEXT_NOTICE, `${isBoatVehicle(def) ? "Motorboat" : "Helicopter"} assembled. Add gasoline before starting.`);
    return RESULT_OK;
  }
}

interface HullPart { x: number; y: number; z: number; radius: number; height: number }

/** The upright bodies a vehicle's hull is tested as: along its length, its tail, its rotor's disc, its propeller and outboard. */
function hullParts(x: number, y: number, z: number, yaw: number, def: VehicleDefinition): HullPart[] {
  const spec = def.spec, sn = Math.sin(yaw), cs = Math.cos(yaw), parts: HullPart[] = [];
  const add = (lx: number, ly: number, lz: number, radius: number, height: number): void => { parts.push({ x: x + cs * lx + sn * lz, y: y + ly, z: z - sn * lx + cs * lz, radius, height }); };
  const along = Math.max(0, spec.halfLength - spec.halfWidth);
  for (let i = -2; i <= 2; i++) add(0, spec.clearance, i * along / 2, spec.halfWidth, spec.height - spec.clearance);
  if (isRotorVehicle(def)) {
    const tail = def.spec.tail;
    for (let i = 0; i <= 8; i++) {
      const at = tail.from.map((v, axis) => v + (tail.to[axis]! - v) * i / 8);
      add(at[0]!, at[1]! - tail.radius, at[2]!, tail.radius, tail.radius * 2);
    }
    const main = def.rotors[0]!;
    parts.push({ x: x + cs * main.at[0] + sn * main.at[2], y: y + main.at[1] - .08, z: z - sn * main.at[0] + cs * main.at[2], radius: main.radius, height: .16 });
  }
  if (isBoatVehicle(def)) {
    const prop = def.spec.propeller;
    add(prop.at[0], prop.at[1] - prop.radius, prop.at[2], prop.radius, prop.radius * 2);
    for (const box of [...def.spec.hullBoxes, ...(def.spec.outboard?.boxes ?? [])]) {
      if (Math.abs(box.at[2]) + box.half[2] <= spec.halfLength) continue;
      const radius = Math.min(box.half[0], box.half[2]);
      const steps = Math.max(1, Math.ceil(box.half[2] / radius));
      for (let i = -steps; i <= steps; i++) add(box.at[0], box.at[1] - box.half[1], box.at[2] + i / steps * Math.max(0, box.half[2] - radius), radius, box.half[1] * 2);
    }
  }
  return parts;
}

/**
 * What a vehicle needs of the world itself where it would stand: its own shape there, and its hull's bodies clear of the
 * ground, what is built and what grows, and on a server the unloaded resource-node index. A map build asks this of a
 * found vehicle (tools/helicopter/sites.ts, tools/boat/sites.ts), so a map holds only what a host can park.
 */
export function vehicleFitsWorld(world: CollisionWorld & { readonly unloaded?: ServerWorld["unloaded"] }, x: number, y: number, z: number, yaw: number, def: VehicleDefinition): boolean {
  if (![x, y, z, yaw].every(Number.isFinite)) return false;
  if (isRotorVehicle(def)) {
    if (!helicopterPlacement(world, x, y, z, yaw, def)) return false;
  } else if (isBoatVehicle(def)) {
    if (!boatPlacement(world, x, y, z, yaw, def)) return false;
  } else if (Math.abs(y - groundUnder(world.hf, x, z, def.spec.halfWidth)) > .2) return false;
  const unloaded = world.unloaded ?? null, sn = Math.sin(yaw), cs = Math.cos(yaw);
  if (isRotorVehicle(def) && unloaded) {
    // The disc is shallow, while a capsule with its radius would be a 9 m tall sphere: unloaded nodes are met by small
    // spheres over it. Static geometry was checked by the shared helper.
    const main = def.rotors[0]!;
    for (let rz = -main.radius; rz <= main.radius; rz += .2) for (let rx = -main.radius; rx <= main.radius; rx += .2) {
      if (rx * rx + rz * rz > main.radius * main.radius) continue;
      const px = x + cs * (main.at[0] + rx) + sn * (main.at[2] + rz), pz = z - sn * (main.at[0] + rx) + cs * (main.at[2] + rz);
      if (unloaded.meets(px, y + main.at[1] - .15, pz, .15, .3)) return false;
    }
  }
  for (const part of hullParts(x, y, z, yaw, def)) {
    if (part.height > .2 && (!capsuleFree(world, part.x, part.y, part.z, part.radius, part.height) || (unloaded?.meets(part.x, part.y, part.z, part.radius, part.height) ?? false))) return false;
  }
  return true;
}

/** Shared by authored parking and deployment: the world itself (vehicleFitsWorld), then the bodies standing there. */
export function vehiclePlaceFree(world: ServerWorld, x: number, y: number, z: number, yaw: number, def: VehicleDefinition): boolean {
  if (!vehicleFitsWorld(world, x, y, z, yaw, def)) return false;
  const ents = world.ents;
  if (isRotorVehicle(def) || isBoatVehicle(def)) {
    // The whole rigid vehicle against each body near, by its exact shape, adjacent rotor discs included.
    const posed = { x, y, z, yaw, pitch: 0, roll: 0 }, pad = 15;
    for (let cz = Math.max(0, Math.floor((z - pad) / CHUNK_SIZE)); cz <= Math.min(world.dims.chunksZ - 1, Math.floor((z + pad) / CHUNK_SIZE)); cz++) {
      for (let cx = Math.max(0, Math.floor((x - pad) / CHUNK_SIZE)); cx <= Math.min(world.dims.chunksX - 1, Math.floor((x + pad) / CHUNK_SIZE)); cx++) {
        for (let e = ents.chunkHead[cz * world.dims.chunksX + cx]!; e >= 0; e = ents.next[e]!) {
          if (!(ents.flags[e]! & F_ALIVE)) continue;
          const kind = ents.kind[e]!, other = world.reg.vehicle[kind];
          const frame = {
            x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, yaw: ents.vehicleYaw[e]!, pitch: ents.vehiclePitch[e]!, roll: ents.vehicleRoll[e]!, steering: ents.steering[e]!,
            ...(other && (isRotorVehicle(other) || isBoatVehicle(other)) ? { qx: ents.vehicleQx[e]!, qy: ents.vehicleQy[e]!, qz: ents.vehicleQz[e]!, qw: ents.vehicleQw[e]! } : {}),
          };
          const hit = isBoatVehicle(def)
            ? other ? boatMeetsVehicle(def, posed, other, frame) : boatMeetsCapsule(def, posed, ents.x[e]!, ents.y[e]!, ents.z[e]!, world.reg.bodyRadius[kind]!, world.reg.bodyHeight[kind]!)
            : other ? helicopterMeetsVehicle(def, posed, other, frame) : helicopterMeetsCapsule(def, posed, ents.x[e]!, ents.y[e]!, ents.z[e]!, world.reg.bodyRadius[kind]!, world.reg.bodyHeight[kind]!);
          if (hit) return false;
        }
      }
    }
    return true;
  }
  // A car's bodies against the bodies near, which are apart from the static world: nearby chunks and vertical overlap.
  for (const part of hullParts(x, y, z, yaw, def)) {
    const pad = part.radius + 8;
    for (let cz = Math.max(0, Math.floor((part.z - pad) / CHUNK_SIZE)); cz <= Math.min(world.dims.chunksZ - 1, Math.floor((part.z + pad) / CHUNK_SIZE)); cz++) {
      for (let cx = Math.max(0, Math.floor((part.x - pad) / CHUNK_SIZE)); cx <= Math.min(world.dims.chunksX - 1, Math.floor((part.x + pad) / CHUNK_SIZE)); cx++) {
        for (let e = ents.chunkHead[cz * world.dims.chunksX + cx]!; e >= 0; e = ents.next[e]!) {
          const k = ents.kind[e]!;
          if ((ents.flags[e]! & F_ALIVE) === 0 || part.y >= ents.y[e]! + world.reg.bodyHeight[k]! || part.y + part.height <= ents.y[e]!) continue;
          const other = world.reg.vehicle[k];
          if (other) {
            const a = ents.vehicleYaw[e]!, dx = part.x - ents.x[e]!, dz = part.z - ents.z[e]!;
            const lx = Math.cos(a) * dx - Math.sin(a) * dz, lz = Math.sin(a) * dx + Math.cos(a) * dz;
            if (Math.hypot(Math.max(0, Math.abs(lx) - other.spec.halfWidth), Math.max(0, Math.abs(lz) - other.spec.halfLength)) < part.radius) return false;
          } else if (Math.hypot(part.x - ents.x[e]!, part.z - ents.z[e]!) < part.radius + world.reg.bodyRadius[k]!) return false;
        }
      }
    }
  }
  return true;
}
