// Wire protocol, version 2. Message layouts live here and nowhere else.
//
// Every message starts with a 4-bit type. Channels are fixed per type:
//
//   client -> server
//     HELLO     reliable     version u16, content hash u32, name string, flags u8,
//                            device key (16 bytes)
//     INPUT     unreliable   ack tick u32, newest tick u32, count-1 (3 bits),
//                            then inputs newest first; each after the first is
//                            preceded by one bit: 1 = same as the one before
//     COMMAND   reliable     sequence u16, op u8, arguments by op
//   server -> client
//     WELCOME   reliable     version u16, tick u32, own handle u32, species u16,
//                            session state 2 bits, admin 1 bit, day offset u32,
//                            map id string, map hash u32, chunksX u8+1, chunksZ u8+1,
//                            own body, yaw u16
//     SNAPSHOT  unreliable   tick u32, baseline age u8 (0 = none), input margin s8,
//                            session state 2 bits, own body, entity delta (see view.ts)
//     CHUNK     reliable     chunk u16, version u32, final 1 bit, count varint, slots
//     CHUNK_DROP reliable    chunk u16
//     REJECT    reliable     reason u8
//     RESULT    reliable     command sequence u16, code u8
//     TEXT      reliable     channel u8, text string
//     OWN       reliable     component u8, then that component's fields
//
// The server never trusts a position or a target. A client can say what it
// presses, one input per tick, and what it asks the interface to do, one
// command at a time. Neither message has room for a coordinate of its own body
// or the identity of something to hit.
//
// Commands are applied at most once. They are never resent after a reconnect:
// the client learns what happened from the state it is sent, and RESULT only
// tells the interface why something was refused.

import { BitReader, BitWriter } from "./codec.ts";
import { Body } from "../sim/character.ts";

export const PROTOCOL_VERSION = 2;

export const C_HELLO = 1;
export const C_INPUT = 2;
export const C_COMMAND = 3;

export const S_WELCOME = 1;
export const S_SNAPSHOT = 2;
export const S_CHUNK = 3;
export const S_CHUNK_DROP = 4;
export const S_REJECT = 5;
export const S_RESULT = 6;
export const S_TEXT = 7;
export const S_OWN = 8;

export const REJECT_VERSION = 1;
export const REJECT_CONTENT = 2;
export const REJECT_FULL = 3;
export const REJECT_MALFORMED = 4;
export const REJECT_NAME = 5;
/** Wrong device key for the name, spectating not allowed, or too many password attempts. */
export const REJECT_DENIED = 6;
export const REJECT_KICKED = 7;

/** HELLO flag: join without a body. */
export const HELLO_SPECTATE = 1;
export const KEY_BYTES = 16;

/** What the session is doing. Sent with every snapshot. */
export const SESSION_ALIVE = 0;
export const SESSION_DEAD = 1;
export const SESSION_SPECTATING = 2;

/** Command ops. */
export const CMD_TEXT = 1;
/** Move items between slots: from box 1 bit, slot u8, to box 1 bit, slot u8, count u16 (0 = the whole stack), expected item u16. */
export const CMD_MOVE = 2;
/** Eat or use what is in one of your own slots: slot u8, expected item u16. */
export const CMD_USE = 3;

/** Close the container this session has open. No arguments. */
export const CMD_CLOSE = 4;
/** Return to life at one of the offered places: index u8. */
export const CMD_RESPAWN = 5;

/** Boxes a slot command can address. Nothing else can be named: no ids travel. */
export const BOX_SELF = 0;
/** Whatever container the session has open, if any. */
export const BOX_OPEN = 1;

export const RESULT_OK = 0;
/** Too many commands in flight; try again. */
export const RESULT_BUSY = 1;
export const RESULT_INVALID = 2;
export const RESULT_DENIED = 3;
/** The slot does not hold what the client thought: its picture was out of date. */
export const RESULT_STALE = 4;
export const RESULT_FULL = 5;
export const RESULT_FAR = 6;

/** OWN components. */
export const OWN_SESSION = 1;
/** base tick u32, then for health, food, water, oxygen: value uint53, rate svarint, max uint53 (millionths of a point). */
export const OWN_VITALS = 2;
/**
 * box 1 bit, capacity u8, full 1 bit (forget every slot first), count u8, then
 * per slot: index u8, item u16, and if the item is not 0: count u16, quality u8,
 * durability u16, spoil tick u32.
 */
export const OWN_SLOTS = 3;

/** open 1 bit; if open: capacity u8, name string. Its slots follow as OWN_SLOTS for the open box. */
export const OWN_OPEN = 4;
/** count u8, then per marker: kind u8, x f32, y f32, z f32, tick u32. Oldest first. */
export const OWN_MARKERS = 5;
/** Where a dead survivor may return: count u8, then per place: name string, x f32, z f32. */
export const OWN_RESPAWN = 6;

export const MARKER_DEATH = 1;

export const TEXT_CONSOLE = 0;
export const TEXT_NOTICE = 1;

/** Snapshot input margin meaning "no input has arrived yet": the client must not steer its clock by it. */
export const MARGIN_UNKNOWN = -128;

/** Inputs carried per packet. Losing up to three packets in a row costs nothing. */
export const INPUT_REDUNDANCY = 4;
/** How far ahead of the server tick an input may be and still be buffered. */
export const INPUT_WINDOW = 32;
/** Largest message a client may send, in bytes. */
export const MAX_CLIENT_MESSAGE = 256;
export const MAX_NAME_BYTES = 24;
/** A console line from a client. */
export const MAX_TEXT_BYTES = 200;
/** A text message from the server. */
export const MAX_SERVER_TEXT_BYTES = 1000;
/** Known button bits; others are cleared on receipt. */
export const BUTTON_MASK = 0x0f;
/** Pitch units: 16384 is straight up. */
export const PITCH_LIMIT = 16384;

/** Tick-keyed ring of quantized inputs. Tick 0 is never stored. */
export class InputBuffer {
  readonly mask: number;
  readonly tick: Uint32Array;
  readonly moveX: Int8Array;
  readonly moveZ: Int8Array;
  readonly yaw: Uint16Array;
  readonly pitch: Int16Array;
  readonly buttons: Uint8Array;

  /** `size` must be a power of two. */
  constructor(size: number) {
    this.mask = size - 1;
    this.tick = new Uint32Array(size);
    this.moveX = new Int8Array(size);
    this.moveZ = new Int8Array(size);
    this.yaw = new Uint16Array(size);
    this.pitch = new Int16Array(size);
    this.buttons = new Uint8Array(size);
  }

  has(tick: number): boolean {
    return this.tick[tick & this.mask] === tick;
  }

  /** Store an input, clamping every field to its legal range. */
  set(tick: number, moveX: number, moveZ: number, yaw: number, pitch: number, buttons: number): void {
    const i = tick & this.mask;
    this.tick[i] = tick;
    this.moveX[i] = moveX < -127 ? -127 : moveX > 127 ? 127 : moveX;
    this.moveZ[i] = moveZ < -127 ? -127 : moveZ > 127 ? 127 : moveZ;
    this.yaw[i] = yaw;
    this.pitch[i] = pitch < -PITCH_LIMIT ? -PITCH_LIMIT : pitch > PITCH_LIMIT ? PITCH_LIMIT : pitch;
    this.buttons[i] = buttons & BUTTON_MASK;
  }
}

/** 266 bits: position and velocity exactly, then the rest of the predicted state. */
export function writeBody(w: BitWriter, b: Body): void {
  w.f32(b.x);
  w.f32(b.y);
  w.f32(b.z);
  w.f32(b.vx);
  w.f32(b.vy);
  w.f32(b.vz);
  w.bool(b.grounded);
  w.bits(b.mode, 3);
  w.bits(b.stamina, 26);
  w.u16(b.staminaMax);
  w.bits(b.speedQ, 12);
  w.bits(b.swimQ, 12);
  w.bits(b.mflags, 4);
}

export function readBody(r: BitReader, b: Body): void {
  b.x = r.f32();
  b.y = r.f32();
  b.z = r.f32();
  b.vx = r.f32();
  b.vy = r.f32();
  b.vz = r.f32();
  b.grounded = r.bool();
  b.mode = r.bits(3);
  b.stamina = r.bits(26);
  b.staminaMax = r.u16();
  b.speedQ = r.bits(12);
  b.swimQ = r.bits(12);
  b.mflags = r.bits(4);
}

/** Write a HELLO. `key` must be KEY_BYTES long. */
export function writeHello(w: BitWriter, version: number, contentHash: number, name: string, flags: number, key: Uint8Array): void {
  w.bits(C_HELLO, 4);
  w.u16(version);
  w.u32(contentHash);
  w.string(name);
  w.u8(flags);
  for (let i = 0; i < KEY_BYTES; i++) w.u8(key[i] ?? 0);
}

/** Start a COMMAND; the caller appends the op's arguments. */
export function writeCommand(w: BitWriter, seq: number, op: number): void {
  w.bits(C_COMMAND, 4);
  w.u16(seq);
  w.u8(op);
}

/** Write an INPUT message carrying the newest `count` inputs ending at `newest`. */
export function writeInputs(w: BitWriter, inputs: InputBuffer, ack: number, newest: number, count: number): void {
  w.bits(C_INPUT, 4);
  w.u32(ack);
  w.u32(newest);
  w.bits(count - 1, 3);
  let prev = -1;
  for (let k = 0; k < count; k++) {
    const i = (newest - k) & inputs.mask;
    if (prev >= 0) {
      const same =
        inputs.moveX[i] === inputs.moveX[prev] &&
        inputs.moveZ[i] === inputs.moveZ[prev] &&
        inputs.yaw[i] === inputs.yaw[prev] &&
        inputs.pitch[i] === inputs.pitch[prev] &&
        inputs.buttons[i] === inputs.buttons[prev];
      w.bool(same);
      if (same) continue;
    }
    w.sbits(inputs.moveX[i]!, 8);
    w.sbits(inputs.moveZ[i]!, 8);
    w.u16(inputs.yaw[i]!);
    w.sbits(inputs.pitch[i]!, 16);
    w.u8(inputs.buttons[i]!);
    prev = i;
  }
}

/**
 * Read the body of an INPUT message (after its type) into `inputs`, keeping
 * only ticks in (serverTick, serverTick + INPUT_WINDOW) not already present.
 * Returns the newest tick named by the packet, or 0 if it was malformed.
 */
export function readInputs(r: BitReader, inputs: InputBuffer, serverTick: number): number {
  const newest = r.u32();
  const count = r.bits(3) + 1;
  let moveX = 0;
  let moveZ = 0;
  let yaw = 0;
  let pitch = 0;
  let buttons = 0;
  for (let k = 0; k < count; k++) {
    if (k === 0 || !r.bool()) {
      moveX = r.sbits(8);
      moveZ = r.sbits(8);
      yaw = r.u16();
      pitch = r.sbits(16);
      buttons = r.u8();
    }
    const tick = newest - k;
    if (tick > serverTick && tick < serverTick + INPUT_WINDOW && !inputs.has(tick)) {
      inputs.set(tick, moveX, moveZ, yaw, pitch, buttons);
    }
  }
  return r.overflow ? 0 : newest;
}
