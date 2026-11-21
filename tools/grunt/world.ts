// The mock world: a small game that speaks the grunt protocol (grunt/protocol.md) so grunt can be built and tested
// without SNARK. It is deterministic and stepped by hand (`step`), 20 ticks a second, on flat ground: x east, z south,
// y up. It holds one character and holds it to a player's limits: it perceives what is near or in front of it, it
// must face a thing to act on it, its body turns and walks at a body's speed, and trees, rocks and walls are in the way.
//
// What there is: trees, rocks and bushes to gather from, a chest, other players (who only talk), a raptor that hunts,
// recipes for tools and a wood hut, and pieces that snap to each other as a player's preview does. It is a test bench,
// not a game: numbers are round, and only what grunt's skills need is here.

import type {
  Action, Craftable, EmoteSpec, EntitiesChannel, Entity, EntityKind, FocusChannel, InventoryChannel, Interruption, MapChannel, MapPlace, Plan,
  RejectCode, SelfChannel, Slot, TerrainChannel,
} from "../../grunt/protocol.ts";
import type { WorldEvent } from "../../grunt/endpoint.ts";
import { BUILD_RATE, BUILD_REACH, MAX_PLAN as BUILDING_MAX, type PieceAt, PICKUP_S, PIECE_HP, PIECE_RECIPES, specOf, Structures, THINGS } from "./structures.ts";
import { emoteClips } from "../../shared/anim/emote-clips.ts";
import { EMOTES, emoteClipId } from "../../shared/anim/emotes.ts";
import { CHAR, CLIFF, DEEP, LEGEND, SHALLOW, type Feature, type Terrain } from "./terrain.ts";

export const TICK_MS = 50;
const WALK = 3.5, SPRINT = 6, TURN = 6, PITCH_TURN = 3, BODY_R = 0.4, REACH = 2.5, SIGHT = 60, NEAR = 12;
const FOV = Math.PI / 3, SWING_MS = 600, PICK_MS = 500, MAX_HOLD = 2000;
/** What the character can carry before it slows: a levelled survivor's, so that a hut's materials fit. */
// Enough for a hut's worth of wood (SNARK-priced pieces), as a levelled character carries.
const CARRY = 600;
const RAPTOR = { sees: 20, gives_up: 30, speed: 4.5, wander: 1.2, bite: 8, every_ms: 1000, reach: 1.6, hp: 60 };

/** What can be ridden or driven, and how it goes: speed (m/s), on a road where it is faster, turning (rad/s), and
 * the ground it goes on. Flyers keep a height: jump climbs, crouch comes down. */
export interface Ride {
  speed: number;
  road?: number;
  turn: number;
  /** "land": ground, wading and swimming as a body does; "wheels": ground and shallow water only; "water": only water. */
  on: "land" | "wheels" | "water" | "air";
  /** A flyer's stamina a second in the air, if it tires. */
  tires?: number;
  radius: number;
  /** A mount that fights: its blow's damage, pace and reach (the rider attacks with it). */
  attack?: { damage: number; every_ms: number; reach: number };
}
/** How fast the repair assist mends, pieces a second; a repair costs half the piece's recipe in the share it lacks. */
const REPAIR_RATE = 2;

/** A tame creature's health when whole. */
const RIDE_HP: Record<string, number> = { parasaur: 300, pteranodon: 200, raptor: 200, ankylo: 400 };
export const RIDES: Record<string, Ride> = {
  parasaur: { speed: 10, turn: 3, on: "land", radius: 1.2 },
  raptor: { speed: 11, turn: 4, on: "land", radius: 0.6, attack: { damage: 15, every_ms: 700, reach: 2.2 } },
  ankylo: { speed: 5, turn: 1.5, on: "land", radius: 1.2, attack: { damage: 12, every_ms: 1200, reach: 2.6 } },
  pteranodon: { speed: 18, turn: 2, on: "air", tires: 1.2, radius: 1.2 },
  car: { speed: 9, road: 16, turn: 1.4, on: "wheels", radius: 1.4 },
  heli: { speed: 25, turn: 1.8, on: "air", radius: 3 },
  boat: { speed: 10, turn: 1.2, on: "water", radius: 2 },
};
const CLIMB = 6, CEILING = 120;
/** A tek suit: personal flight, burning a unit of element every two seconds aloft. */
const SUIT: Ride = { speed: 16, turn: 4, on: "air", radius: 0.4 };
const SUIT_BURN_S = 2;

/** A bow: drawn for draw_ms, an arrow flies at `speed` m/s up to `range` m and does `damage`. */
export const BOW = { damage: 18, draw_ms: 800, range: 45, speed: 45, ammo: "arrow" };
/** The assists, as the game advertises them: a player's reaction and a good player's aim, not an aimbot's. */
export const ASSIST = { reaction_ms: 150, spread_deg: 1.5 };
/** How far a speaking voice carries. */
export const VOICE_RANGE = 40;

// --- Items and recipes --------------------------------------------------------------------------------------------

const WEIGHT: Record<string, number> = {
  wood: 0.5, thatch: 0.1, fiber: 0.1, stone: 1, flint: 0.05, berries: 0.1,
  stone_hatchet: 1, stone_pick: 1, bow: 1, arrow: 0.05, tek_suit: 5, element: 0.1,
};
/** A piece weighs what SNARK's tier says (content/building.ts): thatch 2, wood 4, stone 6. */
const weightOf = (item: string) => WEIGHT[item] ?? (item.startsWith("piece_") ? (item.endsWith("_thatch") ? 2 : item.endsWith("_stone") ? 6 : 4) : 1);
const TOOLS: Record<string, { uses: number; tree: [number, number]; rock: [number, number]; hits: number }> = {
  // [main yield, thatch or flint] per swing, and the damage a swing does to a creature.
  // Yields of the order ARK's: a stone hatchet takes a dozen wood a swing, a tree holds 150, so that pieces priced as
  // SNARK prices them (a wood foundation is 80 wood) are a few trees' work.
  hands: { uses: 0, tree: [2, 1], rock: [1, 0], hits: 4 },
  stone_hatchet: { uses: 100, tree: [12, 4], rock: [3, 0], hits: 10 },
  stone_pick: { uses: 100, tree: [4, 8], rock: [8, 3], hits: 12 },
};
export const RECIPES: Record<string, { needs: Record<string, number>; seconds: number }> = {
  stone_hatchet: { needs: { wood: 1, flint: 1, stone: 1, thatch: 10 }, seconds: 1 },
  stone_pick: { needs: { wood: 1, stone: 1, thatch: 10 }, seconds: 1 },
  ...PIECE_RECIPES,
  bow: { needs: { wood: 6, fiber: 30 }, seconds: 3 },
  arrow: { needs: { wood: 1, flint: 1, fiber: 2 }, seconds: 0.5 },
};
const STACK = (item: string) => (item in TOOLS || item === "bow" || item === "tek_suit" ? 1 : 100);
/** What sort each item is, as the inventory screen sorts it. */
export function kindOf(item: string): string {
  if (item.startsWith("piece_")) return "structure";
  if (item in TOOLS) return "tool";
  return ({ bow: "weapon", arrow: "ammo", tek_suit: "armor", element: "fuel", berries: "food", meat: "food" } as Record<string, string>)[item] ?? "resource";
}
/** How many stacks a container holds. */
const CAPACITY: Record<string, number> = { self: 60, chest: 30, vault: 120, corpse: 20, creature: 40 };
/** Puts items into slots, filling stacks first, up to a number of stacks: how many went in. */
function addTo(slots: Slot[], item: string, n: number, capacity: number): number {
  let left = n;
  for (const s of slots) {
    if (left <= 0) break;
    if (s.item === item && s.count < STACK(item)) {
      const add = Math.min(left, STACK(item) - s.count);
      (s.count += add), (left -= add);
    }
  }
  while (left > 0 && slots.length < capacity) {
    const add = Math.min(left, STACK(item));
    slots.push({ slot: slots.length, item, count: add });
    left -= add;
  }
  return n - left;
}
function takeFrom(slots: Slot[], item: string, n: number): number {
  let left = n;
  for (let i = slots.length - 1; i >= 0 && left > 0; i--) {
    const s = slots[i]!;
    if (s.item !== item) continue;
    const k = Math.min(left, s.count);
    (s.count -= k), (left -= k);
    if (s.count === 0) slots.splice(i, 1);
  }
  slots.forEach((s, i) => (s.slot = i));
  return n - left;
}

// --- The things in the world --------------------------------------------------------------------------------------

interface Thing {
  id: string;
  kind: EntityKind;
  type: string;
  x: number;
  z: number;
  /** How wide it is, for being in the way and being aimed at. */
  r: number;
  blocks: boolean;
  /** A resource's yield left, a creature's health. */
  left: number;
  name?: string;
  /** A player who is an enemy. */
  hostile?: boolean;
  // A creature's mind.
  hunting?: boolean;
  home?: [number, number];
  goal?: [number, number];
  biteAt?: number;
  /** Tame, and someone's: does not hunt or wander. */
  tame?: boolean;
  /** A flyer's own stamina. */
  stamina?: number;
  /** How it is moving (creatures), m/s. */
  vx?: number;
  vz?: number;
  /** Hurt by the character: hunts it, wherever, until then. */
  angry?: number;
  /** A walking player's way, pace (m/s) and when it sets off. */
  path?: [number, number][];
  pace?: number;
  departs?: number;
  /** A loot bag's end. */
  expires?: number;
  // A container's slots; a structure's place.
  slots?: Slot[];
  piece?: PieceAt;
  /** A player's emote, and until when (a loop until it stops); an invite it has made to the character, and one it
   * has had from the character; whether it accepts the character's invites. */
  emote?: string;
  emoteUntil?: number;
  invite?: { name: string; until: number };
  asked?: { name: string; at: number; until: number };
  accepts?: boolean;
}

/** The emotes the mock has: SNARK's list (shared/anim/emotes.ts), each one-shot as long as its clip. */
export const EMOTE_SPECS: EmoteSpec[] = EMOTES.map((e) => {
  const clip = emoteClips().find((c) => c.id === emoteClipId(e.id));
  return {
    name: e.id, tags: [...e.tags], loop: e.loop, mask: e.mask, ...(e.loop ? {} : { seconds: (clip?.frames ?? 60) / 30 }),
    ...(e.pair ? { pair: { ...e.pair } } : {}), ...(e.group ? { group: true } : {}),
  };
});
const EMOTE_SPEC = new Map(EMOTE_SPECS.map((e) => [e.name, e]));
/** How long an invite waits for its answer, how near it is made from, and how near a dance is joined. */
const INVITE_MS = 8000, INVITE_RANGE = 4, JOIN_RANGE = 15;

interface Running {
  command: string;
  index: number;
  action: Action;
  started: number;
  until: number;
  next?: number;
  done: Record<string, unknown>;
}

export type { WorldEvent } from "../../grunt/endpoint.ts";

/** A small seeded generator, so that a world made twice from one seed runs the same. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wrap = (a: number) => {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
};
/** The yaw that faces from one point to another: 0 north (−z), clockwise from above. */
export const yawTo = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(tx - fx, -(tz - fz));

export interface CharacterSetup {
  name?: string;
  x?: number;
  z?: number;
  yaw?: number;
  items?: Record<string, number>;
  hold?: string;
}

export class World {
  tick = 0;
  readonly things = new Map<string, Thing>();
  readonly structures = new Structures();
  /** Where creatures and players have been: [t, x, z], the last 30 ticks. */
  private readonly trail = new Map<string, [number, number, number][]>();
  /** Arrows in flight, and what to tell when one lands (an assist's tally). */
  private readonly arrows: { x: number; z: number; vx: number; vz: number; left: number; tally?: Record<string, unknown> }[] = [];
  /** The ground, where the scene has any: flat open ground otherwise. */
  terrain: Terrain | null = null;
  /** Named places the map screen shows (an obelisk, a landmark), and what a new player is told of the world. */
  places: MapPlace[] = [];
  about = "";
  /** Changes to the ground after the start, by game time: the map does not show them. */
  changes: { at: number; feature: Feature }[] = [];
  readonly me = {
    id: "e:1", name: "Scout", alive: true, x: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0,
    health: 100, stamina: 100, food: 100, water: 100, slots: [] as Slot[], held: null as number | null,
    open: null as string | null, crafting: [] as { item: string; left: number; ready: number; command: string; index: number }[],
    /** What it rides or drives, and how high it is (flying). */
    mount: null as string | null, y: 0, crouch: false,
    /** Wearing a tek suit; and the time aloft since the last unit of element burned. */
    suit: false, aloft: 0,
    /** The emote it plays, until when, and whether moving ends it. */
    emote: null as { name: string; until: number; full: boolean } | null,
  };
  /** Every emote played, by whom (a name), at whom, and when: what a scenario's `emoted` check reads. */
  readonly emoted: { who: string; name: string; t: number; target?: string }[] = [];
  readonly heardChat: { channel: string; from: string; from_id?: string; text: string; t: number }[] = [];
  readonly said: { channel: string; text: string; t: number }[] = [];
  private readonly running = new Map<string, Running>();
  /** Outcomes of instant actions, told after their act's ack (`flush`). */
  private readonly instants: WorldEvent[] = [];
  private readonly listeners: ((e: WorldEvent) => void)[] = [];
  private readonly random: () => number;
  private next = 2;
  private lastBlocked = -1e9;
  private lastHeard = new Map<string, number>();

  constructor(seed = 1) {
    this.random = rng(seed);
  }

  get t(): number {
    return this.tick * TICK_MS;
  }

  named(name: string): void {
    this.me.name = name;
  }

  on(fn: (e: WorldEvent) => void): void {
    this.listeners.push(fn);
  }

  private emit(e: WorldEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  private event(kind: string, data: Record<string, unknown>): void {
    this.emit({ type: "event", kind, data });
  }

  // --- Making a scene ---------------------------------------------------------------------------------------------

  place(kind: EntityKind, type: string, x: number, z: number, extra: Partial<Thing> = {}): string {
    const prefix = kind === "resource" ? "n:" : kind === "structure" ? "s:" : "e:";
    const id = `${prefix}${this.next++}`;
    const base: Record<string, Pick<Thing, "r" | "blocks" | "left">> = {
      tree: { r: 0.5, blocks: true, left: 150 }, rock: { r: 0.8, blocks: true, left: 80 }, bush: { r: 0.5, blocks: false, left: 12 },
      chest: { r: 0.5, blocks: true, left: 0 }, vault: { r: 0.7, blocks: true, left: 0 }, corpse: { r: 0.5, blocks: false, left: 0 }, ankylo: { r: 1.2, blocks: false, left: 400 }, raptor: { r: 0.6, blocks: false, left: RAPTOR.hp }, player: { r: 0.4, blocks: false, left: 100 },
      parasaur: { r: 1.2, blocks: false, left: 300 }, pteranodon: { r: 1.2, blocks: false, left: 200 },
      car: { r: 1.4, blocks: false, left: 500 }, heli: { r: 3, blocks: false, left: 800 }, boat: { r: 2, blocks: false, left: 400 },
    };
    const b = base[type] ?? { r: 0.5, blocks: true, left: 1 };
    // A tame creature is as hale as a mount of its kind; a container's things are restacked as the game stacks them.
    const hp = extra.tame && RIDE_HP[type] ? { left: RIDE_HP[type]! } : {};
    const slots = extra.slots ? (() => {
      const out: Slot[] = [];
      for (const s of extra.slots) addTo(out, s.item, s.count, 1000);
      return { slots: out };
    })() : {};
    this.things.set(id, { id, kind, type, x, z, ...b, ...extra, ...hp, ...slots });
    return id;
  }

  setup(c: CharacterSetup): void {
    Object.assign(this.me, { name: c.name ?? this.me.name, x: c.x ?? 0, z: c.z ?? 0, yaw: c.yaw ?? 0 });
    for (const [item, count] of Object.entries(c.items ?? {})) this.give(item, count);
    if (c.hold) this.me.held = this.me.slots.findIndex((s) => s.item === c.hold);
  }

  /** A line said by someone else, as the character hears it. */
  say(from: string, text: string, channel = "local", from_id?: string): void {
    const line = { channel, from, ...(from_id ? { from_id } : {}), text, t: this.t };
    this.heardChat.push(line);
    this.event("chat", line);
  }

  /** A player speaking aloud: heard (transcribed) only within a voice's range, quieter farther off. */
  speak(id: string, text: string, confidence = 0.95): boolean {
    const p = this.things.get(id);
    if (!p || p.kind !== "player") return false;
    const d = this.dist(p);
    if (d > VOICE_RANGE) return false;
    const line = { channel: "voice", from: p.name ?? id, from_id: id, text, t: this.t, voice: { distance: Math.round(d * 10) / 10, bearing: Math.round(this.bearing(p.x, p.z) * 100) / 100, loudness: Math.round((1 - d / VOICE_RANGE) * 100) / 100, confidence } };
    this.heardChat.push(line);
    this.event("chat", line);
    return true;
  }

  // --- Inventory --------------------------------------------------------------------------------------------------

  count(item: string): number {
    return this.me.slots.filter((s) => s.item === item).reduce((n, s) => n + s.count, 0);
  }

  give(item: string, count: number, quiet = true): void {
    let left = count;
    for (const s of this.me.slots) {
      if (left <= 0) break;
      if (s.item === item && s.count < STACK(item)) {
        const add = Math.min(left, STACK(item) - s.count);
        s.count += add;
        left -= add;
      }
    }
    while (left > 0) {
      const add = Math.min(left, STACK(item));
      const tool = TOOLS[item];
      this.me.slots.push({ slot: this.me.slots.length, item, count: add, ...(tool?.uses ? { uses: [tool.uses, tool.uses] } : {}) });
      left -= add;
    }
    if (!quiet) this.event("item", { item, delta: count, count: this.count(item) });
  }

  private take(item: string, count: number, quiet = false): boolean {
    if (this.count(item) < count) return false;
    let left = count;
    for (const s of this.me.slots) {
      if (s.item !== item || left <= 0) continue;
      const off = Math.min(left, s.count);
      s.count -= off;
      left -= off;
    }
    this.compact();
    if (!quiet) this.event("item", { item, delta: -count, count: this.count(item) });
    return true;
  }

  private compact(): void {
    const heldItem = this.me.held === null ? null : this.me.slots[this.me.held];
    const kept = this.me.slots.filter((s) => s.count > 0);
    kept.forEach((s, i) => (s.slot = i));
    this.me.slots.length = 0;
    this.me.slots.push(...kept);
    this.me.held = heldItem && heldItem.count > 0 ? kept.indexOf(heldItem) : null;
  }

  private weight(): number {
    return this.me.slots.reduce((w, s) => w + weightOf(s.item) * s.count, 0);
  }

  private heldItem(): string | undefined {
    return this.me.held === null ? undefined : this.me.slots[this.me.held]?.item;
  }

  // --- Seeing -----------------------------------------------------------------------------------------------------

  private forward(): [number, number] {
    return [Math.sin(this.me.yaw), -Math.cos(this.me.yaw)];
  }

  private bearing(x: number, z: number): number {
    return wrap(yawTo(this.me.x, this.me.z, x, z) - this.me.yaw);
  }

  private dist(t: Thing): number {
    return Math.hypot(t.x - this.me.x, t.z - this.me.z);
  }

  /** What the character perceives: a player's senses, a little heightened and all at once (grunt/protocol.md):
   * everything about it out to 60 m whichever way it faces, a little round corners close by, and farther straight
   * ahead; never what a solid wall hides at any distance. From high up, much further, and over cliffs below it. */
  perceives(t: Thing): boolean {
    const d = this.dist(t);
    if (t.id === this.me.mount || d < 2) return true;
    const high = this.me.y > 15;
    const round = high ? 160 : SIGHT, ahead = high ? 200 : 120;
    if (d > ahead || (d > round && Math.abs(this.bearing(t.x, t.z)) > FOV)) return false;
    if (!this.terrain) return true;
    const over = Math.max(1.5, this.me.y);
    if (this.terrain.clear(this.me.x, this.me.z, t.x, t.z, over)) return true;
    // Close by, round a corner a little: as if from a step or two aside (peeking, hearing it move).
    if (d > NEAR + 3) return false;
    for (const [ox, oz] of [[3, 0], [-3, 0], [0, 3], [0, -3]] as const) {
      const vx = this.me.x + ox, vz = this.me.z + oz;
      if (this.terrain.at(vx, vz) !== CLIFF && this.terrain.clear(this.me.x, this.me.z, vx, vz, over) && this.terrain.clear(vx, vz, t.x, t.z, over)) return true;
    }
    return false;
  }

  /** What is under the crosshair and within reach. */
  private focusThing(): Thing | undefined {
    const [fx, fz] = this.forward();
    let best: Thing | undefined, bestT = Infinity;
    for (const t of this.things.values()) {
      if (t.kind === "structure" && t.piece?.y) continue;
      const dx = t.x - this.me.x, dz = t.z - this.me.z;
      const along = dx * fx + dz * fz;
      const across = Math.abs(dx * fz - dz * fx);
      if (along < 0 || along > REACH + t.r || across > t.r + 0.2) continue;
      if (along < bestT) (best = t), (bestT = along);
    }
    return best;
  }

  private affords(t: Thing): string[] {
    if (t.id === this.me.mount) return this.me.y < 0.5 ? ["dismount"] : [];
    if (this.dist(t) - t.r > REACH) return [];
    if (t.tame && t.slots) return [...(this.me.open === t.id ? ["close"] : ["open"]), ...(RIDES[t.type] && !this.me.mount ? ["mount"] : [])];
    if (RIDES[t.type] && t.tame && !this.me.mount) return ["mount"];
    if (t.type === "bush") return ["harvest"];
    if (t.kind === "container" || (t.tame && t.slots)) return [...(this.me.open === t.id ? ["close"] : ["open"]), ...(RIDES[t.type] && t.tame && !this.me.mount ? ["mount"] : [])];
    if (t.piece && specOf(t.piece.form)?.place === "in_frame") return [t.piece.open ? "close" : "open"];
    return [];
  }

  selfChannel(): SelfChannel {
    const m = this.me, h = this.heldItem();
    const held = m.held === null || !h ? null : { item: h, slot: m.held, uses: m.slots[m.held]?.uses ?? null };
    return {
      id: m.id, name: m.name, alive: m.alive, pos: [m.x, m.y, m.z], yaw: m.yaw, pitch: m.pitch, vel: [m.vx, 0, m.vz],
      on: m.y > 0.5 ? "air" : m.mount ? (this.things.get(m.mount)?.kind === "vehicle" ? "vehicle" : "mount") : this.terrain?.at(m.x, m.z) === DEEP ? "water" : "ground",
      held, mount: m.mount, status: [...(this.weight() > CARRY ? ["encumbered"] : []), ...(m.suit ? ["tek_suit"] : [])],
      vitals: { health: [m.health, 100], stamina: [m.stamina, 100], food: [m.food, 100], water: [m.water, 100], weight: [Math.round(this.weight() * 10) / 10, CARRY] },
    };
  }

  entitiesChannel(radius = 40, max = 20): EntitiesChannel {
    const seen = [...this.things.values()]
      // Of a base, only its doors: the rest is ground, which the terrain channel shows.
      .filter((t) => (!t.piece || t.kind === "container" || (specOf(t.piece.form)?.place === "in_frame" && this.dist(t) < 20)) && this.perceives(t) && this.dist(t) <= radius)
      .sort((a, b) => this.dist(a) - this.dist(b));
    const items: Entity[] = seen.slice(0, max).map((t) => ({
      id: t.id, kind: t.kind, type: t.type, ...(t.name ? { name: t.name } : {}),
      pos: [t.x, t.piece?.y ?? 0, t.z], distance: Math.round(this.dist(t) * 100) / 100, bearing: this.bearing(t.x, t.z),
      ...(t.kind === "creature" && !t.tame ? { health: t.left / RAPTOR.hp, disposition: "hostile" as const, tags: t.hunting ? ["hunting"] : ["wild"] } : {}),
      ...(t.tame || t.kind === "vehicle" ? {
        disposition: "own" as const,
        ...(t.kind === "creature" ? { health: Math.max(0, t.left) / (RIDE_HP[t.type] ?? 300) } : {}),
        tags: [
          ...(RIDES[t.type] ? [RIDES[t.type]!.on === "air" ? "flyer" : RIDES[t.type]!.on === "water" ? "boat" : t.kind === "vehicle" ? "car" : "mount", "rideable"] : []),
          ...(RIDES[t.type]?.attack ? ["fighter"] : []), ...(t.slots ? ["inventory"] : []),
          ...(t.id === this.me.mount ? ["ridden"] : []), ...(t.stamina !== undefined ? [`stamina ${Math.round(t.stamina)}`] : []),
        ],
      } : {}),
      ...(t.kind === "player" ? { disposition: t.hostile ? ("hostile" as const) : ("neutral" as const) } : {}),
      // A player's emote is what a look at them shows; an invite at the character, which way they reach.
      ...(t.kind === "player" && (t.emote || t.invite) ? { tags: [...(t.emote ? [`emote:${t.emote}`] : []), ...(t.invite && t.invite.until > this.t ? [`emote_to:${this.me.id}`, `invite:${t.invite.name}`] : [])] } : {}),
      ...(t.kind === "structure" ? { disposition: "own" as const, tags: t.piece?.open ? ["open"] : [] } : {}),
      ...(t.piece ? { base: t.piece.base } : {}),
      affords: this.affords(t),
    }));
    return { items, more: Math.max(0, seen.length - max) };
  }

  terrainChannel(radius = 16, cell = 1): TerrainChannel {
    const n = Math.floor(radius / cell) * 2 + 1;
    const ox = Math.round(this.me.x / cell) * cell - Math.floor(n / 2) * cell, oz = Math.round(this.me.z / cell) * cell - Math.floor(n / 2) * cell;
    const rows: string[] = [];
    for (let r = 0; r < n; r++) {
      let row = "";
      for (let c = 0; c < n; c++) {
        const x = ox + c * cell, z = oz + r * cell;
        let ch: string = this.terrain ? CHAR[this.terrain.at(x, z)]! : ".";
        for (const t of this.things.values()) {
          if (t.piece) {
            if (this.slab(t, x, z, cell / 2)) ch = "#";
            continue;
          }
          if (Math.hypot(t.x - x, t.z - z) > t.r + cell / 2 || !this.perceives(t)) continue;
          ch = t.type === "tree" ? "T" : t.type === "rock" ? "R" : t.type === "bush" ? "b" : t.kind === "creature" ? "c" : t.kind === "player" ? "P" : t.kind === "vehicle" ? "v" : "B";
        }
        if (Math.abs(x - this.me.x) < cell / 2 && Math.abs(z - this.me.z) < cell / 2) ch = "@";
        row += ch;
      }
      rows.push(row);
    }
    return {
      cell, origin: [ox, oz], size: [n, n], rows, heights: null,
      legend: { ...LEGEND, ".": "walkable", "#": "blocked", T: "tree", R: "rock", b: "bush", B: "container", c: "creature", P: "player", v: "vehicle", "@": "self" },
    };
  }

  /** The map screen: the whole map as drawn at the start (under fog, only what has been explored). */
  mapChannel(cell = 4): MapChannel | null {
    if (!this.terrain) return null;
    const m = this.terrain.map(cell);
    return { ...m, legend: LEGEND, known: this.terrain.fog ? "explored" : "full", ...(this.places.length ? { places: this.places } : {}) };
  }

  inventoryChannel(): InventoryChannel {
    const m = this.me;
    const craftable: Craftable[] = Object.entries(RECIPES).map(([item, r]) => ({
      item, needs: r.needs, seconds: r.seconds, at: null,
      can: Math.min(...Object.entries(r.needs).map(([i, n]) => Math.floor(this.count(i) / n))),
    }));
    const box = m.open ? this.things.get(m.open) : undefined;
    const kinded = (s: Slot) => ({ ...s, kind: kindOf(s.item) });
    return {
      slots: m.slots.map(kinded), capacity: CAPACITY.self!, weight: [Math.round(this.weight() * 10) / 10, CARRY],
      hotbar: Array.from({ length: 10 }, (_, i) => (i < m.slots.length ? i : null)),
      open: box ? { id: box.id, slots: (box.slots ?? []).map(kinded), capacity: this.capacityOf(box), ...(box.name ? { name: box.name } : {}) } : null,
      craftable,
      crafting: m.crafting.map((c) => ({ item: c.item, left: c.left, ready_in_s: Math.max(0, (c.ready - this.t) / 1000) })),
    };
  }

  focusChannel(): FocusChannel {
    const t = this.focusThing();
    const out: FocusChannel = t ? { target: t.id, distance: Math.max(0, Math.round((this.dist(t) - t.r) * 100) / 100), verbs: this.affords(t) } : { target: null };
    return out;
  }

  // --- Building ---------------------------------------------------------------------------------------------------

  /** Where the last foundation of the plan being built now will go, if it is still to go (for a scenario's surprise). */
  planAhead(): { x: number; z: number } | null {
    const r = this.running.get("hands");
    if (!r || r.action.control !== "plan") return null;
    const d = r.done as { at: number; to: number; base?: string };
    const plan = r.action.plan;
    const base = this.structures.baseOf(plan, this.things.values());
    if (!base) return null;
    for (let k = plan.pieces.length - 1; k > d.at; k--) {
      const p = plan.pieces[k]!;
      if (p.form === "foundation") return this.structures.place(base, { ...p, cell: [p.cell[0] + base.off[0], p.cell[1] + base.off[1]] });
    }
    return null;
  }

  private capacityOf(t: Thing): number {
    return CAPACITY[t.type] ?? (t.kind === "creature" ? CAPACITY.creature! : 30);
  }

  /** How many of an item the character can take on before it is over its carrying limit. */
  private roomFor(item: string): number {
    return Math.max(0, Math.floor((CARRY - this.weight()) / weightOf(item)));
  }

  /** "Transfer all", with a filter: every matching stack from one side to the other, as far as there is room. */
  private transfer(a: Extract<Action, { control: "items"; op: "transfer" }>, instant: (detail: Record<string, unknown>) => null): RejectCode | null {
    const box = this.me.open ? this.things.get(this.me.open) : undefined;
    if (!box || a.from === a.to) return box ? "bad_arguments" : "not_permitted";
    if (this.dist(box) - box.r > REACH + 1) return "out_of_reach";
    box.slots ??= [];
    const from = a.from === "self" ? this.me.slots : box.slots;
    const match = (item: string) => (!a.items || a.items.includes(item)) && (!a.kinds || a.kinds.includes(kindOf(item)));
    const moved: Record<string, number> = {};
    let reason: string | null = null;
    for (const item of [...new Set(from.map((x) => x.item))].filter(match)) {
      const have = from.filter((x) => x.item === item).reduce((n, x) => n + x.count, 0);
      let n = Math.max(0, have - (a.keep?.[item] ?? 0));
      if (a.to === "self") {
        const room = this.roomFor(item);
        if (room < n) (n = room), (reason = "weight");
        const slotsFree = CAPACITY.self! - this.me.slots.length;
        const fits = this.me.slots.filter((x) => x.item === item).reduce((k, x) => k + STACK(item) - x.count, 0) + slotsFree * STACK(item);
        if (fits < n) (n = fits), (reason = "full");
        if (n <= 0) continue;
        takeFrom(box.slots, item, n);
        this.give(item, n);
      } else {
        if (n <= 0) continue;
        const put = addTo(box.slots, item, n, this.capacityOf(box));
        if (put < n) reason = "full";
        if (put <= 0) continue;
        this.take(item, put, true);
        n = put;
      }
      moved[item] = n;
    }
    return instant({ moved, reason });
  }

  /** A base's standing pieces as a plan's pieces on its grid, each with its id and health. */
  private survey(plan: Plan): Record<string, unknown> {
    const base = this.structures.baseOf(plan, this.things.values());
    if (!base?.id) return { pieces: [], base: null };
    const pieces = [...this.things.values()].filter((t) => t.piece?.base === base.id).map((t) => {
      const p = t.piece!;
      const item = p.form === "thing" ? p.item! : `piece_${p.form === "doorframe" || p.form === "windowframe" ? "wall" : p.form}_${p.tier}`;
      return {
        form: p.form, item, cell: [p.cell[0] - base.off[0], p.cell[1] - base.off[1]], level: p.level, ...(p.side ? { side: p.side } : {}), ...(p.up ? { up: p.up } : {}),
        ...(p.half ? { half: p.half } : {}), ...(p.spot ? { spot: p.spot } : {}), id: t.id, health: Math.max(0, t.left) / (PIECE_HP[p.form === "thing" ? "thing" : p.form] ?? 1),
      };
    });
    // The base's grid: cell 0, 0 of the plan's anchor (a point on the grid moves it by whole cells), and its turns.
    let [ox, oz] = [base.off[0] * 3, base.off[1] * 3];
    for (let t = 0; t < base.turns; t++) [ox, oz] = [-oz, ox];
    return { pieces, base: base.id, frame: { at: [base.x + ox, base.z + oz], turns: base.turns } };
  }

  /** Takes pieces down: whole within the pickup window, else demolished for half of each ingredient. */
  private removePieces(ids: string[]): Record<string, unknown> {
    const removed: string[] = [], refused: Record<string, string> = {}, back: Record<string, number> = {};
    for (const id of ids) {
      const t = this.things.get(id);
      if (!t?.piece) {
        refused[id] = "not a piece of a base";
        continue;
      }
      const p = t.piece;
      const item = p.form === "thing" ? p.item! : `piece_${p.form === "doorframe" || p.form === "windowframe" ? "wall" : p.form}_${p.tier}`;
      if (this.t - p.at <= PICKUP_S * 1000) (this.give(item, 1), (back[item] = (back[item] ?? 0) + 1));
      else for (const [m, n] of Object.entries(PIECE_RECIPES[item]?.needs ?? {})) {
        const k = Math.floor(n / 2);
        if (k > 0) this.give(m, k), (back[m] = (back[m] ?? 0) + k);
      }
      this.things.delete(id);
      removed.push(id);
    }
    return { removed, refused, back };
  }

  /** What the build checks need of the world. */
  site() {
    return {
      terrain: this.terrain, bounds: this.terrain ? ([this.terrain.x0 + 2, this.terrain.z0 + 2, this.terrain.x0 + this.terrain.w - 2, this.terrain.z0 + this.terrain.h - 2] as [number, number, number, number]) : null,
      things: () => [...this.things.values()].map((t) => ({ ...t, kind: t.kind as string })),
      me: { id: this.me.id, x: this.me.x, y: this.me.y, z: this.me.z },
    };
  }

  /** Places one piece of a plan that has passed its check. */
  private put(base: { id: string; x: number; z: number; turns: number }, p: Plan["pieces"][number]): string {
    const tier = this.structures.tierOf(p.form, p.item)!;
    const at = this.structures.place(base, p);
    const piece: PieceAt = {
      form: p.form, tier, base: base.id, cell: p.cell, level: p.level, ...(p.side ? { side: p.side } : {}), ...(p.up ? { up: p.up } : {}),
      ...(p.half ? { half: p.half } : {}), ...(p.spot ? { spot: p.spot } : {}), ...(p.form === "thing" ? { item: p.item } : {}), yaw: at.yaw, y: at.y, at: this.t,
    };
    // A thing set down: a box or vault is a container to open; the rest stand where they are.
    if (p.form === "thing") {
      const t = THINGS[p.item]!;
      const id = this.place(t.container ? "container" : "structure", p.item, at.x, at.z, { r: t.r, blocks: t.blocks, left: PIECE_HP.thing!, piece, ...(t.container ? { slots: [] } : {}) });
      this.event("built", { id, form: p.form, item: p.item, base: base.id });
      return id;
    }
    const place = specOf(p.form)?.place;
    const id = this.place("structure", `${p.form}_${tier}`, at.x, at.z, {
      r: place === "floor" || place === "centre" ? 1.5 : place === "corner" ? 0.25 : 0.3,
      blocks: place === "edge" || place === "corner" || (place === "in_frame" && !!p.side), left: PIECE_HP[p.form] ?? 5000,
      piece,
    });
    this.event("built", { id, form: p.form, item: p.item, base: base.id });
    return id;
  }

  // --- Acting -----------------------------------------------------------------------------------------------------

  /** Takes one action of an act: null if it is accepted (its outcome comes later), else why not. */
  act(command: string, index: number, a: Action): RejectCode | null {
    if (!this.me.alive && a.control !== "chat" && a.control !== "stop") return "no_body";
    const hold = "duration_ms" in a ? a.duration_ms : "hold_ms" in a ? a.hold_ms : undefined;
    if (hold !== undefined && (hold < 0 || hold > MAX_HOLD)) return "too_long";
    const instant = (detail: Record<string, unknown> = {}) => {
      this.instants.push({ type: "outcome", command, index, status: "completed", detail });
      return null;
    };
    switch (a.control) {
      case "stop":
        for (const key of [...this.running.keys()]) this.end(key, "interrupted", { by: "stop" });
        this.me.emote = null;
        return instant();
      case "emote":
        return this.emote(command, index, a, instant);
      case "chat":
        this.said.push({ channel: a.channel, text: a.text, t: this.t });
        return instant();
      case "select": {
        if (a.slot < 0 || a.slot >= this.me.slots.length) return "missing_items";
        this.me.held = a.slot;
        return instant({ item: this.me.slots[a.slot]!.item });
      }
      case "items": {
        if (a.op === "transfer") return this.transfer(a, instant);
        const s = this.me.slots[a.slot];
        if (!s) return "missing_items";
        if (a.op === "consume") {
          if (s.item !== "berries") return "not_permitted";
          this.take("berries", 1);
          this.me.food = Math.min(100, this.me.food + 5);
          return instant();
        }
        if (a.op === "equip") {
          if (s.item !== "tek_suit") return "not_permitted";
          this.me.suit = !this.me.suit;
          return instant({ worn: this.me.suit });
        }
        if (a.op === "drop") {
          this.take(s.item, a.count ?? s.count);
          return instant();
        }
        // move between the character and the open box
        const box = this.me.open ? this.things.get(this.me.open) : undefined;
        if (!box) return "not_permitted";
        if (a.from === "open" && a.to === "self") {
          const b = box.slots![a.slot];
          if (!b) return "missing_items";
          const n = Math.min(a.count ?? b.count, b.count, this.roomFor(b.item));
          const item = b.item;
          takeFrom(box.slots!, item, n);
          this.give(item, n);
          return instant({ moved: n });
        }
        if (a.to === "open") {
          const n = Math.min(a.count ?? s.count, s.count);
          const item = s.item;
          this.take(item, n);
          box.slots!.push({ slot: box.slots!.length, item, count: n });
          return instant({ moved: n });
        }
        return "bad_arguments";
      }
      case "craft": {
        const r = RECIPES[a.item];
        if (!r || !(a.count >= 1)) return "bad_arguments";
        if (Object.entries(r.needs).some(([i, n]) => this.count(i) < n)) return "missing_items";
        const last = this.me.crafting.at(-1)?.ready ?? this.t;
        this.me.crafting.push({ item: a.item, left: a.count, ready: Math.max(last, this.t) + r.seconds * 1000, command, index });
        return null;
      }
      case "rotate":
        return "unknown_control";
      case "crouch":
        this.me.crouch = a.on;
        return instant({ on: a.on });
      case "assist": {
        if (a.kind === "repair") {
          if (!this.structures.bases.has(a.target)) return "unknown_target";
          if (this.running.has("hands")) this.end("hands", "interrupted", { by: "replaced" });
          this.running.set("hands", { command, index, action: a, started: this.t, until: Infinity, next: this.t, done: { repaired: 0, spent: {} } });
          return null;
        }
        const t = this.things.get(a.target);
        if (!t) return "unknown_target";
        if (!["aim", "attack", "harvest", "follow"].includes(a.kind)) return "bad_arguments";
        if (a.kind === "harvest" && t.kind !== "resource") return "not_permitted";
        if (a.kind === "attack" && t.kind !== "creature" && t.kind !== "player") return "not_permitted";
        if (!this.perceives(t)) return "out_of_reach";
        if (this.running.has("hands")) this.end("hands", "interrupted", { by: "replaced" });
        if (this.running.has("move")) this.end("move", "interrupted", { by: "replaced" });
        const until = a.until?.seconds ? this.t + Math.min(a.until.seconds, 120) * 1000 : Infinity;
        this.running.set("hands", { command, index, action: a, started: this.t, until, next: this.t, done: { swings: 0, hits: 0, damage: 0, shots: 0 } });
        return null;
      }
      case "plan": {
        if (!a.plan?.anchor || !Array.isArray(a.plan.pieces) || a.plan.pieces.length > BUILDING_MAX) return "bad_arguments";
        if (a.op === "upgrade") return "not_permitted";
        if (a.op === "survey") return instant(this.survey(a.plan));
        if (a.op === "remove") return instant(this.removePieces(a.ids ?? []));
        if (a.op === "check") {
          const { verdicts, base } = this.structures.check(this.site(), a.plan, false);
          // What is still to place, against the bag.
          const need: Record<string, number> = {};
          a.plan.pieces.forEach((p, k) => verdicts[k]!.status !== "built" && (need[p.item] = (need[p.item] ?? 0) + 1));
          return instant({ verdicts, base: base?.id || null, need, have: Object.fromEntries(Object.keys(need).map((i) => [i, this.count(i)])) });
        }
        if (this.running.has("hands")) this.end("hands", "interrupted", { by: "replaced" });
        const from = Math.max(0, a.from ?? 0), to = Math.min(a.plan.pieces.length - 1, a.to ?? a.plan.pieces.length - 1);
        this.running.set("hands", { command, index, action: a, started: this.t, until: Infinity, next: this.t, done: { from, at: from, to, placed: 0, ids: [] } });
        return null;
      }
      case "look":
      case "move":
      case "jump":
      case "use":
      case "interact": {
        if (a.control === "interact") {
          const t = this.things.get(a.target);
          if (!t) return "unknown_target";
          if (!this.affords(t).includes(a.verb)) return this.dist(t) - t.r > REACH ? "out_of_reach" : "not_permitted";
          if (a.verb === "dismount") {
            const spot = this.landing(t);
            if (!spot) return "not_permitted";
            this.releaseAll("mounted");
            this.me.mount = null;
            [this.me.x, this.me.z] = spot;
            this.event("dismounted", { mount: t.id });
            return instant();
          }
          if (this.focusThing()?.id !== t.id) return "out_of_reach";
          if (a.verb === "mount") {
            this.releaseAll("mounted");
            this.me.mount = t.id;
            this.me.x = t.x;
            this.me.z = t.z;
            this.event("mounted", { mount: t.id });
            return instant();
          }
          if (a.verb === "open" || a.verb === "close") {
            if (t.kind === "container" || t.slots) this.me.open = a.verb === "open" ? t.id : null;
            else if (t.piece) (t.piece.open = a.verb === "open"), (t.blocks = a.verb !== "open");
            return instant();
          }
        }
        const key = a.control === "use" || a.control === "interact" ? "hands" : a.control;
        // The client's own hands on the controls take over from an assist.
        if ((a.control === "move" || a.control === "look") && this.running.get("hands")?.action.control === "assist") this.end("hands", "interrupted", { by: "replaced" });
        if (this.running.has(key)) this.end(key, "interrupted", { by: "replaced" });
        const ms = hold ?? (a.control === "use" ? 300 : a.control === "jump" ? 100 : 0);
        this.running.set(key, { command, index, action: a, started: this.t, until: this.t + ms, next: this.t, done: {} });
        return null;
      }
    }
  }

  private end(key: string, status: "completed" | "interrupted" | "failed", extra: { by?: Interruption; code?: RejectCode | "blocked" } = {}): void {
    const r = this.running.get(key);
    if (!r) return;
    this.running.delete(key);
    if (key === "move") (this.me.vx = 0), (this.me.vz = 0);
    this.emit({ type: "outcome", command: r.command, index: r.index, status, ...extra, detail: r.done });
  }

  /** Tells the outcomes of the instant actions taken since the last flush. */
  flush(): void {
    for (const e of this.instants.splice(0)) this.emit(e);
  }

  /** Lets go of every control, as when a connection goes quiet. */
  releaseAll(by: Interruption): void {
    for (const key of [...this.running.keys()]) this.end(key, "interrupted", { by });
  }

  // --- The tick ---------------------------------------------------------------------------------------------------

  step(ticks = 1): void {
    for (let i = 0; i < ticks; i++) this.once();
  }

  private once(): void {
    this.tick++;
    const dt = TICK_MS / 1000, m = this.me;
    while (this.changes.length && this.changes[0]!.at <= this.t) this.terrain?.paint(this.changes.shift()!.feature);
    if (this.terrain && m.alive) {
      this.terrain.explore(m.x, m.z, 24);
      // Deep water: a swimmer tires, and drowns when it can swim no more.
      if (this.terrain.at(m.x, m.z) === DEEP && !m.mount) {
        m.stamina = Math.max(0, m.stamina - 3 * dt);
        if (m.stamina <= 0 && this.tick % 20 === 0) this.hurt(4, "water");
      }
    }
    if (m.alive) {
      this.turn(dt);
      this.walk(dt);
      this.hands();
      this.craft();
      m.food = Math.max(0, m.food - 0.01 * dt);
      m.water = Math.max(0, m.water - 0.02 * dt);
    }
    for (const t of this.things.values()) if (t.kind === "creature" && !t.tame) this.creature(t, dt);
    for (const t of this.things.values()) if (t.path && t.left > 0) this.walker(t, dt);
    for (const t of [...this.things.values()]) if (t.expires && this.t >= t.expires) this.things.delete(t.id);
    if (m.open) {
      const box = this.things.get(m.open);
      if (!box || this.dist(box) - box.r > REACH + 1.5) m.open = null;
    }
    this.fly(dt);
    // Where each creature and player has been this last second and a half: what a reaction lagging behind sees.
    for (const t of this.things.values()) {
      if (t.kind !== "creature" && t.kind !== "player") continue;
      const tr = this.trail.get(t.id) ?? [];
      tr.push([this.t, t.x, t.z]);
      if (tr.length > 30) tr.shift();
      this.trail.set(t.id, tr);
    }
    for (const key of [...this.running.keys()]) {
      const r = this.running.get(key)!;
      if (key !== "look" && this.t >= r.until) this.end(key, "completed");
    }
    this.emotes();
  }

  // --- Emotes -----------------------------------------------------------------------------------------------------

  private emote(command: string, index: number, a: Extract<Action, { control: "emote" }>, instant: (d?: Record<string, unknown>) => null): RejectCode | null {
    const m = this.me;
    if (a.stop) {
      if (this.running.has("emote")) this.end("emote", "interrupted", { by: "stop" });
      m.emote = null;
      return instant();
    }
    if (!m.alive || m.mount || m.y > 0.5) return "not_permitted";
    let name = a.name;
    if (a.join) {
      const t = this.things.get(a.join);
      if (!t?.emote || !EMOTE_SPEC.get(t.emote)?.group) return "unknown_target";
      if (this.dist(t) > JOIN_RANGE) return "out_of_reach";
      name = t.emote;
    }
    const spec = name ? EMOTE_SPEC.get(name) : undefined;
    if (!spec) return "bad_arguments";
    if (spec.mask === "full" && this.running.has("move")) return "not_permitted";
    if (spec.pair) {
      const t = a.target ? this.things.get(a.target) : undefined;
      if (!t || t.kind !== "player") return "unknown_target";
      if (this.dist(t) > INVITE_RANGE) return "out_of_reach";
      // The answer to the other's invite begins the pair; anything else asks them.
      const theirs = t.invite && t.invite.until > this.t ? t.invite.name : null;
      if (theirs && (theirs === spec.name || EMOTE_SPEC.get(theirs)?.pair?.with === spec.name)) {
        t.invite = undefined;
        this.pair(t, theirs, spec.name);
        return this.play(command, index, spec, a.seconds, t.name ?? t.id);
      }
      t.asked = { name: spec.name, at: this.t, until: this.t + INVITE_MS };
      return instant({ invited: t.id, name: spec.name });
    }
    return this.play(command, index, spec, a.seconds);
  }

  /** The character plays `spec`: a one-shot's outcome comes as it ends, a loop's at once. */
  private play(command: string, index: number, spec: EmoteSpec, seconds?: number, target?: string): null {
    const m = this.me;
    if (this.running.has("emote")) this.end("emote", "interrupted", { by: "replaced" });
    const until = spec.loop ? (seconds ? this.t + seconds * 1000 : Infinity) : this.t + (spec.seconds ?? 2) * 1000;
    m.emote = { name: spec.name, until, full: spec.mask === "full" };
    this.emoted.push({ who: m.name, name: spec.name, t: this.t, ...(target ? { target } : {}) });
    this.running.set("emote", { command, index, action: { control: "emote", name: spec.name }, started: this.t, until: spec.loop ? this.t : until, next: this.t, done: { name: spec.name } });
    return null;
  }

  /** A pair begun: the player plays its side, face to face with the character. */
  private pair(t: Thing, theirs: string, mine: string): void {
    t.emote = theirs;
    t.emoteUntil = this.t + (EMOTE_SPEC.get(theirs)?.seconds ?? 2) * 1000;
    this.me.yaw = yawTo(this.me.x, this.me.z, t.x, t.z);
    this.emoted.push({ who: t.name ?? t.id, name: theirs, t: this.t, target: this.me.name });
    this.event("emoted", { who: t.id, name: theirs, target: this.me.id, with: mine });
  }

  /** A player emotes (a scenario's script): at the character, a pair's emote is an invite. */
  playerEmote(id: string, name: string, atMe = false): void {
    const t = this.things.get(id);
    const spec = EMOTE_SPEC.get(name);
    if (!t || !spec) return;
    if (spec.pair && atMe) {
      t.invite = { name, until: this.t + INVITE_MS };
      this.event("invited", { from: t.id, name, with: spec.pair.with });
      return;
    }
    t.emote = name;
    t.emoteUntil = spec.loop ? Infinity : this.t + (spec.seconds ?? 2) * 1000;
    this.emoted.push({ who: t.name ?? t.id, name, t: this.t, ...(atMe ? { target: this.me.name } : {}) });
    this.event("emoted", { who: t.id, name, ...(atMe ? { target: this.me.id } : {}) });
  }

  /** Each tick: emotes run out, moving ends a whole-body one, a player who accepts answers the character's invite. */
  private emotes(): void {
    const m = this.me;
    if (m.emote && (this.t >= m.emote.until || (m.emote.full && (m.vx !== 0 || m.vz !== 0)) || !m.alive || m.mount)) {
      if (this.running.has("emote")) this.end("emote", this.t >= m.emote.until ? "completed" : "interrupted", { by: "replaced" });
      m.emote = null;
    }
    for (const t of this.things.values()) {
      if (t.emote && this.t >= (t.emoteUntil ?? Infinity)) (t.emote = undefined), (t.emoteUntil = undefined);
      if (t.invite && t.invite.until <= this.t) t.invite = undefined;
      if (!t.asked) continue;
      if (t.asked.until <= this.t) t.asked = undefined;
      else if (t.accepts && this.t - t.asked.at >= 1000 && this.dist(t) <= INVITE_RANGE) {
        const spec = EMOTE_SPEC.get(t.asked.name)!;
        t.asked = undefined;
        this.pair(t, spec.pair!.with, spec.name);
        m.emote = { name: spec.name, until: this.t + (spec.seconds ?? 2) * 1000, full: true };
        this.emoted.push({ who: m.name, name: spec.name, t: this.t, target: t.name ?? t.id });
      }
    }
  }

  private turn(dt: number): void {
    const r = this.running.get("look");
    if (!r || r.action.control !== "look") return;
    const a = r.action;
    if (r.done.yaw === undefined) {
      r.done.yaw = a.yaw ?? wrap(this.me.yaw + (a.yaw_delta ?? 0));
      r.done.pitch = a.pitch ?? Math.max(-1.4, Math.min(1.4, this.me.pitch + (a.pitch_delta ?? 0)));
    }
    const dy = wrap((r.done.yaw as number) - this.me.yaw), dp = (r.done.pitch as number) - this.me.pitch;
    const rate = this.me.mount ? (RIDES[this.things.get(this.me.mount)?.type ?? ""]?.turn ?? TURN) : TURN;
    this.me.yaw = wrap(this.me.yaw + Math.sign(dy) * Math.min(Math.abs(dy), rate * dt));
    this.me.pitch += Math.sign(dp) * Math.min(Math.abs(dp), PITCH_TURN * dt);
    if (Math.abs(wrap((r.done.yaw as number) - this.me.yaw)) < 1e-3 && Math.abs((r.done.pitch as number) - this.me.pitch) < 1e-3) this.end("look", "completed");
  }

  private walk(dt: number): void {
    const m = this.me;
    // Breath comes back standing or riding (a rider does not run); not while swimming.
    const rest = (rate: number) => this.terrain?.at(m.x, m.z) !== DEEP && (m.stamina = Math.min(100, m.stamina + rate * dt));
    if (m.mount) return void rest(5), this.ride(dt);
    // A tek suit takes off on jump with element to burn, and flies until it is down again.
    if (m.suit && (m.y > 0.3 || (this.running.has("jump") && this.count("element") > 0))) return this.ride(dt);
    const r = this.running.get("move");
    // An assist moves the body itself (and rests it when it stands).
    if (this.running.get("hands")?.action.control === "assist") return;
    if (!r || r.action.control !== "move") return void rest(6);
    const a = r.action;
    const [fx, fz] = this.forward();
    let vx = fx * a.forward + Math.cos(m.yaw) * a.strafe, vz = fz * a.forward + Math.sin(m.yaw) * a.strafe;
    const len = Math.hypot(vx, vz);
    if (len > 1) (vx /= len), (vz /= len);
    const ground = this.terrain?.at(m.x, m.z);
    const sprinting = !!a.sprint && m.stamina > 1 && a.forward > 0 && ground !== DEEP;
    const wading = ground === SHALLOW ? 0.6 : ground === DEEP ? 0.4 : 1;
    const speed = (sprinting ? SPRINT : WALK) * (this.weight() > CARRY ? 0.3 : 1) * wading;
    m.stamina = Math.max(0, Math.min(100, m.stamina + (sprinting ? -8 : 4) * dt));
    const nx = m.x + vx * speed * dt, nz = m.z + vz * speed * dt;
    const hit = this.collide(nx, nz);
    if (hit) {
      m.vx = 0;
      m.vz = 0;
      if (this.t - this.lastBlocked >= 1000) {
        this.lastBlocked = this.t;
        this.event("blocked", { by: hit, pos: [m.x, 0, m.z] });
      }
      return;
    }
    r.done.moved_m = ((r.done.moved_m as number) ?? 0) + Math.hypot(nx - m.x, nz - m.z);
    m.vx = vx * speed;
    m.vz = vz * speed;
    m.x = nx;
    m.z = nz;
  }

  /** A body on a mount or in a vehicle: the mount's speed and ground; a flyer's height. */
  private ride(dt: number): void {
    const m = this.me, mount = m.mount ? this.things.get(m.mount) : undefined;
    if (m.mount && !mount) return void (m.mount = null);
    const ride = mount ? RIDES[mount.type]! : SUIT;
    const air = ride.on === "air";
    // Height: jump held climbs, crouch comes down; a flyer out of stamina (or a suit out of element) comes down.
    if (air) {
      if (ride.tires && mount) {
        mount.stamina ??= 100;
        mount.stamina = Math.max(0, Math.min(100, mount.stamina + (m.y > 0.5 ? -ride.tires : 4) * dt));
      }
      if (!mount && m.y > 0.5 && (m.aloft += dt) >= SUIT_BURN_S) {
        m.aloft -= SUIT_BURN_S;
        this.take("element", 1, true);
      }
      const spent = mount ? ride.tires !== undefined && (mount.stamina ?? 100) <= 0 : this.count("element") <= 0;
      const up = this.running.get("jump") && !spent;
      const down = m.crouch || spent;
      const floor = this.terrain && [CLIFF].includes(this.terrain.at(m.x, m.z)) ? this.terrain.height(m.x, m.z) + 1 : 0;
      if (up) m.y = Math.min(CEILING, m.y + CLIMB * dt);
      else if (down) {
        const ground = this.terrain?.at(m.x, m.z);
        // A flyer settles on firm ground, and only hovers low over water.
        const lowest = ground === DEEP || ground === SHALLOW ? 1 : floor;
        m.y = Math.max(lowest, m.y - CLIMB * dt);
      }
    }
    const r = this.running.get("move");
    let vx = 0, vz = 0;
    if (r && r.action.control === "move") {
      const a = r.action;
      const [fx, fz] = this.forward();
      vx = fx * a.forward + (ride.on === "wheels" || ride.on === "water" ? 0 : Math.cos(m.yaw) * a.strafe);
      vz = fz * a.forward + (ride.on === "wheels" || ride.on === "water" ? 0 : Math.sin(m.yaw) * a.strafe);
      const len = Math.hypot(vx, vz);
      if (len > 1) (vx /= len), (vz /= len);
    }
    const ground = this.terrain?.at(m.x, m.z) ?? 0;
    let speed = ride.speed;
    if (air) speed = m.y > 2 ? ride.speed : 3;
    else if (ride.on === "wheels") speed = ground === 4 || ground === 5 ? (ride.road ?? ride.speed) : ground === SHALLOW ? ride.speed * 0.4 : ride.speed;
    else if (ride.on === "land") speed = ground === SHALLOW ? ride.speed * 0.7 : ground === DEEP ? ride.speed * 0.35 : ride.speed;
    else if (ride.on === "water" && ground === SHALLOW) speed = ride.speed * 0.7;
    const nx = m.x + vx * speed * dt, nz = m.z + vz * speed * dt;
    if (vx || vz) {
      const hit = this.rideCollide(nx, nz, ride);
      if (hit) {
        m.vx = m.vz = 0;
        if (this.t - this.lastBlocked >= 1000) {
          this.lastBlocked = this.t;
          this.event("blocked", { by: hit, pos: [m.x, m.y, m.z] });
        }
      } else {
        if (r) r.done.moved_m = ((r.done.moved_m as number) ?? 0) + Math.hypot(nx - m.x, nz - m.z);
        m.vx = vx * speed;
        m.vz = vz * speed;
        m.x = nx;
        m.z = nz;
      }
    }
    if (mount) (mount.x = m.x), (mount.z = m.z);
  }

  /** What stops a mount: cliffs it is below (or any, on the ground), and the wrong ground (water for wheels, land for a boat). */
  private rideCollide(x: number, z: number, ride: Ride): string | null {
    if (!this.terrain) return null;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4, px = x + Math.cos(a) * ride.radius, pz = z + Math.sin(a) * ride.radius;
      const k = this.terrain.at(px, pz);
      if (k === CLIFF && this.terrain.height(px, pz) >= this.me.y) return "terrain";
    }
    const k = this.terrain.at(x, z);
    if (ride.on === "wheels" && k === DEEP) return "water";
    if (ride.on === "water" && k !== DEEP && k !== SHALLOW) return "land";
    return null;
  }

  /** Where to step off a mount: firm ground beside it, or (a boat in deep water) the water. */
  private landing(t: Thing): [number, number] | null {
    for (const d of [2.5, 4, 6]) {
      for (let i = 0; i < 8; i++) {
        const a = this.me.yaw + Math.PI / 2 + (i * Math.PI) / 4;
        const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
        const k = this.terrain?.at(x, z) ?? 0;
        if (k !== CLIFF && k !== DEEP && !this.collide(x, z)) return [x, z];
      }
    }
    return RIDES[t.type]?.on === "water" ? [t.x, t.z] : null;
  }

  /** What would be in the way of the body at (x, z): an id, or null. */
  private collide(x: number, z: number): string | null {
    if (this.terrain) {
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        if (this.terrain.at(x + Math.cos(a) * BODY_R, z + Math.sin(a) * BODY_R) === CLIFF) return "terrain";
      }
    }
    for (const t of this.things.values()) {
      if (t.piece) {
        if (this.slab(t, x, z, BODY_R)) return t.id;
        continue;
      }
      if (t.blocks && Math.hypot(t.x - x, t.z - z) < t.r + BODY_R) return t.id;
    }
    return null;
  }

  /** Whether a point (with a body's radius about it) is in a piece standing on the ground storey: a wall, window or
   * closed door is a thin slab along its edge, 3 m wide; a doorframe two slabs with a gap; a pillar a post. */
  private slab(t: Thing, x: number, z: number, r: number): boolean {
    const p = t.piece!;
    if (p.level > 0 || (p.y > 0 && specOf(p.form)?.place !== "edge")) return false;
    // A thing set down: as big as it is, if it blocks.
    if (p.form === "thing") return t.blocks && Math.hypot(t.x - x, t.z - z) < t.r + r;
    const place = specOf(p.form)?.place;
    if (place === "corner") return Math.hypot(t.x - x, t.z - z) < t.r + r;
    // A frame leaves a gap (a doorway, a gateway, a behemoth's gateway nearly its whole width); what fills it, closed,
    // shuts it; anything else on an edge (a wall, a window, a railing, a fence) is a slab.
    const gap = p.form === "doorframe" ? 0.7 : p.form === "gateway" ? 1.2 : p.form === "behemoth_gateway" ? 1.4 : 0;
    const shut = place === "in_frame" && !!p.side && !p.open;
    if (!(place === "edge" || shut)) return false;
    const along = p.yaw === 0 ? x - t.x : z - t.z;
    const across = p.yaw === 0 ? Math.abs(z - t.z) : Math.abs(x - t.x);
    if (across >= 0.15 + r || Math.abs(along) >= 1.5 + r) return false;
    return gap === 0 || Math.abs(along) > gap - r;
  }

  private hands(): void {
    const r = this.running.get("hands");
    if (!r || r.next === undefined || this.t < r.next) return;
    const a = r.action;
    if (a.control === "plan") return this.building(r, a.plan);
    if (a.control === "assist") return this.assist(r, a);
    if (a.control === "interact") {
      const t = this.things.get(a.target);
      if (!t || this.focusThing()?.id !== t.id) return this.end("hands", "failed", { code: "out_of_reach" });
      r.next = this.t + PICK_MS;
      if (t.type === "bush" && t.left > 0) {
        t.left--;
        this.gain(r, "fiber", 4);
        if (t.left % 3 === 0) this.gain(r, "berries", 1);
        if (t.left <= 0) this.things.delete(t.id);
      }
      return;
    }
    if (a.control !== "use") return;
    const held = this.heldItem();
    // A bow: drawn, then loosed along the facing, once a press.
    if (held === "bow") {
      r.next = this.t;
      if (!r.done.shots && this.t - r.started >= BOW.draw_ms) {
        if (!this.take(BOW.ammo, 1, true)) return this.end("hands", "failed", { code: "missing_items" });
        this.loose(this.me.yaw, r.done);
        r.done.shots = 1;
      }
      return;
    }
    r.next = this.t + SWING_MS;
    const tool = TOOLS[held && held in TOOLS ? held : "hands"]!;
    const t = this.focusThing();
    r.done.swings = ((r.done.swings as number) ?? 0) + 1;
    if (!t) return;
    if (t.type === "tree" || t.type === "rock") {
      const [main, extra] = t.type === "tree" ? tool.tree : tool.rock;
      const got = Math.min(main, t.left);
      t.left -= got;
      this.gain(r, t.type === "tree" ? "wood" : "stone", got);
      if (extra) this.gain(r, t.type === "tree" ? "thatch" : "flint", extra);
      this.wear();
      if (t.left <= 0) {
        this.things.delete(t.id);
        this.event("notice", { text: `the ${t.type} is used up`, level: "info", id: t.id });
      }
    } else if (t.kind === "creature") {
      this.wear();
      this.strike(t, tool.hits, held ?? "hands");
    }
  }

  /** The build helper at work: the next piece of the plan, if it can go and is in the bag, at the helper's pace. */
  private building(r: Running, plan: Plan): void {
    const d = r.done as { from: number; at: number; to: number; placed: number; ids: string[]; base?: string };
    while (d.at <= d.to) {
      const k = d.at;
      // Laid at a point, the plan finds the base its first piece made (it is on that base's grid).
      const { verdicts, base } = this.structures.check(this.site(), { anchor: plan.anchor, pieces: plan.pieces.slice(0, k + 1) }, true);
      const v = verdicts[k]!;
      if (v.status === "built") {
        d.at++;
        continue;
      }
      if (v.status !== "ok") {
        Object.assign(d, { reason: v.status, ...(v.by ? { by: v.by } : {}) });
        return this.end("hands", "failed", { code: "blocked" });
      }
      const p = plan.pieces[k]!;
      if (!this.take(p.item, 1)) {
        Object.assign(d, { reason: "missing_items", item: p.item });
        return this.end("hands", "failed", { code: "missing_items" });
      }
      const on = base!.id ? base! : { ...this.structures.newBase(base!), off: [0, 0] as [number, number] };
      d.base = on.id;
      d.ids.push(this.put(on, { ...p, cell: [p.cell[0] + on.off[0], p.cell[1] + on.off[1]] }));
      d.placed++;
      d.at++;
      r.next = this.t + 1000 / BUILD_RATE;
      return;
    }
    this.end("hands", "completed");
  }

  // --- Assists: the hands done for the client, within a player's limits (grunt/protocol.md, "Assists") ------------

  /** Where a thing seems to be to an eye that lags a player's reaction behind: where it was then, carried on by how it
   * was moving then. A sudden turn fools it for that long, as it fools a player. */
  private lagged(t: Thing): { x: number; z: number; vx: number; vz: number } {
    const tr = this.trail.get(t.id);
    if (!tr || tr.length < 3) return { x: t.x, z: t.z, vx: t.vx ?? 0, vz: t.vz ?? 0 };
    const when = this.t - ASSIST.reaction_ms;
    let k = tr.length - 1;
    while (k > 1 && tr[k]![0] > when) k--;
    const [t1, x1, z1] = tr[k]!, [t0, x0, z0] = tr[Math.max(0, k - 4)]!;
    const span = Math.max(1, t1 - t0) / 1000;
    const vx = (x1 - x0) / span, vz = (z1 - z0) / span, ahead = (this.t - t1) / 1000;
    return { x: x1 + vx * ahead, z: z1 + vz * ahead, vx, vz };
  }

  /** Turns the body toward a yaw at its own rate (a mount's, if mounted). */
  private faceToward(yaw: number, dt: number): number {
    const m = this.me;
    const rate = m.mount ? (RIDES[this.things.get(m.mount)?.type ?? ""]?.turn ?? TURN) : TURN;
    const dy = wrap(yaw - m.yaw);
    m.yaw = wrap(m.yaw + Math.sign(dy) * Math.min(Math.abs(dy), rate * dt));
    return Math.abs(wrap(yaw - m.yaw));
  }

  /** One tick of running or walking along the facing, as the move control would: what stopped it, or null. */
  private stride(sprint: boolean, dt: number): string | null {
    const m = this.me;
    const mount = m.mount ? this.things.get(m.mount) : undefined;
    if (mount) {
      // Ridden: the mount's pace and its ground.
      const ride = RIDES[mount.type]!;
      const k = this.terrain?.at(m.x, m.z) ?? 0;
      const speed = k === SHALLOW ? ride.speed * 0.7 : k === DEEP ? ride.speed * 0.35 : ride.speed;
      const [fx, fz] = this.forward();
      const nx = m.x + fx * speed * dt, nz = m.z + fz * speed * dt;
      const hit = this.rideCollide(nx, nz, ride);
      if (hit) return (m.vx = m.vz = 0), hit;
      [m.x, m.z, m.vx, m.vz, mount.x, mount.z] = [nx, nz, fx * speed, fz * speed, nx, nz];
      return null;
    }
    const ground = this.terrain?.at(m.x, m.z);
    const sprinting = sprint && m.stamina > 1 && ground !== DEEP;
    const wading = ground === SHALLOW ? 0.6 : ground === DEEP ? 0.4 : 1;
    const speed = (sprinting ? SPRINT : WALK) * (this.weight() > CARRY ? 0.3 : 1) * wading;
    m.stamina = Math.max(0, Math.min(100, m.stamina + (sprinting ? -8 : 4) * dt));
    const [fx, fz] = this.forward();
    const nx = m.x + fx * speed * dt, nz = m.z + fz * speed * dt;
    const hit = this.collide(nx, nz);
    if (hit) return (m.vx = m.vz = 0), hit;
    [m.x, m.z, m.vx, m.vz] = [nx, nz, fx * speed, fz * speed];
    return null;
  }

  /** A mount bitten: hurt, and its rider thrown when it falls. */
  private strikeMount(mount: Thing, damage: number, by: string): void {
    mount.left -= damage;
    this.event("hurt", { amount: damage, health: this.me.health, by, kind: "melee", mount: mount.id, mount_health: Math.max(0, mount.left) / (RIDE_HP[mount.type] ?? 300) });
    if (mount.left <= 0) {
      this.me.mount = null;
      this.me.y = 0;
      this.things.delete(mount.id);
      this.event("dismounted", { mount: mount.id, reason: "it died" });
      this.event("notice", { text: `your ${mount.type} is dead`, level: "warning", id: mount.id });
    }
  }

  /** A player walking its way: point to point at its pace, from when it sets off; it waits for no one. */
  private walker(t: Thing, dt: number): void {
    if (this.t < (t.departs ?? 0) || !t.path?.length) return void (t.vx = t.vz = 0);
    const [tx, tz] = t.path[0]!;
    const d = Math.hypot(tx - t.x, tz - t.z), step = (t.pace ?? 3) * dt;
    if (d <= step) {
      [t.x, t.z] = [tx, tz];
      t.path.shift();
    } else (t.x += ((tx - t.x) / d) * step), (t.z += ((tz - t.z) / d) * step);
    [t.vx, t.vz] = [d > step ? ((tx - t.x) / d) * (t.pace ?? 3) : 0, d > step ? ((tz - t.z) / d) * (t.pace ?? 3) : 0];
  }

  /** A blow or an arrow landing on a creature: it is hurt, angry, and dead at nothing left. */
  private strike(t: Thing, damage: number, weapon: string, tally?: Record<string, unknown>): void {
    t.left -= damage;
    t.hunting = true;
    t.angry = this.t + 30_000;
    this.event("struck", { target: t.id, damage, weapon, health: Math.max(0, t.left) / RAPTOR.hp });
    if (tally) (tally.hits = Number(tally.hits ?? 0) + 1), (tally.damage = Number(tally.damage ?? 0) + damage);
    if (t.left <= 0) {
      if (tally) tally.killed = true;
      this.things.delete(t.id);
      this.trail.delete(t.id);
      this.event("notice", { text: `the ${t.type} is dead`, level: "info", id: t.id });
      // What it leaves: a body to loot, for ten minutes.
      const slots: Slot[] = [];
      addTo(slots, "meat", 4 + Math.floor(this.random() * 4), CAPACITY.corpse!);
      addTo(slots, "hide", 3 + Math.floor(this.random() * 3), CAPACITY.corpse!);
      this.place("container", "corpse", t.x, t.z, { name: `${t.type} body`, slots, expires: this.t + 600_000 });
    }
  }

  /** Looses an arrow along a yaw. */
  private loose(yaw: number, tally?: Record<string, unknown>): void {
    const [fx, fz] = [Math.sin(yaw), -Math.cos(yaw)];
    this.arrows.push({ x: this.me.x + fx * 0.5, z: this.me.z + fz * 0.5, vx: fx * BOW.speed, vz: fz * BOW.speed, left: BOW.range, ...(tally ? { tally } : {}) });
    if (tally) tally.shots = Number(tally.shots ?? 0) + 1;
  }

  /** Arrows fly: each lands in the first body it passes within reach of, or stops on what blocks it. */
  private fly(dt: number): void {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i]!;
      const n = 4;
      let done = false;
      for (let s = 1; s <= n && !done; s++) {
        const x = a.x + (a.vx * dt * s) / n, z = a.z + (a.vz * dt * s) / n;
        for (const t of this.things.values()) {
          const body = (t.kind === "creature" && !t.tame) || t.kind === "player";
          if (body && Math.hypot(t.x - x, t.z - z) < t.r + 0.15) {
            this.strike(t, BOW.damage, "bow", a.tally);
            done = true;
            break;
          }
          if (!body && (t.piece ? this.slab(t, x, z, 0.05) : t.blocks && Math.hypot(t.x - x, t.z - z) < t.r)) done = true;
        }
        if (this.terrain && this.terrain.at(x, z) === CLIFF && this.terrain.height(x, z) > 1.5) done = true;
      }
      a.x += a.vx * dt;
      a.z += a.vz * dt;
      a.left -= BOW.speed * dt;
      if (done || a.left <= 0) this.arrows.splice(i, 1);
    }
  }

  /** An assist at work, a tick at a time: aim tracks a target; attack closes in and strikes at the weapon's pace (a bow
   * keeps its range, leads, and looses with a good player's spread); harvest swings at a tool's pace until the thing is
   * gone. Ends at its `until`, or when the target is gone, lost from sight, or out of reach. */
  private assist(r: Running, a: Extract<Action, { control: "assist" }>): void {
    const m = this.me, d = r.done, dt = TICK_MS / 1000;
    r.next = this.t;
    const u = a.until ?? {};
    const finish = (status: "completed" | "failed", result: string, extra: Record<string, unknown> = {}) => {
      Object.assign(d, { result, ...extra });
      m.vx = m.vz = 0;
      this.end("hands", status, status === "failed" ? { code: result === "ammo" ? "missing_items" : "blocked" } : {});
    };
    if (a.kind === "repair") return this.repair(r, a.target, finish);
    const t = this.things.get(a.target);
    if (!t) return finish("completed", d.killed ? "killed" : "gone");
    const mount = m.mount ? this.things.get(m.mount) : undefined;
    if (u.mount_health_below !== undefined && mount && mount.left / (RIDE_HP[mount.type] ?? 300) < u.mount_health_below) return finish("completed", "mount_health");
    if (u.health_below !== undefined && m.health / 100 < u.health_below) return finish("completed", "health");
    if (u.stamina_below !== undefined && m.stamina / 100 < u.stamina_below) return finish("completed", "stamina");
    if (a.kind === "harvest" && this.weight() > CARRY) return finish("completed", "weight");
    if (u.count !== undefined) {
      const got = Object.values((d.gained as Record<string, number> | undefined) ?? {})[0] ?? 0;
      if (got >= u.count) return finish("completed", "count");
    }
    if (!this.perceives(t)) {
      d.unseen_ms = Number(d.unseen_ms ?? 0) + TICK_MS;
      if (Number(d.unseen_ms) > 1500) return finish("failed", "lost");
    } else d.unseen_ms = 0;
    const seen = this.lagged(t);
    const dist = Math.hypot(seen.x - m.x, seen.z - m.z);
    const toward = yawTo(m.x, m.z, seen.x, seen.z);
    let moved = false;
    const rest = () => !moved && this.terrain?.at(m.x, m.z) !== DEEP && (m.stamina = Math.min(100, m.stamina + 6 * dt));
    const run = (yaw: number, sprint: boolean) => {
      if (this.faceToward(yaw, dt) > 0.6) return;
      moved = true;
      const hit = this.stride(sprint, dt);
      d.stuck_ms = hit ? Number(d.stuck_ms ?? 0) + TICK_MS : 0;
      if (Number(d.stuck_ms) > 1500) finish("failed", "obstructed", { by: hit });
    };
    if (a.kind === "follow") return this.follow(r, a, t, seen, dist);
    if (a.kind === "aim") {
      const bow = this.heldItem() === "bow";
      this.faceToward(bow ? this.lead(seen) : toward, dt);
      return void rest();
    }
    if (a.kind === "attack" && this.heldItem() === "bow") {
      if (this.count(BOW.ammo) <= 0) return finish("failed", "ammo");
      const [near, far] = a.range ?? [8, 35];
      // Too close: turn and run until well clear (a bow is no use at a raptor's teeth), then turn and shoot again.
      if (dist < near || (d.kiting && dist < near + 6 && m.stamina > 5)) {
        d.kiting = true;
        d.draw_at = undefined;
        run(yawTo(seen.x, seen.z, m.x, m.z), true);
        return void rest();
      }
      d.kiting = false;
      if (dist > far) {
        d.draw_at = undefined;
        run(toward, false);
        return void rest();
      }
      // Lead it, with the error of a good player's hand, larger the faster it crosses the line.
      if (d.draw_at === undefined) {
        const crossing = Math.abs(Math.sin(toward) * seen.vz + Math.cos(toward) * seen.vx);
        d.err = (this.random() * 2 - 1) * ((ASSIST.spread_deg * Math.PI) / 180) * (1 + crossing / 3);
      }
      const off = this.faceToward(this.lead(seen) + Number(d.err ?? 0), dt);
      if (d.draw_at === undefined) {
        if (off < 0.4) d.draw_at = this.t;
      } else if (this.t - Number(d.draw_at) >= BOW.draw_ms && off < 0.02) {
        this.take(BOW.ammo, 1, true);
        this.loose(m.yaw, d);
        d.draw_at = undefined;
      }
      return void rest();
    }
    // Hands (or a fighting mount's jaws): close in, face it, strike at the weapon's own pace.
    const bush = t.type === "bush";
    const jaws = m.mount && a.kind === "attack" ? RIDES[this.things.get(m.mount)?.type ?? ""]?.attack : undefined;
    if (m.mount && a.kind === "attack" && !jaws) return finish("failed", "unarmed_mount");
    if (jaws) {
      if (dist > jaws.reach + t.r - 0.3) {
        run(toward, true);
        return void rest();
      }
      const off = this.faceToward(toward, dt);
      if (off > 0.35 || this.t < Number(d.ready ?? 0)) return void rest();
      d.ready = this.t + jaws.every_ms;
      d.swings = Number(d.swings) + 1;
      return this.strike(t, jaws.damage, this.things.get(m.mount!)!.type, d);
    }
    if (dist > REACH + t.r - 0.4) {
      if (a.kind === "harvest" && dist > 20) return finish("failed", "out_of_reach");
      run(toward, a.kind === "attack" && m.stamina > 15);
      return void rest();
    }
    m.vx = m.vz = 0;
    const off = this.faceToward(toward, dt);
    rest();
    if (off > 0.25 || this.t < Number(d.ready ?? 0)) return;
    d.ready = this.t + (bush ? PICK_MS : SWING_MS);
    // Never a blow at what it is not after: something else under the crosshair (a tree between) stops it.
    const f = this.focusThing();
    // In the way is what stands there (a tree, a rock, a body that lives); a body lying on the ground is not.
    if (f && f.id !== t.id && (f.blocks || f.kind === "creature" || f.kind === "player")) {
      d.wrong = Number(d.wrong ?? 0) + 1;
      if (Number(d.wrong) >= 3) finish("failed", "obstructed", { by: f?.id ?? null });
      return;
    }
    d.wrong = 0;
    d.swings = Number(d.swings) + 1;
    if (a.kind === "attack") {
      const held = this.heldItem();
      this.wear();
      return this.strike(t, TOOLS[held && held in TOOLS ? held : "hands"]!.hits, held ?? "hands", d);
    }
    if (bush) {
      t.left--;
      this.gain(r, "fiber", 4);
      if (t.left % 3 === 0) this.gain(r, "berries", 1);
      if (t.left <= 0) this.things.delete(t.id);
      return;
    }
    const held = this.heldItem();
    const tool = TOOLS[held && held in TOOLS ? held : "hands"]!;
    const [main, extra] = t.type === "tree" ? tool.tree : tool.rock;
    const got = Math.min(main, t.left);
    t.left -= got;
    this.gain(r, t.type === "tree" ? "wood" : "stone", got);
    if (extra) this.gain(r, t.type === "tree" ? "thatch" : "flint", extra);
    this.wear();
    if (t.left <= 0) {
      this.things.delete(t.id);
      this.event("notice", { text: `the ${t.type} is used up`, level: "info", id: t.id });
    }
  }

  /** Following: keeping to a spot near the target (behind it and to a side, the spot changing now and then), walking
   * or running as the gap asks; waiting, it glances at what is about, the target most, and shifts its feet, as a
   * person waiting does. Ends when the target is lost from sight, or at `until.seconds`. */
  private follow(r: Running, a: Extract<Action, { control: "assist" }>, t: Thing, seen: { x: number; z: number; vx: number; vz: number }, dist: number): void {
    const m = this.me, d = r.done, dt = TICK_MS / 1000;
    const [near, far] = a.range ?? [2.5, 6];
    const natural = a.natural !== false;
    // The spot: behind the way it is going (or on this side of it, standing), off to one side, re-chosen now and then.
    if (d.spot_at === undefined || this.t >= Number(d.spot_at)) {
      d.spot_at = this.t + (natural ? 6000 + this.random() * 6000 : 1e9);
      d.side = natural ? (this.random() < 0.5 ? -1 : 1) * (0.3 + this.random() * 0.6) : 0;
      d.gap = near + (far - near) * (natural ? 0.3 + this.random() * 0.5 : 0.5);
    }
    const moving = Math.hypot(seen.vx, seen.vz) > 0.3;
    const back = moving ? Math.atan2(-seen.vx, seen.vz) : yawTo(seen.x, seen.z, m.x, m.z);
    const a2 = back + Number(d.side);
    const spot = [seen.x + Math.sin(a2) * Number(d.gap), seen.z - Math.cos(a2) * Number(d.gap)] as const;
    const gap = Math.hypot(spot[0] - m.x, spot[1] - m.z);
    if (dist > far || gap > 2.5) {
      // Going: a little wander in the line while walking, a run when far behind or the target is quick.
      const wobble = natural ? Math.sin(this.t / 700 + Number(d.side) * 5) * 0.08 : 0;
      const sprint = dist > far + 8 || Math.hypot(seen.vx, seen.vz) > WALK + 0.2;
      if (this.faceToward(yawTo(m.x, m.z, spot[0], spot[1]) + wobble, dt) < 0.6) {
        const hit = this.stride(sprint, dt);
        d.stuck_ms = hit ? Number(d.stuck_ms ?? 0) + TICK_MS : 0;
        if (Number(d.stuck_ms) > 2500) {
          Object.assign(d, { result: "obstructed", by: hit });
          return this.end("hands", "failed", { code: "blocked" });
        }
      }
      d.idle_at = this.t + 800;
      return;
    }
    m.vx = m.vz = 0;
    m.stamina = Math.min(100, m.stamina + 6 * dt);
    if (!natural) return void this.faceToward(yawTo(m.x, m.z, seen.x, seen.z), dt);
    // Waiting: now and then a glance (the target most often, else something about), now and then a step.
    if (this.t >= Number(d.idle_at ?? 0)) {
      d.idle_at = this.t + 1500 + this.random() * 4000;
      const roll = this.random();
      const about = [...this.things.values()].filter((o) => o.id !== t.id && !o.piece && this.dist(o) < 25 && this.perceives(o));
      if (roll < 0.5 || !about.length) d.look = yawTo(m.x, m.z, seen.x, seen.z);
      else if (roll < 0.85) {
        const o = about[Math.floor(this.random() * about.length)]!;
        d.look = yawTo(m.x, m.z, o.x, o.z);
      } else d.shuffle = this.t + 400 + this.random() * 400;
      d.glances = Number(d.glances ?? 0) + 1;
    }
    if (Number(d.shuffle ?? 0) > this.t) this.stride(false, dt);
    else if (d.look !== undefined) this.faceToward(Number(d.look), dt * 0.6);
  }

  /** Repairing a base: its damaged pieces within reach, one after another at the assist's pace, each for half its
   * recipe in the share of health it lacks. Done when none within reach is damaged; stopped, saying what it needs, when
   * the bag runs short. */
  private repair(r: Running, base: string, finish: (status: "completed" | "failed", result: string, extra?: Record<string, unknown>) => void): void {
    const d = r.done, m = this.me;
    if (this.t < Number(d.ready ?? 0)) return;
    const hurt = [...this.things.values()].filter((t) => t.piece?.base === base && t.left < PIECE_HP[t.piece.form]!);
    const near = hurt.filter((t) => Math.hypot(t.x - m.x, t.z - m.z, t.piece!.y - m.y) <= BUILD_REACH);
    if (!near.length) return finish("completed", hurt.length ? "out_of_reach" : "whole", { left: hurt.length });
    const t = near.sort((a, b) => this.dist(a) - this.dist(b))[0]!;
    const p = t.piece!;
    const share = 1 - t.left / PIECE_HP[p.form]!;
    const recipe = PIECE_RECIPES[`piece_${p.form === "doorframe" || p.form === "windowframe" ? "wall" : p.form}_${p.tier}`]!;
    const cost = Object.fromEntries(Object.entries(recipe.needs).map(([i, n]) => [i, Math.max(1, Math.ceil(n * share * 0.5))]));
    const short = Object.entries(cost).filter(([i, n]) => this.count(i) < n);
    if (short.length) return finish("failed", "materials", { need: cost, piece: t.id });
    const spent = d.spent as Record<string, number>;
    for (const [i, n] of Object.entries(cost)) this.take(i, n, true), (spent[i] = (spent[i] ?? 0) + n);
    t.left = PIECE_HP[p.form]!;
    d.repaired = Number(d.repaired) + 1;
    d.ready = this.t + 1000 / REPAIR_RATE;
    this.event("repaired", { id: t.id, base, form: p.form });
  }

  /** Whether every structure piece is whole. */
  wholeStructures(): boolean {
    return [...this.things.values()].every((t) => !t.piece || t.left >= PIECE_HP[t.piece.form]!);
  }

  /** Raises a plan whole at once, as it would stand had it been built (a scene's base already standing). */
  raise(plan: Plan): string | null {
    const { verdicts, base } = this.structures.check(this.site(), plan, false);
    if (!base) return null;
    const on = base.id ? base : { ...this.structures.newBase(base), off: [0, 0] as [number, number] };
    plan.pieces.forEach((p, k) => {
      const v = verdicts[k]!;
      if (v.status === "ok" || (v.status === "blocked" && v.by === this.me.id)) this.put(on, { ...p, cell: [p.cell[0] + on.off[0], p.cell[1] + on.off[1]] });
    });
    return on.id;
  }

  /** Damage to structures about a point (a storm, a raid): each piece within the radius loses health. */
  damage(x: number, z: number, radius: number, amount: number): void {
    for (const t of [...this.things.values()]) {
      if (!t.piece || Math.hypot(t.x - x, t.z - z) > radius) continue;
      t.left -= amount;
      this.event("damaged", { id: t.id, base: t.piece.base, form: t.piece.form, pos: [t.x, t.piece.y, t.z], health: Math.max(0, t.left) / PIECE_HP[t.piece.form]! });
      if (t.left <= 0) this.things.delete(t.id);
    }
  }

  /** The yaw that leads a target moving as it seems to, for an arrow's flight. */
  private lead(seen: { x: number; z: number; vx: number; vz: number }): number {
    const m = this.me;
    let time = Math.hypot(seen.x - m.x, seen.z - m.z) / BOW.speed;
    for (let i = 0; i < 4; i++) time = Math.hypot(seen.x + seen.vx * time - m.x, seen.z + seen.vz * time - m.z) / BOW.speed;
    return yawTo(m.x, m.z, seen.x + seen.vx * time, seen.z + seen.vz * time);
  }

  private gain(r: Running, item: string, n: number): void {
    if (n <= 0) return;
    this.give(item, n, false);
    const got = (r.done.gained as Record<string, number> | undefined) ?? {};
    got[item] = (got[item] ?? 0) + n;
    r.done.gained = got;
  }

  private wear(): void {
    const s = this.me.held === null ? undefined : this.me.slots[this.me.held];
    if (!s?.uses) return;
    s.uses = [s.uses[0] - 1, s.uses[1]];
    if (s.uses[0] <= 0) {
      this.event("notice", { text: `the ${s.item} broke`, level: "warning" });
      s.count = 0;
      this.compact();
      this.me.held = null;
    }
  }

  private craft(): void {
    const job = this.me.crafting[0];
    if (!job || this.t < job.ready) return;
    const r = RECIPES[job.item]!;
    if (Object.entries(r.needs).some(([i, n]) => this.count(i) < n)) {
      this.me.crafting.shift();
      this.emit({ type: "outcome", command: job.command, index: job.index, status: "failed", code: "missing_items" });
      return;
    }
    for (const [i, n] of Object.entries(r.needs)) this.take(i, n, true);
    this.give(job.item, 1, true);
    this.event("crafted", { item: job.item, count: 1 });
    job.left--;
    if (job.left > 0) job.ready = this.t + r.seconds * 1000;
    else {
      this.me.crafting.shift();
      this.emit({ type: "outcome", command: job.command, index: job.index, status: "completed", detail: { made: job.item } });
    }
  }

  private creature(t: Thing, dt: number): void {
    const m = this.me, d = Math.hypot(t.x - m.x, t.z - m.z);
    const angry = (t.angry ?? 0) > this.t && d < 90;
    // Its prey: the character, or a player nearer it (the character's anger keeps it on the character).
    let prey: Thing | null = null, pd = angry ? Infinity : d;
    if (!angry) for (const o of this.things.values()) {
      if (o.kind !== "player" || o.left <= 0 || o.hostile) continue;
      const od = Math.hypot(o.x - t.x, o.z - t.z);
      if (od < pd && od < RAPTOR.sees) (prey = o), (pd = od);
    }
    if (prey) t.hunting = true;
    else {
      if (m.alive && (d < RAPTOR.sees || angry)) t.hunting = true;
      if (!m.alive || (d > RAPTOR.gives_up && !angry)) t.hunting = false;
    }
    let tx: number, tz: number, speed: number;
    if (t.hunting && prey) {
      [tx, tz, speed] = [prey.x, prey.z, RAPTOR.speed];
      if (pd <= RAPTOR.reach && this.t >= (t.biteAt ?? 0)) {
        t.biteAt = this.t + RAPTOR.every_ms;
        prey.left -= RAPTOR.bite;
        this.event("notice", { text: `${prey.name ?? prey.id} is bitten by a ${t.type}`, level: "warning", id: prey.id });
        if (prey.left <= 0) this.event("notice", { text: `${prey.name ?? prey.id} is dead`, level: "warning", id: prey.id });
      }
    } else if (t.hunting) {
      [tx, tz, speed] = [m.x, m.z, RAPTOR.speed];
      if (d <= RAPTOR.reach && m.y < 3 && this.t >= (t.biteAt ?? 0)) {
        t.biteAt = this.t + RAPTOR.every_ms;
        // A mount takes the bites meant for its rider.
        const mount = m.mount ? this.things.get(m.mount) : undefined;
        if (mount && mount.kind === "creature") this.strikeMount(mount, RAPTOR.bite, t.id);
        else this.hurt(RAPTOR.bite, t.id);
      }
    } else {
      const home = (t.home ??= [t.x, t.z]);
      if (!t.goal || Math.hypot(t.goal[0] - t.x, t.goal[1] - t.z) < 0.5) {
        const a = this.random() * 2 * Math.PI, rr = this.random() * 8;
        t.goal = [home[0] + Math.cos(a) * rr, home[1] + Math.sin(a) * rr];
      }
      [tx, tz, speed] = [t.goal[0], t.goal[1], RAPTOR.wander];
    }
    const dd = Math.hypot(tx - t.x, tz - t.z);
    const [x0, z0] = [t.x, t.z];
    if (dd > (t.hunting ? RAPTOR.reach * 0.8 : 0.1)) {
      t.x += ((tx - t.x) / dd) * Math.min(dd, speed * dt);
      t.z += ((tz - t.z) / dd) * Math.min(dd, speed * dt);
    }
    [t.vx, t.vz] = [(t.x - x0) / dt, (t.z - z0) / dt];
    // Heard, not seen: its steps and calls, once every two seconds while it is within 25 m.
    if (m.alive && !this.perceives(t) && d < 25 && this.t - (this.lastHeard.get(t.id) ?? -1e9) >= 2000) {
      this.lastHeard.set(t.id, this.t);
      this.event("heard", { kind: "creature", bearing: this.bearing(t.x, t.z), loudness: Math.round((1 - d / 25) * 100) / 100, what: t.type });
    }
  }

  private hurt(amount: number, by: string): void {
    const m = this.me;
    m.health = Math.max(0, m.health - amount);
    const t = this.things.get(by);
    this.event("hurt", { amount, health: m.health, by: t && this.perceives(t) ? by : null, kind: t ? "melee" : by === "water" ? "drown" : "other" });
    if (m.health <= 0) {
      m.alive = false;
      this.releaseAll("died");
      this.event("died", { by, pos: [m.x, 0, m.z] });
    }
  }
}
