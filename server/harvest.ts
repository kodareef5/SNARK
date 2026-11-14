// The server keeps only the nodes that were touched: the hits each has left and, once it is used up, the tick it grows back.
// That is saved per chunk, and clients are sent the used-up slots. Everything else about nodes comes from the map on both sides.

import type { ItemDef, NodeDef } from "../shared/content/defs.ts";
import { stanceEye } from "../shared/sim/character.ts";
import { BitReader, BitWriter } from "../shared/net/codec.ts";
import { S_NODES } from "../shared/net/protocol.ts";
import { Rng } from "../shared/rng.ts";
import { GAME_HOUR_TICKS } from "../shared/sim/lazy.ts";
import { leftAtPeriod } from "../shared/sim/breeding.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { chunkCount, chunkCx, chunkCz, TICK_RATE } from "../shared/coords.ts";
import type { NodeField, NodeSpot } from "../shared/world/nodes.ts";
import { HIT_NODE, castWorld, lookDirection, rayHit } from "../shared/world/ray.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import { XP_HARVEST, type Progression } from "./progression.ts";
import type { Lists } from "./settings/lists.ts";
import type { Rules } from "./settings/rules.ts";
import type { Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";
import { event } from "./events/bus.ts";

export const DEADLINE_NODE = 3;
export const TAG_NODES = 1;
/** Metres from the eye, for picking with the use key. */
const REACH = 3.5;
/** Metres. A node does not grow back while a survivor is this close. It tries again after RETRY_TICKS. */
const CROWDED = 12;
const RETRY_TICKS = 30 * TICK_RATE;

interface Touched {
  hits: number;
  /** Tick it grows back, or 0 while it still stands. */
  respawnAt: number;
}

const HARVEST = event("harvest");

export class Harvest {
  readonly field: NodeField;
  /** Per chunk. Changes whenever a node there is used up or grows back. */
  readonly version: Uint32Array;
  /** Chunks to save. */
  readonly dirty = new Set<number>();
  readonly tag = TAG_NODES;
  hits = 0;

  private readonly world: ServerWorld;
  private readonly game: GameServer;
  private readonly records: Records;
  private readonly items: Items;
  private readonly progression: Progression;
  private readonly deadlines: DeadlineHeap;
  private readonly touched = new Map<number, Touched>();
  rules: Rules | null = null;
  lists: Lists | null = null;
  private readonly rng: Rng;
  private readonly dir = [0, 0, 0];
  private readonly spot: NodeSpot = { kind: 0, x: 0, y: 0, z: 0, yaw: 0 };
  private readonly per: number;

  constructor(world: ServerWorld, game: GameServer, records: Records, items: Items, progression: Progression, deadlines: DeadlineHeap, seed: number) {
    this.world = world;
    this.game = game;
    this.records = records;
    this.items = items;
    this.progression = progression;
    this.deadlines = deadlines;
    this.field = world.nodeField!;
    this.per = this.field.source.perChunk;
    this.version = new Uint32Array(chunkCount(world.dims));
    this.rng = new Rng(seed);
  }

  private key(chunk: number, index: number): number {
    return chunk * 256 + index;
  }

  /** A focus entered (delta 1) or left (delta -1) the chunks within `radius` of `center`. */
  retain(center: number, radius: number, delta: number): void {
    this.field.retain(
      center,
      radius,
      delta,
      (chunk, index) => (this.touched.get(this.key(chunk, index))?.respawnAt ?? 0) > 0,
      (chunk, index) => this.touched.get(this.key(chunk, index))?.hits ?? -1,
    );
  }

  get goneCount(): number {
    let n = 0;
    for (const t of this.touched.values()) if (t.respawnAt > 0) n++;
    return n;
  }

  /** The node the body looks at within REACH, as chunk * 256 + slot, or -1. */
  target(c: Client): number {
    const ents = this.world.ents;
    const e = c.ent;
    const d = this.dir;
    lookDirection(c.heldYaw, c.heldPitch, d);
    const eye = stanceEye(this.world.reg.move[ents.kind[e]!]!, ents.stance[e]!);
    if (castWorld(this.world, ents.x[e]!, ents.y[e]! + eye, ents.z[e]!, d[0]!, d[1]!, d[2]!, REACH) !== HIT_NODE) return -1;
    return Math.floor(rayHit.ref / 65536) * 256 + (rayHit.ref & 0xffff);
  }

  /** A swing landed on this node (server/combat.ts found it). Returns true if that did anything. */
  struck(c: Client, chunk: number, index: number): boolean {
    return this.hit(c, chunk, index, false);
  }

  /** The use key picks the bush the body looks at. Returns true if one was picked. */
  pick(c: Client): boolean {
    const at = this.target(c);
    return at >= 0 && this.hit(c, at >> 8, at & 255, true);
  }

  /** For load tests. Strikes or picks the node, whichever it takes. Play goes through a swing and `pick`. */
  strike(c: Client, chunk: number, index: number): boolean {
    const kind = this.field.store.chunks[chunk]?.kind[index] ?? 0;
    return kind !== 0 && this.hit(c, chunk, index, (this.world.reg.defs[kind] as NodeDef).material === undefined);
  }

  private hit(c: Client, chunk: number, index: number, byHand: boolean): boolean {
    const world = this.world;
    const reg = world.reg;
    const table = this.field.store.chunks[chunk];
    const rec = this.records.byPid.get(c.pid);
    if (!table || table.kind[index] === 0 || !rec) return false;
    const def = reg.defs[table.kind[index]!] as NodeDef;
    // A node with no material is a bush, picked by hand. Trees and rocks are struck.
    if (byHand !== (def.material === undefined)) return false;

    let power = 1;
    let toolSlot = -1;
    const inv = this.items.inv(rec);
    const held = inv.hotbar >= 0 && rec.held >= 0 ? inv.hotbar + rec.held : -1;
    if (def.material !== undefined && held >= 0 && inv.item[held] !== 0 && inv.dur[held]! > 0) {
      const tool = (reg.defs[inv.item[held]!] as ItemDef).tool;
      if (tool && tool.on === def.material) {
        power = tool.power;
        toolSlot = held;
      }
    }
    // A fractional multiplier lands its extra blow by chance, so 0.5 is one blow in two swings.
    const rules = this.rules;
    const force = byHand || !rules ? 1 : rules.num("PlayerHarvestingDamageMultiplier");
    const part = force - Math.floor(force);
    let blows = Math.floor(force) + (part > 0 && this.rng.float() < part ? 1 : 0);
    if (blows > table.hp[index]!) blows = table.hp[index]!;
    if (toolSlot >= 0) this.items.wear(rec, toolSlot, 1);
    if (blows === 0) return true;
    const amount = rules ? rules.num("HarvestAmountMultiplier") : 1;
    const each = this.lists?.multipliers("HarvestResourceItemAmountClassMultipliers");
    for (const y of def.yields) {
      if (y.tool && toolSlot < 0) continue;
      const item = reg.index.get(y.item)!;
      let n = 0;
      for (let b = 0; b < blows; b++) n += (y.min + this.rng.int(y.max - y.min + 1)) * power;
      n = Math.round(n * amount * (each?.get(item) ?? 1));
      const got = n > 0 ? this.items.mint(rec, item, n, 0, 0, -1, "harvest") : 0;
      if (got > 0) this.items.bus.after(HARVEST, { pid: rec.pid, node: def.id, item: y.item, n: got });
    }
    this.progression.addXp(rec, def.xp * blows, XP_HARVEST);
    this.hits++;

    const left = table.hp[index]! - blows;
    const k = this.key(chunk, index);
    this.dirty.add(chunk);
    if (left > 0) {
      table.hp[index] = left;
      this.touched.set(k, { hits: left, respawnAt: 0 });
      return true;
    }
    const respawnAt = world.tick + Math.max(1, Math.round(def.respawnHours * GAME_HOUR_TICKS * (rules ? rules.num("ResourcesRespawnPeriodMultiplier") : 1)));
    this.touched.set(k, { hits: 0, respawnAt });
    this.field.set(chunk, index, false);
    this.version[chunk] = this.version[chunk]! + 1;
    this.deadlines.push(respawnAt, DEADLINE_NODE, k, respawnAt);
    return true;
  }

  /** A DEADLINE_NODE entry came due. */
  due(key: number, stamp: number): void {
    const t = this.touched.get(key);
    if (!t || t.respawnAt !== stamp) return;
    const chunk = key >> 8;
    const index = key & 255;
    this.field.source.at(chunk, index, this.spot);
    const ents = this.world.ents;
    const crowded = CROWDED * (this.rules ? this.rules.num("ResourceNoReplenishRadiusPlayers") : 1);
    for (const c of this.game.clients) {
      if (!c?.active || c.ent < 0) continue;
      const dx = ents.x[c.ent]! - this.spot.x;
      const dz = ents.z[c.ent]! - this.spot.z;
      if (dx * dx + dz * dz < crowded * crowded) {
        t.respawnAt = this.world.tick + RETRY_TICKS;
        this.deadlines.push(t.respawnAt, DEADLINE_NODE, key, t.respawnAt);
        this.dirty.add(chunk);
        return;
      }
    }
    this.touched.delete(key);
    this.field.set(chunk, index, true);
    this.version[chunk] = this.version[chunk]! + 1;
    this.dirty.add(chunk);
  }

  /** Marks every chunk with a touched node for saving. */
  all(): void {
    for (const key of this.touched.keys()) this.dirty.add(Math.floor(key / 256));
  }

  /** A chunk's touched nodes for saving, or null if it has none. Layout: a count, then slot, hits and respawnAt for each. */
  encode(chunk: number): Uint8Array | null {
    const slots: number[] = [];
    for (let i = 0; i < this.per; i++) if (this.touched.has(this.key(chunk, i))) slots.push(i);
    if (slots.length === 0) return null;
    const w = new BitWriter(8 + slots.length * 12);
    w.varint(slots.length);
    for (const i of slots) {
      const t = this.touched.get(this.key(chunk, i))!;
      w.u8(i);
      w.varint(t.hits);
      w.uint53(t.respawnAt);
    }
    return w.bytes().slice();
  }

  /** 0 for a node that is not used up. */
  regrowsAt(chunk: number, index: number): number {
    return this.touched.get(this.key(chunk, index))?.respawnAt ?? 0;
  }

  /** The respawn multiplier was `was` when these nodes were used up. Rescales the time each has left to the current rule. */
  retime(was: number): void {
    const is = this.rules ? this.rules.num("ResourcesRespawnPeriodMultiplier") : 1;
    const tick = this.world.tick;
    if (was === is || !(was > 0)) return;
    for (const [key, t] of this.touched) {
      if (t.respawnAt <= tick) continue;
      t.respawnAt = tick + leftAtPeriod(t.respawnAt - tick, was, is);
      this.deadlines.push(t.respawnAt, DEADLINE_NODE, key, t.respawnAt);
      this.dirty.add(Math.floor(key / 256));
    }
  }

  decode(chunk: number, data: Uint8Array): void {
    const r = new BitReader(data);
    for (let n = r.varint(); n > 0 && !r.overflow; n--) {
      const index = r.u8();
      const hits = r.varint();
      const respawnAt = r.uint53();
      if (r.overflow) return;
      this.touched.set(this.key(chunk, index), { hits, respawnAt });
      if (respawnAt > 0) {
        this.version[chunk] = this.version[chunk]! + 1;
        this.deadlines.push(respawnAt, DEADLINE_NODE, this.key(chunk, index), respawnAt);
      }
    }
  }

  /** Sends the used-up slots of each chunk within `radius` whose version the client does not have. */
  sync(c: Client, radius: number): void {
    const dims = this.world.dims;
    const cx = chunkCx(dims, c.chunk);
    const cz = chunkCz(dims, c.chunk);
    for (let z = Math.max(0, cz - radius); z <= Math.min(dims.chunksZ - 1, cz + radius); z++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(dims.chunksX - 1, cx + radius); x++) {
        const chunk = z * dims.chunksX + x;
        if (this.version[chunk] === c.nodesKnown[chunk]) continue;
        const w = this.game.begin(S_NODES);
        w.u16(chunk);
        w.u32(this.version[chunk]!);
        const at = w.pos;
        w.u8(0);
        let n = 0;
        for (let i = 0; i < this.per; i++) {
          if ((this.touched.get(this.key(chunk, i))?.respawnAt ?? 0) === 0) continue;
          w.u8(i);
          n++;
        }
        const end = w.pos;
        w.pos = at;
        w.u8(n);
        w.pos = end;
        this.game.endOwn(c);
        c.nodesKnown[chunk] = this.version[chunk]!;
      }
    }
  }
}
