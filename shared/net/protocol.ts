// Wire protocol, version 4. Message layouts live here and nowhere else.
//
// Every message starts with a 4-bit type. Channels are fixed per type:
//
//   client -> server
//     HELLO     reliable     version u16, content hash u32, clip hash u32, name string,
//                            flags u8, device key (16 bytes), and with HELLO_LOOK a look (28 bytes)
//     INPUT     unreliable   ack tick u32, ticks behind it that others are drawn u8 (sixteenths),
//                            newest tick u32, count-1 (3 bits),
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
//     NODES     reliable     chunk u16, version u32, count u8, used-up slots
//     EVENT     reliable     kind u8, then that kind's fields (see EVENT_*)
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
import { LOOK_BYTES } from "../anim/look.ts";
import { Body } from "../sim/character.ts";

export const PROTOCOL_VERSION = 4;

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
/** Which nodes of a chunk are used up: chunk u16, version u32, count u8, slot u8 each. Reliable. */
export const S_NODES = 9;
/** Something happened that this client is told about once: a hit it landed, harm it took, a death. See EVENT_*. */
export const S_EVENT = 10;

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
/** HELLO flag: a look follows the key. A new survivor is made with it at once, without the creator. */
export const HELLO_LOOK = 2;
export const KEY_BYTES = 16;

/** What the session is doing. Sent with every snapshot. */
export const SESSION_ALIVE = 0;
export const SESSION_DEAD = 1;
export const SESSION_SPECTATING = 2;
/** A new survivor with no look yet: it has no body until it sends one with CMD_CREATE. */
export const SESSION_CREATING = 3;

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

/** Put a level-up point into a stat: stat u8. */
export const CMD_SPEND = 6;
/** Learn an engram: content index u16. */
export const CMD_LEARN = 7;
/** Make something: recipe content index u16, how many u8. */
export const CMD_CRAFT = 8;

/** Make this session's survivor with a look: 28 bytes (shared/anim/look.ts). Only while the session is creating. */
export const CMD_CREATE = 9;

/** Take a hotbar slot's item in hand: slot u8, 0 to 9, or 255 to put away what is held. */
export const CMD_SELECT = 10;
/** Set the weapon in a slot of your own to take a kind of ammunition: weapon slot u8, ammunition item u16. Rounds of another kind in it go back to the bag. */
export const CMD_LOAD = 11;
/** Fit an attachment to a weapon, both in slots of your own: weapon slot u8, attachment slot u8. */
export const CMD_ATTACH = 12;
/** Take the attachment off the weapon in a slot of your own: slot u8. */
export const CMD_DETACH = 13;
/** Take the rounds out of the weapon in a slot of your own: slot u8. */
export const CMD_UNLOAD = 14;
/** Repair the thing in a slot of your own, for a share of what it is made of: slot u8. */
export const CMD_REPAIR = 15;
/** Drop from a slot of your own onto the ground: slot u8, count u16 (0 = the whole stack), expected item u16. */
export const CMD_DROP = 16;
/**
 * Round 4's commands, numbered here once so that nothing is renumbered as its parts arrive:
 * 17 chat, 18 place a structure, 19 act on a structure, 20 order a creature, 21 name one,
 * 22 feed one, 23 open one. Each is defined beside the part that handles it.
 */
export const CMD_CHAT = 17;
export const CMD_PLACE = 18;
export const CMD_STRUCT = 19;
export const CMD_ORDER = 20;
export const CMD_NAME = 21;
export const CMD_FEED = 22;
export const CMD_OPEN = 23;

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
/** Not enough of something: points, level, ingredients. */
export const RESULT_SHORT = 7;

/** OWN components. */
export const OWN_SESSION = 1;
/** base tick u32, then for health, food, water, oxygen: value uint53, rate svarint, max uint53 (millionths of a point). */
export const OWN_VITALS = 2;
/**
 * box 1 bit, capacity u8, bag size u8, full 1 bit (forget every slot first),
 * count u8, then per slot: index u8, item u16, and if the item is not 0: count
 * u16, quality u8, durability u16, spoil tick u32, and 1 bit for "it holds
 * something", then if so: ammunition item u16, rounds u8, attachment item u16.
 */
export const OWN_SLOTS = 3;

/** open 1 bit; if open: capacity u8, name string. Its slots follow as OWN_SLOTS for the open box. */
export const OWN_OPEN = 4;
/** count u8, then per marker: kind u8, x f32, y f32, z f32, tick u32. Oldest first. */
export const OWN_MARKERS = 5;
/** Where a dead survivor may return: count u8, then per place: name string, x f32, z f32. */
export const OWN_RESPAWN = 6;

/**
 * experience u32, level u16, unspent stat points u16, unspent engram points u16,
 * learned engrams (count u8, content index u16 each), crafting jobs (count u8,
 * then recipe u16, units left u8, tick the current unit is done u32 each).
 */
export const OWN_PROGRESSION = 7;

/** The survivor's own look: 28 bytes. Sent when it gets a body. */
export const OWN_LOOK = 8;

/** Which hotbar slot is in the survivor's hands: u8, 255 for none. */
export const OWN_HELD = 9;
/** What is acting on the body for a time: count u8, then for each a buff (u16 content index) and the tick it ends (u32; 0 for one with no end). */
export const OWN_BUFFS = 10;
/** The server's rules that a client acts on: flags u8 (bit 0: the damage of hits may be shown as numbers). */
export const OWN_RULES = 11;
/** Reserved for round 4, in the same way: the tribe, the voice socket's token and rights, and the creature opened or ridden. */
export const OWN_TRIBE = 12;
export const OWN_VOICE = 13;
export const OWN_SUBJECT = 14;

export const MARKER_DEATH = 1;

/**
 * Kinds of S_EVENT, each after a u8 naming it.
 * HIT, to whoever landed it: where (3 x f32), the part hit (4 bits), the damage (u16), whether it killed, whether armor stopped some of it.
 * HURT, to whoever took it: the damage (u16), the side it came from (u8, 256ths of a turn, as a facing), the part hit (4 bits).
 * DEATH, likewise, then: who did it (a string), with what (u16 content index, 0 for bare hands), from how far (u16, tenths of a metre).
 * KILL, to whoever did it: what died (a string), its level (u16), the experience gained (u16, tenths).
 */
export const EVENT_HIT = 1;
/** Bytes of a name in an event, at most: 24 characters of up to three bytes each. */
export const EVENT_NAME_BYTES = 72;
export const EVENT_HURT = 2;
export const EVENT_DEATH = 3;
export const EVENT_KILL = 4;
/**
 * SHOT, to whoever is near: something was fired. Where from (3 x f32), then
 * the ammunition (u16 content index), then whether it flies. If it flies: its
 * velocity (3 x f32) and how many ticks ago it left (u8). If not: where it
 * ended (3 x f32).
 */
export const EVENT_SHOT = 5;
/** BLAST, to whoever is near: something went off. Where (3 x f32) and how far it reached (f32, metres). */
export const EVENT_BLAST = 6;

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
/** Bits an input's buttons take on the wire, and the known ones; others are cleared on receipt. */
export const BUTTON_BITS = 10;
export const BUTTON_MASK = 0x3ff;
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
  readonly buttons: Uint16Array;
  /**
   * On the server: the moment of the world the client was drawing when it
   * sampled this input, in ticks, as the client said: the newest snapshot it
   * had, less how far behind that it draws. It is what the client was looking
   * at when it pressed the button. Unchecked; whoever uses it bounds it.
   */
  readonly view: Float64Array;

  /** `size` must be a power of two. */
  constructor(size: number) {
    this.mask = size - 1;
    this.tick = new Uint32Array(size);
    this.moveX = new Int8Array(size);
    this.moveZ = new Int8Array(size);
    this.yaw = new Uint16Array(size);
    this.pitch = new Int16Array(size);
    this.buttons = new Uint16Array(size);
    this.view = new Float64Array(size);
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

/** 344 bits: position and velocity exactly, then the rest of the predicted state. */
export function writeBody(w: BitWriter, b: Body): void {
  w.f32(b.x);
  w.f32(b.y);
  w.f32(b.z);
  w.f32(b.vx);
  w.f32(b.vy);
  w.f32(b.vz);
  w.bool(b.grounded);
  w.bits(b.mode, 3);
  w.bits(b.stance, 2);
  w.bits(b.stamina, 26);
  w.u16(b.staminaMax);
  w.bits(b.speedQ, 12);
  w.bits(b.swimQ, 12);
  w.bits(b.mflags, 5);
  w.u16(b.kind);
  w.u16(b.yaw);
  w.u16(b.held);
  w.bits(b.act, 3);
  w.u8(b.actTicks);
  w.u8(b.rounds);
  w.u8(b.reloadTo);
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
  b.stance = r.bits(2);
  b.stamina = r.bits(26);
  b.staminaMax = r.u16();
  b.speedQ = r.bits(12);
  b.swimQ = r.bits(12);
  b.mflags = r.bits(5);
  b.kind = r.u16();
  b.yaw = r.u16();
  b.held = r.u16();
  b.act = r.bits(3);
  b.actTicks = r.u8();
  b.rounds = r.u8();
  b.reloadTo = r.u8();
}

/** Write a HELLO. `key` must be KEY_BYTES long. */
export function writeHello(w: BitWriter, version: number, contentHash: number, clipHash: number, name: string, flags: number, key: Uint8Array, look: Uint8Array | null = null): void {
  w.bits(C_HELLO, 4);
  w.u16(version);
  w.u32(contentHash);
  w.u32(clipHash);
  w.string(name);
  w.u8(look ? flags | HELLO_LOOK : flags & ~HELLO_LOOK);
  for (let i = 0; i < KEY_BYTES; i++) w.u8(key[i] ?? 0);
  if (look) for (let i = 0; i < LOOK_BYTES; i++) w.u8(look[i] ?? 0);
}

/** Start a COMMAND; the caller appends the op's arguments. */
export function writeCommand(w: BitWriter, seq: number, op: number): void {
  w.bits(C_COMMAND, 4);
  w.u16(seq);
  w.u8(op);
}

/** Write an INPUT message carrying the newest `count` inputs ending at `newest`. */
/** Steps to a tick in which a client says how far behind its newest snapshot it draws the world. */
export const VIEW_STEPS = 16;

/**
 * Write an INPUT: the newest snapshot decoded (`ack`), how many ticks behind
 * it the client is drawing everyone else (`behind`, up to 15), then the newest
 * `count` inputs.
 */
export function writeInputs(w: BitWriter, inputs: InputBuffer, ack: number, newest: number, count: number, behind = 0): void {
  w.bits(C_INPUT, 4);
  w.u32(ack);
  const steps = Math.round(behind * VIEW_STEPS);
  w.u8(steps < 0 ? 0 : steps > 255 ? 255 : steps);
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
    w.bits(inputs.buttons[i]!, BUTTON_BITS);
    prev = i;
  }
}

/**
 * Read the body of an INPUT message (after its type) into `inputs`, keeping
 * only ticks in (serverTick, serverTick + INPUT_WINDOW) not already present.
 * Returns the newest tick named by the packet, or 0 if it was malformed.
 */
/** Read the inputs of an INPUT whose `ack` and `behind` (in ticks) have been read already. Returns the newest tick named, or 0. */
export function readInputs(r: BitReader, inputs: InputBuffer, serverTick: number, ack = 0, behind = 0): number {
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
      buttons = r.bits(BUTTON_BITS);
    }
    const tick = newest - k;
    if (tick > serverTick && tick < serverTick + INPUT_WINDOW && !inputs.has(tick)) {
      inputs.set(tick, moveX, moveZ, yaw, pitch, buttons);
      // The message speaks of the moment its newest input was sampled; an older input was sampled that much earlier.
      inputs.view[tick & inputs.mask] = ack - behind - k;
    }
  }
  return r.overflow ? 0 : newest;
}
