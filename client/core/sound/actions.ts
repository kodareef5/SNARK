// What is heard of fighting and of the player's own state, from what the client already has: the combat events the
// session queues (hits for the attacker, hurt and death for the victim, shots and blasts for those near), the player's
// predicted actions and shots, the actions in other survivors' pose words, and the player's vitals and progress. The
// events are copied as they arrive, before the hit marks and tracers take them (Sounds.absorb).

import { ZONE_HEAD, ZONE_NONE } from "../../../shared/anim/human.ts";
import { AnimState } from "../../../shared/anim/pose.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { BURST_LOOKS } from "../../../shared/content/kinds/weapons.ts";
import { TICK_RATE } from "../../../shared/coords.ts";
import { EVENT_BALL, EVENT_BLAST, EVENT_DEATH, EVENT_HIT, EVENT_HURT, EVENT_KILL, EVENT_ROCKET, EVENT_SHOT } from "../../../shared/net/protocol.ts";
import { shotDir } from "../../../shared/sim/aim.ts";
import { launchSpeed } from "../../../shared/sim/projectiles.ts";
import { GEAR_COUNT, GEAR_HELD } from "../../../shared/sim/entities.ts";
import { V_FOOD, V_HEALTH, V_WATER, type Vitals } from "../../../shared/sim/vitals.ts";
import { ACT_DRAW, ACT_EQUIP, ACT_RELOAD, ACT_SWING, FISTS, HOLD_NAMES, HOLD_PISTOL, HOLD_RIFLE, HOLD_THROW, POSE_LAUNCHER } from "../../../shared/sim/weapon.ts";
import { cueKey } from "../../../shared/sound/cues.ts";
import type { CombatEvent, LocalShot, RemoteSample } from "../session.ts";
import type { Hear } from "./bodies.ts";
import { SOUND_SPEED, STRIKE_LATEST } from "./supply.ts";
import type { Place } from "./vehicles.ts";

/** Within this many metres a blast is near, and past this many a shot is far. */
const BLAST_NEAR = 120;
const SHOT_FAR = 150;
/** A rocket's blast throws debris and sends a wave that are heard within these many metres. */
const DEBRIS_NEAR = 60;
const WAVE_NEAR = 45;
/** Seconds after a blast that what it threw is heard coming down. */
const DEBRIS_AFTER = 0.35;
/** Another's round told within this many ticks of leaving is heard to leave: one just fired is as old as the server looked back. */
const LEFT_NOW = 16;
/** The first of the loops' numbers that are flying rounds', and how many they turn through. */
export const ROCKET_LOOPS = 900000;
const ROCKET_LOOP_MOST = 1024;
/** Milliseconds a flying round's loop takes to come up and go, and those the player's own may fly unnumbered. */
const WHOOSH_FADE = 160;
const UNTOLD_MS = 2000;
const ROCKET = BURST_LOOKS.indexOf("rocket");
const GRENADE = BURST_LOOKS.indexOf("grenade");
/** A hitscan line that passes this near the ear whizzes. */
const WHIZ = 4;
/** Health below this share beats; food or water below this share growls. */
const HEART = 0.25;
const HUNGER = 0.1;
/** A rise of food or water at least this share at once is eating or drinking, not the slow mend. */
const GULP = 0.02;

const by = (f: (h: string) => string): number[] => HOLD_NAMES.map((h) => cueKey(f(h)));
// A throw begins as a swing of what is thrown.
const SWING = by((h) => (h === "throw" ? "throw" : `swing/${h}`));
const DRAW = by((h) => `draw/${h}`);
const RELEASE = by((h) => `release/${h}`);
const FIRE = by((h) => `fire/${h}`);
const RELOAD = by((h) => `reload/${h}`);
const K = {
  equip: cueKey("equip"),
  pump: cueKey("pump"),
  shell: cueKey("shell"),
  far: cueKey("fire/far"),
  whiz: cueKey("whiz"),
  ricochet: cueKey("ricochet"),
  near: cueKey("blast/near"),
  blastFar: cueKey("blast/far"),
  launch: cueKey("launch"),
  fly: cueKey("rocket/fly"),
  rocket: cueKey("burst/rocket"),
  fireball: cueKey("burst/fireball"),
  debris: cueKey("burst/debris"),
  wave: cueKey("burst/shockwave"),
  distant: cueKey("burst/distant"),
  marker: cueKey("hit/marker"),
  head: cueKey("hit/head"),
  kill: cueKey("kill"),
  flesh: cueKey("impact/flesh"),
  stone: cueKey("impact/stone"),
  heart: cueKey("heartbeat"),
  hungry: cueKey("hungry"),
  levelUp: cueKey("level_up"),
  engram: cueKey("engram"),
  respawn: cueKey("respawn"),
  dead: cueKey("dead"),
  tamed: cueKey("tame/done"),
  ballKeep: cueKey("ball/keep"),
  ballLoose: cueKey("ball/loose"),
};
const VOICE = (n: string): number[] => [cueKey(`voice/male/${n}`), cueKey(`voice/female/${n}`)];
/** By hold, what the item in hand makes; and what a blow or a shot of it lands as. */
const IN_HAND = HOLD_NAMES.map((_, h) => [SWING[h]!, DRAW[h]!, RELEASE[h]!, FIRE[h]!, RELOAD[h]!, K.equip, K.pump, K.shell]);
const LANDS = [K.flesh, K.stone];
const MARKS = [K.marker, K.head, K.kill];
const HURT = VOICE("hurt");
const HURT_BADLY = VOICE("hurt/badly");
const DEATH = VOICE("death");
const EAT = VOICE("eat");
const DRINK = VOICE("drink");

/** The parts of the player's state heard here. */
export interface OwnState {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  act: number;
  /** Ticks into the act: back to 0 where a held button starts the next swing while the act stays a swing. */
  actTicks: number;
  /** The content index of the item in hand, 0 for none. */
  held: number;
  female: boolean;
  vitals: Vitals | null;
  tick: number;
  level: number;
  engrams: number;
}

/** Plays a loop while `on`, keyed by `id`, at the ear. */
export type Hold = (id: number, owner: number, key: number, level: number, on: boolean) => void;

/** A round with a motor heard in flight: where and when it left by the frame's clock, its number (0 for the player's own until told) and its loop's. */
interface Whoosh {
  id: number;
  own: boolean;
  ammo: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  born: number;
  until: number;
  loop: number;
}

export class ActionSounds {
  private readonly events: CombatEvent[] = [];
  private readonly fired: LocalShot[] = [];
  private tamed = 0;
  private readonly reg: Registry;
  /** The hold of the weapon that fires each kind of ammunition, by content index. */
  private readonly ammoHold: Int8Array;
  private readonly st = new AnimState();
  private readonly dir = [0, 0, 0];
  private readonly rockets: Whoosh[] = [];
  private loops = 0;
  private readonly acts = new Map<number, number>();
  private act = 0;
  private actTicks = 0;
  private alive = true;
  private level = -1;
  private engrams = -1;
  private food = -1;
  private water = -1;
  private hungry = false;
  /** The frame's time, set by Sounds; and when the player was last hurt and last struck something (ms), for the music. */
  nowMs = 0;
  hurtAtMs = -Infinity;
  fightAtMs = -Infinity;

  /**
   * `ownerOf` gives the resolver's owner number of an id: a weapon's sounds are its own (`core:shotgun/sound/fire`), or
   * its shared family's under its name (`core:weapon/sound/fire/shotgun`), before those of how it is held.
   */
  constructor(reg: Registry, ownerOf: (id: string) => number) {
    this.reg = reg;
    this.ammoHold = new Int8Array(reg.defs.length).fill(-1);
    this.ammoWeapon = new Int32Array(reg.defs.length);
    this.itemOwner = new Int32Array(reg.defs.length).fill(-1);
    reg.defs.forEach((d, kind) => {
      const w = reg.weapon[kind];
      if (w && d) this.itemOwner[kind] = ownerOf(d.id);
      const ammo = (d as { weapon?: { ammo?: readonly string[] } } | null)?.weapon?.ammo;
      if (!w || !ammo) return;
      for (const id of ammo) {
        const a = reg.index.get(id);
        if (a === undefined || this.ammoHold[a] !== -1) continue;
        this.ammoHold[a] = w.hold;
        this.ammoWeapon[a] = kind;
      }
    });
  }

  /** The weapon that fires each kind of ammunition (the first that does), by content index; 0 for none. */
  private readonly ammoWeapon: Int32Array;
  /** By content index, the owner number a held item's sounds are found under; -1 for none. */
  private readonly itemOwner: Int32Array;

  /** Whose sounds a body's action is: the item in its hand, else the body's own (bare hands). */
  private ownerOf(item: number, body: number): number {
    return item > 0 && this.itemOwner[item]! >= 0 ? this.itemOwner[item]! : body;
  }

  /** A gunshot: the gun's report, then its pump if it has one and a spent case for the player's own. A round with a motor is `launched` instead. */
  private shot(h: number, item: number, survivor: number, x: number, y: number, z: number, flat: boolean, own: boolean, hear: Hear, launched = false): void {
    const o = this.ownerOf(item, survivor);
    if (launched) return hear(o, K.launch, -1, x, y, z, 0, 1, flat);
    const gun = h === HOLD_RIFLE || h === HOLD_PISTOL;
    hear(o, gun ? FIRE[h]! : RELEASE[h]!, -1, x, y, z, 0, 1, flat);
    if (!gun) return;
    hear(o, K.pump, -1, x, y, z, 0, 0.8, flat, 0.35);
    if (own) hear(o, K.shell, -1, x, y - 1.4, z, 0, 0.5, flat, 0.5);
  }

  /** Copies what the session queued this frame, before others take it. */
  absorb(events: readonly CombatEvent[], fired: readonly LocalShot[], tamed: number): void {
    for (const e of events) this.events.push({ ...e });
    for (const f of fired) this.fired.push({ ...f });
    this.tamed += tamed;
  }

  /** A round with a motor flies from (x, y, z), having left `ago` milliseconds back. */
  private whoosh(id: number, own: boolean, ammo: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, ago: number): void {
    const born = this.nowMs - ago;
    this.loops = (this.loops + 1) % ROCKET_LOOP_MOST;
    this.rockets.push({ id, own, ammo, x, y, z, vx, vy, vz, born, until: born + (this.reg.ammoFlightTicks[ammo]! * 1000) / TICK_RATE, loop: ROCKET_LOOPS + this.loops });
  }

  /** `place` plays a loop where something is; without it no flying round is heard. */
  update(remote: RemoteSample, ex: number, ey: number, ez: number, own: OwnState, ownId: number, ui: number, survivor: number, isSurvivor: (kind: number) => boolean, hear: Hear, hold: Hold, place: Place | null = null): void {
    const sex = own.female ? 1 : 0;
    const reg = this.reg;
    const holdOf = (item: number): number => (this.reg.weapon[item] ?? FISTS).hold;
    // ---- The player's own actions, as predicted.
    if (own.alive && (own.act !== this.act || own.actTicks < this.actTicks)) this.action(own.act, holdOf(own.held), this.ownerOf(own.held, survivor), -1, own.x, own.y, own.z, true, hear);
    this.act = own.act;
    this.actTicks = own.actTicks;
    for (const f of this.fired) {
      const motor = reg.ammoFlame[f.ammo]! > 0;
      this.shot(this.ammoHold[f.ammo]! >= 0 ? this.ammoHold[f.ammo]! : holdOf(own.held), own.held, survivor, f.x, f.y, f.z, true, true, hear, motor);
      if (!motor) continue;
      // Its own is heard from when it is fired, along the ray the server will cast (shared/sim/aim.ts).
      const d = this.dir, speed = launchSpeed(reg.ammoSpeed[f.ammo]!, f.draw);
      shotDir(f.seed, 0, f.yaw, f.pitch, f.cone, d);
      this.whoosh(0, true, f.ammo, f.x, f.y, f.z, d[0]! * speed, d[1]! * speed, d[2]! * speed, 0);
    }
    this.fired.length = 0;
    // ---- Other survivors' actions, from their pose words. Their shots come as events.
    const seen = new Set<number>();
    for (let i = 0; i < remote.count; i++) {
      const id = remote.id[i]!;
      if (id === ownId || !isSurvivor(remote.kind[i]!)) continue;
      seen.add(id);
      this.st.unpack(remote.anim[i]!, remote.cue[i]!);
      // The act and the tick it began, so that a swing begun again as the last ends is heard too.
      const act = this.st.action & 7;
      const now = act | (this.st.actionStart << 3);
      const was = this.acts.get(id);
      const held = remote.gear[i * GEAR_COUNT + GEAR_HELD]!;
      if (was !== undefined && now !== was && act !== 0) this.action(act, (this.st.action >> 3) & 7, this.ownerOf(held, survivor), id, remote.x[i]!, remote.y[i]!, remote.z[i]!, false, hear);
      this.acts.set(id, now);
    }
    for (const id of this.acts.keys()) if (!seen.has(id)) this.acts.delete(id);
    // ---- Combat events.
    for (const e of this.events) {
      if (e.kind === EVENT_HIT) {
        this.fightAtMs = this.nowMs;
        // A blow that kills is followed by EVENT_KILL, which is where the kill is heard.
        hear(ui, e.zone === ZONE_HEAD ? K.head : K.marker, -1, 0, 0, 0, 0, 1, true);
        hear(survivor, e.zone === ZONE_NONE ? K.stone : K.flesh, -1, e.x, e.y, e.z, 0, Math.min(1, 0.4 + e.damage / 60), false);
      } else if (e.kind === EVENT_HURT && own.vitals) {
        this.hurtAtMs = this.nowMs;
        const max = own.vitals.max[V_HEALTH]! || 1;
        hear(survivor, (e.damage * 1e6) / max >= 0.25 ? HURT_BADLY[sex]! : HURT[sex]!, -1, 0, 0, 0, 0, 1, true);
      } else if (e.kind === EVENT_DEATH) {
        hear(survivor, DEATH[sex]!, -1, 0, 0, 0, 0, 1, true);
      } else if (e.kind === EVENT_KILL) {
        hear(ui, K.kill, -1, 0, 0, 0, 0, 1, true);
      } else if (e.kind === EVENT_SHOT) {
        // A thrown weapon that is its own round, the bola, was heard as it was thrown.
        if (this.reg.weapon[e.item]?.hold === HOLD_THROW) continue;
        const d = Math.hypot(e.x - ex, e.y - ey, e.z - ez);
        const h = this.ammoHold[e.item]! >= 0 ? this.ammoHold[e.item]! : HOLD_RIFLE;
        const gun = h === HOLD_RIFLE || h === HOLD_PISTOL;
        if (gun && d > SHOT_FAR) hear(survivor, K.far, -1, e.x, e.y, e.z, 0, 1, false);
        else this.shot(h, this.ammoWeapon[e.item]!, survivor, e.x, e.y, e.z, false, false, hear);
        if (!e.flies) this.line(e, ex, ey, ez, survivor, hear);
      } else if (e.kind === EVENT_ROCKET) {
        const motor = reg.ammoFlame[e.item]! > 0;
        if (e.own) {
          // The player's own was heard when it was fired, and takes the number: the newest of that ammunition with none.
          let mine: Whoosh | undefined;
          for (const r of this.rockets) if (r.own && r.id === 0 && r.ammo === e.item) mine = r;
          if (mine) mine.id = e.id;
          continue;
        }
        // One told again is the round already heard.
        if (this.rockets.some((r) => r.id === e.id)) continue;
        if (e.back < LEFT_NOW) {
          const h = this.ammoHold[e.item]! >= 0 ? this.ammoHold[e.item]! : HOLD_RIFLE;
          this.shot(h, this.ammoWeapon[e.item]!, survivor, e.x, e.y, e.z, false, false, hear, motor);
        }
        if (motor) this.whoosh(e.id, false, e.item, e.x, e.y, e.z, e.vx, e.vy, e.vz, (e.back * 1000) / TICK_RATE);
      } else if (e.kind === EVENT_BLAST) {
        const d = Math.hypot(e.x - ex, e.y - ey, e.z - ez);
        // Its round is heard no more; and the blast is heard as late as sound takes to come.
        if (e.id !== 0) for (let k = this.rockets.length - 1; k >= 0; k--) if (this.rockets[k]!.id === e.id) this.rockets.splice(k, 1);
        const late = Math.min(STRIKE_LATEST, d / SOUND_SPEED);
        const look = reg.burstLook[e.item] ?? 0;
        if (look === ROCKET) {
          if (d > BLAST_NEAR) hear(survivor, K.distant, -1, e.x, e.y, e.z, 0, 1, false, late);
          else {
            hear(survivor, K.rocket, -1, e.x, e.y, e.z, 0, 1, false, late);
            hear(survivor, K.fireball, -1, e.x, e.y, e.z, 0, 0.8, false, late);
            if (d <= WAVE_NEAR) hear(survivor, K.wave, -1, e.x, e.y, e.z, 0, 1 - 0.5 * (d / WAVE_NEAR), false, late);
            if (d <= DEBRIS_NEAR) hear(survivor, K.debris, -1, e.x, e.y, e.z, 0, 0.8, false, late + DEBRIS_AFTER);
          }
        } else {
          hear(survivor, d <= BLAST_NEAR ? K.near : K.blastFar, -1, e.x, e.y, e.z, 0, 1, false, late);
          if (look === GRENADE && d <= DEBRIS_NEAR) hear(survivor, K.debris, -1, e.x, e.y, e.z, 0, 0.5, false, late + DEBRIS_AFTER);
        }
      } else if (e.kind === EVENT_BALL) {
        hear(survivor, e.kill ? K.ballKeep : K.ballLoose, -1, e.x, e.y + e.vy / 2, e.z, 0, 1, false);
      }
    }
    this.events.length = 0;
    // ---- Rounds with a motor, each where its flight has it now. One not asked for fades out by itself.
    const rockets = this.rockets;
    let kept = 0;
    for (const r of rockets) {
      if (this.nowMs >= r.until || (r.id === 0 && this.nowMs - r.born > UNTOLD_MS)) continue;
      rockets[kept++] = r;
      const t = (this.nowMs - r.born) / 1000;
      place?.(r.loop, survivor, K.fly, r.x + r.vx * t, r.y + r.vy * t - 0.5 * reg.ammoGravity[r.ammo]! * t * t, r.z + r.vz * t, 1, true, false, WHOOSH_FADE);
    }
    rockets.length = kept;
    for (; this.tamed > 0; this.tamed--) hear(ui, K.tamed, -1, 0, 0, 0, 0, 1, true);
    // ---- The player's own state.
    const v = own.vitals;
    if (own.alive && !this.alive && this.level >= 0) hear(ui, K.respawn, -1, 0, 0, 0, 0, 1, true);
    if (!own.alive && this.alive && this.level >= 0) hear(ui, K.dead, -1, 0, 0, 0, 0, 1, true);
    this.alive = own.alive;
    if (this.level >= 0 && own.level > this.level) hear(ui, K.levelUp, -1, 0, 0, 0, 0, 1, true);
    if (this.engrams >= 0 && own.engrams > this.engrams) hear(ui, K.engram, -1, 0, 0, 0, 0, 1, true);
    this.level = own.level;
    this.engrams = own.engrams;
    if (!v || !own.alive) {
      hold(0, survivor, K.heart, 0, false);
      return;
    }
    const share = (i: number): number => v.at(i, own.tick) / (v.max[i]! || 1);
    const health = share(V_HEALTH);
    hold(0, survivor, K.heart, Math.min(1, (HEART - health) / HEART + 0.4), health < HEART);
    const food = share(V_FOOD);
    const water = share(V_WATER);
    if (this.food >= 0 && food - this.food >= GULP) hear(survivor, EAT[sex]!, -1, 0, 0, 0, 0, 1, true);
    if (this.water >= 0 && water - this.water >= GULP) hear(survivor, DRINK[sex]!, -1, 0, 0, 0, 0, 1, true);
    const low = food < HUNGER || water < HUNGER;
    if (low && !this.hungry && this.food >= 0) hear(survivor, K.hungry, -1, 0, 0, 0, 0, 1, true);
    this.hungry = low;
    this.food = food;
    this.water = water;
  }

  /** Tells `want` of each sound the item in the player's hand may make, so that the first of each is not late. */
  ahead(own: OwnState, ui: number, survivor: number, want: (owner: number, key: number) => void): void {
    const o = this.ownerOf(own.held, survivor);
    for (const k of IN_HAND[(this.reg.weapon[own.held] ?? FISTS).hold]!) want(o, k);
    if (this.reg.holdPose[own.held] === POSE_LAUNCHER) want(o, K.launch);
    for (const k of LANDS) want(survivor, k);
    for (const k of MARKS) want(ui, k);
  }

  /** An action begun: a swing, a draw, a reload or taking something in hand. */
  private action(act: number, hold: number, owner: number, entity: number, x: number, y: number, z: number, flat: boolean, hear: Hear): void {
    const key = act === ACT_SWING ? SWING[hold] : act === ACT_DRAW ? DRAW[hold] : act === ACT_RELOAD ? RELOAD[hold] : act === ACT_EQUIP ? K.equip : undefined;
    if (key !== undefined) hear(owner, key, entity, x, y, z, flat ? 0 : 1.2, 0.9, flat);
  }

  /** A hitscan shot's line: a whiz where it passes near the ear, and a ricochet where it ends. */
  private line(e: CombatEvent, ex: number, ey: number, ez: number, owner: number, hear: Hear): void {
    const dx = e.vx - e.x;
    const dy = e.vy - e.y;
    const dz = e.vz - e.z;
    const len2 = dx * dx + dy * dy + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((ex - e.x) * dx + (ey - e.y) * dy + (ez - e.z) * dz) / len2));
    const near = Math.hypot(e.x + dx * t - ex, e.y + dy * t - ey, e.z + dz * t - ez);
    if (near < WHIZ && t > 0.02 && t < 0.98) hear(owner, K.whiz, -1, e.x + dx * t, e.y + dy * t, e.z + dz * t, 0, 1, false);
    hear(owner, K.ricochet, -1, e.vx, e.vy, e.vz, 0, 0.7, false);
  }
}
