// The authoritative game loop: accepts connections, consumes one input per
// player per tick, steps the world, and replicates what each client may know.
//
// It has no socket, no clock and no file of its own. A transport listener and
// calls to `tick()` come from outside, so tests drive a whole server in memory
// and server/main.ts wires the same class to Bun.

import { CHUNK_SIZE, STRUCT_UNITS, TICK_DT, chunkCount, chunkCx, chunkCz } from "../shared/coords.ts";
import { TAU, detCos, detSin } from "../shared/math/scalar.ts";
import { BitReader, BitWriter } from "../shared/net/codec.ts";
import {
  C_HELLO,
  C_INPUT,
  INPUT_WINDOW,
  InputBuffer,
  MAX_CLIENT_MESSAGE,
  MAX_NAME_BYTES,
  PROTOCOL_VERSION,
  REJECT_CONTENT,
  REJECT_FULL,
  REJECT_MALFORMED,
  REJECT_NAME,
  REJECT_VERSION,
  S_CHUNK,
  S_CHUNK_DROP,
  S_REJECT,
  S_SNAPSHOT,
  S_WELCOME,
  readInputs,
  writeBody,
} from "../shared/net/protocol.ts";
import { CH_RELIABLE, CH_UNRELIABLE, type Connection, type Listener } from "../shared/net/transport.ts";
import { EntityView, MAX_VIEW, VIEW_RING, ViewRing, quantX, quantY, writeViewDelta } from "../shared/net/view.ts";
import { Body, stepBody } from "../shared/sim/character.ts";
import { F_AWAKE, F_GROUNDED, F_PLAYER } from "../shared/sim/entities.ts";
import { sortU32 } from "../shared/sort.ts";
import { capsuleFree } from "../shared/world/collide.ts";
import type { ChunkTable } from "../shared/world/structures.ts";
import type { ServerWorld } from "./world.ts";

export interface GameOptions {
  /** Ticks between snapshots to each client. */
  snapshotEvery: number;
  /** Byte budget for the deferrable part of one snapshot. */
  snapshotBytes: number;
  /** Entity interest radius in chunks. */
  entityRadius: number;
  /** Structure interest radius in chunks. */
  structRadius: number;
  /** Structure slots sent to one client per tick. */
  chunkSlotsPerTick: number;
  maxClients: number;
}

const DEFAULTS: GameOptions = {
  snapshotEvery: 1,
  snapshotBytes: 1100,
  entityRadius: 3,
  structRadius: 3,
  chunkSlotsPerTick: 256,
  maxClients: 128,
};

/** Messages accepted from one client per tick before the rest are dropped. */
const MAX_PACKETS_PER_TICK = 8;
/** Malformed messages tolerated before disconnecting. */
const MAX_STRIKES = 8;
const NAME = /^[A-Za-z0-9 _-]{1,24}$/;

export class Client {
  readonly id: number;
  readonly conn: Connection;
  active = false;
  name = "";
  /** Entity index of the controlled body, or -1. */
  ent = -1;
  readonly inputs = new InputBuffer(INPUT_WINDOW);
  heldX = 0;
  heldZ = 0;
  heldYaw = 0;
  heldPitch = 0;
  heldButtons = 0;
  /** Newest input tick received. */
  newestInput = 0;
  /** Newest snapshot the client says it decoded. */
  ackTick = 0;
  lastSnapshot = 0;
  readonly views = new ViewRing();
  /** Structure table version the client holds, per chunk. */
  readonly known: Uint32Array;
  readonly subscribed: number[] = [];
  syncChunk = -1;
  syncCursor = 0;
  syncFrom = 0;
  syncTarget = 0;
  rotate = 0;
  strikes = 0;
  packets = 0;

  constructor(id: number, conn: Connection, chunks: number) {
    this.id = id;
    this.conn = conn;
    this.known = new Uint32Array(chunks);
  }
}

export class GameServer {
  readonly world: ServerWorld;
  readonly opts: GameOptions;
  readonly clients: (Client | null)[];
  readonly stats = { malformed: 0, throttled: 0, lateInputs: 0, heldInputs: 0 };
  /** Called after a player body is created or about to be destroyed. */
  onJoin: ((c: Client) => void) | null = null;
  onLeave: ((c: Client) => void) | null = null;
  /** Called once per tick after players move, before replication. */
  onStep: ((tick: number) => void) | null = null;
  /** Where a returning survivor was last seen, or null for a new one. */
  savedPosition: ((name: string) => { x: number; y: number; z: number; yaw: number } | null) | null = null;

  private readonly w = new BitWriter(16384);
  private readonly r = new BitReader();
  private readonly body = new Body();
  private readonly cur = new EntityView();
  private readonly ids = new Uint32Array(MAX_VIEW);
  private readonly entityOffsets: Int16Array;
  private readonly structOffsets: Int16Array;

  constructor(world: ServerWorld, opts: Partial<GameOptions> = {}) {
    this.world = world;
    this.opts = { ...DEFAULTS, ...opts };
    this.clients = new Array(this.opts.maxClients).fill(null);
    this.entityOffsets = nearestFirst(this.opts.entityRadius);
    this.structOffsets = nearestFirst(this.opts.structRadius);
  }

  listen(listener: Listener): void {
    listener.onConnection = (conn) => this.accept(conn);
  }

  get playerCount(): number {
    let n = 0;
    for (const c of this.clients) if (c?.active) n++;
    return n;
  }

  /** Advance the world by one fixed step and replicate. */
  tick(): void {
    const world = this.world;
    const ents = world.ents;
    const T = ++world.tick;
    const b = this.body;

    for (const c of this.clients) {
      if (!c) continue;
      c.packets = 0;
      if (!c.active) continue;
      const inputs = c.inputs;
      if (inputs.has(T)) {
        const i = T & inputs.mask;
        c.heldX = inputs.moveX[i]!;
        c.heldZ = inputs.moveZ[i]!;
        c.heldYaw = inputs.yaw[i]!;
        c.heldPitch = inputs.pitch[i]!;
        c.heldButtons = inputs.buttons[i]!;
      } else this.stats.heldInputs++;
      const e = c.ent;
      b.x = ents.x[e]!;
      b.y = ents.y[e]!;
      b.z = ents.z[e]!;
      b.vx = ents.vx[e]!;
      b.vy = ents.vy[e]!;
      b.vz = ents.vz[e]!;
      b.grounded = (ents.flags[e]! & F_GROUNDED) !== 0;
      stepBody(world, b, c.heldX, c.heldZ, c.heldYaw, c.heldButtons, world.reg.move[ents.kind[e]!]!, TICK_DT);
      ents.setPosition(e, b.x, b.y, b.z);
      ents.vx[e] = b.vx;
      ents.vy[e] = b.vy;
      ents.vz[e] = b.vz;
      ents.yaw[e] = c.heldYaw;
      ents.flags[e] = b.grounded ? ents.flags[e]! | F_GROUNDED : ents.flags[e]! & ~F_GROUNDED;
    }

    this.onStep?.(T);

    const snap = T % this.opts.snapshotEvery === 0;
    for (const c of this.clients) {
      if (!c?.active) continue;
      if (snap) this.snapshot(c, T);
      this.syncChunks(c, T);
    }
  }

  /** Disconnect a client, telling it why. */
  reject(c: Client, reason: number): void {
    const w = this.w;
    w.reset();
    w.bits(S_REJECT, 4);
    w.u8(reason);
    c.conn.send(CH_RELIABLE, w.bytes());
    c.conn.close();
  }

  private accept(conn: Connection): void {
    const slot = this.clients.indexOf(null);
    if (slot < 0) {
      const w = this.w;
      w.reset();
      w.bits(S_REJECT, 4);
      w.u8(REJECT_FULL);
      conn.send(CH_RELIABLE, w.bytes());
      conn.close();
      return;
    }
    const c = new Client(slot, conn, chunkCount(this.world.dims));
    this.clients[slot] = c;
    conn.onMessage = (channel, data) => this.receive(c, channel, data);
    conn.onClose = () => this.remove(c);
  }

  private remove(c: Client): void {
    if (this.clients[c.id] !== c) return;
    if (c.active) {
      this.onLeave?.(c);
      this.world.ents.destroy(c.ent);
    }
    c.active = false;
    this.clients[c.id] = null;
  }

  private receive(c: Client, channel: number, data: Uint8Array): void {
    if (++c.packets > MAX_PACKETS_PER_TICK) {
      this.stats.throttled++;
      return;
    }
    const r = this.r;
    let ok = data.length <= MAX_CLIENT_MESSAGE;
    if (ok) {
      r.reset(data);
      const type = r.bits(4);
      if (type === C_INPUT && c.active) ok = this.input(c, r);
      else if (type === C_HELLO && !c.active && channel === CH_RELIABLE) ok = this.hello(c, r);
      else ok = false;
    }
    if (!ok) {
      this.stats.malformed++;
      if (++c.strikes > MAX_STRIKES) this.reject(c, REJECT_MALFORMED);
    }
  }

  private input(c: Client, r: BitReader): boolean {
    const ack = r.u32();
    const newest = readInputs(r, c.inputs, this.world.tick);
    if (newest === 0) return false;
    if (newest <= this.world.tick) this.stats.lateInputs++;
    if (newest > c.newestInput && newest < this.world.tick + INPUT_WINDOW) c.newestInput = newest;
    // An ack can only name a snapshot that was sent, and only move forward.
    if (ack > c.ackTick && ack <= c.lastSnapshot) c.ackTick = ack;
    return true;
  }

  private hello(c: Client, r: BitReader): boolean {
    const version = r.u16();
    const contentHash = r.u32();
    const name = r.string(MAX_NAME_BYTES);
    if (r.overflow) return false;
    const world = this.world;
    if (version !== PROTOCOL_VERSION) return this.refuse(c, REJECT_VERSION);
    if (contentHash !== world.reg.hash) return this.refuse(c, REJECT_CONTENT);
    if (!NAME.test(name)) return this.refuse(c, REJECT_NAME);
    // One body per survivor: a second login under the same name is refused, not duplicated.
    for (const other of this.clients) if (other?.active && other.name === name) return this.refuse(c, REJECT_NAME);

    const kind = world.reg.index.get("core:survivor")!;
    const p = world.reg.move[kind]!;
    let x = world.spawn.x;
    let z = world.spawn.z;
    let y = 0;
    let yaw = world.spawn.yaw;
    const saved = this.savedPosition?.(name);
    if (saved && capsuleFree(world, saved.x, saved.y, saved.z, p.radius, p.height)) {
      x = saved.x;
      y = saved.y;
      z = saved.z;
      yaw = saved.yaw;
    } else {
      // First free spot on rings around the spawn point.
      for (let k = 0; k < 96; k++) {
        const ring = Math.ceil(k / 8);
        const a = (k * TAU) / 8 + ring * 0.4;
        x = world.spawn.x + detSin(a) * ring * 1.5;
        z = world.spawn.z + detCos(a) * ring * 1.5;
        if (capsuleFree(world, x, world.hf.heightAt(x, z), z, p.radius, p.height) && !this.occupied(x, z)) break;
      }
      y = world.hf.heightAt(x, z);
    }
    const e = world.ents.create(kind, x, y, z, F_PLAYER | F_AWAKE);
    if (e < 0) return this.refuse(c, REJECT_FULL);
    world.ents.yaw[e] = yaw;
    c.ent = e;
    c.name = name;
    c.heldYaw = yaw;
    c.active = true;
    this.onJoin?.(c);

    const w = this.w;
    const ents = world.ents;
    w.reset();
    w.bits(S_WELCOME, 4);
    w.u16(PROTOCOL_VERSION);
    w.u32(world.tick);
    w.u32(ents.handleOf(e));
    w.u16(kind);
    w.string(world.mapId);
    w.u32(world.mapHash);
    w.u8(world.dims.chunksX - 1);
    w.u8(world.dims.chunksZ - 1);
    const b = this.body;
    b.x = ents.x[e]!;
    b.y = ents.y[e]!;
    b.z = ents.z[e]!;
    b.vx = b.vy = b.vz = 0;
    b.grounded = false;
    writeBody(w, b);
    w.u16(ents.yaw[e]!);
    c.conn.send(CH_RELIABLE, w.bytes());
    return true;
  }

  private refuse(c: Client, reason: number): boolean {
    this.reject(c, reason);
    return true;
  }

  private occupied(x: number, z: number): boolean {
    const ents = this.world.ents;
    for (const c of this.clients) {
      if (!c?.active) continue;
      const dx = ents.x[c.ent]! - x;
      const dz = ents.z[c.ent]! - z;
      if (dx * dx + dz * dz < 1) return true;
    }
    return false;
  }

  private snapshot(c: Client, T: number): void {
    const world = this.world;
    const ents = world.ents;
    const dims = world.dims;
    const e = c.ent;

    // Entities in the chunks around the player, nearest chunks first.
    const ccx = chunkCx(dims, ents.chunk[e]!);
    const ccz = chunkCz(dims, ents.chunk[e]!);
    const ids = this.ids;
    const offsets = this.entityOffsets;
    let n = 0;
    for (let o = 0; o < offsets.length && n < MAX_VIEW; o += 2) {
      const cx = ccx + offsets[o]!;
      const cz = ccz + offsets[o + 1]!;
      if (cx < 0 || cz < 0 || cx >= dims.chunksX || cz >= dims.chunksZ) continue;
      for (let i = ents.chunkHead[cz * dims.chunksX + cx]!; i >= 0 && n < MAX_VIEW; i = ents.next[i]!) {
        if (i !== e) ids[n++] = i;
      }
    }
    sortU32(ids, n);
    const cur = this.cur;
    cur.count = 0;
    for (let k = 0; k < n; k++) {
      const i = ids[k]!;
      cur.push(i, ents.gen[i]!, ents.kind[i]!, quantX(ents.x[i]!), quantY(ents.y[i]!), quantX(ents.z[i]!), ents.yaw[i]! >>> 6, (ents.flags[i]! >>> 1) & 0xf);
    }

    const age = T - c.ackTick;
    const base = c.ackTick > 0 && age < VIEW_RING ? c.views.find(c.ackTick) : null;
    const next = c.views.alloc(T);

    const w = this.w;
    w.reset();
    w.bits(S_SNAPSHOT, 4);
    w.u32(T);
    w.u8(base ? age : 0);
    let margin = c.newestInput - T;
    if (margin < -127) margin = -127;
    else if (margin > 127) margin = 127;
    w.sbits(margin, 8);
    const b = this.body;
    b.x = ents.x[e]!;
    b.y = ents.y[e]!;
    b.z = ents.z[e]!;
    b.vx = ents.vx[e]!;
    b.vy = ents.vy[e]!;
    b.vz = ents.vz[e]!;
    b.grounded = (ents.flags[e]! & F_GROUNDED) !== 0;
    writeBody(w, b);
    c.rotate = writeViewDelta(w, base, cur, next, this.opts.snapshotBytes * 8 - w.pos, c.rotate);
    c.lastSnapshot = T;
    c.conn.send(CH_UNRELIABLE, w.bytes());
  }

  /** Bring the client's structure tables up to date, nearest chunk first, within a per-tick budget. */
  private syncChunks(c: Client, T: number): void {
    const world = this.world;
    const dims = world.dims;
    const ents = world.ents;
    const ccx = chunkCx(dims, ents.chunk[c.ent]!);
    const ccz = chunkCz(dims, ents.chunk[c.ent]!);
    const offsets = this.structOffsets;
    let budget = this.opts.chunkSlotsPerTick;
    for (let o = 0; o < offsets.length && budget > 0; o += 2) {
      const cx = ccx + offsets[o]!;
      const cz = ccz + offsets[o + 1]!;
      if (cx < 0 || cz < 0 || cx >= dims.chunksX || cz >= dims.chunksZ) continue;
      const chunk = cz * dims.chunksX + cx;
      const t = world.structs.chunks[chunk];
      if (t && t.version > c.known[chunk]!) budget = this.sendChunk(c, chunk, t, budget);
    }

    // Forget chunks the player has left behind.
    if ((T + c.id) % 16 === 0) {
      const limit = this.opts.structRadius + 1;
      const w = this.w;
      for (let i = c.subscribed.length - 1; i >= 0; i--) {
        const chunk = c.subscribed[i]!;
        const dx = chunkCx(dims, chunk) - ccx;
        const dz = chunkCz(dims, chunk) - ccz;
        if (dx <= limit && dx >= -limit && dz <= limit && dz >= -limit) continue;
        c.subscribed[i] = c.subscribed[c.subscribed.length - 1]!;
        c.subscribed.pop();
        c.known[chunk] = 0;
        if (c.syncChunk === chunk) c.syncChunk = -1;
        w.reset();
        w.bits(S_CHUNK_DROP, 4);
        w.u16(chunk);
        c.conn.send(CH_RELIABLE, w.bytes());
      }
    }
  }

  /** Send slots changed since the client's version. Returns the budget left; 0 if the chunk is unfinished. */
  private sendChunk(c: Client, chunk: number, t: ChunkTable, budget: number): number {
    if (c.syncChunk !== chunk) {
      c.syncChunk = chunk;
      c.syncCursor = 0;
      c.syncFrom = c.known[chunk]!;
      c.syncTarget = t.version;
    }
    const dims = this.world.dims;
    const x0 = chunkCx(dims, chunk) * CHUNK_SIZE;
    const z0 = chunkCz(dims, chunk) * CHUNK_SIZE;
    const w = this.w;
    w.reset();
    w.bits(S_CHUNK, 4);
    w.u16(chunk);
    w.u32(c.syncTarget);
    const header = w.pos;
    w.bits(0, 1 + 16);
    let count = 0;
    let s = c.syncCursor;
    for (; s < t.high && count < budget; s++) {
      if (t.mod[s]! <= c.syncFrom) continue;
      const kind = t.kind[s]!;
      w.u16(s);
      w.u16(kind);
      if (kind !== 0) {
        w.bits(Math.round((t.x[s]! - x0) * STRUCT_UNITS), 15);
        w.bits(Math.round((t.z[s]! - z0) * STRUCT_UNITS), 15);
        w.svarint(Math.round(t.y[s]! * STRUCT_UNITS));
        w.u16(t.yaw[s]!);
        w.varint(t.owner[s]!);
        w.f32(t.hp[s]!);
      }
      count++;
    }
    const final = s >= t.high;
    const end = w.pos;
    w.pos = header;
    // The header bits were written as zeros, so OR-ing the real values in is safe.
    w.bits(final ? 1 : 0, 1);
    w.bits(count, 16);
    w.pos = end;
    c.conn.send(CH_RELIABLE, w.bytes());
    if (final) {
      if (c.known[chunk] === 0 && !c.subscribed.includes(chunk)) c.subscribed.push(chunk);
      c.known[chunk] = c.syncTarget;
      c.syncChunk = -1;
      return budget - count;
    }
    c.syncCursor = s;
    return 0;
  }
}

/** Chunk offsets within a square radius, as (dx, dz) pairs sorted by distance. */
function nearestFirst(radius: number): Int16Array {
  const list: [number, number][] = [];
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) list.push([dx, dz]);
  list.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
  return Int16Array.from(list.flat());
}
