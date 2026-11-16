// Finds what a swing or shot lands on, on the server, from the body's own eye. A client never names what it hit.
// What a hit does is resolveDamage (shared/sim/damage.ts) and nothing else. The attacker's events never say what the victim has left.

import { HUMAN } from "../shared/anim/human.ts";
import { SLOT_OF_ZONE, ZONE_NONE, ZONE_TORSO } from "../shared/anim/human.ts";
import { AnimState, bodySeed } from "../shared/anim/pose.ts";
import { BODY_REACH, BODY_REACH_Y, rayBody, raySeated } from "../shared/anim/zones.ts";
import { SEAT_FLOATS, saddleSeat, seatOn } from "../shared/anim/seat.ts";
import { rayCreature, type CreatureAnim } from "../shared/anim/creature.ts";
import { youngScale } from "../shared/sim/breeding.ts";
import { rayVehicle } from "../shared/sim/vehicle-frame.ts";
import { TAU } from "../shared/math/scalar.ts";
import { zoneHit } from "../shared/anim/skeleton.ts";
import type { SpeciesDef } from "../shared/content/defs.ts";
import { EVENT_DEATH, EVENT_HIT, EVENT_HURT, EVENT_KILL, S_EVENT } from "../shared/net/protocol.ts";
import { BTN_MOD, stanceEye } from "../shared/sim/character.ts";
import { DMG_EXPLOSIVE, DMG_MELEE, PIECE_SCALE, harm, hit, resetHit, resolveDamage } from "../shared/sim/damage.ts";
import { F_ALIVE, F_HELD, F_PROP, GEAR_WORN } from "../shared/sim/entities.ts";
import { ARMOR_SLOTS, FLAG_ON, QUALITY_MUL } from "../shared/sim/items.ts";
import { TICK_DT, TICK_RATE } from "../shared/coords.ts";
import { W_BOW, W_GUN, W_MELEE, W_THROWN } from "../shared/sim/weapon.ts";
import { capsuleHull, hullPush } from "../shared/world/convex.ts";
import { HIT_NODE, HIT_NONE, HIT_STRUCTURE, castWorld, lookDirection, rayBox, rayHit } from "../shared/world/ray.ts";
import { Found } from "../shared/world/structures.ts";
import type { Buffs } from "./buffs.ts";
import type { Corpses } from "./corpses.ts";
import type { Creatures } from "./creatures.ts";
import { V_HEALTH, V_TORPOR } from "../shared/sim/vitals.ts";
import { DID_FIRE, DID_RELOAD, DID_BITE, DID_ROLL, DID_STRIKE, type Client, type GameServer } from "./game.ts";
import type { Harvest } from "./harvest.ts";
import { Past } from "./history.ts";
import type { Items } from "./items.ts";
import { XP_KILL, type Progression } from "./progression.ts";
import type { Rules } from "./settings/rules.ts";
import type { Lists } from "./settings/lists.ts";
import type { EntityRecord, Records } from "./records.ts";
import { STAT_MELEE, statOf, type Survival } from "./survival.ts";
import type { ServerWorld } from "./world.ts";
import type { EventData } from "./api/module.ts";
import { event, type Bus } from "./events/bus.ts";

const CHUNK_METRES = 64;
/** Metres. A swing also casts rays this far off its aim, to each side and above and below. */
const SWING_WIDTH = 0.14;
/** At most this many bodies near a ray are posed. */
const MAX_NEAR = 256;
/**
 * A barrel roll hits what it passes for ROLL_TICKS from its start, out to ROLL_REACH metres from the roller's middle: its
 * wings, turning about it, sweep half its span. ARK gives neither (FUNCTIONS §19). A second, and half the pteranodon's 7 m
 * span, are ours.
 */
const ROLL_TICKS = TICK_RATE;
const ROLL_REACH = 3.5;

/** A barrel roll under way: the roller, as its entity and generation, where its middle was last tick, and whom it has hit. */
interface Roll {
  e: number;
  gen: number;
  until: number;
  x: number;
  y: number;
  z: number;
  /** Pids. */
  readonly hit: number[];
}
/** From a chunk's middle to its corner. */
const CHUNK_REACH = CHUNK_METRES * Math.SQRT1_2;
/** How many times a saddle's rating counts against a blow, an arrow or a round, and against an explosion. ARK's. */
const SADDLE_DIRECT = 4;
const SADDLE_BLAST = 1;
/**
 * A flashlight that is on spends a use of its weapon every this many ticks of the world's clock. ARK's flashlight "will
 * use the durability of the weapon" (Flashlight Attachment) at a rate no page gives: a use a minute is ours (DEV145).
 */
export const LIGHT_WEAR_TICKS = 60 * TICK_RATE;

export interface CombatContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
  readonly survival: Survival;
  readonly progression: Progression;
  readonly creatures: Creatures;
  readonly buffs: Buffs;
  readonly rules: Rules;
  readonly lists: Lists;
  readonly harvest: Harvest | null;
  readonly bus: Bus;
}

const DAMAGE = event("damage");
const DAMAGED = event("damaged");
/** A damage type as a module is told it. */
const TYPE_WORDS: readonly string[] = ["melee", "pierce", "bullet", "fire", "explosive"];

/** Ticks behind its newest acked snapshot a client is assumed to draw other bodies, when no input for the tick says. */
const VIEW_BEHIND = 2;
/** The farthest back a shot is judged. Beyond this the shooter must lead. History keeps one more tick. */
export const REWIND_TICKS = 15;
/**
 * A shot is also judged no further back than its client's round trip as the server measured it, plus the ticks by which
 * its input came ahead of its tick, plus this many: up to four that a client draws others behind (REMOTE_DELAY_MAX of
 * client/core/session.ts), and three for rounding and an uneven line.
 */
export const REWIND_SLACK = 7;
/** The round trip is the least seen in this many ticks and the same number before them, so that holding acknowledgements back before a shot buys nothing. */
const LAG_WINDOW = 64;
/** Metres a body can have moved in REWIND_TICKS, and in the tick one segment of a flight takes. They pad the search for bodies near a ray. */
const REWIND_REACH = 6.5;
const SWEEP_REACH = 1;

/** What a blow or a shot carries. */
export interface Source {
  /** Null if the attacker is no longer there to be credited. */
  by: EntityRecord | null;
  /** Where it came from, for the side the victim is shown. */
  x: number;
  z: number;
  /** The weapon's content index, or 0 for bare hands. */
  item: number;
  /** As in `hit` of shared/sim/damage.ts. */
  base: number;
  type: number;
  quality: number;
  draw: number;
  attack: number;
  torporInstant: number;
  torporOver: number;
  /** Seconds torporOver is spread over, and a buff the hit gives (a content index, or 0). */
  torporSeconds: number;
  buff: number;
  /** From a weapon with a silencer: a survivor it hits is not shown the side it came from (Silencer Attachment). */
  silenced?: boolean;
  /** The share of its damage a round keeps at the distance it hit from (`falloff`, shared/sim/damage.ts). 1 where not given. */
  far?: number;
  /** The share of armor the round goes through, 0 to 1 (weapons-plan.md, M12). Omitted, none. */
  pierce?: number;
}

/** One resolved blow, for tests, the console and measurement. */
export interface Blow {
  /** Pids. */
  by: number;
  victim: number;
  zone: number;
  /** Health taken, damage the armor stopped, and the armor uses that cost. */
  damage: number;
  blocked: number;
  wear: number;
  killed: boolean;
}

export class Combat {
  /** Blows landed on bodies. */
  hits = 0;
  readonly last: Blow = { by: 0, victim: 0, zone: 0, damage: 0, blocked: 0, wear: 0, killed: false };

  private readonly ctx: CombatContext;
  private readonly survivor: number;
  /** A second entity the cast in progress skips: the rider of the creature that is biting. -1 for none. */
  private spare = -1;
  private readonly human: Uint8Array;
  /** Vehicle origins can be in an adjacent chunk even when their hull touches a ray. */
  private readonly vehicleReach: Float32Array;
  private readonly targetReach: number;
  private readonly anims: (CreatureAnim | null)[];
  private readonly dir = [0, 0, 0];
  private readonly st = new AnimState();
  private readonly near = new Int32Array(MAX_NEAR);
  private readonly nearT = new Float32Array(MAX_NEAR);
  private readonly past = new Past();
  /** A rider's mount as it was at the tick a cast is judged at, and the rider's seat on it then. */
  private readonly mountPast = new Past();
  private readonly mountSt = new AnimState();
  private readonly seatAt = new Float64Array(SEAT_FLOATS);
  private readonly rolls: Roll[] = [];
  private readonly src: Source = { by: null, x: 0, z: 0, item: 0, base: 0, type: DMG_MELEE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0, silenced: false };
  /** Content index of the tranquilized buff. Each hit with torpor over time gives one, carrying its strength. */
  private readonly dose: number;
  /** Where the last `castBodies` hit: the zone, and the distance along the ray. */
  zone = ZONE_NONE;
  t = 0;
  /** A shot left `c`'s weapon. `draw` is 0 to 1. */
  onFire: ((c: Client, rec: EntityRecord, weapon: number, quality: number, ammo: number, draw: number) => void) | null = null;
  /** A thrown item left `c`'s hand. `draw` is how long a charged throw was held, 0 to 1, and 1 for any other. */
  onThrow: ((c: Client, rec: EntityRecord, item: number, quality: number, draw: number) => void) | null = null;
  /** Gives a hit's buff, reading its bola fields (server/entangle.ts). Unset, the buff is given as it is. `by` is a pid or 0. */
  entangle: ((victim: EntityRecord, buff: number, by: number) => void) | null = null;
  /** Hits landed on structures. `lastStructure` holds the last one, and its `left` is 0 if the structure is gone. */
  structureHits = 0;
  /** The rider of a mount, or null. A rider also gets half the XP its mount earns by a kill. */
  riderOf: ((mount: EntityRecord) => EntityRecord | null) | null = null;
  /** `points` is the health taken. Not called for a blow that kills. */
  onHarm: ((victim: EntityRecord, points: number) => void) | null = null;
  /** Called for a structure that was harmed and still stands. */
  onStructureHurt: ((ref: number) => void) | null = null;
  /** The bodies of dead creatures, which a survivor's swing harvests. */
  corpses: Corpses | null = null;
  readonly lastStructure = { ref: 0, damage: 0, left: 0 };
  private readonly inBlast = new Found(256);
  private readonly found: number[] = [];
  private readonly share: number[] = [];
  /** Set by `killed`, which the hurt in progress may call. */
  private died = false;
  /**
   * Per session slot, for `lag`: the least age of its newest acknowledged snapshot in the window of ticks that began at
   * `lagFrom` (-1 before any) and in the window before, belonging to this connection.
   */
  private readonly lagNow: number[] = [];
  private readonly lagWas: number[] = [];
  private readonly lagFrom: number[] = [];
  private readonly lagConn: (Client["conn"] | undefined)[] = [];

  constructor(ctx: CombatContext, seed: number) {
    this.ctx = ctx;
    const reg = ctx.world.reg;
    this.survivor = reg.index.get("core:survivor")!;
    this.human = Uint8Array.from(reg.defs, (d) => (d?.type === "species" && d.skeleton === HUMAN.id ? 1 : 0));
    this.vehicleReach = Float32Array.from(reg.vehicle, (vehicle, kind) => {
      if (!vehicle) return 0;
      const spec = vehicle.spec, h = reg.bodyHeight[kind]!;
      if (vehicle.movement !== "boat") return Math.hypot(spec.halfWidth, spec.halfLength, h * .5);
      const marine = vehicle.spec;
      const reach = Math.max(marine.halfLength, Math.abs(marine.propeller.at[2]) + marine.propeller.radius,
        ...(marine.outboard?.boxes ?? []).map(box => Math.abs(box.at[2]) + box.half[2]));
      return Math.hypot(marine.halfWidth + .5, reach + .5, h);
    });
    this.targetReach = Math.max(BODY_REACH, ...this.vehicleReach);
    // A creature whose skeleton came with its model is hit on that rig's capsules, as posed.
    this.anims = ctx.world.anims;
    this.dose = reg.index.get("core:tranquilized") ?? 0;
  }

  /** Call once a tick, after every body has stepped. */
  step(): void {
    const now = this.ctx.world.tick;
    const wears = now % LIGHT_WEAR_TICKS === 0;
    for (const c of this.ctx.game.clients) {
      if (!c?.active) continue;
      this.measure(c, now);
      // N switches the attachment of the weapon in hand, on foot (weapons-plan.md, M10). A rider's hands are on the reins.
      if (c.ent >= 0 && c.drive < 0 && ((c.pressed & BTN_MOD) !== 0 || wears)) this.attachments(c, (c.pressed & BTN_MOD) !== 0, wears);
      if (c.did === 0 || c.ent < 0) continue;
      if ((c.did & DID_RELOAD) !== 0) this.reload(c);
      if ((c.did & DID_STRIKE) !== 0) this.strike(c);
      if ((c.did & DID_BITE) !== 0 && c.drive >= 0) this.bite(c.drive);
      if ((c.did & DID_ROLL) !== 0 && c.drive >= 0) this.roll(c.drive);
      if ((c.did & DID_FIRE) !== 0) this.fire(c);
    }
    if (this.rolls.length > 0) this.rolling();
  }

  /** Flyer `e` began a barrel roll in the step just taken: its roll's damage goes once to each body it passes for ROLL_TICKS. */
  roll(e: number): void {
    const world = this.ctx.world;
    const ents = world.ents;
    if (world.reg.rollDamage[ents.kind[e]!]! <= 0) return;
    const mid = world.reg.bodyHeight[ents.kind[e]!]! * 0.5;
    const r: Roll = { e, gen: ents.gen[e]!, until: world.tick + ROLL_TICKS, x: ents.x[e]! - ents.vx[e]! * TICK_DT, y: ents.y[e]! + mid - ents.vy[e]! * TICK_DT, z: ents.z[e]! - ents.vz[e]! * TICK_DT, hit: [] };
    const at = this.rolls.findIndex((o) => o.e === e);
    if (at >= 0) this.rolls[at] = r;
    else this.rolls.push(r);
  }

  /** Each roll under way meets the bodies within its reach of the way its middle went this tick, if no wall stands between. */
  private rolling(): void {
    const { world, records } = this.ctx;
    const ents = world.ents;
    const reg = world.reg;
    const dims = world.dims;
    for (let k = this.rolls.length - 1; k >= 0; k--) {
      const r = this.rolls[k]!;
      const e = r.e;
      const rec = (ents.flags[e]! & F_ALIVE) !== 0 && ents.gen[e] === r.gen ? records.byPid.get(ents.pid[e]!) : undefined;
      if (!rec || world.tick >= r.until) {
        this.rolls[k] = this.rolls[this.rolls.length - 1]!;
        this.rolls.pop();
        continue;
      }
      const kind = ents.kind[e]!;
      const x0 = r.x;
      const y0 = r.y;
      const z0 = r.z;
      const x1 = ents.x[e]!;
      const y1 = ents.y[e]! + reg.bodyHeight[kind]! * 0.5;
      const z1 = ents.z[e]!;
      r.x = x1;
      r.y = y1;
      r.z = z1;
      const rider = this.riderOf?.(rec) ?? null;
      const spare = rider ? (records.entOf.get(rider.pid) ?? -1) : -1;
      const pad = ROLL_REACH + BODY_REACH;
      const cx0 = Math.max(0, Math.floor((Math.min(x0, x1) - pad) / CHUNK_METRES));
      const cx1 = Math.min(dims.chunksX - 1, Math.floor((Math.max(x0, x1) + pad) / CHUNK_METRES));
      const cz0 = Math.max(0, Math.floor((Math.min(z0, z1) - pad) / CHUNK_METRES));
      const cz1 = Math.min(dims.chunksZ - 1, Math.floor((Math.max(z0, z1) + pad) / CHUNK_METRES));
      const sx = x1 - x0;
      const sz = z1 - z0;
      const flat2 = sx * sx + sz * sz;
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          for (let i = ents.chunkHead[cz * dims.chunksX + cx]!; i >= 0; i = ents.next[i]!) {
            if (i === e || i === spare || (ents.flags[i]! & (F_ALIVE | F_PROP | F_HELD)) !== F_ALIVE || r.hit.includes(ents.pid[i]!)) continue;
            if (ents.seat[i] === e + 1 && ents.seatSlot[i] !== 0 && ents.seatGen[i] === ents.gen[e]) continue;
            const bk = ents.kind[i]!;
            // The nearest the way went to the body's upright middle, then the nearest point of its height to that.
            const bx = ents.x[i]!;
            const bz = ents.z[i]!;
            let t = flat2 > 1e-9 ? ((bx - x0) * sx + (bz - z0) * sz) / flat2 : 1;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const px = x0 + sx * t;
            const py = y0 + (y1 - y0) * t;
            const pz = z0 + sz * t;
            const base = ents.y[i]!;
            const qy = py < base ? base : py > base + reg.bodyHeight[bk]! ? base + reg.bodyHeight[bk]! : py;
            const dx = bx - px;
            const dy = qy - py;
            const dz = bz - pz;
            const far = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (far > ROLL_REACH + reg.bodyRadius[bk]!) continue;
            if (far > 1e-6 && castWorld(world, px, py, pz, dx / far, dy / far, dz / far, far) !== HIT_NONE) continue;
            r.hit.push(ents.pid[i]!);
            this.rolled(rec, kind, i, px, pz, bx, qy, bz, far);
          }
        }
      }
    }
  }

  /** Lands `roller`'s roll on body `i` at (x, y, z), the roller's middle being at (ox, oz) and `far` metres away. ARK's 50 at 100% melee. */
  private rolled(roller: EntityRecord, kind: number, i: number, ox: number, oz: number, x: number, y: number, z: number, far: number): void {
    const reg = this.ctx.world.reg;
    const src = this.src;
    src.by = roller;
    src.x = ox;
    src.z = oz;
    src.item = 0;
    src.base = reg.rollDamage[kind]!;
    src.type = DMG_MELEE;
    src.quality = 1;
    src.draw = 1;
    src.attack = statOf(reg.defs[kind] as SpeciesDef, roller.genome, STAT_MELEE, 1);
    src.torporInstant = src.torporOver = src.torporSeconds = 0;
    src.buff = 0;
    src.pierce = 0;
    this.land(src, i, ZONE_TORSO, x, y, z, far);
  }

  /** The inventory slot of the held item, or -1. */
  private heldSlot(rec: EntityRecord): number {
    const inv = this.ctx.items.inv(rec);
    return inv.hotbar >= 0 && rec.held >= 0 && inv.item[inv.hotbar + rec.held] !== 0 ? inv.hotbar + rec.held : -1;
  }

  /** `toggle`: N was pressed. `wear`: a flashlight on spends a use now (LIGHT_WEAR_TICKS). */
  private attachments(c: Client, toggle: boolean, wear: boolean): void {
    const { records, items } = this.ctx;
    const rec = records.byPid.get(c.pid);
    if (!rec || rec.dead) return;
    const slot = this.heldSlot(rec);
    if (slot < 0) return;
    if (toggle) items.toggle(rec, slot);
    const inv = items.inv(rec);
    if (wear && !toggle && (inv.flags[slot]! & FLAG_ON) !== 0 && items.attachmentOf(inv, slot) === "light" && this.ctx.world.reg.uses[inv.item[slot]!]! > 0) items.wear(rec, slot, 1);
  }

  bite(e: number): void {
    const rec = this.ctx.records.byPid.get(this.ctx.world.ents.pid[e]!);
    if (rec) this.strikeBy(e, rec, null);
  }

  private strike(c: Client): void {
    const rec = this.ctx.records.byPid.get(c.pid);
    if (rec) this.strikeBy(c.ent, rec, c);
  }

  /** `c` is the session for a survivor's blow, or null for a creature's bite. */
  private strikeBy(e: number, rec: EntityRecord, c: Client | null): void {
    const { world, items, harvest } = this.ctx;
    const ents = world.ents;
    const reg = world.reg;
    const kind = ents.kind[e]!;
    // It swings the held item if that is a melee weapon and not worn out, else its bare hands. A creature has only its own body.
    // A bow or gun with a blow strikes with it (weapons-plan.md, M4): ARK's "Melee attack of any Ranged Weapon", 10 and
    // 14 torpor (Base Damage), as the melee stat and the weapon's quality make it, as a melee weapon's is.
    const inv = c ? items.inv(rec) : null;
    const slot = inv ? this.heldSlot(rec) : -1;
    let item = inv && slot >= 0 ? inv.item[slot]! : 0;
    const held = item !== 0 ? reg.weapon[item]?.kind : undefined;
    const blow = (held === W_BOW || held === W_GUN) && reg.blowDamage[item]! > 0;
    if (inv && item !== 0 && ((held !== W_MELEE && !blow) || (reg.uses[item]! > 0 && inv.dur[slot]! === 0))) item = 0;
    const butt = blow && item !== 0;
    const reach = butt ? reg.blowReach[item]! : reg.reach[item !== 0 ? item : kind]!;
    const d = this.dir;
    lookDirection(ents.yaw[e]!, ents.pitch[e]!, d);
    const ox = ents.x[e]!;
    const oy = ents.y[e]! + stanceEye(reg.move[kind]!, ents.stance[e]!);
    const oz = ents.z[e]!;
    const what = castWorld(world, ox, oy, oz, d[0]!, d[1]!, d[2]!, reach);
    const ref = rayHit.ref;
    const worldT = rayHit.t;
    // A mount does not bite its rider, who sits where its jaws begin.
    const rider = c === null ? (this.riderOf?.(rec) ?? null) : null;
    this.spare = rider ? (this.ctx.records.entOf.get(rider.pid) ?? -1) : -1;
    const target = this.castBodies(e, ox, oy, oz, d[0]!, d[1]!, d[2]!, what === HIT_NONE ? reach : worldT, SWING_WIDTH);
    this.spare = -1;
    // A dead creature's body nearer than any living one and anything built. Only a survivor's swing harvests one yet.
    const corpses = this.corpses;
    const body = corpses && c ? corpses.cast(ox, oy, oz, d[0]!, d[1]!, d[2]!, target >= 0 ? this.t : what === HIT_NONE ? reach : worldT) : -1;
    const src = this.src;
    src.by = rec;
    src.x = ox;
    src.z = oz;
    src.item = item;
    src.base = butt ? reg.blowDamage[item]! : reg.damage[item !== 0 ? item : kind]!;
    src.type = item !== 0 && !butt ? reg.damageType[item]! : DMG_MELEE;
    src.quality = inv && item !== 0 ? (QUALITY_MUL[inv.quality[slot]!] ?? 1) : 1;
    src.draw = 1;
    src.attack = statOf(reg.defs[kind] as SpeciesDef, rec.genome, STAT_MELEE, 1);
    src.torporInstant = butt ? reg.blowTorpor[item]! : reg.meleeTorpor[item !== 0 ? item : kind]!;
    src.torporOver = src.torporSeconds = 0;
    src.buff = 0;
    src.pierce = 0;
    const wears = item !== 0 && reg.uses[item]! > 0;
    if (body >= 0) {
      // Harvest damage is the blow's damage as the attacker's melee and the weapon's quality make it, times the server's rule.
      corpses!.struck(rec, body, src.base * src.quality * src.attack * this.ctx.rules.num("PlayerHarvestingDamageMultiplier"), item);
      if (wears) items.wear(rec, slot, 1);
    } else if (target >= 0) {
      const t = this.t;
      this.land(src, target, this.zone, ox + d[0]! * t, oy + d[1]! * t, oz + d[2]! * t, t);
      if (wears) items.wear(rec, slot, 1);
    } else if (what === HIT_NODE && harvest && c) harvest.struck(c, Math.floor(ref / 65536), ref & 0xffff);
    else if (what === HIT_STRUCTURE && this.hitStructure(src, ref, ox + d[0]! * worldT, oy + d[1]! * worldT, oz + d[2]! * worldT) > 0 && wears) items.wear(rec, slot, 1);
  }

  private reload(c: Client): void {
    const { world, records, items } = this.ctx;
    const rec = records.byPid.get(c.pid);
    if (!rec) return;
    const slot = this.heldSlot(rec);
    const params = slot >= 0 ? world.reg.weapon[items.inv(rec).item[slot]!] : null;
    const ammo = slot >= 0 ? this.ammoFor(rec, slot) : 0;
    // A round at a time loads one more than it holds of that kind, as the action step counted (weapons-plan.md, M4).
    const inv = items.inv(rec);
    const upTo = params?.reloadEach ? Math.min(params.clip, (slot >= 0 && inv.ammo[slot] === ammo ? inv.loaded[slot]! : 0) + 1) : (params?.clip ?? 0);
    if (params && ammo !== 0) items.load(rec, slot, ammo, upTo);
    // The weapon's count overrides what the action step assumed.
    world.ents.rounds[c.ent] = slot >= 0 ? items.inv(rec).loaded[slot]! : 0;
  }

  private fire(c: Client): void {
    const { world, records, items } = this.ctx;
    const rec = records.byPid.get(c.pid);
    if (!rec) return;
    const slot = this.heldSlot(rec);
    const inv = items.inv(rec);
    if (slot >= 0 && world.reg.weapon[inv.item[slot]!]?.kind === W_THROWN) {
      this.throwIt(c, rec, slot);
      return;
    }
    if (slot < 0 || !items.spend(rec, slot)) {
      // The action step assumed a round the weapon does not have.
      world.ents.rounds[c.ent] = slot >= 0 ? inv.loaded[slot]! : 0;
      return;
    }
    const weapon = inv.item[slot]!;
    if (world.reg.uses[weapon]! > 0) items.wear(rec, slot, 1);
    this.onFire?.(c, rec, weapon, inv.quality[slot]!, inv.ammo[slot]!, c.drawn);
  }

  private throwIt(c: Client, rec: EntityRecord, slot: number): void {
    const items = this.ctx.items;
    const inv = items.inv(rec);
    const item = inv.item[slot]!;
    const quality = inv.quality[slot]!;
    if (!items.burn(rec, slot, 1)) return;
    this.onThrow?.(c, rec, item, quality, c.drawn);
  }

  /**
   * Notes how old the newest snapshot `c` has acknowledged is: its round trip, as the server sees it. The client names
   * the tick, so it can make this longer but not for one shot, because `lag` takes the least over some seconds.
   */
  private measure(c: Client, now: number): void {
    const i = c.id;
    // A zero ack requests a whole snapshot, not a fresh latency estimate. Only an actual connection change resets it.
    if (this.lagConn[i] !== c.conn) {
      this.lagConn[i] = c.conn;
      this.lagFrom[i] = -1;
    }
    if (c.ackTick === 0) return;
    const age = now - c.ackTick;
    if (this.lagFrom[i]! < 0) {
      this.lagNow[i] = this.lagWas[i] = age;
      this.lagFrom[i] = now;
    } else if (now - this.lagFrom[i]! >= LAG_WINDOW) {
      this.lagWas[i] = this.lagNow[i]!;
      this.lagNow[i] = age;
      this.lagFrom[i] = now;
    } else if (age < this.lagNow[i]!) this.lagNow[i] = age;
  }

  /** The round trip of `c` in ticks, as measured. 0 until it has acknowledged a snapshot. */
  lag(c: Client): number {
    const i = c.id;
    return this.lagConn[i] !== c.conn || (this.lagFrom[i] ?? -1) < 0 ? 0 : Math.min(this.lagNow[i]!, this.lagWas[i]!);
  }

  /**
   * The moment `c` was drawing when it sampled the input stepped now, as it says. It may fall between two ticks, and is
   * clamped to the last snapshot sent, to REWIND_TICKS back, and to what its measured round trip explains. Returns now
   * if history does not remember that moment.
   */
  viewTick(c: Client): number {
    const world = this.ctx.world;
    const now = world.tick;
    const inputs = c.inputs;
    let view = inputs.has(now) ? inputs.view[now & inputs.mask]! : c.ackTick - VIEW_BEHIND;
    if (view > c.lastSnapshot) view = c.lastSnapshot;
    // An input sent ahead was sampled that much earlier. A client can only add to this by committing to the shot sooner.
    const ahead = inputs.has(now) ? now - c.arrived[now & inputs.mask]! : 0;
    const back = Math.min(REWIND_TICKS, this.lag(c) + ahead + REWIND_SLACK);
    if (view < now - back) view = now - back;
    if (view >= now || !world.history.has(Math.floor(view))) return now;
    return view;
  }

  /**
   * The ammunition a reload of the weapon in `slot` would use: the kind last chosen if any is loaded or carried,
   * else the first kind it takes that the record carries. 0 for none.
   */
  ammoFor(rec: EntityRecord, slot: number): number {
    const reg = this.ctx.world.reg;
    const inv = this.ctx.items.inv(rec);
    const def = reg.defs[inv.item[slot]!];
    const takes = def?.type === "item" ? def.weapon?.ammo : undefined;
    if (!takes) return 0;
    const chosen = inv.ammo[slot]!;
    if (chosen !== 0 && (inv.loaded[slot]! > 0 || inv.total(chosen) > 0)) return chosen;
    for (const id of takes) {
      const k = reg.index.get(id)!;
      if (inv.total(k) > 0) return k;
    }
    return chosen;
  }

  /**
   * The nearest body a ray hits within `maxT`, other than `self`, as an entity index, or -1. `this.zone` and `this.t`
   * say where. With a `width`, rays that far off the middle one are tried when it misses. `at` is the tick to test
   * bodies at, now or one the history remembers. `sweep` is the ticks the ray took to cover `maxT`, for a segment of
   * a flight, and each body is then met where it was along the way.
   */
  castBodies(self: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, width = 0, at = this.ctx.world.tick, sweep = 0): number {
    const world = this.ctx.world;
    const ents = world.ents;
    const reg = world.reg;
    const dims = world.dims;
    this.at = at >= world.tick ? -1 : at;
    this.sweep = sweep;
    this.span = maxT;
    // Gather every body whose bounding sphere could touch the ray. A body judged in the past may have moved since, so the search is padded.
    // The car or creature the caster sits on is not in its way, nor, for a mount, are those who sit on it.
    const parent = self >= 0 ? ents.seat[self]! - 1 : -1;
    const carrier = parent >= 0 && ents.seatSlot[self] !== 0 && ents.seatGen[self] === ents.gen[parent] ? parent : -1;
    let n = 0;
    const near = this.near;
    const nearT = this.nearT;
    const slack = width + (this.at < 0 ? 0 : REWIND_REACH) + (sweep > 0 ? SWEEP_REACH : 0);
    const pad = this.targetReach + slack;
    const ex = ox + dx * maxT;
    const ez = oz + dz * maxT;
    const x0 = Math.max(0, Math.floor((Math.min(ox, ex) - pad) / CHUNK_METRES));
    const x1 = Math.min(dims.chunksX - 1, Math.floor((Math.max(ox, ex) + pad) / CHUNK_METRES));
    const z0 = Math.max(0, Math.floor((Math.min(oz, ez) - pad) / CHUNK_METRES));
    const z1 = Math.min(dims.chunksZ - 1, Math.floor((Math.max(oz, ez) + pad) / CHUNK_METRES));
    const flat2 = dx * dx + dz * dz;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        // A long ray crosses few of the chunks its bounds cover, so skip those it passes nowhere near.
        const mx = (cx + 0.5) * CHUNK_METRES - ox;
        const mz = (cz + 0.5) * CHUNK_METRES - oz;
        let along = flat2 > 1e-9 ? (mx * dx + mz * dz) / flat2 : 0;
        along = along < 0 ? 0 : along > maxT ? maxT : along;
        const fx = mx - dx * along;
        const fz = mz - dz * along;
        if (fx * fx + fz * fz > (CHUNK_REACH + pad) * (CHUNK_REACH + pad)) continue;
        for (let i = ents.chunkHead[cz * dims.chunksX + cx]!; i >= 0; i = ents.next[i]!) {
          if (i === self || i === this.spare || i === carrier || (ents.flags[i]! & (F_ALIVE | F_PROP | F_HELD)) !== F_ALIVE) continue;
          if (self >= 0 && ents.seat[i] === self + 1 && ents.seatSlot[i] !== 0 && ents.seatGen[i] === ents.gen[self]) continue;
          const kind = ents.kind[i]!;
          // A sphere that holds the body in any pose. A larger box gets a larger sphere.
          const h = reg.bodyHeight[kind]!;
          const rig = this.anims[kind]?.rig;
          const vehicle = reg.vehicle[kind], car = vehicle?.spec;
          const marine = vehicle?.movement === "boat" ? vehicle.spec : null;
          const r = (car ? this.vehicleReach[kind]! : rig ? rig.reach : Math.max(BODY_REACH, h * 0.5 + reg.bodyRadius[kind]!)) + slack;
          const px = ents.x[i]! - ox;
          const py = ents.y[i]! + (marine ? 0 : this.human[kind] ? BODY_REACH_Y : rig && !car ? rig.mid : h * 0.5) - oy;
          const pz = ents.z[i]! - oz;
          const t = px * dx + py * dy + pz * dz;
          if (t < -r || t > maxT + r || px * px + py * py + pz * pz - t * t > r * r) continue;
          if (n < MAX_NEAR) {
            nearT[n] = t;
            near[n++] = i;
            continue;
          }
          // Full. The farthest along the ray gives way, so the nearest body is always among those tested.
          let far = 0;
          for (let k = 1; k < MAX_NEAR; k++) if (nearT[k]! > nearT[far]!) far = k;
          if (t < nearT[far]!) {
            nearT[far] = t;
            near[far] = i;
          }
        }
      }
    }
    this.zone = ZONE_NONE;
    this.t = maxT;
    if (n === 0) return -1;
    let best = this.castNear(n, ox, oy, oz, dx, dy, dz);
    if (best >= 0 || width <= 0) return best;
    // Offsets to each side, above and below. (rx, 0, rz) is level and square to the ray, and (ux, uy, uz) is square to both.
    let rx = dz;
    let rz = -dx;
    const rl = Math.sqrt(rx * rx + rz * rz);
    if (rl < 1e-6) {
      rx = 1;
      rz = 0;
    } else {
      rx /= rl;
      rz /= rl;
    }
    const ux = -rz * dy;
    const uy = rz * dx - rx * dz;
    const uz = rx * dy;
    for (let k = 0; k < 4; k++) {
      const a = k === 0 ? width : k === 1 ? -width : 0;
      const b = k === 2 ? width : k === 3 ? -width : 0;
      const hit = this.castNear(n, ox + rx * a + ux * b, oy + uy * b, oz + rz * a + uz * b, dx, dy, dz);
      if (hit >= 0) best = hit;
    }
    return best;
  }

  /** The tick `castNear` tests bodies at, or -1 for now. */
  private at = -1;
  /** For a segment of a flight: the ticks it took, and its length. `sweep` is 0 for a ray that takes no time. */
  private sweep = 0;
  private span = 0;
  private readonly before = new Past();
  private readonly vehicleNow = new Past();

  /** Where body `i` was at `tick`, which may be now, a remembered tick, or a moment between two. False if it was not there then. */
  private where(i: number, tick: number, out: Past): boolean {
    const world = this.ctx.world;
    const ents = world.ents;
    const now = world.tick;
    const whole = Math.floor(tick);
    if (whole < now - 1 || (whole < now && whole === tick)) return world.history.sample(tick, i, out);
    if (whole >= now) {
      out.x = ents.x[i]!;
      out.y = ents.y[i]!;
      out.z = ents.z[i]!;
      out.yaw = ents.yaw[i]!;
      out.anim = ents.anim[i]!;
      out.cue = ents.cue[i]!;
      out.vehicleFrom(ents, i);
      return true;
    }
    // Between the last remembered tick and this one, which is not recorded yet. Blend as a client does.
    if (!world.history.at(whole, i, out)) return false;
    const k = tick - whole;
    out.x += (ents.x[i]! - out.x) * k;
    out.y += (ents.y[i]! - out.y) * k;
    out.z += (ents.z[i]! - out.z) * k;
    this.vehicleNow.vehicleFrom(ents, i); out.blendVehicle(this.vehicleNow, k);
    let turn = ents.yaw[i]! - out.yaw;
    if (turn > 32768) turn -= 65536;
    else if (turn < -32768) turn += 65536;
    out.yaw = (out.yaw + Math.round(turn * k)) & 0xffff;
    if (k >= 0.5) {
      out.anim = ents.anim[i]!;
      out.cue = ents.cue[i]!;
    }
    return true;
  }

  /**
   * For body `i` sitting in a saddle's seat, writes its seat's frame on its mount as the mount was at `tick` to `seatAt`
   * and returns 1 for the seat that steers, 2 for a passenger's; 0 for a body in no saddle.
   */
  private saddled(i: number, tick: number): number {
    const world = this.ctx.world, ents = world.ents;
    const host = ents.seat[i]! - 1;
    if (host < 0 || ents.seatSlot[i] === 0 || ents.gen[host] !== ents.seatGen[i] || world.reg.vehicle[ents.kind[host]!]) return 0;
    const seat = saddleSeat(world.reg, ents.gears.get(host)?.[GEAR_WORN] ?? 0, ents.seatSlot[i]!);
    const was = this.mountPast;
    if (!seat || !this.where(host, tick, was)) return 0;
    const st = this.mountSt;
    st.unpack(was.anim, was.cue);
    st.seed = bodySeed(host);
    seatOn(this.anims[ents.kind[host]!] ?? null, seat, st, tick, was.x, was.y, was.z, (was.yaw * TAU) / 65536, this.seatAt);
    return seat.driver ? 1 : 2;
  }

  /** The nearest of the first `n` bodies in `near` that the ray hits nearer than `this.t`, or -1. Updates `this.t` and `this.zone`. */
  private castNear(n: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    const world = this.ctx.world;
    const reg = world.reg;
    const st = this.st;
    const past = this.past;
    const before = this.before;
    const tick = this.at < 0 ? world.tick : this.at;
    const span = this.span;
    let best = -1;
    for (let k = 0; k < n; k++) {
      const i = this.near[k]!;
      const kind = world.ents.kind[i]!;
      if (!this.where(i, tick, past)) continue;
      // A flight segment takes time, and the body moves in that time. In the body's frame the segment starts
      // further back by as much as the body moved. Tested this way, nothing slips between ticks.
      let rx = ox, ry = oy, rz = oz, ux = dx, uy = dy, uz = dz;
      let scale = 1;
      if (this.sweep > 0 && this.where(i, tick - this.sweep, before)) {
        const mx = past.x - before.x;
        const my = past.y - before.y;
        const mz = past.z - before.z;
        if (mx !== 0 || my !== 0 || mz !== 0) {
          rx += mx;
          ry += my;
          rz += mz;
          const ex = ox + dx * span - rx;
          const ey = oy + dy * span - ry;
          const ez = oz + dz * span - rz;
          const length = Math.sqrt(ex * ex + ey * ey + ez * ez);
          if (length > 1e-9) {
            ux = ex / length;
            uy = ey / length;
            uz = ez / length;
            // Converts distances along this ray to distances along the segment.
            scale = span / length;
          }
        }
      }
      const reach = this.t / scale;
      if (this.human[kind] && world.anim) {
        st.unpack(past.anim);
        st.seed = bodySeed(i);
        const seat = this.saddled(i, tick);
        const zone = seat !== 0 ? raySeated(world.anim, st, tick, this.seatAt, seat === 1, rx, ry, rz, ux, uy, uz, reach) : rayBody(world.anim, st, tick, past.x, past.y, past.z, past.yaw, rx, ry, rz, ux, uy, uz, reach);
        if (zone !== ZONE_NONE && zoneHit.t < reach) {
          this.t = zoneHit.t * scale;
          this.zone = zone;
          best = i;
        }
      } else if (this.anims[kind] && !reg.vehicle[kind]) {
        st.unpack(past.anim, past.cue);
        st.seed = bodySeed(i);
        // A young creature is its kind's shape scaled down about its position. The ray is scaled up about that
        // point instead, and the hit distance is scaled back.
        const size = world.ents.grown[i] !== 0 ? youngScale(reg.birthScale[kind]!, world.ents.span[i]!, world.ents.grown[i]!, tick) : 1;
        const zone =
          size === 1
            ? rayCreature(this.anims[kind]!, st, tick, past.x, past.y, past.z, past.yaw, rx, ry, rz, ux, uy, uz, reach)
            : rayCreature(this.anims[kind]!, st, tick, past.x, past.y, past.z, past.yaw, past.x + (rx - past.x) / size, past.y + (ry - past.y) / size, past.z + (rz - past.z) / size, ux, uy, uz, reach / size);
        if (zone !== ZONE_NONE && zoneHit.t * size < reach) {
          this.t = zoneHit.t * size * scale;
          this.zone = zone;
          best = i;
        }
      } else if (reg.vehicle[kind]) {
        // A vehicle is met by its mechanical hull up to its belt line, whatever its art, turned as it was.
        const def = reg.vehicle[kind]!;
        const t = rayVehicle(def, past.x, past.y, past.z, (past.yaw * TAU) / 65536, rx, ry, rz, ux, uy, uz, def.beltline, def.movement === "boat" || def.movement === "rotor" ? past : { pitch: past.pitch, roll: past.roll });
        if (t < reach) {
          this.t = t * scale;
          this.zone = ZONE_TORSO;
          best = i;
        }
      } else {
        const size = world.ents.grown[i] !== 0 ? youngScale(reg.birthScale[kind]!, world.ents.span[i]!, world.ents.grown[i]!, tick) : 1;
        const r = reg.bodyRadius[kind]! * size;
        const t = rayBox(rx, ry, rz, ux, uy, uz, past.x - r, past.y, past.z - r, past.x + r, past.y + reg.bodyHeight[kind]! * size, past.z + r);
        if (t < reach) {
          this.t = t * scale;
          this.zone = ZONE_TORSO;
          best = i;
        }
      }
    }
    return best;
  }

  /** The server's multiplier on damage `by` deals. */
  private dealt(by: EntityRecord | null): number {
    if (!by) return 1;
    const { rules, lists } = this.ctx;
    if (by.kind === this.survivor) return rules.num("PlayerDamageMultiplier");
    const tamed = by.team !== 0;
    return rules.num(tamed ? "TamedDinoDamageMultiplier" : "DinoDamageMultiplier") * (lists.multipliers(tamed ? "TamedDinoClassDamageMultipliers" : "DinoClassDamageMultipliers").get(by.kind) ?? 1);
  }

  /**
   * The server's multiplier on damage `victim` takes. As in ARK, the class-wide settings are damage taken (higher
   * takes more) and the per-species lists are resistance (higher takes less), so the lists divide.
   */
  private taken(victim: EntityRecord): number {
    const { rules, lists } = this.ctx;
    if (victim.kind === this.survivor) return rules.num("PlayerResistanceMultiplier");
    const tamed = victim.team !== 0;
    const own = lists.multipliers(tamed ? "TamedDinoClassResistanceMultipliers" : "DinoClassResistanceMultipliers").get(victim.kind);
    return rules.num(tamed ? "TamedDinoResistanceMultiplier" : "DinoResistanceMultiplier") / (own !== undefined && own > 0 ? own : 1);
  }

  /**
   * Whether the rules cancel what `by` does to something of `team`. On a PvE server one tribe cannot harm another's
   * survivors, tames or structures. A team's own side is spared everything but explosions, unless a rule spares those
   * too or spares nothing. The wild, and what a record does to itself, are never spared.
   */
  private spared(by: EntityRecord | null, team: number, type: number, self: boolean): boolean {
    if (!by || self || by.team === 0 || team === 0) return false;
    const rules = this.ctx.rules;
    const pve = rules.on("serverPVE");
    if (by.team !== team) return pve;
    if (rules.on(pve ? "bPvEDisableFriendlyFire" : "bDisableFriendlyFire")) return true;
    return type !== DMG_EXPLOSIVE && !rules.on("FullFriendlyFire");
  }

  /** `far` is metres from where `src` came. The harm applies to the body as it is now, even when the hit was judged at an earlier tick. */
  land(src: Source, target: number, zone: number, x: number, y: number, z: number, far: number): void {
    const { world, records, items, survival, creatures, buffs } = this.ctx;
    const ents = world.ents;
    const reg = world.reg;
    const victim = records.byPid.get(ents.pid[target]!);
    if (!victim) return;
    const by = src.by;
    const item = src.item;
    const vkind = ents.kind[target]!;
    resetHit();
    hit.base = src.base;
    hit.type = src.type;
    hit.quality = src.quality;
    hit.draw = src.draw;
    hit.far = src.far ?? 1;
    hit.attack = src.attack * (by ? buffs.dealtOf(by) : 1);
    hit.resist = buffs.takenOf(victim);
    hit.torporInstant = src.torporInstant;
    hit.torporOver = src.torporOver;
    hit.pierce = src.pierce ?? 0;
    hit.takes = reg.takes[vkind]?.[hit.type] ?? 1;
    const rules = this.ctx.rules;
    hit.zone = rules.on("HeadMultipliers") ? (reg.zoneMul[vkind]?.[zone] ?? 1) : 1;
    const self = by === victim;
    hit.rule = this.spared(by, victim.team, hit.type, self) ? 0 : this.dealt(by) * this.taken(victim) * (self ? rules.num("SelfDamageMultiplier") : 1);
    const bus = this.ctx.bus;
    if (bus.n[DAMAGE] !== 0 && hit.rule !== 0) hit.rule *= this.asked("body", victim.pid, reg.ids[vkind]!, victim.team, by, item, hit.type, zone);
    this.blow.victim = victim.pid;
    this.blow.item = item;
    this.blow.far = far;
    const vinv = victim.inv;
    let piece = -1;
    let worn = 0;
    if (vinv && vinv.armor >= 0 && zone !== ZONE_NONE) {
      // An aimed hit counts only the piece worn over the zone hit, if it is not worn out, scaled by PIECE_SCALE.
      piece = vinv.armor + SLOT_OF_ZONE[zone]!;
      if (vinv.item[piece] !== 0 && vinv.dur[piece]! > 0) hit.armor = reg.armor[vinv.item[piece]!]! * (QUALITY_MUL[vinv.quality[piece]!] ?? 1) * PIECE_SCALE;
    } else if (vinv && vinv.armor >= 0) {
      // An unaimed hit (a blast) counts every worn piece once.
      for (let k = 0; k < ARMOR_SLOTS; k++) {
        const at = vinv.armor + k;
        if (vinv.item[at] === 0 || vinv.dur[at]! === 0) continue;
        hit.armor += reg.armor[vinv.item[at]!]! * (QUALITY_MUL[vinv.quality[at]!] ?? 1);
        worn++;
      }
    } else if (victim.saddle !== 0) {
      // A saddle is armor for its wearer wherever the hit lands.
      hit.armor = reg.saddleArmor[victim.saddle]! * (hit.type === DMG_EXPLOSIVE ? SADDLE_BLAST : SADDLE_DIRECT);
    }
    resolveDamage();
    if (harm.wear > 0 && hit.armor > 0 && vinv && vinv.armor >= 0) {
      if (piece >= 0) items.wear(victim, piece, harm.wear);
      else for (let k = 0; k < ARMOR_SLOTS; k++) if (vinv!.item[vinv!.armor + k] !== 0 && vinv!.dur[vinv!.armor + k]! > 0) items.wear(victim, vinv!.armor + k, Math.ceil(harm.wear / worn));
    }

    const vc = this.clientOf(victim.pid);
    const ax = src.x;
    const az = src.z;
    const vx = ents.x[target]!;
    const vz = ents.z[target]!;
    this.died = false;
    const taken = survival.hurt(victim, harm.health, by ? by.pid : 0);
    const killed = this.died;
    this.blow.victim = 0;
    if (bus.n[DAMAGED] !== 0) {
      bus.after(DAMAGED, { target: "body", victim: victim.pid, kind: reg.ids[vkind]!, team: victim.team, byPid: by ? by.pid : 0, byTeam: by ? by.team : 0, item: item !== 0 ? reg.ids[item]! : "", type: TYPE_WORDS[hit.type]!, zone, taken, blocked: harm.blocked, killed, left: killed ? 0 : survival.value(victim, V_HEALTH) });
    }
    if (taken > 0 && !killed) this.onHarm?.(victim, taken);
    this.hits++;
    const last = this.last;
    last.by = by ? by.pid : 0;
    last.victim = victim.pid;
    last.zone = zone;
    last.damage = taken;
    last.blocked = harm.blocked;
    last.wear = hit.armor > 0 ? harm.wear : 0;
    last.killed = killed;
    // A blow the rules cancel provokes nobody and leaves no torpor or buff.
    if (!killed && hit.rule !== 0 && (ents.flags[target]! & F_ALIVE) !== 0) {
      creatures.provoke(target, ax, az, by ? (records.entOf.get(by.pid) ?? -1) : -1);
      // The hit leaves instant torpor, torpor over time as a dose, and the round's buff. Armor reduces the torpor as it reduces the harm.
      const from = by ? by.pid : 0;
      if (harm.torpor > 0) survival.add(victim, V_TORPOR, harm.torpor);
      if (harm.torporOver > 0 && src.torporSeconds > 0 && this.dose !== 0) buffs.give(victim, this.dose, from, src.torporSeconds, harm.torporOver / src.torporSeconds);
      if (src.buff !== 0) {
        if (this.entangle) this.entangle(victim, src.buff, from);
        else buffs.give(victim, src.buff, from);
      }
    }

    const game = this.ctx.game;
    const shown = Math.min(65535, Math.max(taken > 0 ? 1 : 0, Math.round(taken)));
    const ac = by ? this.clientOf(by.pid) : null;
    if (ac) {
      const w = game.begin(S_EVENT);
      w.u8(EVENT_HIT);
      w.f32(x);
      w.f32(y);
      w.f32(z);
      w.bits(zone, 4);
      w.u16(shown);
      w.bool(killed);
      w.bool(harm.blocked > 0);
      game.endOwn(ac);
    }
    if (vc && taken > 0) {
      const w = game.begin(S_EVENT);
      w.u8(killed ? EVENT_DEATH : EVENT_HURT);
      w.u16(shown);
      // The side it came from, in 256ths of a turn, unless the shot was silenced: "Players hit by a silenced weapon will not
      // be shown the direction the bullet came from" (Silencer Attachment). Then the side is not sent at all.
      const side = src.silenced !== true;
      w.u8(side ? Math.round((Math.atan2(ax - vx, az - vz) / (Math.PI * 2)) * 256) & 255 : 0);
      w.bits(zone, 4);
      w.bool(side);
      if (killed) {
        w.string(!by ? "someone" : by.name !== "" ? by.name.slice(0, 24) : speciesLabel(reg.ids[by.kind]!));
        w.u16(item);
        w.u16(Math.min(65535, Math.round(far * 10)));
      }
      game.endOwn(vc);
    }
  }

  /** `src`, times `share`, lands on the structure `ref` at (x, y, z). Returns the damage done. */
  hitStructure(src: Source, ref: number, x: number, y: number, z: number, share = 1): number {
    const { world, buffs, game } = this.ctx;
    const structs = world.structs;
    const t = structs.chunks[Math.floor(ref / 65536)];
    const slot = ref & 0xffff;
    if (!t || slot >= t.high || t.kind[slot] === 0) return 0;
    const takes = world.reg.structTakes[t.kind[slot]!];
    if (!takes) return 0;
    resetHit();
    hit.base = src.base * share;
    hit.type = src.type;
    hit.quality = src.quality;
    hit.draw = src.draw;
    hit.far = src.far ?? 1;
    hit.attack = src.attack * (src.by ? buffs.dealtOf(src.by) : 1);
    hit.takes = takes[src.type]!;
    // The weapon's own factor against what is built (D435): the grenade's 175 to a body is the Table of explosives' 788 to wood.
    hit.structures = world.reg.structureMul[src.item] ?? 1;
    // A structure is spared as its owning tribe would be.
    hit.rule = this.spared(src.by, t.owner[slot]!, src.type, false) ? 0 : this.dealt(src.by) * this.ctx.rules.num("StructureResistanceMultiplier");
    const bus = this.ctx.bus;
    const [kind, owner] = [world.reg.ids[t.kind[slot]!]!, t.owner[slot]!];
    if (bus.n[DAMAGE] !== 0 && hit.rule !== 0) hit.rule *= this.asked("structure", ref, kind, owner, src.by, src.item, src.type, ZONE_NONE);
    resolveDamage();
    if (!(harm.health > 0)) return 0;
    const before = t.hp[slot]!;
    const left = structs.damage(ref, harm.health, world.tick);
    if (bus.n[DAMAGED] !== 0) {
      bus.after(DAMAGED, { target: "structure", victim: ref, kind, team: owner, byPid: src.by ? src.by.pid : 0, byTeam: src.by ? src.by.team : 0, item: src.item !== 0 ? world.reg.ids[src.item]! : "", type: TYPE_WORDS[src.type]!, zone: ZONE_NONE, taken: left === 0 ? before : harm.health, blocked: 0, killed: left === 0, left });
    }
    if (left > 0) this.onStructureHurt?.(ref);
    const done = left === 0 ? before : harm.health;
    this.structureHits++;
    this.lastStructure.ref = ref;
    this.lastStructure.damage = done;
    this.lastStructure.left = left;
    const ac = src.by ? this.clientOf(src.by.pid) : null;
    if (ac) {
      const w = game.begin(S_EVENT);
      w.u8(EVENT_HIT);
      w.f32(x);
      w.f32(y);
      w.f32(z);
      w.bits(ZONE_NONE, 4);
      w.u16(Math.min(65535, Math.max(1, Math.round(done))));
      w.bool(left === 0);
      w.bool(false);
      game.endOwn(ac);
    }
    return done;
  }

  /**
   * Every body within `radius` of (x, y, z) that has a clear line to it, and every structure within `radius`, takes
   * `src`, in full within a metre and fading to nothing at the edge. `direct` is a body a round that went off struck straight
   * on, which takes the blast in full wherever on it the round met it (weapons-plan.md, M8), or -1.
   */
  blast(src: Source, x: number, y: number, z: number, radius: number, direct = -1): void {
    const world = this.ctx.world;
    const ents = world.ents;
    const reg = world.reg;
    const dims = world.dims;
    const fade = (far: number): number => (far <= 1 ? 1 : far >= radius ? 0 : 1 - (far - 1) / (radius - 1));
    const base = src.base;
    // Gather the bodies first, because a kill changes the chunk lists being walked.
    const found = this.found;
    const share = this.share;
    found.length = share.length = 0;
    const x0 = Math.max(0, Math.floor((x - radius - 2) / CHUNK_METRES));
    const x1 = Math.min(dims.chunksX - 1, Math.floor((x + radius + 2) / CHUNK_METRES));
    const z0 = Math.max(0, Math.floor((z - radius - 2) / CHUNK_METRES));
    const z1 = Math.min(dims.chunksZ - 1, Math.floor((z + radius + 2) / CHUNK_METRES));
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (let i = ents.chunkHead[cz * dims.chunksX + cx]!; i >= 0; i = ents.next[i]!) {
          if ((ents.flags[i]! & (F_ALIVE | F_PROP | F_HELD)) !== F_ALIVE) continue;
          const kind = ents.kind[i]!;
          const mx = ents.x[i]! - x;
          const my = ents.y[i]! + reg.bodyHeight[kind]! * 0.5 - y;
          const mz = ents.z[i]! - z;
          // The distance to the body's nearest point, approximated as the distance to its middle less its radius.
          const mid = Math.sqrt(mx * mx + my * my + mz * mz);
          const far = i === direct ? 0 : Math.max(0, mid - reg.bodyRadius[kind]!);
          if (far >= radius) continue;
          // World geometry between the two shields the body.
          if (i !== direct && mid > 0.5 && castWorld(world, x, y + 0.1, z, mx / mid, (my - 0.1) / mid, mz / mid, mid - 0.3) !== HIT_NONE) continue;
          found.push(i);
          share.push(fade(far));
        }
      }
    }
    for (let k = 0; k < found.length; k++) {
      const i = found[k]!;
      if ((ents.flags[i]! & F_ALIVE) === 0) continue;
      src.base = base * share[k]!;
      const kind = ents.kind[i]!;
      const by = ents.y[i]! + reg.bodyHeight[kind]! * 0.5;
      this.land(src, i, ZONE_NONE, ents.x[i]!, by, ents.z[i]!, Math.sqrt((ents.x[i]! - x) * (ents.x[i]! - x) + (by - y) * (by - y) + (ents.z[i]! - z) * (ents.z[i]! - z)));
    }
    src.base = base;
    // Structures take the blast by the distance to their nearest point.
    const structs = world.structs;
    const n = structs.query(x - radius, z - radius, x + radius, z + radius, this.inBlast);
    const refs = this.inBlast.refs;
    found.length = share.length = 0;
    for (let k = 0; k < n; k++) {
      const ref = refs[k]!;
      const t = structs.chunks[Math.floor(ref / 65536)]!;
      const slot = ref & 0xffff;
      const kind = t.kind[slot]!;
      // The blast in the box's own frame, and the point of the box nearest it.
      const a = (t.yaw[slot]! * Math.PI * 2) / 65536;
      const sn = Math.sin(a);
      const cs = Math.cos(a);
      const px = x - t.x[slot]!;
      const pz = z - t.z[slot]!;
      const lx = cs * px - sn * pz;
      const ly = y - t.y[slot]!;
      const lz = sn * px + cs * pz;
      const parts = structs.parts;
      const hulls = parts.hulls;
      let far: number;
      if (hulls && hulls.start[kind + 1]! > hulls.start[kind]!) {
        // A sloped piece's box holds much air, so it takes the blast by the nearest of its parts.
        far = radius;
        const box = parts.box;
        for (let p = parts.start[kind]! * 6, end = parts.start[kind + 1]! * 6; p < end; p += 6) far = Math.min(far, fromBox(lx - box[p]!, ly - box[p + 1]!, lz - box[p + 2]!, box[p + 3]!, box[p + 4]!, box[p + 5]!));
        // With no radius, a part's push is the way from the blast to its nearest point, and deeper than 0 inside it.
        for (let p = hulls.start[kind]!, end = hulls.start[kind + 1]!; p < end; p++) if (capsuleHull(hulls, p, t.yaw[slot]!, px, pz, ly, ly, 0, far)) far = Math.max(0, -hullPush.depth);
      } else far = fromBox(lx, ly, lz, structs.halfXOf(kind), structs.halfYOf(kind), structs.halfZOf(kind));
      if (far >= radius) continue;
      found.push(ref);
      share.push(fade(far));
    }
    for (let k = 0; k < found.length; k++) {
      const ref = found[k]!;
      const t = structs.chunks[Math.floor(ref / 65536)]!;
      const slot = ref & 0xffff;
      this.hitStructure(src, ref, t.x[slot]!, t.y[slot]!, t.z[slot]!, share[k]!);
    }
  }

  /** The blow being landed, for whoever is told of a death it causes. `victim` is 0 when none is. */
  readonly blow = { victim: 0, item: 0, far: 0 };
  // One object for every asking. A handler may not keep it.
  private readonly asking: EventData = {};

  /**
   * Asks modules about a blow that the rules let land. Returns the share of it that lands: 1 unless a module says
   * otherwise, and 0 if one refuses it.
   */
  private asked(target: string, victim: number, kind: string, team: number, by: EntityRecord | null, item: number, type: number, zone: number): number {
    const d = this.asking;
    d.target = target;
    d.victim = victim;
    d.kind = kind;
    d.team = team;
    d.byPid = by ? by.pid : 0;
    d.byTeam = by ? by.team : 0;
    d.item = item !== 0 ? this.ctx.world.reg.ids[item]! : "";
    d.type = TYPE_WORDS[type]!;
    d.zone = zone;
    d.scale = 1;
    if (this.ctx.bus.before(DAMAGE, d) !== "") return 0;
    const scale = Number(d.scale);
    return scale >= 0 ? scale : 1;
  }

  /**
   * A body's health reached zero and `by` (a pid, or 0) did it. Called before the body leaves the world. The killer gets
   * the XP. What a creature's body gives is had by harvesting it (server/corpses.ts), whoever killed it.
   */
  killed(rec: EntityRecord, by: number): void {
    this.died = true;
    const { world, records, progression, game } = this.ctx;
    const killer = by !== 0 ? records.byPid.get(by) : undefined;
    if (!killer || killer === rec || killer.dead) return;
    const reg = world.reg;
    const def = reg.defs[rec.kind] as SpeciesDef;
    const level = rec.kind === this.survivor ? progression.levelOf(rec.xp) : (rec.genome?.level ?? 1);
    const base = Math.round((def.killXp ?? 0) * (1 + 0.1 * (level - 1)) * 10) / 10;
    const xp = progression.addXp(killer, base, XP_KILL);
    const rider = this.riderOf?.(killer) ?? null;
    if (rider) progression.addXp(rider, base / 2, XP_KILL);
    const kc = this.clientOf(killer.pid);
    if (kc) {
      const w = game.begin(S_EVENT);
      w.u8(EVENT_KILL);
      w.string(rec.name !== "" ? rec.name.slice(0, 24) : speciesLabel(def.id));
      w.u16(level);
      w.u16(Math.min(65535, Math.round(xp * 10)));
      game.endOwn(kc);
    }
  }

  private clientOf(pid: number): Client | null {
    for (const c of this.ctx.game.clients) if (c?.active && !c.closed && c.pid === pid) return c;
    return null;
  }
}

/** A species id without its namespace, for a body with no name. */
function speciesLabel(id: string): string {
  return id.slice(id.indexOf(":") + 1);
}

/** Metres from (x, y, z) to a box of half extents (hx, hy, hz) about the origin, in its own frame. */
function fromBox(x: number, y: number, z: number, hx: number, hy: number, hz: number): number {
  const ex = x - Math.max(-hx, Math.min(hx, x));
  const ey = y - Math.max(-hy, Math.min(hy, y));
  const ez = z - Math.max(-hz, Math.min(hz, z));
  return Math.sqrt(ex * ex + ey * ey + ez * ez);
}
