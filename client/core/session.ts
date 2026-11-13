// One client's connection to a world: handshake, input, prediction of the local
// body, reconciliation with the server, and interpolation of everything else.
//
// No DOM, no clock, no socket. The shell (or a test) supplies a Connection and
// calls `update(nowMs, ...)`; everything observable is a field on this object.
//
// Timing. The server consumes exactly one input per tick, numbered by tick. The
// client therefore runs ahead: it simulates tick T before the server does, so
// that input T arrives in time. Each snapshot reports the margin by which
// inputs are arriving; the client steers its tick clock to keep that margin
// small and positive.

import type { Registry } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, STRUCT_UNITS, TICK_DT, TICK_RATE, YAW_UNITS, chunkCx, chunkCz, type MapDims } from "../../shared/coords.ts";
import { handleIndex } from "../../shared/ids.ts";
import { PI, TAU } from "../../shared/math/scalar.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import {
  C_HELLO,
  INPUT_REDUNDANCY,
  InputBuffer,
  PITCH_LIMIT,
  PROTOCOL_VERSION,
  S_CHUNK,
  S_CHUNK_DROP,
  S_REJECT,
  S_SNAPSHOT,
  S_WELCOME,
  readBody,
  writeInputs,
} from "../../shared/net/protocol.ts";
import { CH_RELIABLE, CH_UNRELIABLE, type Connection } from "../../shared/net/transport.ts";
import { EntityView, MAX_VIEW, VIEW_RING, ViewRing, dequantX, dequantY, readViewDelta } from "../../shared/net/view.ts";
import { Body, stepBody, type MoveParams } from "../../shared/sim/character.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";

export interface SessionOptions {
  name: string;
  registry: Registry;
  /** Return the terrain for a map, or null if this client does not have it. */
  resolveMap(mapId: string, mapHash: number, dims: MapDims): Heightfield | null;
}

/** Remote entities at the current render time, filled by `sampleRemote`. */
export class RemoteSample {
  count = 0;
  readonly id = new Uint32Array(MAX_VIEW);
  readonly kind = new Uint16Array(MAX_VIEW);
  readonly x = new Float32Array(MAX_VIEW);
  readonly y = new Float32Array(MAX_VIEW);
  readonly z = new Float32Array(MAX_VIEW);
  /** Radians. */
  readonly yaw = new Float32Array(MAX_VIEW);
  readonly flags = new Uint8Array(MAX_VIEW);
}

const HISTORY = 128;
/** Ticks the client starts ahead of the server before any feedback. */
const INITIAL_LEAD = 4;
/** Inputs the server should have in hand when it needs one. */
const TARGET_MARGIN = 2;
const MAX_STEPS_PER_UPDATE = 8;
const CLOSED_BY_PEER = -1;
const CLOSED_BAD_MAP = -2;

export class ClientSession {
  state: "connecting" | "active" | "closed" = "connecting";
  /** Reject reason from the server, or a negative local reason. */
  closeReason = 0;

  world: (CollisionWorld & { dims: MapDims }) | null = null;
  ownHandle = 0;
  ownKind = 0;
  /** Predicted local body after the latest simulated tick. */
  readonly own = new Body();
  /** Predicted local body one tick earlier, for render interpolation. */
  readonly ownPrev = new Body();
  ownYaw = 0;
  ownPitch = 0;

  /** Latest tick the client has simulated. */
  simTick = 0;
  /** Fractional tick clock that `simTick` follows. */
  tickClock = 0;
  /** Smoothed estimate of the newest server tick received. */
  renderClock = 0;
  latestSnapshot = 0;

  readonly stats = { snapshots: 0, undecodable: 0, corrections: 0, clockJumps: 0, margin: 0, rttTicks: 0, bytesIn: 0 };

  private readonly conn: Connection;
  private readonly opts: SessionOptions;
  private move: MoveParams | null = null;
  private readonly inputs = new InputBuffer(HISTORY);
  private readonly bodies: Body[] = [];
  private readonly bodyTick = new Uint32Array(HISTORY);
  private readonly views = new ViewRing();
  private readonly w = new BitWriter(256);
  private readonly r = new BitReader();
  private readonly serverBody = new Body();
  private lastNow = -1;
  private dilation = 1;
  private guardTick = 0;
  private needFull = true;

  constructor(conn: Connection, opts: SessionOptions) {
    this.conn = conn;
    this.opts = opts;
    for (let i = 0; i < HISTORY; i++) this.bodies.push(new Body());
    conn.onMessage = (channel, data) => this.receive(channel, data);
    conn.onClose = () => {
      if (this.state !== "closed") {
        this.state = "closed";
        this.closeReason = CLOSED_BY_PEER;
      }
    };
    const w = this.w;
    w.bits(C_HELLO, 4);
    w.u16(PROTOCOL_VERSION);
    w.u32(opts.registry.hash);
    w.string(opts.name);
    conn.send(CH_RELIABLE, w.bytes());
  }

  /** Fraction of the way from `ownPrev` to `own` at the last `update`. */
  get alpha(): number {
    const a = this.tickClock - this.simTick;
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }

  /**
   * Advance to `nowMs`, sampling the given input for every tick that elapses.
   * `moveX`/`moveZ` are -1..1 (right, forward); `yaw`/`pitch` are radians.
   */
  update(nowMs: number, moveX: number, moveZ: number, yaw: number, pitch: number, buttons: number): void {
    if (this.state !== "active") return;
    let dt = this.lastNow < 0 ? 0 : nowMs - this.lastNow;
    this.lastNow = nowMs;
    if (dt > 250) dt = 250;
    const ticks = (dt / 1000) * TICK_RATE;
    this.tickClock += ticks * this.dilation;
    this.renderClock += ticks;

    const qx = Math.round(clamp1(moveX) * 127);
    const qz = Math.round(clamp1(moveZ) * 127);
    const qyaw = Math.round((yaw / TAU) * YAW_UNITS) & 0xffff;
    const qpitch = Math.round((pitch / (PI / 2)) * PITCH_LIMIT);
    this.ownYaw = yaw;
    this.ownPitch = pitch;

    const target = Math.floor(this.tickClock);
    let steps = 0;
    while (this.simTick < target && steps < MAX_STEPS_PER_UPDATE) {
      const t = ++this.simTick;
      steps++;
      this.inputs.set(t, qx, qz, qyaw, qpitch, buttons);
      this.ownPrev.copy(this.own);
      this.step(t);
    }
    // Too far behind to catch up by simulating: skip. The server held the last input meanwhile.
    if (this.simTick < target) this.simTick = target;
    if (steps > 0) this.sendInputs();
  }

  /** Fill `out` with remote entities interpolated to the current render time. */
  sampleRemote(out: RemoteSample, delayTicks = 2): void {
    out.count = 0;
    const at = this.renderClock - delayTicks;
    let a: EntityView | null = null;
    let b: EntityView | null = null;
    for (let i = 0; i < VIEW_RING; i++) {
      const v = this.views.at(i);
      if (v.tick === 0) continue;
      if (v.tick <= at) {
        if (!a || v.tick > a.tick) a = v;
      } else if (!b || v.tick < b.tick) b = v;
    }
    if (!b) b = a;
    if (!b) return;
    const k = a && a !== b ? (at - a.tick) / (b.tick - a.tick) : 1;
    let i = 0;
    const na = a ? a.count : 0;
    for (let j = 0; j < b.count; j++) {
      const id = b.id[j]!;
      while (i < na && a!.id[i]! < id) i++;
      const n = out.count++;
      out.id[n] = id;
      out.kind[n] = b.kind[j]!;
      out.flags[n] = b.flags[j]!;
      if (a !== b && i < na && a!.id[i] === id && a!.gen[i] === b.gen[j]) {
        out.x[n] = dequantX(a!.qx[i]! + (b.qx[j]! - a!.qx[i]!) * k);
        out.y[n] = dequantY(a!.qy[i]! + (b.qy[j]! - a!.qy[i]!) * k);
        out.z[n] = dequantX(a!.qz[i]! + (b.qz[j]! - a!.qz[i]!) * k);
        let turn = b.yaw[j]! - a!.yaw[i]!;
        if (turn > 512) turn -= 1024;
        else if (turn < -512) turn += 1024;
        out.yaw[n] = ((a!.yaw[i]! + turn * k) * TAU) / 1024;
      } else {
        out.x[n] = dequantX(b.qx[j]!);
        out.y[n] = dequantY(b.qy[j]!);
        out.z[n] = dequantX(b.qz[j]!);
        out.yaw[n] = (b.yaw[j]! * TAU) / 1024;
      }
    }
  }

  close(): void {
    this.state = "closed";
    this.conn.close();
  }

  private step(t: number): void {
    const i = t & this.inputs.mask;
    const inp = this.inputs;
    stepBody(this.world!, this.own, inp.moveX[i]!, inp.moveZ[i]!, inp.yaw[i]!, inp.buttons[i]!, this.move!, TICK_DT);
    this.bodies[t & (HISTORY - 1)]!.copy(this.own);
    this.bodyTick[t & (HISTORY - 1)] = t;
  }

  private sendInputs(): void {
    let count = 1;
    while (count < INPUT_REDUNDANCY && this.inputs.has(this.simTick - count)) count++;
    const w = this.w;
    w.reset();
    writeInputs(w, this.inputs, this.needFull ? 0 : this.latestSnapshot, this.simTick, count);
    this.conn.send(CH_UNRELIABLE, w.bytes());
  }

  private receive(_channel: number, data: Uint8Array): void {
    if (this.state === "closed") return;
    this.stats.bytesIn += data.length;
    const r = this.r;
    r.reset(data);
    const type = r.bits(4);
    if (type === S_SNAPSHOT) {
      if (this.state === "active") this.snapshot(r);
    } else if (type === S_CHUNK) this.chunk(r);
    else if (type === S_CHUNK_DROP) this.world?.structs.dropChunk(r.u16());
    else if (type === S_WELCOME) this.welcome(r);
    else if (type === S_REJECT) {
      this.state = "closed";
      this.closeReason = r.u8();
    }
  }

  private welcome(r: BitReader): void {
    const version = r.u16();
    const tick = r.u32();
    this.ownHandle = r.u32();
    this.ownKind = r.u16();
    const mapId = r.string(64);
    const mapHash = r.u32();
    const dims = { chunksX: r.u8() + 1, chunksZ: r.u8() + 1 };
    readBody(r, this.own);
    const yaw = r.u16();
    const reg = this.opts.registry;
    const hf = r.overflow || version !== PROTOCOL_VERSION ? null : this.opts.resolveMap(mapId, mapHash, dims);
    const move = reg.move[this.ownKind];
    if (!hf || !move) {
      this.state = "closed";
      this.closeReason = CLOSED_BAD_MAP;
      this.conn.close();
      return;
    }
    this.world = { dims, hf, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ) };
    this.move = move;
    this.ownPrev.copy(this.own);
    this.ownYaw = (yaw * TAU) / YAW_UNITS;
    this.tickClock = tick + INITIAL_LEAD;
    this.simTick = tick + INITIAL_LEAD;
    this.renderClock = tick;
    this.state = "active";
  }

  private snapshot(r: BitReader): void {
    const tick = r.u32();
    const age = r.u8();
    const margin = r.sbits(8);
    const sb = this.serverBody;
    readBody(r, sb);
    if (r.overflow || tick <= this.latestSnapshot) return;

    const base = age > 0 ? this.views.find(tick - age) : null;
    if (age > 0 && !base) {
      // Encoded against a view this client no longer has. Ask for a full one.
      this.stats.undecodable++;
      this.needFull = true;
      return;
    }
    const next = this.views.alloc(tick);
    if (!readViewDelta(r, base, next) || r.overflow) {
      next.tick = 0;
      this.stats.undecodable++;
      this.needFull = true;
      return;
    }
    this.latestSnapshot = tick;
    this.needFull = false;
    this.stats.snapshots++;
    this.stats.margin = margin;

    // Render clock follows the newest server tick, smoothly unless far off.
    const lag = tick - this.renderClock;
    if (lag > 6 || lag < -6) this.renderClock = tick;
    else this.renderClock += lag * 0.1;

    // Input clock: keep the server's margin near the target.
    this.stats.rttTicks = this.simTick - tick - margin;
    if (this.simTick >= this.guardTick) {
      const error = TARGET_MARGIN - margin;
      if (error >= 3 || error <= -6) {
        this.tickClock += error;
        this.dilation = 1;
        this.stats.clockJumps++;
        // Ignore feedback until snapshots can reflect this jump.
        this.guardTick = Math.floor(this.tickClock) + Math.max(0, Math.ceil(this.stats.rttTicks)) + 2;
      } else {
        this.dilation = 1 + (error > 2 ? 2 : error < -2 ? -2 : error) * 0.01;
      }
    }

    this.reconcile(tick, sb);
  }

  /** Compare the server's body at `tick` with what was predicted; on a mismatch, rewind and replay. */
  private reconcile(tick: number, sb: Body): void {
    if (tick >= this.simTick) {
      // The server is at or past our prediction (join, stall): adopt its state.
      this.own.copy(sb);
      this.ownPrev.copy(sb);
      return;
    }
    const slot = tick & (HISTORY - 1);
    const predicted = this.bodyTick[slot] === tick;
    if (predicted && this.bodies[slot]!.equals(sb)) return;
    if (predicted) this.stats.corrections++;
    if (this.simTick - tick >= HISTORY) {
      this.own.copy(sb);
      this.ownPrev.copy(sb);
      return;
    }
    this.own.copy(sb);
    this.bodies[slot]!.copy(sb);
    this.bodyTick[slot] = tick;
    // Replay. Ticks with no stored input repeat the previous one, as the server did.
    let last = this.inputs.has(tick) ? tick : 0;
    for (let t = tick + 1; t <= this.simTick; t++) {
      if (this.inputs.has(t)) last = t;
      else if (last !== 0) {
        const i = last & this.inputs.mask;
        this.inputs.set(t, this.inputs.moveX[i]!, this.inputs.moveZ[i]!, this.inputs.yaw[i]!, this.inputs.pitch[i]!, this.inputs.buttons[i]!);
        last = t;
      } else this.inputs.set(t, 0, 0, Math.round((this.ownYaw / TAU) * YAW_UNITS) & 0xffff, 0, 0);
      if (t === this.simTick) this.ownPrev.copy(this.own);
      this.step(t);
    }
  }

  private chunk(r: BitReader): void {
    const world = this.world;
    if (!world) return;
    const chunk = r.u16();
    const version = r.u32();
    const final = r.bool();
    const count = r.bits(16);
    if (chunk >= world.structs.chunks.length) return;
    const x0 = chunkCx(world.dims, chunk) * CHUNK_SIZE;
    const z0 = chunkCz(world.dims, chunk) * CHUNK_SIZE;
    const kinds = this.opts.registry.defs.length;
    for (let i = 0; i < count; i++) {
      const slot = r.u16();
      const kind = r.u16();
      if (kind === 0) {
        if (!r.overflow) world.structs.put(chunk, slot, 0, 0, 0, 0, 0, 0, 0, version);
        continue;
      }
      const x = x0 + r.bits(15) / STRUCT_UNITS;
      const z = z0 + r.bits(15) / STRUCT_UNITS;
      const y = r.svarint() / STRUCT_UNITS;
      const yaw = r.u16();
      const owner = r.varint();
      const hp = r.f32();
      if (r.overflow || kind >= kinds) return;
      world.structs.put(chunk, slot, kind, x, y, z, yaw, owner, hp, version);
    }
    if (final) world.structs.setVersion(chunk, version);
  }
}

function clamp1(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** Slot index of the local body among replicated entities, for callers that need to exclude it. */
export function ownIndex(session: ClientSession): number {
  return handleIndex(session.ownHandle);
}
