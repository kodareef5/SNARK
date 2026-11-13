// Gathering from resource nodes.
//
// The server keeps only what has been touched: for each such node, how many
// hits it has left and, once it is used up, the tick it grows back. That is
// what is saved (per chunk) and what clients are told (which slots are used
// up). Everything else about nodes comes from the map on both sides.
//
// What a swing hits is decided here, by a ray from the body's own eye.

import type { ItemDef, NodeDef } from "../shared/content/defs.ts";
import { stanceEye } from "../shared/sim/character.ts";
import { BitReader, BitWriter } from "../shared/net/codec.ts";
import { S_NODES } from "../shared/net/protocol.ts";
import { Rng } from "../shared/rng.ts";
import { GAME_HOUR_TICKS } from "../shared/sim/lazy.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { chunkCount, chunkCx, chunkCz, TICK_RATE } from "../shared/coords.ts";
import type { NodeField, NodeSpot } from "../shared/world/nodes.ts";
import { HIT_NODE, castWorld, lookDirection, rayHit } from "../shared/world/ray.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { Progression } from "./progression.ts";
import type { Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

export const DEADLINE_NODE = 3;
export const TAG_NODES = 1;
/** Ticks between swings while the primary button is held. */
export const SWING_TICKS = 15;
const REACH = 3.5;
/** A node does not grow back while a body is this close; it tries again later. */
const CROWDED = 12;
const RETRY_TICKS = 30 * TICK_RATE;

interface Touched {
  hits: number;
  /** Tick it grows back, or 0 while it still stands. */
  respawnAt: number;
}

export class Harvest {
  readonly field: NodeField;
  /** Per chunk: changes whenever a node there is used up or grows back. */
  readonly version: Uint32Array;
  /** Chunks whose saved state is out of date. */
  readonly dirty = new Set<number>();
  readonly tag = TAG_NODES;
  /** Hits landed, for tests and measurement. */
  hits = 0;

  private readonly world: ServerWorld;
  private readonly game: GameServer;
  private readonly records: Records;
  private readonly items: Items;
  private readonly progression: Progression;
  private readonly deadlines: DeadlineHeap;
  private readonly touched = new Map<number, Touched>();
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

  /** How many nodes are used up right now. */
  get goneCount(): number {
    let n = 0;
    for (const t of this.touched.values()) if (t.respawnAt > 0) n++;
    return n;
  }

  /** The node a body is looking at within reach, as chunk * 256 + slot, or -1. */
  target(c: Client): number {
    const ents = this.world.ents;
    const e = c.ent;
    const d = this.dir;
    lookDirection(c.heldYaw, c.heldPitch, d);
    const eye = stanceEye(this.world.reg.move[ents.kind[e]!]!, ents.stance[e]!);
    if (castWorld(this.world, ents.x[e]!, ents.y[e]! + eye, ents.z[e]!, d[0]!, d[1]!, d[2]!, REACH) !== HIT_NODE) return -1;
    return Math.floor(rayHit.ref / 65536) * 256 + (rayHit.ref & 0xffff);
  }

  /** The primary button is held: swing at whatever is in front, if the last swing is over. Returns true if a node was hit. */
  swing(c: Client): boolean {
    const tick = this.world.tick;
    if (tick < c.swingAt) return false;
    c.swingAt = tick + SWING_TICKS;
    const at = this.target(c);
    return at >= 0 && this.hit(c, at >> 8, at & 255, false);
  }

  /** The use key on a node that is picked by hand (a bush). Returns true if one was picked. */
  pick(c: Client): boolean {
    const at = this.target(c);
    return at >= 0 && this.hit(c, at >> 8, at & 255, true);
  }

  /** Strike or pick a given node as `c`, whichever that node takes. For load tests; play goes through `swing` and `pick`. */
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
    // Bushes are picked with the use key; trees and rocks are struck.
    if (byHand !== (def.material === undefined)) return false;

    // The best tool for this material that the body carries. Each hit wears it.
    let power = 1;
    let toolSlot = -1;
    const inv = this.items.inv(rec);
    if (def.material !== undefined) {
      for (let s = 0; s < inv.cap; s++) {
        const tool = inv.item[s] !== 0 ? (reg.defs[inv.item[s]!] as ItemDef).tool : undefined;
        if (tool && tool.on === def.material && tool.power > power) {
          power = tool.power;
          toolSlot = s;
        }
      }
    }
    for (const y of def.yields) {
      if (y.tool && toolSlot < 0) continue;
      const n = (y.min + this.rng.int(y.max - y.min + 1)) * power;
      if (n > 0) this.items.mint(rec, reg.index.get(y.item)!, n);
    }
    if (toolSlot >= 0) {
      if (inv.dur[toolSlot]! <= 1) this.items.burn(rec, toolSlot, 1);
      else {
        inv.dur[toolSlot] = inv.dur[toolSlot]! - 1;
        inv.mod[toolSlot] = ++inv.version;
        this.records.dirty.add(rec.pid);
      }
    }
    this.progression.addXp(rec, def.xp);
    this.hits++;

    const left = table.hp[index]! - 1;
    const k = this.key(chunk, index);
    this.dirty.add(chunk);
    if (left > 0) {
      table.hp[index] = left;
      this.touched.set(k, { hits: left, respawnAt: 0 });
      return true;
    }
    const respawnAt = world.tick + Math.round(def.respawnHours * GAME_HOUR_TICKS);
    this.touched.set(k, { hits: 0, respawnAt });
    this.field.set(chunk, index, false);
    this.version[chunk] = this.version[chunk]! + 1;
    this.deadlines.push(respawnAt, DEADLINE_NODE, k, respawnAt);
    return true;
  }

  /** A DEADLINE_NODE entry came due: the node grows back, unless a body is standing where it would. */
  due(key: number, stamp: number): void {
    const t = this.touched.get(key);
    if (!t || t.respawnAt !== stamp) return;
    const chunk = key >> 8;
    const index = key & 255;
    this.field.source.at(chunk, index, this.spot);
    const ents = this.world.ents;
    for (const c of this.game.clients) {
      if (!c?.active || c.ent < 0) continue;
      const dx = ents.x[c.ent]! - this.spot.x;
      const dz = ents.z[c.ent]! - this.spot.z;
      if (dx * dx + dz * dz < CROWDED * CROWDED) {
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

  /** A chunk's touched nodes for saving, or null if it has none. */
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

  /** Take in a chunk's saved state and put back the deadlines of what was growing. */
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

  /** Tell a client which nodes around it are used up, for the chunks where its picture is out of date. */
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
