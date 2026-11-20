// The mock world: a small game that speaks the grunt protocol (grunt/protocol.md) so grunt can be built and tested
// without SNARK. It is deterministic and stepped by hand (`step`), 20 ticks a second, on flat ground: x east, z south,
// y up. It holds one character and holds it to a player's limits: it perceives what is near or in front of it, it
// must face a thing to act on it, its body turns and walks at a body's speed, and trees, rocks and walls are in the way.
//
// What there is: trees, rocks and bushes to gather from, a chest, other players (who only talk), a raptor that hunts,
// recipes for tools and a wood hut, and pieces that snap to each other as a player's preview does. It is a test bench,
// not a game: numbers are round, and only what grunt's skills need is here.

import type {
  Action, Craftable, EntitiesChannel, Entity, EntityKind, FocusChannel, InventoryChannel, Interruption, Placement,
  PlacementRefusal, RejectCode, SelfChannel, Slot, TerrainChannel,
} from "../../grunt/protocol.ts";

export const TICK_MS = 50;
const WALK = 3.5, SPRINT = 6, TURN = 6, PITCH_TURN = 3, BODY_R = 0.4, REACH = 2.5, SIGHT = 60, NEAR = 12;
const FOV = Math.PI / 3, SWING_MS = 600, PICK_MS = 500, CELL = 3, MAX_HOLD = 2000;
const RAPTOR = { sees: 20, gives_up: 30, speed: 4.5, wander: 1.2, bite: 8, every_ms: 1000, reach: 1.6, hp: 60 };

// --- Items and recipes --------------------------------------------------------------------------------------------

const WEIGHT: Record<string, number> = {
  wood: 0.5, thatch: 0.1, fiber: 0.1, stone: 1, flint: 0.05, berries: 0.1,
  stone_hatchet: 1, stone_pick: 1, wood_foundation: 4, wood_wall: 3, wood_doorframe: 3, wood_door: 2, wood_ceiling: 3,
};
const TOOLS: Record<string, { uses: number; tree: [number, number]; rock: [number, number]; hits: number }> = {
  // [main yield, thatch or flint] per swing, and the damage a swing does to a creature.
  hands: { uses: 0, tree: [1, 1], rock: [1, 0], hits: 4 },
  stone_hatchet: { uses: 100, tree: [3, 1], rock: [1, 0], hits: 10 },
  stone_pick: { uses: 100, tree: [1, 2], rock: [2, 1], hits: 12 },
};
export const PIECES = ["wood_foundation", "wood_wall", "wood_doorframe", "wood_door", "wood_ceiling"] as const;
export type Piece = (typeof PIECES)[number];
export const RECIPES: Record<string, { needs: Record<string, number>; seconds: number }> = {
  stone_hatchet: { needs: { wood: 1, flint: 1, stone: 1, thatch: 10 }, seconds: 1 },
  stone_pick: { needs: { wood: 1, stone: 1, thatch: 10 }, seconds: 1 },
  wood_foundation: { needs: { wood: 25, thatch: 6, fiber: 4 }, seconds: 1.5 },
  wood_wall: { needs: { wood: 15, thatch: 4, fiber: 2 }, seconds: 1.5 },
  wood_doorframe: { needs: { wood: 12, thatch: 3, fiber: 2 }, seconds: 1.5 },
  wood_door: { needs: { wood: 8, thatch: 2 }, seconds: 1 },
  wood_ceiling: { needs: { wood: 18, thatch: 4, fiber: 2 }, seconds: 1.5 },
};
const STACK = (item: string) => (item in TOOLS ? 1 : (PIECES as readonly string[]).includes(item) ? 20 : 100);
const isPiece = (item: string | undefined): item is Piece => !!item && (PIECES as readonly string[]).includes(item);

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
  // A creature's mind.
  hunting?: boolean;
  home?: [number, number];
  goal?: [number, number];
  biteAt?: number;
  // A container's slots; a structure's place.
  slots?: Slot[];
  piece?: { yaw: number; y: number; cell: string; edge?: string; open?: boolean };
}

interface Running {
  command: string;
  index: number;
  action: Action;
  started: number;
  until: number;
  next?: number;
  done: Record<string, unknown>;
}

export type WorldEvent =
  | { type: "event"; kind: string; data: Record<string, unknown> }
  | { type: "outcome"; command: string; index: number; status: "completed" | "interrupted" | "failed";
      by?: Interruption; code?: RejectCode | "blocked"; detail?: Record<string, unknown> };

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
  readonly me = {
    id: "e:1", name: "Scout", alive: true, x: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0,
    health: 100, stamina: 100, food: 100, water: 100, slots: [] as Slot[], held: null as number | null,
    open: null as string | null, crafting: [] as { item: string; left: number; ready: number; command: string; index: number }[],
  };
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
      tree: { r: 0.5, blocks: true, left: 30 }, rock: { r: 0.8, blocks: true, left: 20 }, bush: { r: 0.5, blocks: false, left: 12 },
      chest: { r: 0.5, blocks: true, left: 0 }, raptor: { r: 0.6, blocks: false, left: RAPTOR.hp }, player: { r: 0.4, blocks: false, left: 100 },
    };
    const b = base[type] ?? { r: 0.5, blocks: true, left: 1 };
    this.things.set(id, { id, kind, type, x, z, ...b, ...extra });
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
    return this.me.slots.reduce((w, s) => w + (WEIGHT[s.item] ?? 1) * s.count, 0);
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

  /** What the character perceives: everything near, and what is in front of it farther off. */
  perceives(t: Thing): boolean {
    const d = this.dist(t);
    return d <= NEAR || (d <= SIGHT && Math.abs(this.bearing(t.x, t.z)) <= FOV);
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
    if (this.dist(t) - t.r > REACH) return [];
    if (t.type === "bush") return ["harvest"];
    if (t.type === "chest") return [this.me.open === t.id ? "close" : "open"];
    if (t.type === "wood_door") return [t.piece?.open ? "close" : "open"];
    return [];
  }

  selfChannel(): SelfChannel {
    const m = this.me, h = this.heldItem();
    const held = m.held === null || !h ? null : { item: h, slot: m.held, uses: m.slots[m.held]?.uses ?? null };
    return {
      id: m.id, name: m.name, alive: m.alive, pos: [m.x, 0, m.z], yaw: m.yaw, pitch: m.pitch, vel: [m.vx, 0, m.vz],
      on: "ground", held, mount: null, status: this.weight() > 100 ? ["encumbered"] : [],
      vitals: { health: [m.health, 100], stamina: [m.stamina, 100], food: [m.food, 100], water: [m.water, 100], weight: [Math.round(this.weight() * 10) / 10, 100] },
    };
  }

  entitiesChannel(radius = 40, max = 20): EntitiesChannel {
    const seen = [...this.things.values()]
      .filter((t) => this.perceives(t) && this.dist(t) <= radius)
      .sort((a, b) => this.dist(a) - this.dist(b));
    const items: Entity[] = seen.slice(0, max).map((t) => ({
      id: t.id, kind: t.kind, type: t.type, ...(t.name ? { name: t.name } : {}),
      pos: [t.x, t.piece?.y ?? 0, t.z], distance: Math.round(this.dist(t) * 100) / 100, bearing: this.bearing(t.x, t.z),
      ...(t.kind === "creature" ? { health: t.left / RAPTOR.hp, disposition: "hostile" as const, tags: t.hunting ? ["hunting"] : ["wild"] } : {}),
      ...(t.kind === "player" ? { disposition: "neutral" as const } : {}),
      ...(t.kind === "structure" ? { disposition: "own" as const, tags: t.piece?.open ? ["open"] : [] } : {}),
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
        let ch = ".";
        for (const t of this.things.values()) {
          if (Math.hypot(t.x - x, t.z - z) > t.r + cell / 2 || !this.perceives(t)) continue;
          ch = t.type === "tree" ? "T" : t.type === "rock" ? "R" : t.type === "bush" ? "b" : t.kind === "structure" ? (t.blocks ? "#" : "=") : t.kind === "creature" ? "c" : t.kind === "player" ? "P" : "B";
        }
        if (Math.abs(x - this.me.x) < cell / 2 && Math.abs(z - this.me.z) < cell / 2) ch = "@";
        row += ch;
      }
      rows.push(row);
    }
    return {
      cell, origin: [ox, oz], size: [n, n], rows, heights: null,
      legend: { ".": "walkable", "#": "blocked", "=": "floor", T: "tree", R: "rock", b: "bush", B: "container", c: "creature", P: "player", "@": "self" },
    };
  }

  inventoryChannel(): InventoryChannel {
    const m = this.me;
    const craftable: Craftable[] = Object.entries(RECIPES).map(([item, r]) => ({
      item, needs: r.needs, seconds: r.seconds, at: null,
      can: Math.min(...Object.entries(r.needs).map(([i, n]) => Math.floor(this.count(i) / n))),
    }));
    const box = m.open ? this.things.get(m.open) : undefined;
    return {
      slots: m.slots.map((s) => ({ ...s })), capacity: 60, weight: [Math.round(this.weight() * 10) / 10, 100],
      hotbar: Array.from({ length: 10 }, (_, i) => (i < m.slots.length ? i : null)),
      open: box ? { id: box.id, slots: (box.slots ?? []).map((s) => ({ ...s })) } : null,
      craftable,
      crafting: m.crafting.map((c) => ({ item: c.item, left: c.left, ready_in_s: Math.max(0, (c.ready - this.t) / 1000) })),
    };
  }

  focusChannel(): FocusChannel {
    const t = this.focusThing();
    const out: FocusChannel = t ? { target: t.id, distance: Math.max(0, Math.round((this.dist(t) - t.r) * 100) / 100), verbs: this.affords(t) } : { target: null };
    const h = this.heldItem();
    if (isPiece(h)) out.placement = this.preview(h);
    return out;
  }

  // --- Building ---------------------------------------------------------------------------------------------------

  private cellOf(x: number, z: number): string {
    return `${Math.round(x / CELL)},${Math.round(z / CELL)}`;
  }

  private pieces(type?: string): Thing[] {
    return [...this.things.values()].filter((t) => t.kind === "structure" && (!type || t.type === type));
  }

  /** Where the held piece would go, as a player's preview shows it: 3 m ahead, snapped to what is near. */
  preview(piece: Piece): Placement {
    const [fx, fz] = this.forward();
    const px = this.me.x + fx * CELL, pz = this.me.z + fz * CELL;
    const refuse = (reason: PlacementRefusal, pos: [number, number, number]): Placement =>
      ({ piece, pos, yaw: 0, snapped: null, valid: false, reason });
    const foundations = this.pieces("wood_foundation");
    if (piece === "wood_foundation") {
      // Beside a foundation, to the cell it borders that is nearest the aim; else on a grid of its own at the aim.
      let x = Math.round(px / CELL) * CELL, z = Math.round(pz / CELL) * CELL, snapped: Placement["snapped"] = null;
      let best = 1.6;
      for (const f of foundations) {
        for (const [dx, dz, where] of [[0, -CELL, "north"], [CELL, 0, "east"], [0, CELL, "south"], [-CELL, 0, "west"]] as const) {
          const d = Math.hypot(f.x + dx - px, f.z + dz - pz);
          if (d < best) (best = d), (x = f.x + dx), (z = f.z + dz), (snapped = { to: f.id, where });
        }
      }
      const pos: [number, number, number] = [x, 0, z];
      if (foundations.some((f) => this.cellOf(f.x, f.z) === this.cellOf(x, z))) return { ...refuse("occupied", pos), snapped };
      for (const t of this.things.values()) {
        if (t.blocks && t.kind !== "structure" && Math.abs(t.x - x) < CELL / 2 + t.r && Math.abs(t.z - z) < CELL / 2 + t.r) return { ...refuse("blocked", pos), snapped };
      }
      if (Math.abs(x - this.me.x) < CELL / 2 + BODY_R && Math.abs(z - this.me.z) < CELL / 2 + BODY_R) return { ...refuse("blocked", pos), snapped };
      return { piece, pos, yaw: 0, snapped, valid: true, reason: null };
    }
    if (piece === "wood_wall" || piece === "wood_doorframe") {
      let best: { f: Thing; ex: number; ez: number; where: string; yaw: number } | undefined, bestD = 2;
      for (const f of foundations) {
        for (const [dx, dz, where, yaw] of [[0, -1.5, "north", 0], [1.5, 0, "east", Math.PI / 2], [0, 1.5, "south", 0], [-1.5, 0, "west", Math.PI / 2]] as const) {
          const d = Math.hypot(f.x + dx - px, f.z + dz - pz);
          if (d < bestD) (bestD = d), (best = { f, ex: f.x + dx, ez: f.z + dz, where, yaw });
        }
      }
      if (!best) return refuse("no_support", [px, 0, pz]);
      const pos: [number, number, number] = [best.ex, 0, best.ez];
      const snapped = { to: best.f.id, where: best.where };
      const edge = `${best.ex},${best.ez}`;
      if (this.pieces().some((p) => p.piece?.edge === edge)) return { piece, pos, yaw: best.yaw, snapped, valid: false, reason: "occupied" };
      return { piece, pos, yaw: best.yaw, snapped, valid: true, reason: null };
    }
    if (piece === "wood_door") {
      let best: Thing | undefined, bestD = 2.5;
      for (const f of this.pieces("wood_doorframe")) {
        const d = Math.hypot(f.x - px, f.z - pz);
        if (d < bestD) (bestD = d), (best = f);
      }
      if (!best) return refuse("no_support", [px, 0, pz]);
      const pos: [number, number, number] = [best.x, 0, best.z];
      const snapped = { to: best.id, where: "frame" };
      if (this.pieces("wood_door").some((d) => d.piece?.edge === best!.piece?.edge)) return { piece, pos, yaw: best.piece!.yaw, snapped, valid: false, reason: "occupied" };
      return { piece, pos, yaw: best.piece!.yaw, snapped, valid: true, reason: null };
    }
    // A ceiling goes over a foundation that has a wall on one of its edges, or beside another ceiling.
    let best: Thing | undefined, bestD = 2.5;
    for (const f of foundations) {
      const d = Math.hypot(f.x - px, f.z - pz);
      if (d < bestD) (bestD = d), (best = f);
    }
    if (!best) return refuse("no_support", [px, 3, pz]);
    const pos: [number, number, number] = [best.x, 3, best.z];
    const snapped = { to: best.id, where: "above" };
    const cell = this.cellOf(best.x, best.z);
    if (this.pieces("wood_ceiling").some((c) => c.piece?.cell === cell)) return { piece, pos, yaw: 0, snapped, valid: false, reason: "occupied" };
    const edges = [[0, -1.5], [1.5, 0], [0, 1.5], [-1.5, 0]].map(([dx, dz]) => `${best!.x + dx!},${best!.z + dz!}`);
    const walled = this.pieces().some((p) => p.piece?.edge && edges.includes(p.piece.edge) && p.type !== "wood_door");
    const beside = this.pieces("wood_ceiling").some((c) => Math.abs(c.x - best!.x) + Math.abs(c.z - best!.z) === CELL);
    if (!walled && !beside) return { piece, pos, yaw: 0, snapped, valid: false, reason: "no_support" };
    return { piece, pos, yaw: 0, snapped, valid: true, reason: null };
  }

  private build(piece: Piece): { placed: string } | { code: RejectCode | "blocked"; reason?: PlacementRefusal | null } {
    const p = this.preview(piece);
    if (!p.valid) return { code: "blocked", reason: p.reason };
    if (!this.take(piece, 1)) return { code: "missing_items" };
    const edge = piece === "wood_wall" || piece === "wood_doorframe" ? `${p.pos[0]},${p.pos[2]}` : piece === "wood_door" ? this.things.get(p.snapped!.to)?.piece?.edge : undefined;
    const blocks = piece === "wood_wall" || piece === "wood_door";
    const id = this.place("structure", piece, p.pos[0], p.pos[2], {
      r: piece === "wood_foundation" || piece === "wood_ceiling" ? 1.5 : 0.3, blocks, left: 1000,
      piece: { yaw: p.yaw, y: p.pos[1], cell: this.cellOf(p.pos[0], p.pos[2]), ...(edge ? { edge } : {}) },
    });
    this.event("notice", { text: `placed ${piece}`, level: "info", id });
    return { placed: id };
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
        return instant();
      case "chat":
        this.said.push({ channel: a.channel, text: a.text, t: this.t });
        return instant();
      case "select": {
        if (a.slot < 0 || a.slot >= this.me.slots.length) return "missing_items";
        this.me.held = a.slot;
        return instant({ item: this.me.slots[a.slot]!.item });
      }
      case "items": {
        const s = this.me.slots[a.slot];
        if (!s) return "missing_items";
        if (a.op === "consume") {
          if (s.item !== "berries") return "not_permitted";
          this.take("berries", 1);
          this.me.food = Math.min(100, this.me.food + 5);
          return instant();
        }
        if (a.op === "equip") return "not_permitted";
        if (a.op === "drop") {
          this.take(s.item, a.count ?? s.count);
          return instant();
        }
        // move between the character and the open box
        const box = this.me.open ? this.things.get(this.me.open) : undefined;
        if (!box) return "not_permitted";
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
      case "look":
      case "move":
      case "jump":
      case "crouch":
      case "use":
      case "interact": {
        if (a.control === "interact") {
          const t = this.things.get(a.target);
          if (!t) return "unknown_target";
          if (!this.affords(t).includes(a.verb)) return this.dist(t) - t.r > REACH ? "out_of_reach" : "not_permitted";
          if (this.focusThing()?.id !== t.id) return "out_of_reach";
          if (a.verb === "open" || a.verb === "close") {
            if (t.type === "chest") this.me.open = a.verb === "open" ? t.id : null;
            else if (t.piece) (t.piece.open = a.verb === "open"), (t.blocks = a.verb !== "open");
            return instant();
          }
        }
        const key = a.control === "use" || a.control === "interact" ? "hands" : a.control;
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
    if (m.alive) {
      this.turn(dt);
      this.walk(dt);
      this.hands();
      this.craft();
      m.food = Math.max(0, m.food - 0.01 * dt);
      m.water = Math.max(0, m.water - 0.02 * dt);
    }
    for (const t of this.things.values()) if (t.kind === "creature") this.creature(t, dt);
    for (const key of [...this.running.keys()]) {
      const r = this.running.get(key)!;
      if (key !== "look" && this.t >= r.until) this.end(key, "completed");
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
    this.me.yaw = wrap(this.me.yaw + Math.sign(dy) * Math.min(Math.abs(dy), TURN * dt));
    this.me.pitch += Math.sign(dp) * Math.min(Math.abs(dp), PITCH_TURN * dt);
    if (Math.abs(wrap((r.done.yaw as number) - this.me.yaw)) < 1e-3 && Math.abs((r.done.pitch as number) - this.me.pitch) < 1e-3) this.end("look", "completed");
  }

  private walk(dt: number): void {
    const r = this.running.get("move");
    const m = this.me;
    if (!r || r.action.control !== "move") return;
    const a = r.action;
    const [fx, fz] = this.forward();
    let vx = fx * a.forward + Math.cos(m.yaw) * a.strafe, vz = fz * a.forward + Math.sin(m.yaw) * a.strafe;
    const len = Math.hypot(vx, vz);
    if (len > 1) (vx /= len), (vz /= len);
    const sprinting = !!a.sprint && m.stamina > 1 && a.forward > 0;
    const speed = (sprinting ? SPRINT : WALK) * (this.weight() > 100 ? 0.3 : 1);
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

  /** What would be in the way of the body at (x, z): an id, or null. */
  private collide(x: number, z: number): string | null {
    for (const t of this.things.values()) {
      if (!t.blocks || (t.piece?.y ?? 0) > 0) continue;
      if (t.kind === "structure" && t.piece) {
        // A wall or door is a thin slab along its edge, 3 m wide.
        const along = t.piece.yaw === 0 ? Math.abs(x - t.x) : Math.abs(z - t.z);
        const across = t.piece.yaw === 0 ? Math.abs(z - t.z) : Math.abs(x - t.x);
        if (along < 1.5 + BODY_R && across < 0.15 + BODY_R) return t.id;
        continue;
      }
      if (Math.hypot(t.x - x, t.z - z) < t.r + BODY_R) return t.id;
    }
    // A doorframe is two slabs with a gap between them.
    for (const f of this.pieces("wood_doorframe")) {
      const along = f.piece!.yaw === 0 ? x - f.x : z - f.z;
      const across = f.piece!.yaw === 0 ? Math.abs(z - f.z) : Math.abs(x - f.x);
      if (across < 0.15 + BODY_R && Math.abs(along) < 1.5 + BODY_R && Math.abs(along) > 0.6 - BODY_R) return f.id;
    }
    return null;
  }

  private hands(): void {
    const r = this.running.get("hands");
    if (!r || r.next === undefined || this.t < r.next) return;
    const a = r.action;
    if (a.control === "interact") {
      const t = this.things.get(a.target);
      if (!t || this.focusThing()?.id !== t.id) return this.end("hands", "failed", { code: "out_of_reach" });
      r.next = this.t + PICK_MS;
      if (t.type === "bush" && t.left > 0) {
        t.left--;
        this.gain(r, "fiber", 1);
        if (t.left % 3 === 0) this.gain(r, "berries", 1);
        if (t.left <= 0) this.things.delete(t.id);
      }
      return;
    }
    if (a.control !== "use") return;
    r.next = this.t + SWING_MS;
    const held = this.heldItem();
    if (isPiece(held)) {
      r.next = Infinity;
      const built = this.build(held);
      if ("code" in built) {
        r.done.reason = built.reason ?? null;
        return this.end("hands", "failed", { code: built.code });
      }
      r.done.placed = built.placed;
      return;
    }
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
      t.left -= tool.hits;
      t.hunting = true;
      this.wear();
      if (t.left <= 0) {
        this.things.delete(t.id);
        this.event("notice", { text: `the ${t.type} is dead`, level: "info", id: t.id });
      }
    }
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
    if (m.alive && d < RAPTOR.sees) t.hunting = true;
    if (!m.alive || d > RAPTOR.gives_up) t.hunting = false;
    let tx: number, tz: number, speed: number;
    if (t.hunting) {
      [tx, tz, speed] = [m.x, m.z, RAPTOR.speed];
      if (d <= RAPTOR.reach && this.t >= (t.biteAt ?? 0)) {
        t.biteAt = this.t + RAPTOR.every_ms;
        this.hurt(RAPTOR.bite, t.id);
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
    if (dd > (t.hunting ? RAPTOR.reach * 0.8 : 0.1)) {
      t.x += ((tx - t.x) / dd) * Math.min(dd, speed * dt);
      t.z += ((tz - t.z) / dd) * Math.min(dd, speed * dt);
    }
    // Heard, not seen: its steps and calls, once every two seconds while it is within 25 m.
    if (m.alive && !this.perceives(t) && d < 25 && this.t - (this.lastHeard.get(t.id) ?? -1e9) >= 2000) {
      this.lastHeard.set(t.id, this.t);
      this.event("heard", { kind: "creature", bearing: this.bearing(t.x, t.z), loudness: Math.round((1 - d / 25) * 100) / 100, what: t.type });
    }
  }

  private hurt(amount: number, by: string): void {
    const m = this.me;
    m.health = Math.max(0, m.health - amount);
    this.event("hurt", { amount, health: m.health, by: this.perceives(this.things.get(by)!) ? by : null, kind: "melee" });
    if (m.health <= 0) {
      m.alive = false;
      this.releaseAll("died");
      this.event("died", { by, pos: [m.x, 0, m.z] });
    }
  }
}
