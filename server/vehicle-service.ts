// Maintenance and deployment share inventory transactions with every other item use. No client owns a vehicle by naming it.
import type { BitReader } from "../shared/net/codec.ts";
import { handleGen, handleIndex } from "../shared/ids.ts";
import { CHUNK_SIZE, WORLD_MAX_Y, WORLD_MIN_Y } from "../shared/coords.ts";
import { hashString } from "../shared/hash.ts";
import { Rng } from "../shared/rng.ts";
import { RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_FULL, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_NO_SUPPORT, RESULT_OBSTRUCTED, RESULT_OK, RESULT_SHORT, SESSION_ALIVE, TEXT_NOTICE, VEHICLE_DEPLOY, VEHICLE_INSPECT, VEHICLE_REFUEL, VEHICLE_REPAIR } from "../shared/net/protocol.ts";
import { stanceEye } from "../shared/sim/character.ts";
import { F_ALIVE, F_GROUNDED } from "../shared/sim/entities.ts";
import { FLAG_BLUEPRINT } from "../shared/sim/items.ts";
import { V_HEALTH } from "../shared/sim/vitals.ts";
import { isRotorVehicle, type VehicleDefinition } from "../shared/sim/vehicle.ts";
import { groundUnder } from "../shared/world/collide.ts";
import { helicopterPlacement } from "../shared/world/helicopter.ts";
import type { MapVehicle } from "../shared/world/mapfile.ts";
import { castWorld, HIT_NONE, rayHit } from "../shared/world/ray.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import { placeFree } from "./place.ts";
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
const REPAIR_STEP = .25;
const REPAIR_BILL = [["core:ingot", 160], ["core:polymer", 40], ["core:electronics", 30]] as const;
const FUEL_PER_ITEM = 5;
const REACH = 5;
const DEPLOY_REACH = 12;

export class VehicleService {
  readonly ctx: VehicleServiceContext;
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
    if (!this.ctx.may(actor, rec)) return RESULT_NOT_YOURS;
    if (Math.hypot(ents.x[c.ent]! - ents.x[e]!, ents.y[c.ent]! - ents.y[e]!, ents.z[c.ent]! - ents.z[e]!) > REACH + def.spec.halfWidth) return RESULT_FAR;
    if (!this.visible(c, ents.x[e]!, ents.y[e]! + Math.min(1.3, def.spec.height / 2), ents.z[e]!)) return RESULT_OBSTRUCTED;
    if (stopped && ((ents.flags[e]! & F_GROUNDED) === 0 || Math.hypot(ents.vx[e]!, ents.vy[e]!, ents.vz[e]!) > .1 ||
      (isRotorVehicle(def) && (ents.vehicleEngineOn[e] !== 0 || ents.vehicleRotorRpm[e]! > 30)))) return RESULT_BUSY;
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
    const hp = this.health(rec), engine = Math.round(ents.vehicleEngineCondition[e]! * 100), rotor = Math.round(ents.vehicleRotorCondition[e]! * 100);
    game.sendText(c, TEXT_NOTICE, `${rec.name || "Vehicle"}: hull ${Math.round(hp * 100)}%, fuel ${ents.fuel[e]!.toFixed(1)}/${def.spec.fuelCapacity}${isRotorVehicle(def) ? `, engine ${engine}%, rotor ${rotor}%` : ""}.`);
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
    const engine = isRotorVehicle(def) ? Math.min(REPAIR_STEP, 1 - ents.vehicleEngineCondition[e]!) : 0;
    const rotor = isRotorVehicle(def) ? Math.min(REPAIR_STEP, 1 - ents.vehicleRotorCondition[e]!) : 0;
    const fraction = Math.max(hull, engine, rotor);
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
    if (isRotorVehicle(def)) {
      ents.vehicleEngineCondition[e] = Math.fround(Math.min(1, ents.vehicleEngineCondition[e]! + engine));
      ents.vehicleRotorCondition[e] = Math.fround(Math.min(1, ents.vehicleRotorCondition[e]! + rotor));
    }
    urban.changed(e);
    game.sendText(c, TEXT_NOTICE, "Repaired the hull and mechanical systems by up to 25%.");
    return RESULT_OK;
  }

  private health(rec: EntityRecord): number {
    return rec.vitals ? rec.vitals.at(V_HEALTH, this.ctx.world.tick) / Math.max(1, rec.vitals.max[V_HEALTH]!) : 1;
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
    this.ctx.game.sendText(c, TEXT_NOTICE, "Helicopter assembled. Add gasoline before starting.");
    return RESULT_OK;
  }
}

/** Shared by authored parking and deployment. Terrain/structure checks also include the unloaded resource-node index. */
export function vehiclePlaceFree(world: ServerWorld, x: number, y: number, z: number, yaw: number, def: VehicleDefinition): boolean {
  const spec = def.spec, sn = Math.sin(yaw), cs = Math.cos(yaw);
  if (![x, y, z, yaw].every(Number.isFinite)) return false;
  if (isRotorVehicle(def)) {
    if (!helicopterPlacement(world, x, y, z, yaw, def)) return false;
  } else if (Math.abs(y - groundUnder(world.hf, x, z, spec.halfWidth)) > .2) return false;
  const parts: { x: number; y: number; z: number; radius: number; height: number }[] = [];
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
    // The disc is shallow, while a capsule with its radius would be a 9 m tall sphere. Cover unloaded nodes with
    // small spheres and use one shallow cylinder for dynamic bodies. Static geometry was checked by the shared helper.
    if (world.unloaded) for (let rz = -main.radius; rz <= main.radius; rz += .2) for (let rx = -main.radius; rx <= main.radius; rx += .2) {
      if (rx * rx + rz * rz > main.radius * main.radius) continue;
      const px = x + cs * (main.at[0] + rx) + sn * (main.at[2] + rz), pz = z - sn * (main.at[0] + rx) + cs * (main.at[2] + rz);
      if (world.unloaded.meets(px, y + main.at[1] - .15, pz, .15, .3)) return false;
    }
    parts.push({ x: x + cs * main.at[0] + sn * main.at[2], y: y + main.at[1] - .08, z: z - sn * main.at[0] + cs * main.at[2], radius: main.radius, height: .16 });
  }
  for (const part of parts) {
    if (part.height > .2 && !placeFree(world, part.x, part.y, part.z, part.radius, part.height)) return false;
    // Dynamic bodies are separate from the static collision world. Test only nearby chunks and vertical overlap.
    const pad = part.radius + 8;
    for (let cz = Math.max(0, Math.floor((part.z - pad) / CHUNK_SIZE)); cz <= Math.min(world.dims.chunksZ - 1, Math.floor((part.z + pad) / CHUNK_SIZE)); cz++) {
      for (let cx = Math.max(0, Math.floor((part.x - pad) / CHUNK_SIZE)); cx <= Math.min(world.dims.chunksX - 1, Math.floor((part.x + pad) / CHUNK_SIZE)); cx++) {
        for (let e = world.ents.chunkHead[cz * world.dims.chunksX + cx]!; e >= 0; e = world.ents.next[e]!) {
          const ents = world.ents, k = ents.kind[e]!;
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
