// What the character believes: the last of each channel, things remembered by id with when they were seen, and what
// it has been told. A belief is not the game's truth. A thing out of sight is remembered, not known, and every read
// can ask how old it is.

import type {
  Entity, EntitiesChannel, FocusChannel, GameEvent, InventoryChannel, Observation, SelfChannel, TerrainChannel, Vec3,
} from "./protocol.ts";

export interface Remembered extends Entity {
  /** The game clock (ms) when it was last seen, and its position then. */
  seen: number;
}

export interface Heard {
  t: number;
  kind: string;
  what?: string;
  /** The bearing it was heard on, made a world yaw from the character's facing then. */
  yaw: number;
  loudness: number;
}

/** Distance under which anything there is perceived, whatever way the character faces. */
const NEAR_SURE = 10;

export class Belief {
  self: SelfChannel | null = null;
  selfAt = -Infinity;
  inventory: InventoryChannel | null = null;
  inventoryAt = -Infinity;
  focus: FocusChannel = { target: null };
  focusAt = -Infinity;
  terrain: TerrainChannel | null = null;
  readonly things = new Map<string, Remembered>();
  readonly chat: { t: number; from: string; text: string; channel: string; read: boolean }[] = [];
  readonly heard: Heard[] = [];
  readonly events: GameEvent[] = [];
  /** Where hostile things were last seen, kept after they are out of sight: a place to keep away from. */
  readonly dangers = new Map<string, { type: string; pos: Vec3; t: number }>();
  /** The last time the whole way round was looked at (a scan), for skills that need a fresh view. */
  scannedAt = -Infinity;
  now = 0;

  observe(o: Observation): void {
    this.now = Math.max(this.now, o.t);
    const c = o.channels;
    if (c.self) (this.self = c.self), (this.selfAt = o.t);
    if (c.inventory) (this.inventory = c.inventory), (this.inventoryAt = o.t);
    if (c.focus) (this.focus = c.focus), (this.focusAt = o.t);
    if (c.terrain) this.terrain = c.terrain;
    if (c.entities) this.see(c.entities, o.t);
    if (c.chat) for (const l of c.chat.lines) if (!this.chat.some((x) => x.t === l.t && x.text === l.text)) this.chat.push({ t: l.t, from: l.from, text: l.text, channel: l.channel, read: false });
  }

  private see(e: EntitiesChannel, t: number): void {
    const present = new Set<string>();
    for (const item of e.items) {
      present.add(item.id);
      this.things.set(item.id, { ...item, seen: t });
      if (item.disposition === "hostile") this.dangers.set(item.id, { type: item.type, pos: item.pos, t });
    }
    // What should have been in this view and was not is gone: near enough to be perceived whichever way the
    // character faces, or in front of it and nearer than the farthest thing the view listed.
    if (!this.self) return;
    const farthest = e.more > 0 ? Math.max(0, ...e.items.map((i) => i.distance)) : Infinity;
    for (const [id, r] of this.things) {
      if (present.has(id)) continue;
      const d = this.distance(r.pos), b = Math.abs(this.bearingTo(r.pos));
      if (d <= NEAR_SURE || (b < 0.9 && d < farthest && d < 40)) this.things.delete(id);
    }
  }

  event(e: GameEvent): void {
    this.now = Math.max(this.now, e.t);
    this.events.push(e);
    if (this.events.length > 200) this.events.shift();
    if (e.kind === "heard" && this.self) {
      this.heard.push({ t: e.t, kind: String(e.data.kind), ...(e.data.what ? { what: String(e.data.what) } : {}), yaw: this.self.yaw + Number(e.data.bearing), loudness: Number(e.data.loudness) });
      if (this.heard.length > 50) this.heard.shift();
    }
    // A game that says a thing is gone (used up, dead) is believed at once.
    if (e.kind === "notice" && typeof e.data.id === "string" && /used up|dead|destroyed/.test(String(e.data.text))) {
      this.things.delete(e.data.id);
      this.dangers.delete(e.data.id);
    }
  }

  // --- Reading ----------------------------------------------------------------------------------------------------

  get pos(): Vec3 {
    return this.self?.pos ?? [0, 0, 0];
  }

  distance(p: Vec3): number {
    const s = this.pos;
    return Math.hypot(p[0] - s[0], p[2] - s[2]);
  }

  /** The world yaw from the character to a point: 0 north, clockwise from above. */
  yawTo(p: Vec3): number {
    const s = this.pos;
    return Math.atan2(p[0] - s[0], -(p[2] - s[2]));
  }

  bearingTo(p: Vec3): number {
    return wrap(this.yawTo(p) - (this.self?.yaw ?? 0));
  }

  age(seen: number): number {
    return this.now - seen;
  }

  /** Remembered things, nearest first. */
  find(test: (r: Remembered) => boolean): Remembered[] {
    return [...this.things.values()].filter(test).sort((a, b) => this.distance(a.pos) - this.distance(b.pos));
  }

  count(item: string): number {
    return (this.inventory?.slots ?? []).filter((s) => s.item === item).reduce((n, s) => n + s.count, 0);
  }

  slotOf(item: string): number | null {
    const s = this.inventory?.slots.find((x) => x.item === item);
    return s ? s.slot : null;
  }

  weightFraction(): number {
    const w = this.self?.vitals.weight;
    return w ? w[0] / w[1] : 0;
  }

  vital(name: string): number {
    const v = this.self?.vitals[name];
    return v ? v[0] / v[1] : 1;
  }

  /** The remembered danger nearest a point, seen within `maxAge` ms: how far it was from the point, and how long ago. */
  dangerNear(p: Vec3, maxAge = 90000): { id: string; type: string; distance: number; age: number } | null {
    let best: { id: string; type: string; distance: number; age: number } | null = null;
    for (const [id, d] of this.dangers) {
      if (this.now - d.t > maxAge) continue;
      const distance = Math.hypot(d.pos[0] - p[0], d.pos[2] - p[2]);
      if (!best || distance < best.distance) best = { id, type: d.type, distance, age: this.now - d.t };
    }
    return best;
  }

  /** Events since a time, of some kinds. */
  since(t: number, ...kinds: string[]): GameEvent[] {
    return this.events.filter((e) => e.t > t && (kinds.length === 0 || kinds.includes(e.kind)));
  }
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

/** A world yaw as a compass word: 0 north, clockwise. */
export function compass(yaw: number): string {
  return COMPASS[((Math.round(yaw / (Math.PI / 4)) % 8) + 8) % 8]!;
}

/** A bearing from the character's facing as a word. */
export function side(bearing: number): string {
  const a = Math.abs(bearing);
  return a < 0.5 ? "ahead" : a > 2.6 ? "behind" : bearing > 0 ? "right" : "left";
}

export function wrap(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}
