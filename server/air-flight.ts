import { CHUNK_SIZE, TICK_DT, TICK_RATE, chunkAt } from "../shared/coords.ts";
import { CMD_AIR_SUPPORT, CMD_CHAT, RESULT_BUSY, RESULT_DENIED, RESULT_INVALID, RESULT_OK, SESSION_ALIVE } from "../shared/net/protocol.ts";
import { AIR_BAYS, AIR_VIEW_LIMIT, type AirDrone, type AirPose, type AirSupportView } from "../shared/sim/air-support.ts";
import { BTN_AIR_REMOTE, BTN_SPRINT } from "../shared/sim/character.ts";
import { DMG_EXPLOSIVE } from "../shared/sim/damage.ts";
import { HIT_NONE, castWorld, rayHit } from "../shared/world/ray.ts";
import { bodyAlong } from "../shared/world/water.ts";
import type { Combat } from "./combat.ts";
import type { Client, GameServer } from "./game.ts";
import type { Projectiles } from "./projectiles.ts";
import type { Records } from "./records.ts";
import type { Rules } from "./settings/rules.ts";
import type { ServerWorld } from "./world.ts";

export interface AirFlightContext {
  world: ServerWorld;
  game: GameServer;
  combat: Combat;
  projectiles: Projectiles;
  rules: Rules;
  records: Records;
  valid(c: Client, rack: number): boolean;
  wake?(chunk: number, delta: number): void;
}

const RELEASE_TICKS = Math.ceil(TICK_RATE / 2);

interface Flight extends AirDrone {
  launched: number;
  rack: number;
  capacity: number;
  burn: number;
  boostBurn: number;
  speed: number;
  turn: number;
  damage: number;
  radius: number;
  lookYaw: number;
  lookPitch: number;
  boostAt: number;
  chunk: number;
}

function approach(angle: number, target: number, limit: number): number {
  const delta = Math.atan2(Math.sin(target - angle), Math.cos(target - angle));
  return angle + Math.max(-limit, Math.min(limit, delta));
}

export class AirFlights {
  private readonly flights = new Map<Client, Flight>();
  private nextId = 1;
  private readonly notices = new WeakMap<Client, { until: number; text: string }>();

  private readonly ctx: AirFlightContext;

  constructor(ctx: AirFlightContext) {
    this.ctx = ctx;
    const { game } = ctx;
    game.players.remoteInput = (c, tick) => this.input(c, tick);
    game.replication.cameraChunk = (c) => this.flights.get(c)?.chunk;
    game.players.allows.on((c, op) => !this.active(c) || op === CMD_AIR_SUPPORT || op === CMD_CHAT);
    game.sessions.onPresence.on(c => { if (c.closed) this.abort(c); });
    game.sessions.onExit.on(c => { this.forget(c); });
    game.sessions.onBodyGone.on(c => { this.abort(c); });
  }

  active(c: Client): boolean { return this.flights.has(c); }

  camera(c: Client): Readonly<AirDrone> | undefined { return this.flights.get(c); }

  private permitted(c: Client, rack: number): boolean {
    const rec = this.ctx.records.byPid.get(c.pid);
    return c.active && !c.closed && c.state === SESSION_ALIVE && c.ent >= 0 && !!rec && !rec.out && !rec.dead && !this.ctx.game.players.isDown(c.ent) && this.ctx.valid(c, rack);
  }

  launch(c: Client, origin: AirPose, rack: number, slot: number): number {
    if (this.active(c)) return RESULT_BUSY;
    if (!Number.isInteger(slot) || slot < 0 || slot >= AIR_BAYS) return RESULT_INVALID;
    if (!this.permitted(c, rack)) return RESULT_DENIED;
    const { rules, world } = this.ctx;
    const f: Flight = {
      ...origin, rack, bay: slot, id: this.nextId++, fuel: 1, pitch: 0, launched: world.tick,
      capacity: rules.num("AirDroneFuel"), burn: rules.num("AirDroneBurn"), boostBurn: rules.num("AirDroneBoostBurn"),
      speed: rules.num("AirDroneSpeed"), turn: rules.num("AirDroneTurnRate") * Math.PI / 180,
      damage: rules.num("AirDroneDamage"), radius: rules.num("AirDroneRadius"),
      lookYaw: origin.yaw, lookPitch: 0.27, boostAt: -TICK_RATE, chunk: chunkAt(world.dims, origin.x, origin.z),
    };
    this.flights.set(c, f);
    this.notices.delete(c);
    this.watch(f.chunk, 1);
    return RESULT_OK;
  }

  private input(c: Client, tick: number): boolean {
    const f = this.flights.get(c);
    if (!f) return false;
    if (c.inputs.has(tick) && (c.heldButtons & BTN_AIR_REMOTE) !== 0) {
      f.lookYaw = c.heldYaw * Math.PI / 32768;
      f.lookPitch = Math.max(-1.45, Math.min(1.45, c.heldPitch * Math.PI / 32768));
      f.boostAt = (c.heldButtons & BTN_SPRINT) !== 0 ? tick : -TICK_RATE;
    }
    return true;
  }

  step(tick: number): void {
    const { world, combat } = this.ctx;
    for (const [c, f] of this.flights) {
      if (!this.permitted(c, f.rack)) {
        this.finish(c, "Drone link lost");
        continue;
      }
      const boosted = tick - f.boostAt < 5;
      f.fuel = Math.max(0, f.fuel - (boosted ? f.boostBurn : f.burn) * TICK_DT / f.capacity);
      if (f.fuel <= 0) {
        this.finish(c, "Drone fuel exhausted");
        continue;
      }
      const age = tick - f.launched;
      if (age === 0) continue;
      let forward: number, rise: number;
      if (age <= RELEASE_TICKS) {
        const t = age / RELEASE_TICKS, was = (age - 1) / RELEASE_TICKS;
        forward = 1.45 * (t * t - was * was);
        rise = 1.27 * (t * t * (3 - 2 * t) - was * was * (3 - 2 * was));
        f.pitch = .27 * t;
      } else {
        f.yaw = approach(f.yaw, f.lookYaw, f.turn * TICK_DT);
        f.pitch = approach(f.pitch, f.lookPitch, f.turn * TICK_DT);
        const travel = f.speed * (boosted ? 1.5 : 1) * TICK_DT;
        forward = travel * Math.cos(f.pitch);
        rise = travel * Math.sin(f.pitch);
      }
      const length = Math.hypot(forward, rise);
      const dx = Math.sin(f.yaw) * forward / length, dy = rise / length, dz = Math.cos(f.yaw) * forward / length;
      const solid = castWorld(world, f.x, f.y, f.z, dx, dy, dz, length) !== HIT_NONE;
      const solidAt = solid ? rayHit.t : Infinity;
      const waterAt = bodyAlong(world.hf.water, f.x, f.y, f.z, dx, dy, dz, length);
      const stop = Math.min(length, solidAt, waterAt);
      const body = combat.castBodies(c.ent, f.x, f.y, f.z, dx, dy, dz, stop);
      const hit = body >= 0 || solidAt <= length || waterAt <= length;
      const distance = hit ? Math.max(0, (body >= 0 ? combat.t : stop) - 0.05) : length;
      f.x += dx * distance;
      f.y += dy * distance;
      f.z += dz * distance;
      if (f.x < 0 || f.z < 0 || f.x >= world.hf.sizeX || f.z >= world.hf.sizeZ) {
        this.finish(c, "Drone left the map");
      } else if (hit) this.payload(c, f, body);
      else {
        const chunk = chunkAt(world.dims, f.x, f.z);
        if (chunk !== f.chunk) {
          this.watch(chunk, 1);
          this.watch(f.chunk, -1);
          f.chunk = chunk;
        }
      }
    }
  }

  trigger(c: Client): number {
    const f = this.flights.get(c);
    if (!f || !this.permitted(c, f.rack)) return RESULT_DENIED;
    this.payload(c, f, -1);
    return RESULT_OK;
  }

  private payload(c: Client, f: Flight, direct: number): void {
    const { combat, records, projectiles, world } = this.ctx;
    this.finish(c, "Drone payload spent");
    const by = records.byPid.get(c.pid) ?? null;
    projectiles.boom(f.x, f.y, f.z, f.radius, by?.name, c);
    combat.blast({
      by, item: world.reg.index.get("core:grenade") ?? 0, base: f.damage, type: DMG_EXPLOSIVE,
      x: f.x, z: f.z, attack: 1, draw: 1, quality: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0,
    }, f.x, f.y, f.z, f.radius, direct);
  }

  abort(c: Client): number {
    if (!this.active(c)) return RESULT_DENIED;
    this.finish(c, "Drone link closed");
    return RESULT_OK;
  }

  private finish(c: Client, text: string): void {
    this.forget(c);
    this.notices.set(c, { text, until: this.ctx.world.tick + 2 * TICK_RATE });
  }

  private forget(c: Client): void {
    const f = this.flights.get(c);
    if (!f) return;
    this.flights.delete(c);
    this.watch(f.chunk, -1);
  }

  private watch(chunk: number, delta: number): void {
    const { wake, world } = this.ctx;
    if (!wake) return;
    const { chunksX, chunksZ } = world.dims;
    const cx = chunk % chunksX, cz = Math.floor(chunk / chunksX);
    for (let z = Math.max(0, cz - 1); z <= Math.min(chunksZ - 1, cz + 1); z++) {
      for (let x = Math.max(0, cx - 1); x <= Math.min(chunksX - 1, cx + 1); x++) wake(z * chunksX + x, delta);
    }
  }

  view(c: Client, into: AirSupportView): void {
    const own = this.flights.get(c);
    into.flight = own?.id ?? 0;
    const near = own ?? c.body;
    const reach = CHUNK_SIZE * (1 + this.ctx.game.opts.entityRadius);
    if (own) into.drones.push(own);
    for (const f of this.flights.values()) {
      if (into.drones.length >= AIR_VIEW_LIMIT) break;
      if (f !== own && Math.abs(f.x - near.x) <= reach && Math.abs(f.z - near.z) <= reach) into.drones.push(f);
    }
    const notice = this.notices.get(c);
    if (notice && notice.until > this.ctx.world.tick) into.notice = notice.text;
  }
}
