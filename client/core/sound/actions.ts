// What is heard of fighting and of the player's own state, from what the client already has: the combat events the
// session queues (hits for the attacker, hurt and death for the victim, shots and blasts for those near), the player's
// predicted actions and shots, the actions in other survivors' pose words, and the player's vitals and progress. The
// events are copied as they arrive, before the hit marks and tracers take them (Sounds.absorb).

import { ZONE_HEAD, ZONE_NONE } from "../../../shared/anim/human.ts";
import { AnimState } from "../../../shared/anim/pose.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { EVENT_BLAST, EVENT_DEATH, EVENT_HIT, EVENT_HURT, EVENT_KILL, EVENT_SHOT } from "../../../shared/net/protocol.ts";
import { V_FOOD, V_HEALTH, V_WATER, type Vitals } from "../../../shared/sim/vitals.ts";
import { ACT_DRAW, ACT_EQUIP, ACT_RELOAD, ACT_SWING, FISTS, HOLD_NAMES, HOLD_PISTOL, HOLD_RIFLE } from "../../../shared/sim/weapon.ts";
import { cueKey } from "../../../shared/sound/cues.ts";
import type { CombatEvent, LocalShot, RemoteSample } from "../session.ts";
import type { Hear } from "./bodies.ts";

/** Within this many metres a blast is near, and past this many a shot is far. */
const BLAST_NEAR = 120;
const SHOT_FAR = 150;
/** A hitscan line that passes this near the ear whizzes. */
const WHIZ = 4;
/** Health below this share beats; food or water below this share growls. */
const HEART = 0.25;
const HUNGER = 0.1;
/** A rise of food or water at least this share at once is eating or drinking, not the slow mend. */
const GULP = 0.02;

const by = (f: (h: string) => string): number[] => HOLD_NAMES.map((h) => cueKey(f(h)));
const SWING = by((h) => `swing/${h}`);
const DRAW = by((h) => `draw/${h}`);
const RELEASE = by((h) => `release/${h}`);
const FIRE = by((h) => `fire/${h}`);
const RELOAD = by((h) => `reload/${h}`);
const K = {
  equip: cueKey("equip"),
  far: cueKey("fire/far"),
  whiz: cueKey("whiz"),
  ricochet: cueKey("ricochet"),
  near: cueKey("blast/near"),
  blastFar: cueKey("blast/far"),
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
};
const VOICE = (n: string): number[] => [cueKey(`voice/male/${n}`), cueKey(`voice/female/${n}`)];
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

export class ActionSounds {
  private readonly events: CombatEvent[] = [];
  private readonly fired: LocalShot[] = [];
  private tamed = 0;
  private readonly reg: Registry;
  /** The hold of the weapon that fires each kind of ammunition, by content index. */
  private readonly ammoHold: Int8Array;
  private readonly st = new AnimState();
  private readonly acts = new Map<number, number>();
  private act = 0;
  private alive = true;
  private level = -1;
  private engrams = -1;
  private food = -1;
  private water = -1;
  private hungry = false;

  constructor(reg: Registry) {
    this.reg = reg;
    this.ammoHold = new Int8Array(reg.defs.length).fill(-1);
    reg.defs.forEach((d, kind) => {
      const w = reg.weapon[kind];
      const ammo = (d as { weapon?: { ammo?: readonly string[] } } | null)?.weapon?.ammo;
      if (!w || !ammo) return;
      for (const id of ammo) {
        const a = reg.index.get(id);
        if (a !== undefined && this.ammoHold[a] === -1) this.ammoHold[a] = w.hold;
      }
    });
  }

  /** Copies what the session queued this frame, before others take it. */
  absorb(events: readonly CombatEvent[], fired: readonly LocalShot[], tamed: number): void {
    for (const e of events) this.events.push({ ...e });
    for (const f of fired) this.fired.push({ ...f });
    this.tamed += tamed;
  }

  update(remote: RemoteSample, ex: number, ey: number, ez: number, own: OwnState, ownId: number, ui: number, survivor: number, isSurvivor: (kind: number) => boolean, hear: Hear, hold: Hold): void {
    const sex = own.female ? 1 : 0;
    const holdOf = (item: number): number => (this.reg.weapon[item] ?? FISTS).hold;
    // ---- The player's own actions, as predicted.
    if (own.alive && own.act !== this.act) this.action(own.act, holdOf(own.held), survivor, -1, own.x, own.y, own.z, true, hear);
    this.act = own.act;
    for (const f of this.fired) {
      const h = this.ammoHold[f.ammo]! >= 0 ? this.ammoHold[f.ammo]! : holdOf(own.held);
      hear(survivor, h === HOLD_RIFLE || h === HOLD_PISTOL ? FIRE[h]! : RELEASE[h]!, -1, f.x, f.y, f.z, 0, 1, true);
    }
    this.fired.length = 0;
    // ---- Other survivors' actions, from their pose words. Their shots come as events.
    const seen = new Set<number>();
    for (let i = 0; i < remote.count; i++) {
      const id = remote.id[i]!;
      if (id === ownId || !isSurvivor(remote.kind[i]!)) continue;
      seen.add(id);
      this.st.unpack(remote.anim[i]!, remote.cue[i]!);
      const act = this.st.action & 7;
      const was = this.acts.get(id);
      if (was !== undefined && act !== was && act !== 0) this.action(act, (this.st.action >> 3) & 7, survivor, id, remote.x[i]!, remote.y[i]!, remote.z[i]!, false, hear);
      this.acts.set(id, act);
    }
    for (const id of this.acts.keys()) if (!seen.has(id)) this.acts.delete(id);
    // ---- Combat events.
    for (const e of this.events) {
      if (e.kind === EVENT_HIT) {
        // A blow that kills is followed by EVENT_KILL, which is where the kill is heard.
        hear(ui, e.zone === ZONE_HEAD ? K.head : K.marker, -1, 0, 0, 0, 0, 1, true);
        hear(survivor, e.zone === ZONE_NONE ? K.stone : K.flesh, -1, e.x, e.y, e.z, 0, Math.min(1, 0.4 + e.damage / 60), false);
      } else if (e.kind === EVENT_HURT && own.vitals) {
        const max = own.vitals.max[V_HEALTH]! || 1;
        hear(survivor, (e.damage * 1e6) / max >= 0.25 ? HURT_BADLY[sex]! : HURT[sex]!, -1, 0, 0, 0, 0, 1, true);
      } else if (e.kind === EVENT_DEATH) {
        hear(survivor, DEATH[sex]!, -1, 0, 0, 0, 0, 1, true);
      } else if (e.kind === EVENT_KILL) {
        hear(ui, K.kill, -1, 0, 0, 0, 0, 1, true);
      } else if (e.kind === EVENT_SHOT) {
        const d = Math.hypot(e.x - ex, e.y - ey, e.z - ez);
        const h = this.ammoHold[e.item]! >= 0 ? this.ammoHold[e.item]! : HOLD_RIFLE;
        const gun = h === HOLD_RIFLE || h === HOLD_PISTOL;
        hear(survivor, gun && d > SHOT_FAR ? K.far : gun ? FIRE[h]! : RELEASE[h]!, -1, e.x, e.y, e.z, 0, 1, false);
        if (!e.flies) this.line(e, ex, ey, ez, survivor, hear);
      } else if (e.kind === EVENT_BLAST) {
        const d = Math.hypot(e.x - ex, e.y - ey, e.z - ez);
        hear(survivor, d <= BLAST_NEAR ? K.near : K.blastFar, -1, e.x, e.y, e.z, 0, 1, false);
      }
    }
    this.events.length = 0;
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
