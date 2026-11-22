import { IMPALE_SLOT } from "../shared/sim/seats.ts";
import { creatureHold, stepCreature } from "../shared/sim/creature-actions.ts";
import type { CreatureCombatFacet } from "../shared/content/defs.ts";
// Spawns creatures, wakes and sleeps them, and steps the awake ones. A chunk is awake while a player is within wakeRadius chunks of it.
// Creatures in sleeping chunks are not stepped or iterated. Slow quantities such as hunger are lazy and belong to server/survival.ts.

import { AnimState, bodySeed, CUE_LAND, CUE_NONE, CUE_OUT, CUE_ROLL, CUE_STARTLE, CUE_TAKEOFF, CUE_TORPOR, LAYER_EAT, LAYER_FLINCH, LAYER_NONE } from "../shared/anim/pose.ts";
import { posedSubmerged } from "../shared/anim/breath.ts";
import { TICK_DT, chunkAt, chunkCount, chunkCx, chunkCz } from "../shared/coords.ts";
import { BTN_JUMP, BTN_MELEE, BTN_PRIMARY, BTN_SECONDARY, BTN_SPRINT, Body, MF_NO_JUMP, MF_OUT, MF_ROOTED, MF_WINDED, MODE_FLYER, MODE_SWIM, MODE_WALK, STAMINA_UNITS, stanceEye, stepBody, stepOut, swimDepth, type MoveParams } from "../shared/sim/character.ts";
import { ACT_DRAW, ACT_HOLD, ACT_NONE, ACT_SWING, actionOut, stepAction } from "../shared/sim/weapon.ts";
import { Behavior } from "./behavior.ts";
import type { GameServer } from "./game.ts";
import { F_ALIVE, F_AWAKE, F_GROUNDED, F_HELD, F_PLAYER, F_PROP, wider } from "../shared/sim/entities.ts";
import { rollWild } from "../shared/sim/genome.ts";
import { Rng } from "../shared/rng.ts";
import { groundUnder } from "../shared/world/collide.ts";
import { GROUND_FREE, GROUND_WATER, groundAt } from "../shared/world/path.ts";
import { HIT_NODE, HIT_NONE, HIT_STRUCTURE, castWorld, rayHit } from "../shared/world/ray.ts";
import { freeAt, freePlace, placeFree } from "./place.ts";
import type { EntityRecord, Records } from "./records.ts";
import { refreshMods, type Survival } from "./survival.ts";
import type { ServerWorld } from "./world.ts";
import { NO_BUS, event, type Bus } from "./events/bus.ts";
import { creatureSize, forgetYoungMove, youngMove } from "./young-move.ts";

const CREATURE_SPAWN = event("creature.spawn");
/** Ticks a cue stays in a creature's state: past any clip it starts and the fade after, and short of the 256 its start counts. */
export const CUE_TICKS = 240;
/** Metres a second at which a creature falling lands for its landing to show: a drop of about half a metre. Chosen. */
const LAND_SPEED = 3;
const RAD_YAW = 65536 / (Math.PI * 2);
function angleDelta(a: number, b: number): number { return ((a - b + 32768) & 65535) - 32768; }
interface Tactic { gen: number; target: number; targetGen: number; retreat: boolean; check: number; safe: boolean }

/**
 * What a flyer nobody rides moves by: its numbers with flight costing no stamina, since ARK's wild creatures spend none and
 * its unridden tames none "sprinting to keep up with a player" (FUNCTIONS.md section 4). Null for a kind that does not fly.
 */
function unridden(p: MoveParams | null): MoveParams | null {
  return p?.flies ? { ...p, staminaFly: 0, staminaFlySprint: 0 } : null;
}

export class Creatures {
  bus: Bus = NO_BUS;
  /** In chunks. */
  readonly wakeRadius: number;
  awakeCount = 0;
  /** Creatures run through collision in the last step, for measurement. */
  stepped = 0;
  /** The OxygenSwimSpeedStatMultiplier rule. The host sets it. */
  swimGain = 1;
  /** Flyers that took off, set down from their own flight and rolled since the server started, ridden or not. */
  tookOff = 0;
  setDown = 0;
  rolled = 0;
  /** Wild flyers set down on what was under them as their chunk went to sleep. */
  grounded = 0;

  private readonly world: ServerWorld;
  private readonly records: Records;
  private readonly survival: Survival;
  private readonly rng: Rng;
  /** Entity indices of the awake creatures, in the first `awakeCount` entries. It doubles as more wake. */
  awake = new Int32Array(1024);
  /** By entity index, its place in `awake`, or -1. It grows with the entity store. */
  private awakeSlot: Int32Array;
  /** The slot being stepped, or -1 outside a step. Those above it have been stepped this tick and those below have not. */
  private cursor = -1;
  /** Players keeping each chunk awake. */
  private readonly chunkRefs: Uint16Array;
  readonly mind: Behavior;
  /** Called when a creature's bite strikes. The handler finds what it hit. */
  onStrike: ((e: number) => void) | null = null;
  /** 1 for kinds that stand where they are put. */
  private readonly still: Uint8Array;
  /** By kind, what a wild and a tamed flyer nobody rides move by (`unridden`), or null for a kind that does not fly. */
  private readonly wildFlight: (MoveParams | null)[];
  private readonly tameFlight: (MoveParams | null)[];
  private readonly body = new Body();
  /** Creatures with a cue still to clear (EntityStore.cue). */
  private readonly cued = new Set<number>();
  private readonly cues = new AnimState();
  private readonly breathState = new AnimState();
  /** By entity index: 1 while its eyes are under water, as Survival was last told. */
  private wet: Uint8Array;
  /** Only awake hunters using a tactical facet need state; never inherited by a recycled entity slot. */
  private readonly tactics = new Map<number, Tactic>();
  private readonly input = { move: 0, buttons: 0, pressed: 0, yaw: 0, pitch: 0, side: -1 };

  constructor(world: ServerWorld, game: GameServer, records: Records, survival: Survival, seed: number, wakeRadius = 3) {
    this.world = world;
    this.records = records;
    this.survival = survival;
    this.rng = new Rng(seed);
    this.wakeRadius = wakeRadius;
    this.awakeSlot = new Int32Array(world.ents.cap).fill(-1);
    this.wet = new Uint8Array(world.ents.cap);
    world.ents.onGrow.push((cap) => {
      this.awakeSlot = wider(this.awakeSlot, cap, -1);
      this.wet = wider(this.wet, cap);
    });
    this.chunkRefs = new Uint16Array(chunkCount(world.dims));
    this.mind = new Behavior(world, game, seed + 7);
    this.mind.herd = this;
    // One that takes fright is startled before it runs.
    this.mind.onStartle = (e) => this.cue(e, CUE_STARTLE, false);
    game.onMountLand = (e, speed) => this.landed(e, speed);
    game.onMountFlight = (e) => this.flew(e);
    this.still = Uint8Array.from(world.reg.defs, (d) => (d?.type === "species" && d.still ? 1 : 0));
    this.wildFlight = world.reg.move.map(unridden);
    this.tameFlight = world.reg.tamedMove.map(unridden);
  }

  /** Something at (x, z) hurt `e`. `by` is the entity that did it, or -1. */
  provoke(e: number, x: number, z: number, by = -1): void {
    const ents = this.world.ents;
    // The victim may be a survivor. Its tribe's creatures near it may come to help, and those of the attacker's tribe set
    // to attack its target join in.
    this.mind.alert(ents.team[e]!, e, by);
    this.mind.assist(by, e);
    const anim = this.world.anims[ents.kind[e]!];
    const conscious = anim && (ents.mflags[e]! & MF_OUT) === 0 ? anim : null;
    // It flinches, unless it is still flinching from the last blow.
    if (conscious?.flinch && !this.cueing(e, LAYER_FLINCH, conscious.flinch.frames - 1)) this.cue(e, LAYER_FLINCH, true);
    if (this.awakeSlot[e]! < 0 || this.still[ents.kind[e]!] || ents.driven[e] !== 0) return;
    this.mind.provoke(e, x, z, by);
    // Others of a wild one's kind near it take fright with it.
    if (ents.team[e] === 0) this.mind.alarm(e, x, z, by);
  }

  /** `e` went out cold, or came round: it goes down, or gets up. */
  knocked(e: number, out: boolean): void {
    const ents = this.world.ents;
    if (!this.world.anims[ents.kind[e]!]) return;
    ents.cue[e] = out ? ents.cue[e]! | CUE_OUT : ents.cue[e]! & ~CUE_OUT;
    this.cue(e, CUE_TORPOR, false);
  }

  /**
   * Just after `e`'s step, ridden or not: the barrel roll, take-off or setting down from flight that stepOut says it began now
   * (FL2, FL3). A flight set down has no landing speed, so the landing cue of a fall does not show it.
   */
  flew(e: number): void {
    if (stepOut.rolled) {
      this.rolled++;
      this.cue(e, CUE_ROLL, false);
    } else if (stepOut.tookOff) {
      this.tookOff++;
      this.cue(e, CUE_TAKEOFF, false);
    } else if (stepOut.setDown) {
      this.setDown++;
      this.cue(e, CUE_LAND, false);
    }
  }

  /** `e`, knocked out, ate a piece it was fed. */
  ate(e: number): void {
    if (this.world.anims[this.world.ents.kind[e]!]?.torporEat) this.cue(e, LAYER_EAT, true);
  }

  /** Sets a CUE_ of `e`'s whole body, or with `layer` a LAYER_ over it, beginning now. */
  cue(e: number, kind: number, layer: boolean): void {
    const st = this.cues;
    const ents = this.world.ents;
    st.unpack(0, ents.cue[e]!);
    if (layer) {
      st.layer = kind;
      st.layerStart = this.world.tick & 255;
    } else {
      st.cue = kind;
      st.cueStart = this.world.tick & 255;
    }
    ents.cue[e] = st.packCue();
    this.world.history.cued(e);
    this.cued.add(e);
  }

  /** Whether `e` has the LAYER_ `layer`, begun fewer than `ticks` ticks ago. */
  private cueing(e: number, layer: number, ticks: number): boolean {
    const st = this.cues;
    st.unpack(0, this.world.ents.cue[e]!);
    return st.layer === layer && ((this.world.tick - st.layerStart) & 255) < ticks;
  }

  /** Clears each cue CUE_TICKS after it began, before the low byte of its start could be counted again. */
  private expire(tick: number): void {
    if (this.cued.size === 0) return;
    const ents = this.world.ents;
    const st = this.cues;
    for (const e of this.cued) {
      st.unpack(0, ents.cue[e]!);
      if (st.cue !== CUE_NONE && ((tick - st.cueStart) & 255) >= CUE_TICKS) st.cue = CUE_NONE;
      if (st.layer !== LAYER_NONE && ((tick - st.layerStart) & 255) >= CUE_TICKS) st.layer = LAYER_NONE;
      const word = st.packCue();
      if (word !== ents.cue[e]) {
        ents.cue[e] = word;
        this.world.history.cued(e);
      }
      // Also one gone from the world, whose place another may have taken with no cue.
      if (st.cue === CUE_NONE && st.layer === LAYER_NONE) this.cued.delete(e);
    }
  }

  /**
   * Returns the entity index, or -1 if there is no room or a module refused it. `why` is "wild" for the world's own
   * and "admin" for one an admin asked for. A module may change its level, and its colours: up to six palette indices
   * by region, with commas between.
   */
  spawn(kind: number, x: number, z: number, level: number, why = "wild", atY?: number): number {
    const world = this.world;
    const p = world.reg.move[kind];
    if (!p) return -1;
    const y = atY ?? groundUnder(world.hf, x, z, p.radius);
    if (!Number.isFinite(y)) return -1;
    if (!placeFree(world, x, y, z, p.radius, p.height)) return -1;
    let colours = "";
    if (this.bus.n[CREATURE_SPAWN] !== 0) {
      const asked = { kind: world.reg.ids[kind]!, why, x, z, level, colours };
      if (this.bus.before(CREATURE_SPAWN, asked) !== "") return -1;
      if (Number(asked.level) >= 1) level = Math.floor(Number(asked.level));
      colours = String(asked.colours);
    }
    const rec = this.records.create(kind);
    rec.x = x;
    rec.y = y;
    rec.z = z;
    rec.yaw = this.rng.int(65536);
    rec.genome = rollWild(this.rng, level, world.reg.colorSet[kind]!);
    if (colours !== "") colours.split(",").forEach((c, i) => void (i < rec.genome!.colors.length && Number(c) >= 0 && Number(c) <= 255 && c.trim() !== "" && (rec.genome!.colors[i] = Number(c))));
    const e = this.adopt(rec);
    // With no body it keeps no record. A record left behind would be saved, and be a creature at the next start.
    if (e < 0) this.records.delete(rec.pid);
    return e;
  }

  /** Puts a creature that has a record, new or loaded, into the simulation. Returns -1, changing nothing, if the entity store has no place for it. */
  adopt(rec: EntityRecord): number {
    const ents = this.world.ents;
    // It starts grounded until a step says otherwise.
    const e = ents.create(rec.kind, rec.x, rec.y, rec.z, F_GROUNDED);
    if (e < 0) return -1;
    ents.yaw[e] = rec.yaw;
    ents.pid[e] = rec.pid;
    ents.creatureMode[e] = rec.creatureMode % (this.world.reg.combat[rec.kind]?.modes?.length ?? 1);
    if (this.world.reg.combat[rec.kind]) ents.hold[e] = ents.creatureMode[e]! << 1;
    this.wet[e] = 0;
    refreshMods(this.world.reg, ents, e, rec.genome, 0, 1, false, false, this.swimGain);
    ents.setLook(e, rec.genome ? rec.genome.level : 1, rec.genome ? rec.genome.colors : null, rec.name);
    this.records.entOf.set(rec.pid, e);
    // One saved knocked out lies where it was, and does not fall again.
    if (rec.out && this.world.anims[rec.kind]) ents.cue[e] = CUE_OUT;
    // One saved in its own flight is in the air where it was, and does not fall (planning/reference/flyers-plan.md, FL0).
    if (rec.flying) {
      ents.mode[e] = MODE_FLYER;
      ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    }
    this.mind.reset(e);
    this.mind.stance[e] = rec.stance;
    this.mind.wanders[e] = rec.team !== 0 && rec.wander ? 1 : 0;
    ents.setTeam(e, rec.team);
    if (rec.grown !== 0) ents.setYoung(e, rec.span, rec.grown);
    // A new body starts full. A loaded one keeps its vitals and gets its deadline back.
    if (rec.vitals) this.survival.restore(rec, true);
    else this.survival.init(rec);
    if (this.chunkRefs[ents.chunk[e]!]! > 0) this.wake(e);
    return e;
  }

  /** The caller deletes its record. */
  remove(e: number): void {
    // Its record goes with it, and may be dying: Survival is not told it left the water.
    this.wet[e] = 0;
    this.sleep(e);
    forgetYoungMove(this.world, e);
    this.records.entOf.delete(this.world.ents.pid[e]!);
    this.world.ents.destroy(e);
  }

  isChunkAwake(chunk: number): boolean {
    return this.chunkRefs[chunk]! > 0;
  }

  /** `from` is -1 on entry and `to` is -1 on exit. Each chunk that wakes is added to `woke`. */
  playerMoved(from: number, to: number, woke?: number[]): void {
    // Add the new neighbourhood before removing the old, so shared chunks never dip to zero.
    if (to >= 0) this.adjust(to, 1, woke);
    if (from >= 0) this.adjust(from, -1);
  }

  /** `e` was set somewhere else. It wakes or sleeps as the chunk it is now in does. */
  relocated(e: number): void {
    const awake = this.chunkRefs[this.world.ents.chunk[e]!]! > 0;
    if (awake && this.awakeSlot[e]! < 0) this.wake(e);
    else if (!awake && this.awakeSlot[e]! >= 0) this.sleep(e);
  }

  step(tick: number): void {
    const world = this.world;
    const ents = world.ents;
    const b = this.body;
    const mind = this.mind;
    this.expire(tick);
    // Ways asked for are searched before anyone steers, within the tick's budget.
    mind.plan(tick);
    let stepped = 0;
    for (this.cursor = this.awakeCount - 1; this.cursor >= 0; this.cursor--) {
      const e = this.awake[this.cursor]!;
      // A vehicle's wheels move it (server/urban.ts), and nothing breathes in it.
      if (world.reg.vehicle[ents.kind[e]!]) continue;
      // A driven creature is stepped with its session's body, and breathes as it goes. A held one moves with whoever holds it.
      if (ents.driven[e] !== 0 || (ents.flags[e]! & F_HELD) !== 0 || ents.seatSlot[e] === IMPALE_SLOT) {
        this.tactics.delete(e);
        if (ents.driven[e] !== 0) this.breathe(e, world.reg.tamedMove[ents.kind[e]!]!);
        continue;
      }
      const kind = ents.kind[e]!;
      const combat = world.reg.combat[kind];
      // Once a second, an owned creature with no leader checks whether the entity its record says to follow is back in the world.
      if (ents.team[e] !== 0 && mind.leader[e]! < 0 && (tick + e) % 30 === 0) this.relink(e);
      if (this.still[kind]) {
        // A still kind only falls, if it was put down in the air.
        if ((ents.flags[e]! & F_GROUNDED) !== 0) continue;
      } else mind.steer(e, tick, ents.act[e]!);
      const flags = ents.flags[e]!;
      // A tame runs at its tamed speed. A flyer nobody rides spends no stamina in the air.
      const p = youngMove(world, e, (ents.team[e] !== 0 ? (this.tameFlight[kind] ?? world.reg.tamedMove[kind]) : (this.wildFlight[kind] ?? world.reg.move[kind]))!);
      const input = this.input;
      input.move = mind.move[e]!; input.buttons = mind.buttons[e]!; input.pressed = mind.pressed[e]!;
      input.yaw = this.still[kind] ? ents.yaw[e]! : mind.look[e]!; input.pitch = mind.pitch[e]!; input.side = -1;
      if (combat?.ai && !this.still[kind]) this.tactical(e, tick, p, combat);
      const move = input.move, pressed = input.pressed;
      const swims = ents.mode[e] === MODE_SWIM;
      const cold = (ents.mflags[e]! & MF_OUT) !== 0;
      // KO/recovery and the final return to legacy breathing can change submersion without moving. The helper
      // poses only during those cues; an opted-in resting awake body otherwise pays only the ordinary eye test.
      if (swims || cold || world.anims[kind]?.rig.breath) this.breathe(e, p);
      const growingFloat = swims && ents.grown[e] !== 0 && ents.y[e]! > world.hf.waterAt(ents.x[e]!, ents.z[e]!) - swimDepth(p) + 1e-5;
      // Hovering still, with flight costing it nothing, its step would change only its flight counters.
      if (ents.mode[e] === MODE_FLYER && input.buttons === BTN_JUMP && move === 0 && pressed === 0 && ents.act[e] === ACT_NONE && ents.vx[e] === 0 && ents.vy[e] === 0 && ents.vz[e] === 0 && ents.yaw[e] === input.yaw && p.staminaFly === 0 && (ents.mflags[e]! & (MF_OUT | MF_ROOTED | MF_NO_JUMP | MF_WINDED)) === 0 && ents.stamina[e]! > 0 && ents.stamina[e]! <= ents.staminaMax[e]! * STAMINA_UNITS && this.wet[e] === 0) {
        if (ents.rollWait[e]! > 0) ents.rollWait[e] = ents.rollWait[e]! - 1;
        ents.regenWait[e] = p.regenWaitTicks;
        continue;
      }
      // At rest on the ground or afloat with no input, with its head above water or out cold, nothing would change but its
      // stamina, so the step is skipped and the stamina got back as the step would give it. A flyer holding its jump takes off.
      if (!growingFloat && ents.creaturePrimaryCooldown[e] === 0 && ents.creatureCooldown[e] === 0 && move === 0 && pressed === 0 && (input.buttons & (BTN_JUMP | BTN_PRIMARY | BTN_SECONDARY)) === 0 && ents.act[e] === ACT_NONE && ents.vx[e] === 0 && ents.vz[e] === 0 && ents.yaw[e] === input.yaw && ((flags & F_GROUNDED) !== 0 || (swims && ents.vy[e] === 0)) && (this.wet[e] === 0 || cold)) {
        const cap = ents.staminaMax[e]! * STAMINA_UNITS;
        const had = ents.stamina[e]!;
        // As the step counts them: a flyer's roll, and its wait after flying before any stamina comes back.
        if (ents.rollWait[e]! > 0) ents.rollWait[e] = ents.rollWait[e]! - 1;
        if (ents.regenWait[e]! > 0) ents.regenWait[e] = ents.regenWait[e]! - 1;
        else if (had < cap) {
          const now = had + p.staminaRegen < cap ? had + p.staminaRegen : cap;
          ents.stamina[e] = now;
          if ((ents.mflags[e]! & MF_WINDED) !== 0 && now * 4 >= cap) ents.mflags[e] = ents.mflags[e]! & ~MF_WINDED;
        }
        continue;
      }
      ents.loadBody(e, b);
      let buttons = input.buttons | pressed;
      // In water it swims at its swim speed and comes up for air. A flyer floats up by itself, and its jump would take it off.
      if (swims) buttons = (buttons & ~BTN_SPRINT) | (!p.flies && this.under(e, p) ? BTN_JUMP : 0);
      const x0 = b.x;
      const z0 = b.z;
      const previousAct = b.act;
      if (combat) stepCreature(world, b, 0, move, input.yaw, input.pitch, buttons, pressed, p, combat, TICK_DT, false);
      else stepBody(world, b, 0, move, input.yaw, input.pitch, buttons, p, TICK_DT);
      // The tactic chose a mirrored strike from the actual target bearing before the shared action began.
      if (previousAct === ACT_NONE && b.act === ACT_SWING && input.side >= 0) b.creatureSide = input.side;
      const landing = stepOut.landSpeed;
      if (landing >= LAND_SPEED && (b.mflags & MF_OUT) === 0 && world.anims[kind]?.land) this.cue(e, CUE_LAND, false);
      // Knocked out, it lies down from its limp fall as it comes to the ground.
      else if (landing > 0 && (b.mflags & MF_OUT) !== 0 && world.anims[kind]?.torporFall) this.cue(e, CUE_LAND, false);
      if (p.flies) this.flew(e);
      // Tactical braking/turning is deliberate, not a failed path step. Keep Behavior's cached path input intact.
      if (!combat?.ai || move !== 0) mind.moved(e, b.x - x0, b.z - z0, p.walkSpeed * (b.speedQ / 1000) * TICK_DT);
      // A bite goes through the same action step as any blow.
      const jaws = world.reg.weapon[kind];
      let struck = false;
      if (jaws && !combat) {
        stepAction(b, buttons, pressed, jaws);
        struck = actionOut.strike;
      }
      stepped++;
      // Walking into a sleeping chunk puts the creature to sleep there.
      const crossed = ents.storeBody(e, b);
      if (combat) ents.hold[e] = creatureHold(b);
      ents.pitch[e] = input.pitch;
      ents.pose(e, tick);
      if (struck) this.onStrike?.(e);
      this.breathe(e, p);
      // The landing may kill it, which takes it out of the world.
      if (landing > 0) this.landed(e, landing);
      if ((ents.flags[e]! & F_ALIVE) !== 0 && crossed && this.chunkRefs[ents.chunk[e]!] === 0) this.sleep(e);
    }
    this.stepped = stepped;
  }

  /** Changes only AI input: action timing, turning limits and movement remain in the ridden/shared controller. */
  private tactical(e: number, tick: number, p: MoveParams, combat: CreatureCombatFacet): void {
    const ents = this.world.ents, input = this.input, ai = combat.ai!;
    const target = this.mind.targetOf(e), act = ents.act[e]!;
    const charging = !!combat.charge && (act === ACT_DRAW || act === ACT_HOLD);
    let state = this.tactics.get(e);
    const same = state && state.gen === ents.gen[e] && state.target === target && state.targetGen === ents.gen[target];
    if (target < 0 || (charging && !same) || ents.mode[e] !== MODE_WALK || (ents.mflags[e]! & (MF_OUT | MF_ROOTED)) !== 0) {
      this.tactics.delete(e);
      if (target < 0) { input.buttons &= ~BTN_PRIMARY; input.pressed &= ~BTN_PRIMARY; }
      if (charging) { input.move = 0; input.buttons = 0; input.pressed = BTN_MELEE; input.yaw = ents.yaw[e]!; }
      return;
    }
    if (!same) {
      state = { gen: ents.gen[e]!, target, targetGen: ents.gen[target]!, retreat: false, check: 0, safe: false };
      this.tactics.set(e, state);
    }
    state = state!;
    const x = ents.x[e]!, z = ents.z[e]!, dx = ents.x[target]! - x, dz = ents.z[target]! - z;
    const distance = Math.hypot(dx, dz), aim = Math.round(Math.atan2(dx, dz) * RAD_YAW) & 65535;
    const headingError = Math.abs(angleDelta(aim, ents.yaw[e]!));
    const grounded = (ents.flags[e]! & F_GROUNDED) !== 0, size = creatureSize(this.world, e);

    if (charging && ai.charge) {
      input.move = 0; input.buttons = BTN_SECONDARY; input.pressed = 0; input.yaw = aim; input.pitch = 0;
      // A charge keeps its target and looks ahead through the real capsule's whole footprint, not just a centre ray.
      // Each check has at most 64 samples. Six-tick refreshes bound cost while including stopping distance.
      if (tick >= state.check) {
        const lookAhead = Math.min(ai.charge.maxDistance * size, Math.max(distance, combat.charge!.speed * .4));
        const yaw = ents.yaw[e]! / RAD_YAW;
        const tx = act === ACT_DRAW ? ents.x[target]! : x + Math.sin(yaw) * lookAhead;
        const tz = act === ACT_DRAW ? ents.z[target]! : z + Math.cos(yaw) * lookAhead;
        state.safe = this.corridor(e, p, tx, tz) && this.visible(e, target, p);
        state.check = tick + 6;
      }
      // Passing the target ends the run; turning back into it would make a prolonged circular damage volume.
      if (!grounded || !state.safe || headingError > 16384 || distance > ai.charge.maxDistance * size * 1.25) {
        input.buttons = 0; input.pressed = BTN_MELEE; input.yaw = ents.yaw[e]!;
      }
      return;
    }
    if (act !== ACT_NONE) {
      // Once a sweep begins, the torso stays planted. Its authored tail supplies the contact motion.
      input.move = 0; input.buttons = 0; input.pressed = 0; input.yaw = ents.yaw[e]!; input.pitch = 0;
      return;
    }
    if (ai.charge && combat.charge && grounded && ents.creatureCooldown[e] === 0 && (tick + e) % 15 === 0
      && distance >= ai.charge.minDistance * size && distance <= ai.charge.maxDistance * size && headingError <= 2731
      && Math.abs(ents.y[target]! - ents.y[e]!) <= p.height * .5
      && this.visible(e, target, p) && this.corridor(e, p, ents.x[target]!, ents.z[target]!)) {
      state.safe = true; state.check = tick + 6;
      input.move = 0; input.buttons = BTN_SECONDARY; input.pressed = BTN_SECONDARY; input.yaw = aim; input.pitch = 0;
      return;
    }
    const primary = ai.primary;
    if (!primary) return;
    // Generic pursuit can choose a legacy front attack; this species must reach its authored strike position first.
    input.buttons &= ~BTN_PRIMARY; input.pressed &= ~BTN_PRIMARY;
    const desired = primary.distance * size;
    const tolerance = Math.max(.35 * size, combat.primary.radius * size + this.world.reg.bodyRadius[ents.kind[target]!]! * creatureSize(this.world, target) * .5);
    if (distance > Math.max(combat.primary.reach * size + 2, desired + 2 * tolerance)) { state.retreat = false; return; }
    if (!this.visible(e, target, p)) return;
    input.buttons = 0; input.pressed = 0; input.pitch = 0;
    if (distance < desired - tolerance) state.retreat = true;
    else if (distance >= desired) state.retreat = false;
    if (state.retreat) {
      // Hysteresis carries a close retreat back to the nominal band instead of jittering across its near edge.
      input.yaw = aim;
      const away = Math.max(1, p.radius);
      const ux = distance < .001 ? 0 : dx / distance, uz = distance < .001 ? 1 : dz / distance;
      input.move = headingError < 4096 && this.corridor(e, p, x - ux * away, z - uz * away) ? -80 : 0;
      return;
    }
    if (distance > desired + tolerance) {
      input.yaw = aim;
      const step = Math.min(distance, Math.max(1, p.radius));
      input.move = headingError < 4096 && this.corridor(e, p, x + dx / distance * step, z + dz / distance * step) ? 80 : 0;
      return;
    }
    input.move = 0;
    const bearing = Math.round(primary.bearing / 360 * 65536);
    // The primary clip strikes to negative (left) bearing; alternateClip mirrors to positive (right).
    const left = (aim + bearing) & 65535, right = (aim - bearing) & 65535;
    const mirrored = !!combat.primary.alternateClip && Math.abs(angleDelta(right, ents.yaw[e]!)) < Math.abs(angleDelta(left, ents.yaw[e]!));
    input.yaw = mirrored ? right : left; input.side = mirrored ? 1 : 0;
    if (grounded && Math.abs(angleDelta(input.yaw, ents.yaw[e]!)) <= primary.arc / 360 * 65536
      && Math.hypot(ents.vx[e]!, ents.vz[e]!) <= .35 && Math.abs(ents.y[target]! - ents.y[e]!) <= p.height) {
      input.buttons = input.pressed = BTN_PRIMARY;
    }
  }

  private visible(e: number, target: number, p: MoveParams): boolean {
    const ents = this.world.ents;
    const x = ents.x[e]!, y = ents.y[e]! + p.height * .55, z = ents.z[e]!;
    const dx = ents.x[target]! - x, dy = ents.y[target]! + this.world.reg.bodyHeight[ents.kind[target]!]! * creatureSize(this.world, target) * .55 - y, dz = ents.z[target]! - z;
    const length = Math.hypot(dx, dy, dz);
    return length < .001 || castWorld(this.world, x, y, z, dx / length, dy / length, dz / length, length) === HIT_NONE;
  }

  /** A bounded, supported lane. Tall ledges, swimming water, narrow gaps and unsupported footprints all fail closed. */
  private corridor(e: number, p: MoveParams, tx: number, tz: number): boolean {
    const world = this.world, ents = world.ents, x = ents.x[e]!, z = ents.z[e]!;
    const distance = Math.hypot(tx - x, tz - z);
    const count = Math.ceil(distance / Math.max(.35, Math.min(1, p.radius)));
    if (count < 1 || count > 64) return false;
    let previous = ents.y[e]!;
    for (let n = 1; n <= count; n++) {
      const px = x + (tx - x) * n / count, pz = z + (tz - z) * n / count;
      if (groundAt(world, p, px, pz) !== GROUND_FREE) return false;
      const y = groundUnder(world.hf, px, pz, p.radius);
      if (!Number.isFinite(y) || Math.abs(y - previous) > Math.max(.35, p.stepUp)) return false;
      // groundUnder uses the supporting sphere. Also reject a footprint straddling a drop that its centre ray misses.
      for (let side = 0; side < 4; side++) {
        const ex = px + (side === 0 ? p.radius : side === 1 ? -p.radius : 0), ez = pz + (side === 2 ? p.radius : side === 3 ? -p.radius : 0);
        const edge = world.hf.heightAt(ex, ez);
        if (y - edge > Math.max(.5, p.stepUp + .15) || world.hf.waterAt(ex, ez) - edge > swimDepth(p, .7)) return false;
      }
      previous = y;
    }
    return true;
  }

  /** Authored KO/recovery airways, or the legacy stance/swimming eye when no pair applies. */
  private under(e: number, p: MoveParams): boolean {
    const ents = this.world.ents;
    const a = this.world.anims[ents.kind[e]!];
    if (a?.rig.breath) {
      const st = this.breathState;
      st.unpack(ents.anim[e]!, ents.cue[e]!); st.seed = bodySeed(e);
      const posed = posedSubmerged(a, st, this.world.tick, this.world, ents.x[e]!, ents.y[e]!, ents.z[e]!, ents.yaw[e]! / RAD_YAW, creatureSize(this.world, e));
      if (posed !== null) return posed;
    }
    const raised = ents.mode[e] === MODE_SWIM && (ents.mflags[e]! & MF_OUT) === 0 ? p.swimEyeHeight : undefined;
    return ents.y[e]! + (raised ?? stanceEye(p, ents.stance[e]!)) < this.world.hf.waterAt(ents.x[e]!, ents.z[e]!);
  }

  /** Tells Survival when the head of `e` goes under water or comes up, so it loses its oxygen and then drowns as a survivor does. */
  private breathe(e: number, p: MoveParams): void {
    const under = this.under(e, p) ? 1 : 0;
    if (under === this.wet[e]) return;
    this.wet[e] = under;
    const rec = this.records.byPid.get(this.world.ents.pid[e]!);
    if (rec) this.survival.setSubmerged(rec, under === 1);
  }

  /** `e` touched down at `speed` metres a second, on its own or ridden. Too fast hurts it, as it hurts a survivor. */
  private landed(e: number, speed: number): void {
    const rec = this.records.byPid.get(this.world.ents.pid[e]!);
    if (rec) this.survival.landed(rec, speed);
  }

  private adjust(center: number, delta: number, woke?: number[]): void {
    const dims = this.world.dims;
    const cx = chunkCx(dims, center);
    const cz = chunkCz(dims, center);
    const r = this.wakeRadius;
    for (let z = Math.max(0, cz - r); z <= Math.min(dims.chunksZ - 1, cz + r); z++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(dims.chunksX - 1, cx + r); x++) this.watch(z * dims.chunksX + x, delta, woke);
    }
  }

  /**
   * One chunk held awake (`delta` 1) or let go (-1): round a body, or looked at through a sight (server/gaze.ts, D1032).
   * Its creatures wake as the first hold comes and sleep as the last goes. Each chunk that wakes is added to `woke`.
   */
  watch(chunk: number, delta: number, woke?: number[]): void {
    const ents = this.world.ents;
    const before = this.chunkRefs[chunk]!;
    this.chunkRefs[chunk] = before + delta;
    if (before === 0 && delta > 0) {
      woke?.push(chunk);
      for (let e = ents.chunkHead[chunk]!; e >= 0; e = ents.next[e]!) this.wake(e);
    } else if (before === 1 && delta < 0) {
      for (let e = ents.chunkHead[chunk]!; e >= 0; e = ents.next[e]!) this.sleep(e);
    }
  }

  /** Call after a creature's team changes, so Behavior's owned set stays current. */
  claimed(e: number): void {
    const owned = this.world.ents.team[e] !== 0;
    if (owned && this.records.byPid.get(this.world.ents.pid[e]!)?.follow === 0) this.mind.claim(e);
    if (this.awakeSlot[e]! >= 0 && owned) this.mind.owned.add(e);
    else this.mind.owned.delete(e);
  }

  /** Follows the entity its record names, if that entity is in the world. */
  private relink(e: number): void {
    const rec = this.records.byPid.get(this.world.ents.pid[e]!);
    if (!rec || rec.follow === 0) return;
    const whom = this.records.entOf.get(rec.follow);
    if (whom !== undefined) this.mind.follow(e, whom);
  }

  private seat(slot: number, e: number): void {
    this.awake[slot] = e;
    this.awakeSlot[e] = slot;
  }

  private wake(e: number): void {
    const ents = this.world.ents;
    const flags = ents.flags[e]!;
    if ((flags & F_ALIVE) === 0 || (flags & (F_PLAYER | F_PROP)) !== 0 || this.awakeSlot[e]! >= 0) return;
    if (ents.team[e] !== 0) this.mind.owned.add(e);
    if (this.awakeCount === this.awake.length) this.awake = wider(this.awake, this.awakeCount * 2);
    this.awakeSlot[e] = this.awakeCount;
    this.awake[this.awakeCount++] = e;
    ents.flags[e] = flags | F_AWAKE;
    this.world.history.track(e);
    // One that wakes under water loses its breath from now.
    const p = this.world.reg.move[ents.kind[e]!];
    if (p) this.breathe(e, youngMove(this.world, e, p));
  }

  /**
   * A wild flyer whose chunk goes to sleep is put down unhurt on what is under it, as its flight would set it down, so that
   * nothing wild sleeps in the air (planning/reference/flyers-plan.md, wild flyers 4): on the first thing built or grown under
   * it, else ground it can stand on, else afloat on water deep enough to swim in. Moved aside to a free place if it would be
   * inside something there, within its chunk; with none, or over a slide, it sleeps where it is.
   */
  private setDownUnder(e: number): void {
    const world = this.world;
    const ents = world.ents;
    const p = youngMove(world, e, world.reg.move[ents.kind[e]!]!);
    const x = ents.x[e]!;
    const y = ents.y[e]!;
    const z = ents.z[e]!;
    const ground = groundUnder(world.hf, x, z, p.radius);
    const hit = y > ground ? castWorld(world, x, y, z, 0, -1, 0, y - ground) : HIT_NONE;
    const top = hit === HIT_STRUCTURE || hit === HIT_NODE ? y - rayHit.t : NaN;
    const under = Number.isNaN(top) ? groundAt(world, p, x, z) : GROUND_FREE;
    if (under !== GROUND_FREE && under !== GROUND_WATER) return;
    const mode = under === GROUND_WATER ? MODE_SWIM : MODE_WALK;
    let to = !Number.isNaN(top) ? top : mode === MODE_SWIM ? world.hf.waterAt(x, z) - swimDepth(p) : ground;
    let tx = x;
    let tz = z;
    if (!placeFree(world, x, to, z, p.radius, p.height)) {
      if (!freePlace(world, x, to, z, p.radius, p.height, 0, p.stepUp, p.slopeCos) || chunkAt(world.dims, freeAt.x, freeAt.z) !== ents.chunk[e]) return;
      tx = freeAt.x;
      to = freeAt.y;
      tz = freeAt.z;
    }
    ents.mode[e] = mode;
    ents.flags[e] = mode === MODE_WALK ? ents.flags[e]! | F_GROUNDED : ents.flags[e]! & ~F_GROUNDED;
    ents.setPosition(e, tx, Math.fround(to), tz);
    this.grounded++;
  }

  private sleep(e: number): void {
    this.tactics.delete(e);
    let slot = this.awakeSlot[e]!;
    if (slot < 0) return;
    this.mind.owned.delete(e);
    const ents = this.world.ents;
    if (ents.mode[e] === MODE_FLYER && ents.team[e] === 0) this.setDownUnder(e);
    // Asleep it is no longer saved a slice at a time, so where it stopped is saved now.
    const rec = this.records.byPid.get(ents.pid[e]!);
    if (rec && (rec.x !== ents.x[e] || rec.y !== ents.y[e] || rec.z !== ents.z[e])) this.records.dirty.add(rec.pid);
    // Nothing near, it does not drown, as nothing near is stepped.
    if (this.wet[e] !== 0) {
      this.wet[e] = 0;
      if (rec) this.survival.setSubmerged(rec, false);
    }
    // One that goes while its turn is still to come gives its slot to the next in turn, and the one being stepped moves
    // down beside it. The last of the list, which has been stepped, then fills the slot above them and is not stepped again.
    if (slot < this.cursor) {
      const c = this.cursor--;
      this.seat(slot, this.awake[c - 1]!);
      slot = c - 1;
      if (c < this.awakeCount) {
        this.seat(slot, this.awake[c]!);
        slot = c;
      }
    }
    this.awakeCount--;
    if (slot < this.awakeCount) this.seat(slot, this.awake[this.awakeCount]!);
    this.awakeSlot[e] = -1;
    ents.flags[e] = ents.flags[e]! & ~F_AWAKE;
    ents.vx[e] = 0;
    ents.vy[e] = 0;
    ents.vz[e] = 0;
    ents.pose(e);
    this.world.history.untrack(e);
  }
}
