// A short-lived attack attachment, deliberately outside occupancy and persistence. The victim remains damageable.
import { poseCreatureOn } from "../shared/anim/creature.ts";
import { AnimState, bodySeed } from "../shared/anim/pose.ts";
import { boneToModel } from "../shared/anim/skeleton.ts";
import type { CreatureAttackDef, CreatureModeDef } from "../shared/content/defs.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { TAU, detCos, detSin } from "../shared/math/scalar.ts";
import { youngScale } from "../shared/sim/breeding.ts";
import { Body, MF_OUT, MF_ROOTED, MODE_WALK, STANCE_STAND, stepBody } from "../shared/sim/character.ts";
import { F_ALIVE, F_AWAKE, F_GROUNDED, F_HELD, F_PLAYER, F_PROP } from "../shared/sim/entities.ts";
import { IMPALE_SLOT } from "../shared/sim/seats.ts";
import { MICRO } from "../shared/sim/lazy.ts";
import { V_HEALTH } from "../shared/sim/vitals.ts";
import { ACT_COOL, ACT_HOLD, ACT_NONE, ACT_RELOAD } from "../shared/sim/weapon.ts";
import { capsuleBox, capsuleFree, push } from "../shared/world/collide.ts";
import { HIT_NONE, castWorld } from "../shared/world/ray.ts";
import { Found } from "../shared/world/structures.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Survival } from "./survival.ts";
import type { ServerWorld } from "./world.ts";

type Point = readonly [number, number, number];
interface Ref { readonly rec: EntityRecord; readonly entity: number; readonly generation: number }
interface Hold {
  readonly by: Ref; readonly victim: Ref; readonly attack: CreatureAttackDef; readonly mode: CreatureModeDef | undefined;
  readonly until: number; tick: number; host: Point; safe: Point; readonly trail: Point[];
}
export interface CreatureImpaleContext {
  readonly world: ServerWorld;
  readonly records: Records;
  readonly survival: Survival;
  hostile(by: EntityRecord, victim: EntityRecord): boolean;
  /** Enforces mount immunity and passenger protection. Must leave the victim unseated before returning true. */
  forceDismount?(victim: EntityRecord): boolean;
  refresh(rec: EntityRecord): void;
  /** Ordinary combat resolution, without beginning another impale or reapplying knockback/slow. */
  damage(by: EntityRecord, victim: EntityRecord, attack: CreatureAttackDef, mode: CreatureModeDef | undefined, points: number): void;
}

/** Same per-tick discontinuity limit as carry. A normal tail motion is also tested through the victim's whole capsule. */
const TELEPORT = 4;
const TRAIL = 8;

export class CreatureImpale {
  readonly ctx: CreatureImpaleContext;
  private readonly attackers = new Map<number, Hold>();
  private readonly victims = new Map<number, Hold>();
  private readonly state = new AnimState();
  private readonly point = new Float64Array(3);
  private readonly body = new Body();
  private readonly found = new Found();

  constructor(ctx: CreatureImpaleContext) { this.ctx = ctx; }
  held(pid: number): boolean { return this.victims.has(pid); }
  /** Victim pid, or 0. */
  holding(pid: number): number { return this.attackers.get(pid)?.victim.rec.pid ?? 0; }

  private ref(rec: EntityRecord): Ref | null {
    const { world, records } = this.ctx, e = records.entOf.get(rec.pid);
    if (e === undefined || records.byPid.get(rec.pid) !== rec || world.ents.pid[e] !== rec.pid) return null;
    return { rec, entity: e, generation: world.ents.gen[e]! };
  }
  /** Safe even after the original record is removed: never touches a recycled entity slot. */
  private entity(ref: Ref): boolean {
    const ents = this.ctx.world.ents;
    return ents.pid[ref.entity] === ref.rec.pid && ents.gen[ref.entity] === ref.generation;
  }
  private live(ref: Ref): boolean {
    const { world, records, survival } = this.ctx, flags = world.ents.flags[ref.entity]!;
    return this.entity(ref) && records.byPid.get(ref.rec.pid) === ref.rec && records.entOf.get(ref.rec.pid) === ref.entity
      && !ref.rec.dead && !ref.rec.out && (flags & (F_ALIVE | F_HELD | F_PROP)) === F_ALIVE
      && (flags & (F_AWAKE | F_PLAYER)) !== 0 && survival.value(ref.rec, V_HEALTH) > 0;
  }
  private position(e: number): Point {
    const ents = this.ctx.world.ents;
    return [ents.x[e]!, ents.y[e]!, ents.z[e]!];
  }
  private scale(e: number): number {
    const { world } = this.ctx, ents = world.ents;
    return ents.grown[e] ? youngScale(world.reg.birthScale[ents.kind[e]!]!, ents.span[e]!, ents.grown[e]!, world.tick) : 1;
  }
  private dimensions(e: number): readonly [number, number] {
    const { world } = this.ctx, size = this.scale(e), kind = world.ents.kind[e]!;
    return [world.reg.bodyRadius[kind]! * size, world.reg.bodyHeight[kind]! * size];
  }
  private distance(a: Point, b: Point): number { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
  private sight(a: Point, b: Point): boolean {
    const length = this.distance(a, b);
    return length < .001 || castWorld(this.ctx.world, ...a, (b[0] - a[0]) / length, (b[1] - a[1]) / length, (b[2] - a[2]) / length, Math.max(0, length - .005)) === HIT_NONE;
  }
  private free(p: Point, r: number, h: number): boolean { return capsuleFree(this.ctx.world, ...p, r, h); }
  private corridor(a: Point, b: Point, r: number, h: number): boolean {
    const length = this.distance(a, b);
    if (length > TELEPORT || !this.sight([a[0], a[1] + h * .5, a[2]], [b[0], b[1] + h * .5, b[2]])) return false;
    const count = Math.max(1, Math.ceil(length / Math.max(.05, Math.min(.1, r * .5))));
    for (let n = 0; n <= count; n++) {
      const t = n / count;
      if (!this.free([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], r, h)) return false;
    }
    return true;
  }
  /** Capsule centre at the attachment socket, using the hold pose before the start is committed. */
  private destination(by: Ref, target: Ref, attack: CreatureAttackDef, first = false): Point | null {
    const { world } = this.ctx, ents = world.ents, e = by.entity, anim = world.anims[by.rec.kind];
    const socket = anim?.rig.sockets.get(attack.impale!.socket);
    if (!anim || !socket || !anim.rig.clips.has("impale_hold")) return null;
    this.state.unpack(ents.anim[e]!, ents.cue[e]!); this.state.seed = bodySeed(e);
    if (first) this.state.setAction(ACT_HOLD, ents.hold[e]!, world.tick);
    const size = this.scale(e), yaw = ents.yaw[e]! / 65536 * TAU, sn = detSin(yaw), cs = detCos(yaw);
    poseCreatureOn(anim, this.state, world.tick, world, ents.x[e]!, ents.y[e]!, ents.z[e]!, yaw, size);
    boneToModel(anim.rig.solved, socket.bone, socket.x, socket.y, socket.z, this.point);
    const x = ents.x[e]! + size * (cs * this.point[0]! + sn * this.point[2]!);
    const y = ents.y[e]! + size * this.point[1]!;
    const z = ents.z[e]! + size * (cs * this.point[2]! - sn * this.point[0]!);
    if (![x, y, z].every(Number.isFinite) || this.distance(this.position(e), [x, y, z]) > attack.reach * size + .05) return null;
    const height = this.dimensions(target.entity)[1], origin: Point = [ents.x[e]!, ents.y[e]! + this.dimensions(e)[1] * .5, ents.z[e]!];
    return this.sight(origin, [x, y, z]) ? [x, y - height * .5, z] : null;
  }

  tryStart(by: EntityRecord, target: number, attack: CreatureAttackDef): boolean {
    const { world, records, survival } = this.ctx, ents = world.ents, config = attack.impale;
    const a = this.ref(by), victim = records.byPid.get(ents.pid[target]!), v = victim && this.ref(victim);
    if (!config || !a || !v || v.entity !== target || !this.live(a) || !this.live(v) || by === victim) return false;
    const c = world.reg.combat[by.kind], def = world.reg.defs[victim.kind];
    if (c?.secondary !== attack || ents.act[a.entity] !== ACT_RELOAD || ents.mode[a.entity] !== MODE_WALK || ents.seat[a.entity] !== 0 || (ents.flags[a.entity]! & F_GROUNDED) === 0) return false;
    if ((ents.mflags[a.entity]! & (MF_OUT | MF_ROOTED)) !== 0 || ents.actTicks[a.entity]! < attack.lands || ents.actTicks[a.entity]! > attack.through) return false;
    if (!def || def.type !== "species" || !["creature", "survivor", "civilian"].includes(def.class) || world.reg.vehicle[victim.kind] || world.reg.drag[victim.kind]! > config.maxDrag) return false;
    if (this.attackers.has(by.pid) || this.victims.has(by.pid) || this.attackers.has(victim.pid) || this.victims.has(victim.pid) || !this.ctx.hostile(by, victim)) return false;
    if (ents.seat[target] === a.entity + 1 && ents.seatGen[target] === a.generation || ents.seatSlot[target] === IMPALE_SLOT || ents.driven[target] !== 0) return false;
    const max = victim.vitals?.max[V_HEALTH] ?? 0;
    if (max <= 0 || survival.value(victim, V_HEALTH) * MICRO / max > config.maxHealthFraction) return false;
    let safe = this.position(target), dest = this.destination(a, v, attack, true);
    const [r, h] = this.dimensions(target);
    if (!dest || !this.corridor(safe, dest, r, h)) return false;
    if (ents.seat[target] !== 0) {
      if (!this.ctx.forceDismount?.(victim) || !this.live(a) || !this.live(v) || ents.seat[target] !== 0) return false;
      safe = this.position(target); dest = this.destination(a, v, attack, true);
      if (!dest || !this.corridor(safe, dest, r, h)) return false;
    }
    const hold: Hold = { by: a, victim: v, attack, mode: c.modes?.[ents.creatureMode[a.entity]!], until: world.tick + Math.ceil(config.seconds * TICK_RATE), tick: world.tick, host: this.position(a.entity), safe, trail: [safe] };
    this.attackers.set(by.pid, hold); this.victims.set(victim.pid, hold);
    ents.setSeat(target, a.entity, IMPALE_SLOT);
    ents.act[a.entity] = ACT_HOLD; ents.actTicks[a.entity] = 0; ents.pose(a.entity, world.tick);
    this.pin(hold, dest);
    this.ctx.refresh(by); this.ctx.refresh(victim);
    return true;
  }

  private pin(hold: Hold, p: Point): void {
    const { world, records } = this.ctx, ents = world.ents, e = hold.victim.entity;
    ents.setPosition(e, ...p); ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
    ents.yaw[e] = ents.yaw[hold.by.entity]!; ents.pitch[e] = 0;
    ents.stance[e] = STANCE_STAND; ents.mode[e] = MODE_WALK;
    ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    ents.act[e] = ACT_NONE; ents.actTicks[e] = 0; ents.pose(e, world.tick);
    hold.safe = p; hold.trail.push(p); if (hold.trail.length > TRAIL) hold.trail.shift();
    hold.victim.rec.x = p[0]; hold.victim.rec.y = p[1]; hold.victim.rec.z = p[2]; records.dirty.add(hold.victim.rec.pid);
  }

  step(): void {
    const { world } = this.ctx, ents = world.ents;
    for (const hold of [...this.attackers.values()]) {
      const { by, victim, attack } = hold, e = by.entity, target = victim.entity;
      if (!this.live(by) || !this.live(victim) || ents.act[e] !== ACT_HOLD || ents.mode[e] !== MODE_WALK || (ents.flags[e]! & F_GROUNDED) === 0 || (ents.mflags[e]! & (MF_OUT | MF_ROOTED)) !== 0
        || ents.seat[target] !== e + 1 || ents.seatGen[target] !== by.generation || ents.seatSlot[target] !== IMPALE_SLOT
        || world.tick >= hold.until || !this.ctx.hostile(by.rec, victim.rec) || this.distance(hold.host, this.position(e)) > TELEPORT) { this.end(hold); continue; }
      if (world.tick <= hold.tick) continue;
      const dest = this.destination(by, victim, attack), [r, h] = this.dimensions(target), current = this.position(target);
      if (!dest || this.distance(current, hold.safe) > TELEPORT || !this.corridor(current, dest, r, h)) { this.end(hold); continue; }
      hold.host = this.position(e); this.pin(hold, dest);
      // One fixed tick of ordinary combat, never replay missed damage after an unload or duplicate step call.
      hold.tick = world.tick;
      const damage = attack.impale!.damagePerSecond / TICK_RATE;
      if (damage > 0) this.ctx.damage(by.rec, victim.rec, attack, hold.mode, damage);
      if (this.attackers.get(by.rec.pid) === hold && (!this.live(by) || !this.live(victim))) this.end(hold);
    }
  }

  /** Release either endpoint. Lifecycle owners call before disconnect, dismount, input loss, unload or transfer. */
  release(pid: number): void { const hold = this.attackers.get(pid) ?? this.victims.get(pid); if (hold) this.end(hold); }
  stop(): void { for (const hold of [...this.attackers.values()]) this.end(hold); }

  /** A newly built overlap may exceed a walker's one-radius movement guard. Follow only local collision exit vectors. */
  private depenetrate(start: Point, r: number, h: number): Point | null {
    const { world } = this.ctx;
    let [x, y, z] = start;
    for (let pass = 0; pass < 8; pass++) {
      if (this.free([x, y, z], r, h)) return [x, y, z];
      let moved = false;
      for (const store of [world.structs, world.nodes]) {
        if (!store) continue;
        const count = store.query(x - r, z - r, x + r, z + r, this.found, y - r, y + h + r);
        const refs = Array.from(this.found.refs.subarray(0, count)).sort((a, b) => a - b);
        for (const ref of refs) {
          if (!capsuleBox(store, ref, x, y, z, r, h, 0)) continue;
          x += push.x * 1.001; y += push.y * 1.001; z += push.z * 1.001; moved = true;
          if (![x, y, z].every(Number.isFinite) || this.distance(start, [x, y, z]) > 2) return null;
        }
      }
      if (!moved) break;
    }
    return this.free([x, y, z], r, h) ? [x, y, z] : null;
  }

  private end(hold: Hold): void {
    const { world, records } = this.ctx, ents = world.ents, { by, victim } = hold;
    this.attackers.delete(by.rec.pid); this.victims.delete(victim.rec.pid);
    if (this.entity(victim) && ents.seat[victim.entity] === by.entity + 1 && ents.seatGen[victim.entity] === by.generation && ents.seatSlot[victim.entity] === IMPALE_SLOT) {
      const e = victim.entity, [r, h] = this.dimensions(e), current = this.position(e);
      let p: Point = current;
      if (!this.free(p, r, h)) {
        // Reuse the normal capsule solver for a wall built through the held body; accept only a nearby free result.
        const move = world.reg.move[victim.rec.kind];
        if (move) {
          ents.loadBody(e, this.body); this.body.vx = this.body.vy = this.body.vz = 0; this.body.mode = MODE_WALK; this.body.stance = STANCE_STAND;
          stepBody(world, this.body, 0, 0, this.body.yaw, 0, 0, { ...move, radius: r, height: h }, 0);
          const candidate: Point = [this.body.x, this.body.y, this.body.z];
          if (this.distance(current, candidate) <= 2 && this.free(candidate, r, h)) p = candidate;
        }
        if (!this.free(p, r, h)) p = this.depenetrate(current, r, h) ?? p;
        // Recent placements are candidates, not unconditional teleport destinations: recheck their entire corridor.
        if (!this.free(p, r, h)) for (let n = hold.trail.length - 1; n >= 0; n--) {
          const candidate = hold.trail[n]!;
          if (this.corridor(current, candidate, r, h)) { p = candidate; break; }
        }
      }
      // A completely enclosed edited world has no safe placement. Leave that to ordinary collision recovery, never teleport.
      ents.setSeat(e, -1); ents.setPosition(e, ...p); ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
      ents.flags[e] = ents.flags[e]! & ~F_GROUNDED; ents.pose(e, world.tick);
      if (records.byPid.get(victim.rec.pid) === victim.rec) {
        victim.rec.x = p[0]; victim.rec.y = p[1]; victim.rec.z = p[2]; records.dirty.add(victim.rec.pid);
        if (!victim.rec.dead) this.ctx.refresh(victim.rec);
      }
    }
    if (this.entity(by) && records.byPid.get(by.rec.pid) === by.rec && ents.act[by.entity] === ACT_HOLD) {
      const e = by.entity;
      ents.act[e] = by.rec.dead || by.rec.out ? ACT_NONE : ACT_COOL; ents.actTicks[e] = 0;
      ents.creatureCooldown[e] = Math.max(ents.creatureCooldown[e]!, hold.attack.cooldown ?? 0); ents.pose(e, world.tick);
      if (records.byPid.get(by.rec.pid) === by.rec && !by.rec.dead) this.ctx.refresh(by.rec);
    }
  }
}
