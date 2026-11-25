// Maintenance and deployment share inventory transactions with every other item use. No client owns a vehicle by naming it.
import type { BitReader } from "../shared/net/codec.ts";
import { handleGen, handleIndex, makeHandle } from "../shared/ids.ts";
import { CHUNK_SIZE, TICK_RATE, WORLD_MAX_Y, WORLD_MIN_Y } from "../shared/coords.ts";
import { hashString } from "../shared/hash.ts";
import { Rng } from "../shared/rng.ts";
import { RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_FULL, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_NO_SUPPORT, RESULT_OBSTRUCTED, RESULT_OK, RESULT_SHORT, SESSION_ALIVE, TEXT_NOTICE, VEHICLE_DEPLOY, VEHICLE_PACK, VEHICLE_RIDE, VEHICLE_INSPECT, VEHICLE_REFUEL, VEHICLE_REPAIR, VEHICLE_RECOVER, VEHICLE_FLIP, VEHICLE_PULL, VEHICLE_LIGHTS, VEHICLE_DOOR } from "../shared/net/protocol.ts";
import { stanceEye, stanceHeight } from "../shared/sim/character.ts";
import { F_ALIVE, F_GROUNDED, F_PROP } from "../shared/sim/entities.ts";
import { FLAG_BLUEPRINT } from "../shared/sim/items.ts";
import { V_HEALTH } from "../shared/sim/vitals.ts";
import { VEHICLE_FUEL_PER_GASOLINE as FUEL_PER_ITEM, VEHICLE_REPAIR_STEP as REPAIR_STEP, VEHICLE_REPAIR_BILL as REPAIR_BILL } from "../shared/sim/vehicle-maintenance.ts";
import { skatePlacement } from "../shared/world/skate-placement.ts";
import { isSkateboard, PATROL_LIGHT_MODES, isBoatVehicle, isRotorVehicle, isWheelVehicle, type VehicleDefinition } from "../shared/sim/vehicle.ts";
import { vehiclePoint } from "../shared/sim/vehicle-frame.ts";
import { boatRestY } from "../shared/sim/boat.ts";
import { capsuleFree, groundUnder, type CollisionWorld } from "../shared/world/collide.ts";
import type { MapVehicle } from "../shared/world/mapfile.ts";
import { castWorld, HIT_NONE, rayHit } from "../shared/world/ray.ts";
import { vehicleSolidRadius } from "../shared/world/vehicle-shapes.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Survival } from "./survival.ts";
import type { Urban } from "./urban.ts";
import type { ServerWorld } from "./world.ts";
import { supportedCar, uprightCar } from "./vehicle-recovery.ts";
import { familyOf } from "../shared/sim/families.ts";
import { hullParts, partMeetsBody } from "../shared/sim/vehicle-hull.ts";

/** Stable authored origin kept by the normal component codec. It never changes when a found aircraft is repaired. */
export const VEHICLE_ORIGIN = 0x766f72;
export interface VehicleStart { y?: number; hull?: number; engine?: number; rotor?: number; fuel?: number; origin?: string;
  /** An aircraft placed in flight at `y`: open air is enough, it needs no ground under it. */
  airborne?: boolean }

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
  /** Removes a packed vehicle or rolls back an assembly that failed to deploy. */
  discard(e: number): void;
}

/** Fraction of a full repair per action. The complete bill is intentionally much less than a new assembly. */
const REACH = 5;
const DEPLOY_REACH = 12;

export class VehicleService {
  readonly ctx: VehicleServiceContext;
  private readonly flipAfter = new WeakMap<Client, number>();
  private readonly pushedAt = new Map<number, number>();
  constructor(ctx: VehicleServiceContext) { this.ctx = ctx; }

  command(c: Client, r: BitReader): number {
    const action = r.u8();
    if (action === VEHICLE_DEPLOY) {
      const slot = r.u8(), x = r.f32(), y = r.f32(), z = r.f32(), yaw = r.u16();
      return r.overflow ? RESULT_INVALID : this.deploy(c, slot, x, y, z, yaw * Math.PI * 2 / 65536);
    }
    if (action === VEHICLE_RIDE) {
      const slot = r.u8(), yaw = r.u16();
      return r.overflow ? RESULT_INVALID : this.dropAndRide(c, slot, yaw * Math.PI * 2 / 65536);
    }
    const handle = r.u32(), count = action === VEHICLE_REFUEL ? r.u8() : 0;
    if (r.overflow) return RESULT_INVALID;
    if (action === VEHICLE_LIGHTS) {
      const { world, urban } = this.ctx, ents = world.ents, e = handleIndex(handle);
      if (e >= ents.cap || ents.gen[e] !== handleGen(handle) || (ents.flags[e]! & (F_ALIVE | F_PROP)) !== F_ALIVE) return RESULT_INVALID;
      const def = world.reg.vehicle[ents.kind[e]!];
      if (!def || !isWheelVehicle(def) || !def.emergencyLights) return RESULT_INVALID;
      if (!this.actor(c) || c.drive !== e) return RESULT_DENIED;
      urban.setLightMode(e, (ents.vehicleLightMode[ents.vrow[e]!]! + 1) % PATROL_LIGHT_MODES.length);
      return RESULT_OK;
    }
    if (action === VEHICLE_DOOR) {
      const rec = this.actor(c);
      return rec && this.ctx.urban.toggleDoor(rec.pid) ? RESULT_OK : RESULT_INVALID;
    }
    if (action === VEHICLE_PACK) return this.packBoard(c, handle);
    if (action === VEHICLE_INSPECT) return this.inspect(c, handle);
    if (action === VEHICLE_REFUEL) return this.refuel(c, handle, count);
    if (action === VEHICLE_REPAIR) return this.repair(c, handle);
    if (action === VEHICLE_RECOVER || action === VEHICLE_PULL) return this.recover(c, handle, action === VEHICLE_PULL);
    if (action === VEHICLE_FLIP) return this.flip(c, handle);
    return RESULT_INVALID;
  }

  private actor(c: Client): EntityRecord | null {
    const rec = this.ctx.records.byPid.get(c.pid);
    return c.active && !c.closed && c.state === SESSION_ALIVE && c.ent >= 0 && rec && !rec.dead && !rec.out ? rec : null;
  }

  private target(c: Client, handle: number, stopped: boolean, shorePush = false): { e: number; v: number; rec: EntityRecord; actor: EntityRecord; def: VehicleDefinition } | number {
    const { world, records } = this.ctx, ents = world.ents, actor = this.actor(c);
    if (!actor) return RESULT_DENIED;
    const e = handleIndex(handle), def = world.reg.vehicle[ents.kind[e] ?? 0];
    if (e >= ents.cap || !def || ents.gen[e] !== handleGen(handle) || (ents.flags[e]! & F_ALIVE) === 0) return RESULT_INVALID;
    const rec = records.byPid.get(ents.pid[e]!);
    if (!rec || rec.dead) return RESULT_INVALID;
    // Salvage keeps the aircraft's render kind, but its record and machinery are no longer a live vehicle.
    if (stopped && (ents.flags[e]! & F_PROP) !== 0) return RESULT_INVALID;
    if (!this.ctx.may(actor, rec)) return RESULT_NOT_YOURS;
    const reach = this.reach(c, e, def);
    if (reach !== RESULT_OK) return reach;
    if (stopped) {
      const v = ents.vrow[e]!;
      const grounded = (ents.flags[e]! & F_GROUNDED) !== 0;
      const water = world.hf.waterAt(ents.x[e]!, ents.z[e]!);
      const floating = isBoatVehicle(def) && Number.isFinite(water) && water > world.hf.heightAt(ents.x[e]!, ents.z[e]!) + .1 &&
        Math.abs(ents.y[e]! - boatRestY(def.spec, water, ents.vehiclePayloadMass[v]!)) < .45 &&
        Math.abs(ents.vehiclePitch[v]!) < .35 && Math.abs(ents.vehicleRoll[v]!) < .45;
      const supported = grounded || floating || (isWheelVehicle(def) && supportedCar(world, e, def));
      // A dry hull can rock slightly on the keel. Authorize a shore shove from its
      // linear and angular speed while supported. Maintenance keeps the ordinary rest limit.
      const beached = shorePush && grounded && isBoatVehicle(def) && world.hf.heightAt(ents.x[e]!, ents.z[e]!) >= water - def.spec.draft;
      const speedOK = beached
        ? Math.hypot(ents.vx[e]!, ents.vz[e]!) < .25 && Math.abs(ents.vy[e]!) < .55
        : Math.hypot(ents.vx[e]!, ents.vy[e]!, ents.vz[e]!) <= .15;
      if (!supported || !speedOK ||
        (isBoatVehicle(def) && ents.vehicleEngineOn[v] !== 0) ||
        (!isRotorVehicle(def) && Math.hypot(ents.vehicleYawRate[v]!, ents.vehiclePitchRate[v]!, ents.vehicleRollRate[v]!) > (beached ? .3 : .12)) ||
        (isRotorVehicle(def) && (ents.vehicleEngineOn[v] !== 0 || ents.vehicleRotorRpm[v]! > 30))) return RESULT_BUSY;
    }
    return { e, v: ents.vrow[e]!, rec, actor, def };
  }

  /** Check the same authority, position and sightline when cargo opens, stays open, or changes hands. */
  keepsBoatCargo(c: Client, e: number): boolean {
    return typeof this.target(c, makeHandle(e, this.ctx.world.ents.gen[e]!), false) !== "number";
  }

  private reach(c: Client, e: number, def: VehicleDefinition): number {
    const ents = this.ctx.world.ents, x = ents.x[e]!, y = ents.y[e]!, z = ents.z[e]!;
    const px = ents.x[c.ent]!, py = ents.y[c.ent]!, pz = ents.z[c.ent]!;
    const centre = Math.hypot(px - x, py - y, pz - z) <= REACH + def.spec.halfWidth;
    if (centre && this.visible(c, x, y + Math.min(1.3, def.spec.height / 2), z)) return RESULT_OK;
    let result = centre ? RESULT_OBSTRUCTED : RESULT_FAR;
    if (!isBoatVehicle(def)) return result;
    const v = ents.vrow[e]!, frame = { x, y, z, yaw: ents.vehicleYaw[v]!, pitch: ents.vehiclePitch[v]!, roll: ents.vehicleRoll[v]!,
      qx: ents.vehicleQx[v]!, qy: ents.vehicleQy[v]!, qz: ents.vehicleQz[v]!, qw: ents.vehicleQw[v]! };
    const boarding = def.boarding;
    const seat = ents.seat[c.ent] === e + 1 && ents.seatGen[c.ent] === ents.gen[e] ? def.seats[ents.seatSlot[c.ent]! - 1] : undefined;
    const points = boarding ? [boarding.water, boarding.ladder, boarding.deck] : [];
    if (seat) points.push(seat.anchor);
    const at = [0, 0, 0];
    for (const point of points) {
      vehiclePoint(frame, point, at);
      if (Math.hypot(px - at[0]!, py - at[1]!, pz - at[2]!) > REACH) continue;
      if (this.visible(c, at[0]!, at[1]!, at[2]!)) return RESULT_OK;
      result = RESULT_OBSTRUCTED;
    }
    return result;
  }

  private visible(c: Client, x: number, y: number, z: number): boolean {
    const { world } = this.ctx, ents = world.ents, p = world.reg.move[ents.kind[c.ent]!]!;
    const ox = ents.x[c.ent]!, oy = ents.y[c.ent]! + stanceEye(p, ents.stance[c.ent]!), oz = ents.z[c.ent]!;
    const dx = x - ox, dy = y - oy, dz = z - oz, distance = Math.hypot(dx, dy, dz);
    return distance < .001 || castWorld(world, ox, oy, oz, dx / distance, dy / distance, dz / distance, distance) === HIT_NONE || rayHit.t >= distance - .05;
  }

  packBoard(c: Client, handle: number): number {
    const target = this.target(c, handle, false);
    if (typeof target === "number") return target;
    const { actor, rec, def, e } = target, { items, world, urban, game } = this.ctx;
    // Riding it slowly, the rider steps off and picks it up in one go.
    const riding = c.drive === e && isSkateboard(def) && Math.hypot(world.ents.vx[e]!, world.ents.vz[e]!) < 1;
    if (riding && !urban.standOff(c)) return RESULT_DENIED;
    if (!isSkateboard(def) || actor.team !== rec.team || c.drive >= 0 || world.ents.seat[c.ent]) return RESULT_DENIED;
    if (world.ents.flags[e]! & F_PROP) return RESULT_INVALID;
    if (urban.hasOccupants(e) || (!riding && Math.hypot(world.ents.vx[e]!, world.ents.vy[e]!, world.ents.vz[e]!) > .4)) return RESULT_BUSY;
    if (items.inv(rec).count.some(n => n > 0)) {
      game.sendText(c, TEXT_NOTICE, "Empty the deck storage before picking it up.");
      return this.inspect(c, handle);
    }
    const item = world.reg.vehicleDeploy.indexOf(rec.kind);
    // A newly crafted kit has zero wear data. A packed one carries the condition of this deck.
    const condition = Math.max(1, Math.round(this.health(rec) * 1000));
    if (item < 0 || !items.mint(actor, item, 1, 0, condition, -1, "pack skateboard", 0, 1)) return RESULT_FULL;
    for (const client of game.clients) if (client?.open === rec.pid) client.open = 0;
    this.ctx.discard(e);
    game.sendText(c, TEXT_NOTICE, "Picked up street skateboard.");
    return RESULT_OK;
  }

  inspect(c: Client, handle: number): number {
    const target = this.target(c, handle, false);
    if (typeof target === "number") return target;
    const { e, v, rec, def } = target, { world, game } = this.ctx, ents = world.ents;
    if ((ents.flags[e]! & F_PROP) !== 0) game.sendText(c, TEXT_NOTICE, `${rec.name || "Vehicle"}: salvage wreck. Recover cargo or harvest the remaining materials.`);
    else if (isSkateboard(def)) game.sendText(c, TEXT_NOTICE, `Street skateboard · ${Math.round(this.health(rec)*100)}% health`);
    else {
      const hp = this.health(rec), engine = Math.round(ents.vehicleEngineCondition[v]! * 100), rotor = Math.round(ents.vehicleRotorCondition[v]! * 100);
      const condition = isRotorVehicle(def) ? `hull ${Math.round(hp * 100)}%` : `health ${Math.round(hp * 100)}%, hull ${Math.round(ents.vehicleHullCondition[v]! * 100)}%`;
      game.sendText(c, TEXT_NOTICE, `${rec.name || "Vehicle"}: ${condition}, fuel ${ents.fuel[v]!.toFixed(1)}/${def.spec.fuelCapacity}${isRotorVehicle(def) ? `, engine ${engine}%, rotor ${rotor}%` : isBoatVehicle(def) ? `, propulsion ${engine}%, flooding ${Math.round(ents.vehicleFlooding[v]! * 100)}%` : `, engine ${engine}%, flooding ${Math.round(ents.vehicleFlooding[v]! * 100)}%`}.`);
    }
    if (c.open !== rec.pid && !game.mayOpen(c, rec.pid)) return RESULT_DENIED;
    c.open = c.open === rec.pid ? 0 : rec.pid;
    return RESULT_OK;
  }

  refuel(c: Client, handle: number, count = 0): number {
    const target = this.target(c, handle, true);
    if (typeof target === "number") return target;
    if (!Number.isInteger(count) || count < 0 || count > 255) return RESULT_INVALID;
    const { e, v, actor, def } = target, { world, items, urban, game } = this.ctx, ents = world.ents;
    const missing = def.spec.fuelCapacity - ents.fuel[v]!;
    if (missing < .001) return RESULT_FULL;
    const fuel = world.reg.index.get("core:gasoline");
    if (fuel === undefined) return RESULT_INVALID;
    const n = Math.min(count || 255, Math.ceil(missing / FUEL_PER_ITEM), items.inv(actor).total(fuel));
    if (n < 1 || !items.burnItem(actor, fuel, n)) return RESULT_SHORT;
    const add = Math.min(missing, n * FUEL_PER_ITEM);
    ents.fuel[v] = Math.fround(ents.fuel[v]! + add);
    urban.changed(e);
    game.sendText(c, TEXT_NOTICE, `Added ${add.toFixed(1)} fuel.`);
    return RESULT_OK;
  }

  repair(c: Client, handle: number): number {
    const target = this.target(c, handle, true);
    if (typeof target === "number") return target;
    const { e, v, rec, actor, def } = target, { world, items, survival, urban, game } = this.ctx, ents = world.ents;
    if (isWheelVehicle(def) && ents.y[e]! + def.spec.clearance < world.hf.waterAt(ents.x[e]!, ents.z[e]!)) return RESULT_BUSY;
    urban.changed(e); // Account for pending damage before maintenance restores health.
    const hull = Math.min(REPAIR_STEP, Math.max(1 - this.health(rec), isRotorVehicle(def) ? 0 : 1 - ents.vehicleHullCondition[v]!));
    const engine = Math.min(REPAIR_STEP, 1 - ents.vehicleEngineCondition[v]!);
    const rotor = isRotorVehicle(def) ? Math.min(REPAIR_STEP, 1 - ents.vehicleRotorCondition[v]!) : 0;
    const flooding = !isRotorVehicle(def) ? Math.min(REPAIR_STEP, ents.vehicleFlooding[v]!) : 0;
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
    ents.vehicleEngineCondition[v] = Math.fround(Math.min(1, ents.vehicleEngineCondition[v]! + engine));
    if (isRotorVehicle(def)) ents.vehicleRotorCondition[v] = Math.fround(Math.min(1, ents.vehicleRotorCondition[v]! + rotor));
    if (!isRotorVehicle(def)) {
      ents.vehicleFlooding[v] = Math.fround(Math.max(0, ents.vehicleFlooding[v]! - flooding));
      ents.vehicleHullCondition[v] = Math.fround(Math.min(1, ents.vehicleHullCondition[v]! + hull));
    }
    urban.changed(e);
    game.sendText(c, TEXT_NOTICE, "Repaired the hull and mechanical systems by up to 25%.");
    return RESULT_OK;
  }

  private health(rec: EntityRecord): number {
    return rec.vitals ? rec.vitals.at(V_HEALTH, this.ctx.world.tick) / Math.max(1, rec.vitals.max[V_HEALTH]!) : 1;
  }

  flip(c: Client, handle: number): number {
    const tick = this.ctx.world.tick;
    if (tick < (this.flipAfter.get(c) ?? 0)) return RESULT_BUSY;
    // Charge attempts before the support and rotation sweeps, including a blocked attempt.
    this.flipAfter.set(c, tick + 3 * TICK_RATE);
    const target = this.target(c, handle, true);
    if (typeof target === "number") return target;
    const { e, v, def } = target, { world, urban, game } = this.ctx, ents = world.ents;
    if (!isWheelVehicle(def) || c.drive >= 0 || ents.seat[c.ent] !== 0 || urban.hasOccupants(e)) return RESULT_DENIED;
    if (Math.hypot(ents.vehiclePitchRate[v]!, ents.vehicleYawRate[v]!, ents.vehicleRollRate[v]!) > .12) return RESULT_BUSY;
    const pose = uprightCar(world, e, def);
    if (!pose) return RESULT_OBSTRUCTED;
    ents.setPosition(e, pose.x, pose.y, pose.z);
    ents.vehicleQx[v] = pose.qx; ents.vehicleQy[v] = pose.qy; ents.vehicleQz[v] = pose.qz; ents.vehicleQw[v] = pose.qw;
    ents.vehiclePitch[v] = ents.vehicleRoll[v] = 0;
    ents.vehicleYawRate[v] = ents.vehiclePitchRate[v] = ents.vehicleRollRate[v] = 0;
    ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
    ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    urban.changed(e); world.history.discontinuity(e); ents.pose(e, world.tick);
    game.sendText(c, TEXT_NOTICE, ents.vehicleEngineCondition[v] === 0 ? "Car righted. Repair its engine on shore." : "Car righted.");
    return RESULT_OK;
  }

  /** A nearby survivor can shove a stranded hull toward deeper water. The solver still owns every centimetre moved. */
  recover(c: Client, handle: number, pull = false): number {
    const target = this.target(c, handle, true, true);
    if (typeof target === "number") return target;
    const { e, rec, def } = target, { world, urban, game } = this.ctx, ents = world.ents;
    if ((!isBoatVehicle(def) && !isWheelVehicle(def)) || c.drive >= 0 || ents.seat[c.ent] !== 0 || urban.hasOccupants(e) || (pull && !isWheelVehicle(def))) return RESULT_DENIED;
    if (isWheelVehicle(def) && ents.vehicleFlooding[target.v]! <= .001) return RESULT_DENIED;
    const tick = world.tick;
    if (tick - (this.pushedAt.get(rec.pid) ?? -10000) < 3 * TICK_RATE) return RESULT_BUSY;
    const dx = ents.x[e]! - ents.x[c.ent]!, dz = ents.z[e]! - ents.z[c.ent]!, distance = Math.hypot(dx, dz);
    if (distance < .01) return RESULT_OBSTRUCTED;
    const yaw = ents.vehicleYaw[ents.vrow[e]!]!, sn = Math.sin(yaw), cs = Math.cos(yaw);
    const lx = cs * dx - sn * dz, lz = sn * dx + cs * dz;
    const outside = Math.hypot(Math.max(0, Math.abs(lx) - def.spec.halfWidth), Math.max(0, Math.abs(lz) - def.spec.halfLength));
    if (outside < .05 || outside > 1.5 || Math.abs(ents.y[c.ent]! - ents.y[e]!) > 2) return RESULT_FAR;
    const towardX = dx / distance, towardZ = dz / distance, sign = pull ? -1 : 1;
    const nx = towardX * sign, nz = towardZ * sign, x = ents.x[e]!, z = ents.z[e]!;
    const move = world.reg.move[ents.kind[c.ent]!]!, height = stanceHeight(move, ents.stance[c.ent]!);
    for (let reach = 0; reach <= Math.max(0, outside - move.radius); reach += .15) {
      const px = ents.x[c.ent]! + towardX * reach, pz = ents.z[c.ent]! + towardZ * reach;
      const floor = groundUnder(world.hf, px, pz, move.radius), py = Math.max(ents.y[c.ent]!, floor + .025);
      if (py - ents.y[c.ent]! > move.stepUp || !capsuleFree(world, px, py, pz, move.radius, height)) return RESULT_OBSTRUCTED;
    }
    if (isBoatVehicle(def)) {
      const water = world.hf.waterAt(x, z), ground = world.hf.heightAt(x, z);
      const depth = Number.isFinite(water) ? water - ground : -Infinity;
      let deeper = false;
      for (let reach = 2; reach <= 32; reach += 2) {
        const px = x + nx * reach, pz = z + nz * reach;
        if (px < 0 || pz < 0 || px >= world.hf.sizeX || pz >= world.hf.sizeZ) return RESULT_NO_SUPPORT;
        const floor = world.hf.heightAt(px, pz), surface = world.hf.waterAt(px, pz);
        // Never launch uphill, over a seawall, or toward an unrelated raised lake.
        if (floor > ground + .2 || (Number.isFinite(water) && Math.abs(surface - water) > .1)) return RESULT_NO_SUPPORT;
        if (Number.isFinite(surface) && surface - floor > Math.max(def.spec.draft + .15, depth + .1)) { deeper = true; break; }
      }
      if (!deeper) return RESULT_NO_SUPPORT;
    }
    const push = Math.min(isWheelVehicle(def) ? 2 : 1.25, Math.sqrt((isWheelVehicle(def) ? 3600 : 1800) / Math.max(50, (def.spec.mass ?? 1100) + urban.payloadMass(e))));
    ents.vx[e] = Math.fround(ents.vx[e]! + nx * push); ents.vz[e] = Math.fround(ents.vz[e]! + nz * push);
    for (const [pid, at] of this.pushedAt) if (tick - at >= 3 * TICK_RATE) this.pushedAt.delete(pid);
    this.pushedAt.set(rec.pid, tick);
    if (isWheelVehicle(def)) urban.push(e, nx, nz);
    urban.changed(e); ents.pose(e, tick);
    game.sendText(c, TEXT_NOTICE, isBoatVehicle(def) ? "Pushed toward deeper water. Move around the hull to change direction." : pull ? "Pulled toward you. Step back to keep the path clear." : "Pushed away from you. Move around the car to change direction.");
    return RESULT_OK;
  }

  /** A board from the bag set down at the survivor's feet and stepped onto at once. */
  dropAndRide(c: Client, slot: number, yaw: number): number {
    const { world, items, urban } = this.ctx, actor = this.actor(c), ents = world.ents;
    if (!actor || c.drive >= 0 || ents.seat[c.ent] !== 0) return RESULT_DENIED;
    const inv = items.inv(actor);
    if (!Number.isInteger(slot) || slot < 0 || slot >= inv.cap || inv.count[slot]! < 1) return RESULT_INVALID;
    if (!isSkateboard(world.reg.vehicle[world.reg.vehicleDeploy[inv.item[slot]!]!])) return RESULT_INVALID;
    const placed = this.deploy(c, slot, ents.x[c.ent]!, ents.y[c.ent]!, ents.z[c.ent]!, yaw, c.ent);
    return placed === RESULT_OK && this.placed >= 0 ? urban.mount(c, this.placed) : placed;
  }

  /** The vehicle the last deploy made, or -1. */
  private placed = -1;

  deploy(c: Client, slot: number, x: number, y: number, z: number, yaw: number, under = -1): number {
    const { world, items } = this.ctx, actor = this.actor(c), ents = world.ents;
    this.placed = -1;
    if (!actor || c.drive >= 0 || ents.seat[c.ent] !== 0) return RESULT_DENIED;
    const inv = items.inv(actor);
    if (!Number.isInteger(slot) || slot < 0 || slot >= inv.cap || (inv.flags[slot]! & FLAG_BLUEPRINT) !== 0 || inv.count[slot]! < 1) return RESULT_INVALID;
    const item = inv.item[slot]!, kind = world.reg.vehicleDeploy[item]!, def = world.reg.vehicle[kind];
    if (!def || ![x, y, z, yaw].every(Number.isFinite)) return RESULT_INVALID;
    if (Math.hypot(x - ents.x[c.ent]!, y - ents.y[c.ent]!, z - ents.z[c.ent]!) > DEPLOY_REACH) return RESULT_FAR;
    if (y < WORLD_MIN_Y || y > WORLD_MAX_Y || !this.visible(c, x, y + 1, z)) return RESULT_OBSTRUCTED;
    const problem = vehiclePlaceProblem(world, x, y, z, yaw, def, under);
    if (problem !== RESULT_OK) return problem;
    const hull = isSkateboard(def) && inv.dur[slot] ? Math.min(1, inv.dur[slot]! / 1000) : 1;
    const e = this.ctx.spawn(world.reg.ids[kind]!, x, z, actor.team, yaw, { y, fuel: 0, hull, engine: 1, rotor: 1 });
    if (e < 0) return RESULT_OBSTRUCTED;
    if (inv.item[slot] !== item || !items.burn(actor, slot, 1)) { this.ctx.discard(e); return RESULT_INVALID; }
    this.placed = e;
    if (under < 0) this.ctx.game.sendText(c, TEXT_NOTICE, isSkateboard(def) ? "Skateboard ready. Look at the deck and press E to ride." : `${assembledName(world.reg, item, kind)} assembled. Add gasoline before starting.`);
    return RESULT_OK;
  }
}

/** What a deployed vehicle is called: its kit's label without "assembly", "kit" or "in a kit", else its id's name. */
function assembledName(reg: ServerWorld["reg"], item: number, kind: number): string {
  const label = (reg.defs[item] as { label?: string } | null)?.label?.replace(/\s+(?:in an?\s+)?(?:assembly|kit)$/i, "");
  const name = label || reg.ids[kind]!.slice(reg.ids[kind]!.indexOf(":") + 1).replace(/_/g, " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * What a vehicle needs of the world itself where it would stand: its own shape there, and its hull's bodies clear of the
 * ground, what is built and what grows, and on a server the unloaded resource-node index. A map build asks this of a
 * found vehicle (tools/helicopter/sites.ts, tools/boat/sites.ts), so a map holds only what a host can park.
 */
export function vehicleFitsWorld(world: CollisionWorld & { readonly unloaded?: ServerWorld["unloaded"] }, x: number, y: number, z: number, yaw: number, def: VehicleDefinition): boolean {
  if (![x, y, z, yaw].every(Number.isFinite)) return false;
  if (isSkateboard(def)) return skatePlacement(world, x, y, z) && !world.unloaded?.meets(x, y+.04, z, .4, 1.8);
  if (!familyOf(def)!.supports(world, x, y, z, yaw, def)) return false;
  if (isBoatVehicle(def)) {
    // The compound hull already cleared terrain and loaded solids, including the waterway between sponsons.
    // Unloaded resource nodes expose only a capsule query.
    const unloaded = world.unloaded;
    return !unloaded || !hullParts(x, y, z, yaw, def).some(part =>
      part.height > .2 && unloaded.meets(part.x, part.y, part.z, part.radius, part.height));
  }
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

const parkedRadii = new WeakMap<ServerWorld["reg"], number>();
function largestParkedRadius(reg: ServerWorld["reg"]): number {
  const cached = parkedRadii.get(reg);
  if (cached !== undefined) return cached;
  let radius = 0;
  for (const [kind, vehicle] of reg.vehicle.entries()) {
    radius = Math.max(radius, vehicle ? vehicleSolidRadius(vehicle) : reg.bodyRadius[kind]!);
  }
  parkedRadii.set(reg, radius);
  return radius;
}

/** Shared by authored parking and deployment: the world itself (vehicleFitsWorld), then the bodies standing there. */
export function vehiclePlaceFree(world: ServerWorld, x: number, y: number, z: number, yaw: number, def: VehicleDefinition, under = -1): boolean {
  return vehiclePlaceProblem(world, x, y, z, yaw, def, under) === RESULT_OK;
}

/**
 * Why a vehicle may not stand there, or RESULT_OK: no support where the world itself refuses it, obstructed where a body
 * stands in the way. `under` is a body the vehicle may be set down beneath: a survivor dropping a board at their feet.
 */
export function vehiclePlaceProblem(world: ServerWorld, x: number, y: number, z: number, yaw: number, def: VehicleDefinition, under = -1): number {
  if (!vehicleFitsWorld(world, x, y, z, yaw, def)) return RESULT_NO_SUPPORT;
  const ents = world.ents, parkedRadius = largestParkedRadius(world.reg);
  if (isRotorVehicle(def) || isBoatVehicle(def)) {
    // The whole rigid vehicle against each body near, by its exact shape, adjacent rotor discs included.
    const posed = { x, y, z, yaw, pitch: 0, roll: 0 }, pad = vehicleSolidRadius(def) + parkedRadius;
    for (let cz = Math.max(0, Math.floor((z - pad) / CHUNK_SIZE)); cz <= Math.min(world.dims.chunksZ - 1, Math.floor((z + pad) / CHUNK_SIZE)); cz++) {
      for (let cx = Math.max(0, Math.floor((x - pad) / CHUNK_SIZE)); cx <= Math.min(world.dims.chunksX - 1, Math.floor((x + pad) / CHUNK_SIZE)); cx++) {
        for (let e = ents.chunkHead[cz * world.dims.chunksX + cx]!; e >= 0; e = ents.next[e]!) {
          if (!(ents.flags[e]! & F_ALIVE)) continue;
          const kind = ents.kind[e]!, other = world.reg.vehicle[kind], v = ents.vrow[e]!;
          const frame = {
            x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, yaw: ents.vehicleYaw[v]!, pitch: ents.vehiclePitch[v]!, roll: ents.vehicleRoll[v]!, steering: ents.steering[v]!,
            ...(other ? { qx: ents.vehicleQx[v]!, qy: ents.vehicleQy[v]!, qz: ents.vehicleQz[v]!, qw: ents.vehicleQw[v]! } : {}),
          };
          const family = familyOf(def)!;
          const hit = other ? family.meetsVehicle(def, posed, other, frame) : family.meetsCapsule(def, posed, ents.x[e]!, ents.y[e]!, ents.z[e]!, world.reg.bodyRadius[kind]!, world.reg.bodyHeight[kind]!);
          if (hit) return RESULT_OBSTRUCTED;
        }
      }
    }
    return RESULT_OK;
  }
  // A car's bodies against the bodies near, which are apart from the static world: nearby chunks and vertical overlap.
  for (const part of hullParts(x, y, z, yaw, def)) {
    const pad = part.radius + parkedRadius;
    for (let cz = Math.max(0, Math.floor((part.z - pad) / CHUNK_SIZE)); cz <= Math.min(world.dims.chunksZ - 1, Math.floor((part.z + pad) / CHUNK_SIZE)); cz++) {
      for (let cx = Math.max(0, Math.floor((part.x - pad) / CHUNK_SIZE)); cx <= Math.min(world.dims.chunksX - 1, Math.floor((part.x + pad) / CHUNK_SIZE)); cx++) {
        for (let e = ents.chunkHead[cz * world.dims.chunksX + cx]!; e >= 0; e = ents.next[e]!) {
          const k = ents.kind[e]!, other = world.reg.vehicle[k];
          if (e === under || (ents.flags[e]! & F_ALIVE) === 0) continue;
          if (partMeetsBody(part, ents.x[e]!, ents.y[e]!, ents.z[e]!, world.reg.bodyHeight[k]!, world.reg.bodyRadius[k]!, other, other ? ents.vehicleYaw[ents.vrow[e]!]! : 0)) return RESULT_OBSTRUCTED;
        }
      }
    }
  }
  return RESULT_OK;
}
