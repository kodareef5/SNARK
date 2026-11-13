// Wire protocol, version 1. Message layouts live here and nowhere else.
//
// Every message starts with a 4-bit type. Channels are fixed per type:
//
//   client -> server
//     HELLO     reliable     version u16, content hash u32, name string
//     INPUT     unreliable   ack tick u32, newest tick u32, count-1 (3 bits),
//                            then inputs newest first; each after the first is
//                            preceded by one bit: 1 = same as the one before
//   server -> client
//     WELCOME   reliable     version u16, tick u32, own handle u32, species u16,
//                            map id string, map hash u32, chunksX u8+1, chunksZ u8+1, own body
//     SNAPSHOT  unreliable   tick u32, baseline age u8 (0 = none), input margin s8,
//                            own body, entity delta (see view.ts)
//     CHUNK     reliable     chunk u16, version u32, final 1 bit, count varint, slots
//     CHUNK_DROP reliable    chunk u16
//     REJECT    reliable     reason u8
//
// The server never trusts a position. A client can only say what it presses, one
// input per tick, so speed and teleport cheats have no message to travel in.

import { BitReader, BitWriter } from "./codec.ts";
import { Body } from "../sim/character.ts";

export const PROTOCOL_VERSION = 1;

export const C_HELLO = 1;
export const C_INPUT = 2;

export const S_WELCOME = 1;
export const S_SNAPSHOT = 2;
export const S_CHUNK = 3;
export const S_CHUNK_DROP = 4;
export const S_REJECT = 5;

export const REJECT_VERSION = 1;
export const REJECT_CONTENT = 2;
export const REJECT_FULL = 3;
export const REJECT_MALFORMED = 4;
export const REJECT_NAME = 5;

/** Inputs carried per packet. Losing up to three packets in a row costs nothing. */
export const INPUT_REDUNDANCY = 4;
/** How far ahead of the server tick an input may be and still be buffered. */
export const INPUT_WINDOW = 32;
/** Largest message a client may send, in bytes. */
export const MAX_CLIENT_MESSAGE = 128;
export const MAX_NAME_BYTES = 24;
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

export function writeBody(w: BitWriter, b: Body): void {
  w.f32(b.x);
  w.f32(b.y);
  w.f32(b.z);
  w.f32(b.vx);
  w.f32(b.vy);
  w.f32(b.vz);
  w.bool(b.grounded);
}

export function readBody(r: BitReader, b: Body): void {
  b.x = r.f32();
  b.y = r.f32();
  b.z = r.f32();
  b.vx = r.f32();
  b.vy = r.f32();
  b.vz = r.f32();
  b.grounded = r.bool();
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
