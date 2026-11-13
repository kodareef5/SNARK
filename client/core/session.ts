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
  CMD_TEXT,
  HELLO_SPECTATE,
  INPUT_REDUNDANCY,
  InputBuffer,
  MARGIN_UNKNOWN,
  MAX_SERVER_TEXT_BYTES,
  MAX_TEXT_BYTES,
  OWN_SESSION,
  PITCH_LIMIT,
  PROTOCOL_VERSION,
  SESSION_ALIVE,
  S_CHUNK,
  S_CHUNK_DROP,
  S_OWN,
  S_REJECT,
  S_RESULT,
  S_SNAPSHOT,
  S_TEXT,
  S_WELCOME,
  readBody,
  writeCommand,
  writeHello,
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
  /** The device key that owns the name: 16 random bytes kept by this client. */
  key: Uint8Array;
  /** Join without a body, if the server allows it. */
  spectate?: boolean;
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
/** Lines of server text kept for the console. */
const LOG_LINES = 200;

export interface TextLine {
  channel: number;
  text: string;
}

export class ClientSession {
  state: "connecting" | "active" | "closed" = "connecting";
  /** Reject reason from the server, or a negative local reason. */
  closeReason = 0;

  world: (CollisionWorld & { dims: MapDims }) | null = null;
  /** Handle of the local entity, or 0 while there is none (spectating, dead). */
  ownHandle = 0;
  ownKind = 0;
  /** SESSION_ALIVE, SESSION_DEAD or SESSION_SPECTATING, as the server last said. */
  sessionState = SESSION_ALIVE;
  /** Cheats are enabled for this session. */
  admin = false;
  /** Added to the tick to get the time of day. */
  dayOffset = 0;
  /** Text from the server, oldest first. `logVersion` counts every line ever added. */
  readonly log: TextLine[] = [];
  logVersion = 0;
  /** Called with the sequence number and code when the server answers a command. */
  onResult: ((seq: number, code: number) => void) | null = null;
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
  private commandSeq = 0;

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
    writeHello(w, PROTOCOL_VERSION, opts.registry.hash, opts.name, opts.spectate ? HELLO_SPECTATE : 0, opts.key);
    conn.send(CH_RELIABLE, w.bytes());
  }

  /**
   * Send a command; `args` appends the op's arguments. Returns its sequence
   * number. Commands are not predicted and not resent: what happened shows up
   * in the state the server sends.
   */
  command(op: number, args?: (w: BitWriter) => void): number {
    const seq = (this.commandSeq = (this.commandSeq + 1) & 0xffff);
    if (this.state !== "active") return seq;
    const w = this.w;
    w.reset();
    writeCommand(w, seq, op);
    args?.(w);
    this.conn.send(CH_RELIABLE, w.bytes());
    return seq;
  }

  /** Send a console line. */
  text(line: string): number {
    // Cut by characters: three bytes each at most keeps the line under the server's limit.
    const cut = line.length > MAX_TEXT_BYTES / 3 ? line.slice(0, Math.floor(MAX_TEXT_BYTES / 3)) : line;
    return this.command(CMD_TEXT, (w) => w.string(cut));
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
    stepBody(this.world!, this.own, inp.moveX[i]!, inp.moveZ[i]!, inp.yaw[i]!, inp.pitch[i]!, inp.buttons[i]!, this.move!, TICK_DT);
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
    else if (type === S_RESULT) {
      const seq = r.u16();
      const code = r.u8();
      if (!r.overflow) this.onResult?.(seq, code);
    } else if (type === S_TEXT) {
      const channel = r.u8();
      const text = r.string(MAX_SERVER_TEXT_BYTES);
      if (r.overflow) return;
      this.log.push({ channel, text });
      if (this.log.length > LOG_LINES) this.log.shift();
      this.logVersion++;
    } else if (type === S_OWN) this.ownState(r);
    else if (type === S_REJECT) {
      this.state = "closed";
      this.closeReason = r.u8();
    }
  }

  /** Owner-private state: one component per message. */
  private ownState(r: BitReader): void {
    const component = r.u8();
    if (component === OWN_SESSION) {
      const state = r.bits(2);
      const admin = r.bool();
      const handle = r.u32();
      const dayOffset = r.u32();
      if (r.overflow) return;
      this.sessionState = state;
      this.admin = admin;
      this.ownHandle = handle;
      this.dayOffset = dayOffset;
    }
  }

  private welcome(r: BitReader): void {
    const version = r.u16();
    const tick = r.u32();
    this.ownHandle = r.u32();
    this.ownKind = r.u16();
    this.sessionState = r.bits(2);
    this.admin = r.bool();
    this.dayOffset = r.u32();
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
    const state = r.bits(2);
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
    this.sessionState = state;
    this.stats.snapshots++;

    // Render clock follows the newest server tick, smoothly unless far off.
    const lag = tick - this.renderClock;
    if (lag > 6 || lag < -6) this.renderClock = tick;
    else this.renderClock += lag * 0.1;

    // Input clock: keep the server's margin near the target, once it has one to report.
    if (margin !== MARGIN_UNKNOWN) {
      this.stats.margin = margin;
      // At either end of its range the margin is a bound, not a measurement.
      if (margin > -127 && margin < 127) this.stats.rttTicks = this.simTick - tick - margin;
      if (this.simTick >= this.guardTick) {
        const error = TARGET_MARGIN - margin;
        if (error >= 3 || error <= -6) {
          this.tickClock += error;
          this.dilation = 1;
          this.stats.clockJumps++;
          // Simulated far past the new time: waiting for the clock to catch up would
          // freeze the player. Start again from here; the next snapshot supplies the body.
          const at = Math.floor(this.tickClock);
          if (this.simTick - at > TICK_RATE) {
            this.simTick = at;
            this.bodyTick.fill(0);
            this.inputs.tick.fill(0);
          }
          // Ignore feedback until snapshots can reflect this jump: a round trip,
          // but never more than a second, since the estimate is unreliable just after a jump.
          const wait = Math.ceil(this.stats.rttTicks);
          this.guardTick = Math.floor(this.tickClock) + (wait < 0 ? 0 : wait > TICK_RATE ? TICK_RATE : wait) + 2;
        } else {
          this.dilation = 1 + (error > 2 ? 2 : error < -2 ? -2 : error) * 0.01;
        }
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
