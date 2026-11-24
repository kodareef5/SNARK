// What the use key would act on, and the words under the crosshair that say so. Each frame the look is cast as the
// server casts it: at what was built, at the bodies near, at a node. What it is on is kept here for the keys' rows
// (keys.ts) to act on; the server's answer is the one that counts.

import { CUE_HELD, CUE_OUT } from "../../shared/anim/pose.ts";
import { FORM_BREACH_A, FORM_OPEN } from "../../shared/content/breaks.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { PI, TAU } from "../../shared/math/scalar.ts";
import { KEEP_REACH } from "../../shared/sim/balls.ts";
import { youngScale } from "../../shared/sim/breeding.ts";
import { JET_CUIRASS, MF_WINDED, MODE_SWIM, MODE_WALK } from "../../shared/sim/character.ts";
import { GEAR_COUNT, GEAR_HELD, GEAR_WORN } from "../../shared/sim/entities.ts";
import { motionProgress, motionTicks } from "../../shared/sim/motion.ts";
import { IMPALE_SLOT, type Seat } from "../../shared/sim/seats.ts";
import { supplyName } from "../../shared/sim/supply.ts";
import { kindWords, type Buildings } from "../../shared/world/buildings.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { TRAVEL_TERMINAL } from "../../shared/world/obelisks.ts";
import { HIT_NODE, HIT_NONE, HIT_STRUCTURE, castWorld, lookDirection, rayHit } from "../../shared/world/ray.ts";
import { ACT_REACH } from "../../shared/world/upkeep.ts";
import { loosePrompt } from "./balls.ts";
import type { Builder } from "./build.ts";
import type { Controls } from "./controls.ts";
import { STAGES, STAGE_WHOLE, WRECK, formOf, isHeap, stageOf } from "../../shared/world/breaking.ts";
import type { AppFrame, FramePart } from "./frame.ts";
import { BAG } from "./render/dropped.ts";
import { SeatNotice, type Ridden } from "./seat-notice.ts";
import type { ClientSession, RemoteSample } from "./session.ts";
import { itemLabel, waitWords } from "./ui/inventory.ts";
import { structName } from "./ui/structure.ts";
import type { VehiclePlacement } from "./vehicle-placement.ts";
import { lookAt, nearbyBoard, riddenOf, vehiclePrompt } from "./vehicle-prompt.ts";

/** Metres. Matches the server's REACH. */
const REACH = 3.5;
/** Holding the use key on a structure this long opens its menu. */
const STRUCT_HOLD_MS = 350;
/** Metres. */
const NAME_RANGE = 30;
/** A bit of the replicated entity flags. */
const VIEW_FLAG_PROP = 8;
/** Ticks in the air before C stops being the crouch and becomes the glider's key, so a step off a kerb does not stand a crouched body up. */
export const GLIDER_KEY_TICKS = 6;

/** Whether seat `k` of the creature at `host` of `r` has someone in it. */
/** What a street's wreck says of itself by the look its row holds: as the map set it down, stripped, then a shell. */
const wreckWord = (form: number): string => (form === FORM_BREACH_A ? "stripped" : form === FORM_OPEN ? "shell" : "wreck");

/**
 * What a city piece looked at says of itself: "rubble" for a heap, its stage where it is worn, and nothing for one that
 * stands whole. A wreck says its look, never a stage: its health is its rungs', and is not told within one. `placed` is
 * the kind the map set there, which its health is measured by, and `kind` what its row now holds.
 */
export function cityWord(reg: Registry, placed: number, kind: number, hp: number): string {
  if (reg.breakFamily[placed] === WRECK) return wreckWord(formOf(reg, kind));
  if (isHeap(reg, kind)) return "rubble";
  const stage = stageOf(reg, placed, hp);
  return stage === STAGE_WHOLE ? "" : STAGES[stage]!;
}

/**
 * The building the map's piece in `slot` of `chunk` is of, as a player reads it: its name, else its address, else its kind
 * in words. "" for a piece of no building, or where the map's buildings are not held.
 */
export function buildingWord(buildings: Buildings | null, chunk: number, slot: number): string {
  const b = buildings?.buildingOf(chunk, slot) ?? -1;
  return b < 0 ? "" : (buildings!.name(b) ?? buildings!.address(b) ?? kindWords(buildings!.kind(b)));
}

function taken(r: RemoteSample, host: number, k: number): boolean {
  for (let j = 0; j < r.count; j++) if (r.seat[j] === r.id[host]! + 1 && r.seatGen[j] === r.gen[host] && r.seatSlot[j] === k + 1) return true;
  return false;
}

/** The species' name of `kind` as its id says it. */
function speciesOf(reg: Registry, kind: number): string {
  const id = reg.ids[kind] ?? "";
  return id.slice(id.indexOf(":") + 1);
}

export class Prompts implements FramePart {
  /** Entity index of the tribe's creature under the crosshair, or -1. */
  lookedAt = -1;
  /** Crosshair hit for boat service, including unclaimed hulls and salvage. */
  aimedBoat = -1;
  /** Entity index of any body under the crosshair within NAME_RANGE, or -1: what the attack whistle names. */
  target = -1;
  /** useDownAt is when the use key went down, or -1. aimed is the ref of the player-built structure under the crosshair, or -1. */
  useDownAt = -1;
  aimed = -1;
  /** The use key went down on a structure. The body does not get the press until it proves to be a tap. */
  useKept = false;
  /** Frames left of the synthetic use press that follows a tap. */
  usePulse = 0;
  /** Entity index of the egg under the crosshair, or -1. eggKept: the use key went down on one, and took it with CMD_TAKE. */
  eggAimed = -1;
  eggKept = false;
  /** The obelisk terminal under the crosshair within reach, or -1. */
  terminalAimed = -1;
  /** Why the server refused the last press of the use key on a seat. */
  readonly seatNotice = new SeatNotice();
  /** What the prompt's look is on, as a seat would be ridden: a vehicle, a saddled creature, or null. */
  private ridden: Ridden | null = null;
  /** The content index of a bag (client/core/render/dropped.ts), or -1. */
  private readonly bagKind: number;
  /** The look's direction as it was last cast. */
  readonly aim = [0, 0, 0];
  private readonly builder: Builder;
  private readonly placement: VehiclePlacement;

  /** `builder` and `placement` have the prompt while a piece or a vehicle is in hand. */
  constructor(reg: Registry, builder: Builder, placement: VehiclePlacement) {
    this.bagKind = reg.index.get(BAG) ?? -1;
    this.builder = builder;
    this.placement = placement;
  }

  /** The synthetic use press that follows a tap, before the input is sent. */
  pulse(c: Controls): void {
    if (this.usePulse > 0) c.key("KeyE", --this.usePulse > 0);
  }

  /** The use key is let go, as when the page loses the keyboard. */
  release(): void {
    this.useDownAt = -1;
    this.useKept = this.eggKept = false;
    this.usePulse = 0;
  }

  step(f: AppFrame): void {
    const session = f.session, r = f.remote, world = f.world, nowMs = f.nowMs, alive = f.alive, eyeNow = f.eyeNow;
    const b = this.builder, v = this.placement;
    const menu = f.ui.structure;
    menu.tick(nowMs);
    this.seatNotice.tick(nowMs);
    const built = alive && !b.active && !v.active && session.driving < 0 ? this.builtAt(f, world, eyeNow) : ((this.aimed = this.terminalAimed = -1), "");
    if (this.aimed >= 0 && this.useDownAt >= 0 && nowMs - this.useDownAt >= STRUCT_HOLD_MS && !menu.open && f.ui.wantsPointerLock) {
      menu.begin(this.aimed);
      this.useDownAt = -1;
      this.useKept = false;
      f.controls.release();
    }
    const whom = alive ? this.who(f, world, eyeNow) : ((this.aimedBoat = this.lookedAt = this.target = -1), "");
    this.eggAimed = -1;
    // A move for two goes to the survivor the crosshair is on.
    const emotes = f.ui.emotes, characters = f.scene.characters;
    emotes.tick(nowMs);
    emotes.target = -1;
    emotes.targetName = "";
    for (let i = 0; i < r.count; i++) {
      if (r.id[i] !== this.target || !characters.human(r.kind[i]!)) continue;
      emotes.target = this.target;
      emotes.targetName = r.name[i]!;
    }
    if (emotes.open) characters.wantEmotes();
    f.prompt = !alive ? "" : v.active ? v.notice : b.active ? b.notice : menu.notice || this.seatNotice.notice || emotes.notice || this.handPrompt(f, world, eyeNow) || whom || built || this.gliderPrompt(f);
  }

  /** What a press of the use key now would get into or out of: the seat the session is in, or what the prompt is on. */
  seatPress(session: ClientSession, r: RemoteSample): Ridden | null {
    const s = session, reg = s.registry;
    if (s.driving >= 0) return riddenOf(reg, s.bodyKind, true);
    if (s.own.seat > 0 && s.own.seatSlot !== 0 && s.own.seatSlot !== IMPALE_SLOT) {
      for (let i = 0; i < r.count; i++) if (r.id[i] === s.own.seat - 1) return riddenOf(reg, r.kind[i]!, true);
      return "creature";
    }
    return this.ridden;
  }

  /** With `use`, as the use key meets body `i`; else as a name tag does. */
  lookHit(f: AppFrame, i: number, ox: number, oy: number, oz: number, use = false): number {
    const r = f.remote, reg = f.reg;
    // Scale of the body relative to its kind. Below 1 for a young one.
    const size = r.grown[i] !== 0 && (r.flags[i]! & VIEW_FLAG_PROP) === 0 ? youngScale(reg.birthScale[r.kind[i]!]!, r.span[i]!, r.grown[i]!, r.tick) : 1;
    return lookAt(reg, r, i, ox, oy, oz, this.aim, size, use);
  }

  /** The look as the input carries it, into `aim`. */
  private look(c: Controls): number[] {
    lookDirection(Math.round((c.yaw / TAU) * 65536) & 0xffff, Math.round((c.pitch / (PI / 2)) * 16384), this.aim);
    return this.aim;
  }

  /** Names the entity under the crosshair within NAME_RANGE, and sets lookedAt. */
  private who(f: AppFrame, world: CollisionWorld, eye: number): string {
    const s = f.session, r = f.remote, reg = f.reg, characters = f.scene.characters;
    const ox = s.own.x;
    const oy = s.own.y + eye;
    const oz = s.own.z;
    const d = this.look(f.controls);
    let best = castWorld(world, ox, oy, oz, d[0]!, d[1]!, d[2]!, NAME_RANGE) === HIT_NONE ? NAME_RANGE : rayHit.t;
    let hit = -1;
    for (let i = 0; i < r.count; i++) {
      // What is in someone's arms is no mark for the use key, a blow or a whistle.
      if ((r.cue[i]! & CUE_HELD) !== 0) continue;
      const t = this.lookHit(f, i, ox, oy, oz);
      if (t < best) {
        best = t;
        hit = i;
      }
    }
    const mine = hit >= 0 && s.tribe.team !== 0 && r.team[hit] === s.tribe.team;
    this.target = hit >= 0 && (r.flags[hit]! & VIEW_FLAG_PROP) === 0 ? r.id[hit]! : -1;
    this.aimedBoat = hit >= 0 && reg.vehicle[r.kind[hit]!]?.movement === "boat" ? r.id[hit]! : -1;
    this.lookedAt = hit >= 0 && mine && (r.flags[hit]! & VIEW_FLAG_PROP) === 0 && !characters.human(r.kind[hit]!) ? r.id[hit]! : -1;
    // A creature's name is in the mark over it (fillOverhead).
    if (hit < 0 || r.name[hit] === "" || (r.flags[hit]! & VIEW_FLAG_PROP) !== 0 || !characters.human(r.kind[hit]!)) return "";
    return `${r.name[hit]}${mine ? " (tribe)" : ""}  level ${r.level[hit]}`;
  }

  /** Sets `aimed` to the player-built structure within ACT_REACH, and returns its name and health. */
  private builtAt(f: AppFrame, world: CollisionWorld, eye: number): string {
    const s = f.session, reg = f.reg;
    this.aimed = -1;
    this.terminalAimed = -1;
    const d = this.look(f.controls);
    if (castWorld(world, s.own.x, s.own.y + eye, s.own.z, d[0]!, d[1]!, d[2]!, ACT_REACH) !== HIT_STRUCTURE) return "";
    const ref = rayHit.ref;
    const t = world.structs.chunks[Math.floor(ref / 65536)]!;
    const kind = t.kind[ref & 0xffff]!;
    const motion = reg.motion[kind];
    if (motion && rayHit.t <= REACH) {
      const state = s.motions.get(ref);
      const p = state ? motionProgress(state, motionTicks(motion), s.tickClock) : 0;
      const word = `E ${motion.say[state?.to === 1 ? 1 : 0]}`;
      return p > 0 && p < 1 ? `${word}  ${Math.round(p * 100)}%` : word;
    }
    if (kind === reg.index.get(TRAVEL_TERMINAL)) {
      this.terminalAimed = ref;
      return "E travel to another server";
    }
    // A piece nobody built says its building, and under it, if it breaks, how it stands: its health is not told within a stage.
    if (t.owner[ref & 0xffff] === 0) {
      const of = buildingWord(s.buildings, Math.floor(ref / 65536), ref & 0xffff);
      const stands = reg.breakSet[kind] !== 0 ? cityWord(reg, s.mapKind(Math.floor(ref / 65536), ref & 0xffff) || kind, kind, t.hp[ref & 0xffff]!) : "";
      return of !== "" && stands !== "" ? `${of}\n${stands}` : of || stands;
    }
    if (reg.pieceItem[kind] === 0) return "";
    this.aimed = ref;
    const mine = s.tribe.team !== 0 && t.owner[ref & 0xffff] === s.tribe.team;
    const usable = (reg.opens[kind] !== 0 || reg.structSlots[kind] !== 0) && rayHit.t <= REACH;
    return `${usable ? "E use  " : mine ? "hold E  " : ""}${structName(reg, kind)}  ${Math.ceil(t.hp[ref & 0xffff]!)}/${reg.maxHp[kind]}`;
  }

  /** The use button's prompt, and before it what a click of the soul ball in hand would do. */
  private handPrompt(f: AppFrame, world: CollisionWorld, eye: number): string {
    const use = this.prompt(f, world, eye);
    const ball = this.ballPrompt(f, world, eye);
    return ball && use ? `${ball}    ${use}` : ball || use;
  }

  /**
   * With a soul ball in hand, what a click would do (server/balls.ts): a full one looses the tame it holds, an empty one
   * keeps the tribe's creature looked at within KEEP_REACH. "" with anything else in hand, or nothing a click would keep.
   */
  private ballPrompt(f: AppFrame, world: CollisionWorld, eye: number): string {
    const s = f.session, r = f.remote, reg = f.reg;
    const inv = s.inventory;
    if (!inv || s.held < 0 || inv.hotbar < 0 || s.driving >= 0 || s.own.seat > 0 || f.holding >= 0) return "";
    const slot = inv.hotbar + s.held;
    const item = inv.item[slot]!;
    if (item === 0) return "";
    if (reg.ballEmpty[item] !== 0) return loosePrompt(reg, s.kept[0].get(slot));
    if (reg.ballFull[item] === 0) return "";
    const ox = s.own.x;
    const oy = s.own.y + eye;
    const oz = s.own.z;
    const d = this.look(f.controls);
    const struck = castWorld(world, ox, oy, oz, d[0]!, d[1]!, d[2]!, KEEP_REACH);
    let best = struck === HIT_NONE ? KEEP_REACH : rayHit.t;
    let hit = -1;
    for (let i = 0; i < r.count; i++) {
      if ((r.cue[i]! & CUE_HELD) !== 0) continue;
      const t = this.lookHit(f, i, ox, oy, oz, true);
      if (t < best) {
        best = t;
        hit = i;
      }
    }
    // Only a creature of the tribe's: not a thing lying there, a vehicle, a survivor, or another tribe's.
    if (hit < 0 || (r.flags[hit]! & VIEW_FLAG_PROP) !== 0 || reg.vehicle[r.kind[hit]!] || r.kind[hit] === s.ownKind || reg.defs[r.kind[hit]!]?.type !== "species") return "";
    if (s.tribe.team === 0 || r.team[hit] !== s.tribe.team) return "";
    const name = r.name[hit] || `the ${speciesOf(reg, r.kind[hit]!)}`;
    return (r.cue[hit]! & CUE_OUT) !== 0 ? `${name} must be awake to go into a soul ball` : `click  keep ${name}`;
  }

  /** Labels what the use button would act on, with the same ray the server casts. The server's answer is the one that counts. */
  private prompt(f: AppFrame, world: CollisionWorld, eye: number): string {
    const s = f.session, r = f.remote, reg = f.reg;
    const ox = s.own.x;
    const oy = s.own.y + eye;
    const oz = s.own.z;
    this.ridden = null;
    if (s.own.seat > 0 && s.own.seatSlot === IMPALE_SLOT) return "Impaled: held by a Stegosaurus";
    if (s.driving >= 0) {
      const combat = reg.combat[s.bodyKind];
      if (combat) return `LMB attack   ${combat.charge ? "hold RMB charge" : combat.secondary ? "RMB impale" : ""}   E get off`;
      if (reg.vehicle[s.bodyKind]) return "E  exit vehicle";
      const mount = reg.defs[s.bodyKind];
      return mount?.type === "species" && mount.roar ? "RMB  roar    E  get off" : "E  get off";
    }
    // Seats in cars and saddles have a slot; a carried body has none. Who steers is handled above.
    if (s.own.seatSlot !== 0 && s.own.seat > 0) {
      for (let i = 0; i < r.count; i++) if (r.id[i] === s.own.seat - 1) return reg.vehicle[r.kind[i]!] ? "E  exit passenger seat" : "E  get off";
      return "E  get off";
    }
    if (f.holding >= 0) return "E  set down   click  throw";
    const d = this.look(f.controls);
    const struck = castWorld(world, ox, oy, oz, d[0]!, d[1]!, d[2]!, REACH);
    let best = struck === HIT_NONE ? REACH : rayHit.t;
    const node = struck === HIT_NODE ? rayHit.ref : -1;
    let hit = -1;
    for (let i = 0; i < r.count; i++) {
      // What is in someone's arms is no mark for the use key, a blow or a whistle.
      if ((r.cue[i]! & CUE_HELD) !== 0) continue;
      const t = this.lookHit(f, i, ox, oy, oz, true);
      if (t < best) {
        best = t;
        hit = i;
      }
    }
    if (hit >= 0) {
      // The server also treats using an occupant as using its vehicle or creature, useful when a person fills the doorway.
      if (r.seatSlot[hit] !== 0) for (let j = 0; j < r.count; j++) {
        if (r.id[j] === r.seat[hit]! - 1 && r.gen[j] === r.seatGen[hit]) { hit = j; break; }
      }
      if (reg.vehicle[r.kind[hit]!]) {
        this.ridden = riddenOf(reg, r.kind[hit]!, false);
        return vehiclePrompt(reg, r, hit, ox, s.own.y, oz, world.hf.waterAt(ox, oz), s.own.mode === MODE_SWIM);
      }
      // A saddled creature of the tribe, grown and awake, is ridden: its steering seat if it is free, else a passenger's.
      const seats = reg.saddleSeats[r.gear[hit * GEAR_COUNT + GEAR_WORN]!];
      if (seats) this.ridden = "creature";
      if (seats && s.tribe.team !== 0 && r.team[hit] === s.tribe.team && r.grown[hit] === 0 && (r.cue[hit]! & CUE_OUT) === 0) return this.ridePrompt(r, hit, seats, r.name[hit] || `the ${speciesOf(reg, r.kind[hit]!)}`);
      if ((r.flags[hit]! & VIEW_FLAG_PROP) !== 0) {
        // A bag of one stack, as a thing thrown or let fall lies, is taken up whole (server/loose.ts); F still opens it.
        const lying = r.kind[hit] === this.bagKind ? r.gear[hit * GEAR_COUNT + GEAR_HELD]! : 0;
        if (lying !== 0) {
          this.eggAimed = r.id[hit]!;
          return `E  take ${itemLabel(reg, lying)}`;
        }
        // On a prop, a nonzero grown tick marks a fertilised egg. An egg that is an item is taken up.
        const left = waitWords(Math.max(0, Math.ceil((r.grown[hit]! - s.serverTick) / TICK_RATE)));
        if (reg.propItem[r.kind[hit]!] !== 0) {
          this.eggAimed = r.id[hit]!;
          return `E  take ${r.name[hit]}${r.grown[hit] !== 0 ? `  ${left} to hatch` : ""}`;
        }
        if (r.grown[hit] !== 0) return `${r.name[hit]}  hatches in ${left}`;
        return this.dropPrompt(s, r, hit, reg.takeOnly[r.kind[hit]!] === 1);
      }
      if (r.team[hit] === 0 && r.grown[hit] !== 0) return `E  take the young ${speciesOf(reg, r.kind[hit]!)}`;
      // A small creature, wild or the tribe's, awake, is picked up. F still opens it.
      if (reg.carriable[r.kind[hit]!] === 1 && (r.team[hit] === 0 || (s.tribe.team !== 0 && r.team[hit] === s.tribe.team)) && (r.cue[hit]! & CUE_OUT) === 0) {
        return `E  pick up ${r.name[hit] || `the ${speciesOf(reg, r.kind[hit]!)}`}`;
      }
      return "";
    }
    // Aimed at nothing, E steps onto a free board of the tribe nearby, as after a fall (server/urban.ts nearbyBoard).
    if (node < 0 && struck !== HIT_STRUCTURE && s.tribe.team !== 0 && nearbyBoard(reg, r, s.tribe.team, ox, s.own.y, oz)) return "E  ride skateboard";
    if (node < 0 || !s.nodeField) return "";
    // A node without a material is a bush, picked with the use key. Trees and rocks are struck. What is left of a used-up one is neither.
    const def = reg.defs[s.nodeField.standing(Math.floor(node / 65536), node & 0xffff)];
    if (def?.type !== "node") return "";
    const what = def.id.slice(def.id.indexOf(":") + 1);
    return def.material === undefined ? `E  pick ${what}` : `hold click  gather from ${what}`;
  }

  /** A saddled creature to ride: its steering seat if it is free, else a passenger's. */
  private ridePrompt(r: RemoteSample, hit: number, seats: readonly Seat[], name: string): string {
    let steer = -1;
    for (let k = 0; k < seats.length && steer < 0; k++) if (seats[k]!.driver) steer = k;
    if (!taken(r, hit, steer)) return `E  ride ${name}`;
    for (let k = 0; k < seats.length; k++) if (!seats[k]!.driver && !taken(r, hit, k)) return `E  ride ${name} as a passenger`;
    return "Every seat is taken";
  }

  /** A thing lying there that opens. A supply drop's capsule opens at its tier's level: below it the prompt says the level, and no key. */
  private dropPrompt(s: ClientSession, r: RemoteSample, hit: number, capsule: boolean): string {
    const rows = s.supply.rows;
    let at = -1;
    if (capsule) for (let k = 0; k < rows.length && at < 0; k++) {
      const d = rows[k]!;
      if (d.landed && d.left === 0 && Math.abs(d.x - r.x[hit]!) < 0.5 && Math.abs(d.z - r.z[hit]!) < 0.5) at = k;
    }
    const drop = at >= 0 ? rows[at]! : undefined;
    const level = drop ? (s.supply.tiers[drop.tier]?.level ?? 0) : 0;
    // Its name is said whole from the list: an entity's own is cut at twenty-four characters (EntityStore.setLook).
    const name = drop ? supplyName(s.supply.tiers[drop.tier]?.name ?? "", s.supply.classes[drop.cls]?.name ?? "", drop.ringed) : r.name[hit]!;
    if (!s.open && s.progress.level < level) return `${name}  opens at level ${level}`;
    return `E  ${s.open ? "close" : "open"} ${name}`;
  }

  /** What the glider's keys do now, for a survivor in the air that carries one: the cuirass's jet has Space, so there it is C. */
  private gliderPrompt(f: AppFrame): string {
    const s = f.session, own = s.own;
    if (s.driving >= 0 || own.seat || own.grounded || own.mode !== MODE_WALK || own.glideGear === 0) return "";
    const key = (own.jetGear & JET_CUIRASS) !== 0 ? "C" : "Space";
    if (own.glide !== 0) return `${key}  fold glider   Shift  dive   S  flare`;
    return s.simTick - f.airFrom >= GLIDER_KEY_TICKS && own.vy < -2 && (own.mflags & MF_WINDED) === 0 ? `${key}  open glider` : "";
  }
}
