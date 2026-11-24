// Message layouts live here and nowhere else. Every message starts with its type, and each type has a fixed channel. A client's
// type is 4 bits. The server's is a byte, since it has many more kinds of message to tell apart.
//
// No code here is numbered by hand (shared/codes.ts): a kind of message, a command, an own component, an event or a flag
// takes its number from its place among its kind's lines. To add one, add its line after the last of its kind. There is no
// version to raise: PROTOCOL_VERSION is a hash of the source.
//
//   client -> server
//     HELLO     reliable     version u32, content hash u32 (of the definitions as written, untuned), clip hash u32,
//                            name string, flags u8, device key (16 bytes), with HELLO_LOOK a look (28 bytes),
//                            with HELLO_TICKET a travel ticket (32 bytes), password string ("" for none), with HELLO_NEW a 16-byte create request id
//     INPUT     unreliable   ack tick u32, ticks behind it that others are drawn u8 (sixteenths), newest tick u32,
//                            count-1 (3 bits), then inputs newest first. Each after the first is preceded by
//                            one bit: 1 = same as the one before.
//     COMMAND   reliable     sequence u16 (1 to 65,535, then 1 again), op u8, arguments by op
//               CMD_CREATE carries the look and an optional public spawn index (u8).
//   server -> client
//     WELCOME   reliable     version u32, tick u32, own handle u32, species u16, session state 2 bits, admin 1 bit,
//                            day offset u32, map id string, map hash u32, chunksX-1 u8, chunksZ-1 u8, own body,
//                            yaw u16, tuned content hash u32, tuning string (shared/content/tuning.ts), the clock's
//                            cycle, day and night scales (f64 each), MOTD seconds u16, takes the map's statics 1 bit
//     SNAPSHOT  unreliable   tick u32, baseline age u8 (0 = none), input margin s8, ticks given up since the welcome
//                            1 bit and if set u16 (wrapping), buttons carried into this tick from an input that came
//                            after its own 1 bit and if set BUTTON_BITS bits, session state 2 bits, driven entity index + 1
//                            varint (0 = its own body), own stride change bit and if changed 14 bits, that body,
//                            vehicle contact proxies, entity delta (see view.ts)
//     CHUNK     reliable     chunk u16, version u32, final 1 bit, row count 16 bits; to a client that takes statics, for
//                            a chunk that holds map statics, from the map 1 bit, and if set first slot u16 and count
//                            u16 of the slots it takes as the map has them; rows, in ascending slots; then removals:
//                            count u8, and per removal: versions back varint, cause 2 bits (taken, destroyed, fell,
//                            blast), unless taken where it began (3 x f32) and when (tick u32), for a blast its
//                            reach u8 (quarter metres), leaves 1 bit, then runs of slots: count varint, and per
//                            run: first slot minus the end of the run before svarint, length-1 varint. With leaves
//                            set those slots take their heap's kind where they stood (heapAt, at heapHealth) in
//                            place of emptying; 1 bit follows, set if runs of emptied slots follow too. Slots from
//                            the map are set first, then rows, then removals. A removal leaves alone any row newer
//                            than itself. A row for a slot just taken from the map is in place where a piece
//                            still stands in it.
//                            A row: 1 bit set if its slot follows the last row's, else the gap less one varint; in
//                            place 1 bit, then kind changed 1 bit and if set its kind (named u16), then owner
//                            (named varint) and health; else kind (named u16, 0 for an empty
//                            slot, which ends the row), x and z 15 bits each (1/512 m from the chunk's corner),
//                            height 1 bit set if it is the last full row's, else svarint from it (1/512 m, from 0
//                            for the first), yaw (named u16), owner (named varint), health. Health is 1 bit set for
//                            the kind's most, else f32. A value named is 0 and its place among those the message
//                            named before (as few bits as their count needs), or 1 and the value; see Named.
//     CHUNK_DROP reliable    chunk u16
//     REJECT    reliable     reason u8, and for REJECT_TRAVEL why, as a string
//     RESULT    reliable     command sequence u16 (0 when no command asked), code u8
//     TEXT      reliable     channel u8, text string
//     OWN       reliable     component u8, then that component's fields
//     NODES     reliable     chunk u16, version u32, count u16, used-up slots (slot u8, crushed bool each)
//     EVENT     reliable     kind u8, then that kind's fields (see EVENT_*)
//     TRAVEL    reliable     travel ticket (32 bytes), destination's world id u16; the connection then closes
//
// The server never trusts a position or a target. Neither INPUT nor COMMAND has room for a coordinate of the client's own
// body or the identity of something to hit. Commands are applied at most once and never resent after a reconnect. The
// client learns the outcome from the state it is sent, and RESULT only tells the interface why something was refused.

import { SkateState, readSkate, writeSkate } from "../sim/skate-state.ts";
import { BitReader, BitWriter } from "./codec.ts";
import { LOOK_BYTES } from "../anim/look.ts";
import { REACT_BITS } from "../anim/pose.ts";
import { counter, flags } from "../codes.ts";
import { BTN_CROUCH, BTN_PRONE, Body, buttonCount } from "../sim/character.ts";

declare const __WIRE__: number;
/**
 * A hash of the source that lays out the wire (shared/net/wire.ts). A hello of another is refused before the rest of it is read.
 * A build gives it to the page; a server or an agent run from source reads its own and calls stampWire. A process that
 * never does holds 0, which is the same on both sides where a client and a server share the process, as in a test.
 */
export let PROTOCOL_VERSION: number = typeof __WIRE__ === "number" ? __WIRE__ : 0;
export function stampWire(version: number): void {
  PROTOCOL_VERSION = version;
}
/** Bits the owner body's spent reserve travels in: JET_CAPACITY (shared/sim/character.ts) must fit, which a test holds. */
export const JET_SPENT_BITS = 9;

// Protocol 16: the flyers' contracts (planning/reference/flyers-plan.md, FL0). Each is read by nothing until the package
// named builds it; the server refuses the new codes until then. Besides these: MODE_FLYER (5) in a body's mode bits, the
// flight layout of a pose's motion bits and CUE_TAKEOFF and CUE_ROLL (shared/anim/pose.ts), and the two flight counters
// at the end of writeBody.
/** CMD_CARRY, FL6: a ridden flyer grabs a body in its feet, named by its entity index u32, as CARRY_PICK_UP names one. */
export const CARRY_GRAB = 3;
/** CMD_CARRY, FL6: a ridden flyer lets go of what it carries, in the air or on the ground. Nothing follows. */
export const CARRY_RELEASE = 4;
/** CMD_ORDER, FL3: a flyer lands where it is, as ARK's whistle lands flyers (ASE 288.113). A whistle may give it. */
export const ORDER_LAND = 11;
/** The flight counters (Body.regenWait, Body.rollWait), 10 bits each after the rest of a body. */
function writeFlight(w: BitWriter, b: Body): void {
  w.bits(b.regenWait, 10);
  w.bits(b.rollWait, 10);
}
function readFlight(r: BitReader, b: Body): void {
  b.regenWait = r.bits(10);
  b.rollWait = r.bits(10);
}
/** Protocol 18: a vehicle's mechanical state and a body's seat, after the flight counters (shared/sim/vehicle-body.ts). */
function writeVehicle(w: BitWriter, b: Body): void {
  w.bool(b.vehicle);
  if (b.vehicle) {
    w.f32(b.vehicleYaw);
    w.f32(b.vehiclePitch);
    w.f32(b.vehicleRoll);
    w.f32(b.steering);
    w.f32(b.wheelAngle);
    w.f32(b.fuel);
    w.f32(b.vehicleYawRate);
    w.f32(b.vehiclePitchRate);
    w.f32(b.vehicleRollRate);
    w.f32(b.vehicleGroundPitch);
    w.f32(b.vehicleGroundRoll);
    w.f32(b.vehicleRideOffset);
    w.f32(b.vehicleRideVelocity);
    w.u8(b.vehicleGear + 1);
    w.f32(b.vehicleRpm);
    w.f32(b.vehicleShiftTime);
    w.f32(b.vehiclePayloadMass);
    const rotor = b.vehicleRotorRpm !== 0 || b.vehicleRotorPhase !== 0 || b.vehicleEngineCondition !== 1 || b.vehicleRotorCondition !== 1 || b.vehicleEngineOn || b.vehicleQx !== 0 || b.vehicleQy !== 0 || b.vehicleQz !== 0 || b.vehicleQw !== 1 || b.vehicleCollective !== 0;
    w.bool(rotor);
    if (rotor) {
      w.f32(b.vehicleRotorRpm);
      w.f32(b.vehicleRotorPhase);
      w.f32(b.vehicleEngineCondition);
      w.f32(b.vehicleRotorCondition);
      w.bool(b.vehicleEngineOn);
      w.f32(b.vehicleQx);
      w.f32(b.vehicleQy);
      w.f32(b.vehicleQz);
      w.f32(b.vehicleQw);
      w.f32(b.vehicleCollective);
    }
    const marine = b.vehicleHullCondition !== 1 || b.vehicleFlooding !== 0;
    w.bool(marine);
    if (marine) { w.f32(b.vehicleHullCondition); w.f32(b.vehicleFlooding); }
    const thrust = b.vehicleThrust !== 0 || b.vehicleThrustCool !== 0;
    w.bool(thrust);
    if (thrust) { w.u32(b.vehicleThrust); w.u32(b.vehicleThrustCool); }
    const skate = b.skate;
    w.bool(!!skate);
    if (skate) writeSkate(w, skate);
    // A new vehicle field goes here, in readVehicle at the same place, in Body.copy and equals, and in VEHICLE_FIELDS.
  }
  // A seat costs a body one bit when it has none: the entity it sits on, the seat's place in it from 1, and the entity's generation.
  w.bool(b.seat !== 0);
  if (b.seat !== 0) { w.varint(b.seat - 1); w.u8(b.seatSlot); w.bits(b.seatGen, 12); }
}
function readVehicle(r: BitReader, b: Body): void {
  b.vehicle = r.bool();
  b.vehicleYaw = b.vehicle ? r.f32() : 0;
  b.vehiclePitch = b.vehicle ? r.f32() : 0;
  b.vehicleRoll = b.vehicle ? r.f32() : 0;
  b.steering = b.vehicle ? r.f32() : 0;
  b.wheelAngle = b.vehicle ? r.f32() : 0;
  b.fuel = b.vehicle ? r.f32() : 0;
  b.vehicleYawRate = b.vehicle ? r.f32() : 0;
  b.vehiclePitchRate = b.vehicle ? r.f32() : 0;
  b.vehicleRollRate = b.vehicle ? r.f32() : 0;
  b.vehicleGroundPitch = b.vehicle ? r.f32() : 0;
  b.vehicleGroundRoll = b.vehicle ? r.f32() : 0;
  b.vehicleRideOffset = b.vehicle ? r.f32() : 0;
  b.vehicleRideVelocity = b.vehicle ? r.f32() : 0;
  b.vehicleGear = b.vehicle ? r.u8() - 1 : 0;
  b.vehicleRpm = b.vehicle ? r.f32() : 0;
  b.vehicleShiftTime = b.vehicle ? r.f32() : 0;
  b.vehiclePayloadMass = b.vehicle ? r.f32() : 0;
  const rotor = b.vehicle && r.bool();
  b.vehicleRotorRpm = rotor ? r.f32() : 0;
  b.vehicleRotorPhase = rotor ? r.f32() : 0;
  b.vehicleEngineCondition = rotor ? r.f32() : 1;
  b.vehicleRotorCondition = rotor ? r.f32() : 1;
  b.vehicleEngineOn = rotor && r.bool();
  b.vehicleQx = rotor ? r.f32() : 0;
  b.vehicleQy = rotor ? r.f32() : 0;
  b.vehicleQz = rotor ? r.f32() : 0;
  b.vehicleQw = rotor ? r.f32() : 1;
  b.vehicleCollective = rotor ? r.f32() : 0;
  const marine = b.vehicle && r.bool();
  b.vehicleHullCondition = marine ? r.f32() : 1;
  b.vehicleFlooding = marine ? r.f32() : 0;
  const thrust = b.vehicle && r.bool();
  b.vehicleThrust = thrust ? r.u32() : 0;
  b.vehicleThrustCool = thrust ? r.u32() : 0;
  if (b.vehicle && r.bool()) readSkate(r, b.skate ??= new SkateState());
  else b.skate = null;
  b.seat = r.bool() ? r.varint() + 1 : 0;
  b.seatSlot = b.seat !== 0 ? r.u8() : 0;
  b.seatGen = b.seat !== 0 ? r.bits(12) : 0;
}


/** New kinds go last: HELLO, WELCOME and REJECT then keep their numbers, and a page of another version still reads its refusal. */
const clientKind = counter();
export const C_HELLO = clientKind();
export const C_INPUT = clientKind();
export const C_COMMAND = clientKind();

const serverKind = counter();
export const S_WELCOME = serverKind();
export const S_SNAPSHOT = serverKind();
export const S_CHUNK = serverKind();
export const S_CHUNK_DROP = serverKind();
export const S_REJECT = serverKind();
export const S_RESULT = serverKind();
export const S_TEXT = serverKind();
export const S_OWN = serverKind();
export const S_NODES = serverKind();
export const S_EVENT = serverKind();
/**
 * One chunk's structures as the map shows them (shared/world/tactical.ts). Reliable. chunk u16, level 2 bits (cells of 4, 8, 16
 * or 32 m), team count 3 bits, a varint per team, then runs until the chunk's cells are covered, row by row: length-1 (8 bits,
 * less 2 for each level), filled 1 bit, and if filled: palette colour u8, height band 3 bits, owner 3 bits (an index into the
 * teams, or 7 for a team not among them).
 */
export const S_TACTICAL = serverKind();
/**
 * Tribe mates and tames anywhere on the map, once a second. Unreliable. The receiver's own place in the list u8 (255 for none),
 * the map zoom the server holds for it 2 bits, the players rule 2 bits (off, view, all), count u8, then per mark: kind 3 bits
 * (mate, tame, other), x and z as 14-bit shares of the map, heading 5 bits.
 */
export const S_MARKS = serverKind();
/**
 * Every tribe's structures beyond the view, to draw on the horizon (shared/world/tactical.ts). Reliable. chunk u16, 1 bit
 * set where the map's own pieces are left out (to a session that holds the map's statics and draws those itself), then runs
 * until its 256 cells of 4 m are covered, row by row: length-1 u8, filled 1 bit, and if filled: palette colour u8, top u8
 * (half metres above the ground at the cell's middle to 64 m, then 2 m steps to 318 m). No owner or team. A chunk is sent
 * whole, and an emptied one is sent empty. Protocol 9.
 */
export const S_FAR = serverKind();
/**
 * Protocol 14. The survivor has left for another server of the cluster: the travel ticket (TICKET_BYTES) and the destination's
 * world id u16. The page takes the ticket to the destination, whose HELLO carries it, and the server closes this connection.
 */
export const S_TRAVEL = serverKind();
/**
 * Protocol 23. Where statics that move when used stand (StructureDef.motion), every one in as many messages as they take after
 * a welcome, and each again as it is thrown (24): count u8, then per static ref u32, where it left from and goes to u16 (the top bit set when it goes to
 * its second state, the rest the progress it left from in 1/32,767), and the tick it left u32. Its kind and place are the
 * client's map's (shared/sim/motion.ts).
 */
export const S_MOTION = serverKind();
/** Protocol 25. Sparse, generation-qualified corpse motion checkpoint; shared/net/corpse.ts defines its bounded payload. */
export const S_CORPSE = serverKind();
/**
 * Protocol 41. The supply drops that are live on the map, whole, to every session after its welcome and again whenever
 * one is called, lands, is first opened or goes: what each tier and class among them shows, then a row a drop
 * (shared/sim/supply.ts writeSupply). A session works out where each is from its ticks, so nothing more is sent as it flies.
 */
export const S_SUPPLY = serverKind();
/**
 * The server's settings changed its content while it runs: the tuned content's hash u32 and the tuning as a string, as the
 * welcome carries them. A session derives the content again and leaves if its hash is another (shared/content/tuning.ts).
 */
export const S_TUNING = serverKind();
/**
 * The server is stopping, for an update or a restart: seconds until it does, u16. RESTART_GO is "go now": the page
 * leaves for its waiting page while the server still answers. RESTART_OFF takes a stop that was said back.
 */
export const S_RESTART = serverKind();
export const RESTART_GO = 0;
export const RESTART_OFF = 0xffff;
/** The longest a stop may be said ahead, in seconds: a day. */
export const RESTART_MOST = 86400;
export const S_AIR_SUPPORT = serverKind();
/**
 * Which of the map's own pieces no longer stand in one chunk, to a session that holds the map's statics, within GoneRadius
 * and what it asked (shared/world/gone.ts). Reliable. chunk u16, the list's version varint, then 1 bit for its form. Runs
 * (0): count varint, then per run the slots it starts past the last run's end varint, 1 bit for more than one slot, and if so
 * its length less 2 varint. Bits (1): count varint, then a bit a slot from slot 0, set for one gone. A list with no slot
 * says every piece of the chunk stands again.
 */
export const S_GONE = serverKind();

export const REJECT_VERSION = 1;
export const REJECT_CONTENT = 2;
export const REJECT_FULL = 3;
export const REJECT_MALFORMED = 4;
export const REJECT_NAME = 5;
/** Wrong device key for the name, spectating not allowed, or too many password attempts. */
export const REJECT_DENIED = 6;
export const REJECT_KICKED = 7;
export const REJECT_PASSWORD = 8;
/**
 * Protocol 14. A travel ticket, or a survivor that is away on another server, was turned away. A string says why: the ticket
 * was used, has expired, is for another name, or its survivor went back; this server will not take the survivor; or it is away.
 */
export const REJECT_TRAVEL = 9;
export const MAX_PASSWORD_BYTES = 64;
export const MAX_TUNING_BYTES = 1 << 20;

const helloFlag = flags();
export const HELLO_SPECTATE = helloFlag();
/** A look follows the key. A new survivor gets it at once and skips the creator. */
export const HELLO_LOOK = helloFlag();
/** Protocol 14. A travel ticket follows the look: the survivor arrives from another server of the cluster (S_TRAVEL). */
export const HELLO_TICKET = helloFlag();
/** Protocol 21. The client holds the map's statics (shared/world/mapfile.ts) and takes a chunk's from them, all but the slots CHUNK sends. */
export const HELLO_STATICS = helloFlag();
/** Explicit title actions distinguish making a new survivor from resuming an existing one. */
export const HELLO_NEW = helloFlag();
export const HELLO_RESUME = helloFlag();
export const KEY_BYTES = 16;
/** A transfer's id (16 bytes), then the secret that lets one browser take it (16 bytes). */
export const TICKET_BYTES = 32;

export const SESSION_ALIVE = 0;
export const SESSION_DEAD = 1;
export const SESSION_SPECTATING = 2;
/** A new survivor with no look yet. It has no body until it sends a look with CMD_CREATE. */
export const SESSION_CREATING = 3;

const command = counter();
export const CMD_TEXT = command();
/** From box 1 bit, slot varint, to box 1 bit, slot varint, count u16 (0 = the whole stack), expected item u16. */
export const CMD_MOVE = command();
/** Eats or uses the item in an own slot: slot varint, expected item u16. */
export const CMD_USE = command();

/** Closes the open container. No arguments. */
export const CMD_CLOSE = command();
/** Index u8 into the places OWN_RESPAWN listed, then that list's number u8. A place from a list since replaced is STALE. */
export const CMD_RESPAWN = command();

/** Stat u8. It gets one level-up point. */
export const CMD_SPEND = command();
/** Engram content index u16. */
export const CMD_LEARN = command();
/** Recipe content index u16, count u8. */
export const CMD_CRAFT = command();

/** A look, 28 bytes (shared/anim/look.ts). Accepted only in SESSION_CREATING. */
export const CMD_CREATE = command();

/** Hotbar slot u8, 0 to 9, or 255 to put away the held item. */
export const CMD_SELECT = command();
/** Weapon slot varint, ammunition item u16. The weapon then takes that ammunition, and rounds of another kind in it go back to the bag. */
export const CMD_LOAD = command();
/** Weapon slot varint, attachment slot varint, both own slots. */
export const CMD_ATTACH = command();
/** DETACH, UNLOAD and REPAIR each take an own slot varint. A repair costs a share of the item's ingredients. */
export const CMD_DETACH = command();
export const CMD_UNLOAD = command();
export const CMD_REPAIR = command();
/** Slot varint, count u16 (0 = the whole stack), expected item u16. */
export const CMD_DROP = command();
/** Channel 3 bits (TEXT_GLOBAL, TEXT_LOCAL or TEXT_TRIBE), then the text string. */
export const CMD_CHAT = command();
/**
 * Places the building piece in hand: form index u8, then target u32. A structure ref is followed by its socket u8, and for
 * socket 255 (a thing set on top of it) by x and z (s32 lattice units) and yaw u16. 0xffffffff means open ground and is
 * followed by x and z (s32 lattice units), yaw u16 and lift (s8 steps). Last is the turn in place u8. The server works
 * the position out again itself.
 */
export const CMD_PLACE = command();
/**
 * Structure ref u32, then a STRUCT_ action u8 (shared/world/upkeep.ts). STRUCT_PIN and STRUCT_USE add a PIN u16: 0 to 9999, or
 * 0xffff for none. STRUCT_NAME adds a name string.
 */
export const CMD_STRUCT = command();
/**
 * Orders a tribe creature: entity index u32 or ORDER_ALL, then order u8. The order is an ORDER_ value, ORDER_STANCE plus a
 * stance (passive, neutral, aggressive), ORDER_YOURS, or ORDER_LEVEL plus a stat to spend one of its unspent levels on.
 */
export const CMD_ORDER = command();
export const ORDER_STAY = 0;
export const ORDER_FOLLOW = 1;
export const ORDER_STANCE = 2;
/** The saddle goes into the creature's inventory. */
export const ORDER_UNSADDLE = 5;
/** Allow or forbid mating. A creature mates only with one of its species and tribe that is also allowed. */
export const ORDER_MATE = 6;
export const ORDER_UNMATE = 7;
/** Protocol 11. It wanders about where it is, as a wild one does. */
export const ORDER_WANDER = 8;
/** Protocol 11. Followed by the target's entity index u32: it goes for that body. A whistle may give it. */
export const ORDER_ATTACK = 9;
/** Protocol 11. Its stance becomes attacking your target (ARK's "Attack My Target" whistle): neutral, and it goes for what its tribe hurts. */
export const ORDER_YOURS = 10;
export const ORDER_LEVEL = 16;
/** Every tribe creature within WHISTLE_RANGE. It cannot take ORDER_UNSADDLE, ORDER_MATE, ORDER_UNMATE, ORDER_WANDER or ORDER_LEVEL. */
export const ORDER_ALL = 0xffffffff;
/** Metres. */
export const WHISTLE_RANGE = 40;
/** Names a tribe creature: entity handle u32, then a string of at most 24 bytes. */
export const CMD_NAME = command();
/** Feeds the creature whose inventory is open from that inventory: slot varint, expected item u16. */
export const CMD_FEED = command();
/** Opens a tribe creature's inventory: entity index u32. The use button rides a saddled creature, so this command reaches its inventory. */
export const CMD_OPEN = command();
/**
 * The most entities the client wants to be shown u16, and its snapshot byte budget u16. The server holds both to its own
 * limits and lets them change once a second. A client that never asks is shown VIEW_DEFAULT entities in the server's own budget.
 */
export const CMD_VIEW = command();
/** The finest map zoom the client is showing, 2 bits. Structure cells are sent at the size that suits it (S_TACTICAL). */
export const CMD_MAP_ZOOM = command();
/**
 * Metres u16: how far off the client wants far cells (S_FAR), then metres u16: how far off it wants the lists of its map's
 * pieces gone (S_GONE). The server holds them to FarRadius and GoneRadius and reads them once a second. 0, or never asking, is none.
 */
export const CMD_FAR = command();
/**
 * Protocol 11. A creature in a survivor's arms: a CARRY_ action u8, and for CARRY_PICK_UP the creature's entity index u32.
 * Dropping and throwing name nothing: the throw goes where the body looks.
 */
export const CMD_CARRY = command();
export const CARRY_PICK_UP = 0;
export const CARRY_DROP = 1;
export const CARRY_THROW = 2;
/** Takes into the bag what lies in the world at an entity index u32: an egg, or a bag of one stack. */
export const CMD_TAKE = command();
/**
 * Protocol 12. Crafting at a station: item u16, count u8. Queued on the station the session has open, made from what lies in
 * it and put there; the session's survivor must know the engram, and gets the experience. Refused for an item made
 * elsewhere, and with no station open.
 */
export const CMD_CRAFT_AT = command();
/**
 * Protocol 12. Crafting from a blueprint: box 1 bit (BOX_), slot varint, count u8. The blueprint lies in the inventory the
 * item is made from: the session's own (BOX_SELF) for an item made in the hands, the station it has open (BOX_OPEN) for one
 * made at a station, where the job is queued as CMD_CRAFT_AT's is. No engram is needed; the ingredients are the blueprint's
 * quality's, and what is made is of its quality or above. Refused for a slot that holds no blueprint and for the wrong
 * station (INVALID), and without the ingredients (SHORT).
 */
export const CMD_CRAFT_BLUEPRINT = command();
/**
 * Protocol 14. The survivor leaves for another server of the cluster: its world id u16. Refused (DENIED, with a notice that
 * says why) where it may not go; on success the answer is S_TRAVEL, once its leaving is saved.
 */
export const CMD_TRAVEL = command();
/** Vehicle service: action u8 then generation-qualified target u32 (refuel adds count u8, 0 fills).
 * Deploy instead sends own inventory slot u8, x/y/z f32 and yaw u16. */
export const CMD_VEHICLE = command();
/**
 * Protocol 22. The client holds the map's statics now, as a browser does once the end of the map file has come, though its
 * hello did not say HELLO_STATICS. The answer, OK, is the place in the reliable stream from which chunks are sent as to a
 * client whose hello did; INVALID where the world has no map file.
 */
export const CMD_STATICS = command();
/** Refresh up to eight currently visible corpse checkpoints: count u8, then generation-qualified entity handles u32. */
export const CMD_CORPSE = command();
/**
 * Protocol 34. An admin turns the time of day on the Creative screen's sundial: the hour u16, in two-second steps from
 * midnight below CLOCK_SHARES (shared/sim/clock.ts), then 1 bit set on the turn's last message. DENIED without the admin
 * role or while the server does not show creative mode (RULE_CREATIVE). A turn is journalled once, as `settime` at the
 * hour it ended on.
 */
export const CMD_CLOCK = command();
/**
 * Protocol 37. A survivor's emote (shared/anim/emotes.ts, server/emote.ts): the op 2 bits (0 play, 1 stop, 2 join), the
 * emote's number u16, and the entity it is aimed at plus one as a varint (0 for none). Playing a pair's emote at someone
 * invites them; their playing its other side back at the one who asked begins it. Joining a dance plays it in step with
 * the one joined. BUSY within a third of a second of the last, DENIED while the body cannot (moving, swimming, riding,
 * carrying, acting), FAR beyond reach of the one aimed at.
 */
export const CMD_EMOTE = command();
/**
 * Looking through a sight (D1079): how many times it magnifies, in sixteenths u16 (0 or 16 and under for none), how far
 * off, in metres, what the middle of the view is on u16 (0 for nothing found), and the zero dialled, metres u16 (0 for
 * none, D1083), which lifts a flying round to cross the look there. The server holds the zoom to what the
 * survivor holds or wears that magnifies, and while it lasts adds the chunks along the survivor's look to its view and
 * wakes the creatures round what it is on. A session sends it as its zoom changes and once a second while it looks;
 * GAZE_TICKS after the last, the cone is gone.
 */
export const CMD_GAZE = command();
export const GAZE_TICKS = 90;
/** Metres a gaze's cone reaches for each time its sight magnifies, and at most: the map's width. */
export const GAZE_REACH = 200;
export const GAZE_FARTHEST = 8000;
/**
 * Marks for the tribe the creature the session looks at through a glass or a visor (D1082), its entity index u32 and
 * generation u16: it must be in the session's view or its cone, or within DRONE_LOOK of a drone it flies, alive, and no
 * survivor. Its tribe's marks hold it as
 * MARK_SPOT where it is for SPOT_TICKS, SPOTS_MOST a tribe, the oldest let go first. A survivor with no tribe is denied.
 */
export const CMD_MARK = command();
/**
 * Throws one of the held thing along the session's look (server/loose.ts): it flies as a loose body, strikes the first
 * body it meets while fast, and comes to rest as a bag of one stack, which CMD_TAKE takes up. No arguments.
 */
export const CMD_THROW = command();
export const CMD_AIR_SUPPORT = command();
export const SPOT_TICKS = 1800;
export const SPOTS_MOST = 8;
/** Metres a flown drone's camera looks along its middle: what its operator is told of, and may mark (CMD_MARK). */
export const DRONE_LOOK = 400;
export const VEHICLE_INSPECT = 0;
export const VEHICLE_REFUEL = 1;
export const VEHICLE_REPAIR = 2;
export const VEHICLE_DEPLOY = 3;
/** A nearby survivor pushes an unoccupied stopped car locally, or a stopped boat toward deeper water. */
export const VEHICLE_RECOVER = 4;
/** Manually right a stopped, unoccupied rolled car through a clear local path. */
export const VEHICLE_FLIP = 5;
/** Pull a stopped unoccupied car toward the nearby survivor. */
export const VEHICLE_PULL = 6;
/** Cycle the warning lights of the currently driven patrol vehicle. Followed by its handle. */
export const VEHICLE_LIGHTS = 7;
/**
 * Protocol 44. Swing the door of the seat the session sits in open, or shut again, followed by the vehicle's handle. Held
 * open on a car going 3 m/s or more, it strikes whoever stands where it swings (server/urban.ts doorStrikes).
 */
export const VEHICLE_DOOR = 8;
/** Pick up the board looked at, followed by its handle; or the one ridden, if it is slow enough to step off. */
export const VEHICLE_PACK = 9;
/** Set the board kit in a slot down at the session's feet and ride it, followed by the slot (u8) and the yaw (u16). */
export const VEHICLE_RIDE = 10;

/** The only boxes a slot command can address. No ids travel. */
export const BOX_SELF = 0;
/** The container the session has open, if any. */
export const BOX_OPEN = 1;

export const RESULT_OK = 0;
/** Too many commands in flight. Try again. */
export const RESULT_BUSY = 1;
export const RESULT_INVALID = 2;
export const RESULT_DENIED = 3;
/** The slot does not hold the item the client expected. */
export const RESULT_STALE = 4;
export const RESULT_FULL = 5;
export const RESULT_FAR = 6;
/** Not enough points, level or ingredients. */
export const RESULT_SHORT = 7;
/**
 * Placement refusals. TOO_HIGH is a foundation too far above the ground, ENEMY_NEAR is too close to another tribe's foundation
 * or pillar, and NO_SNAP is no such place to join.
 */
export const RESULT_OBSTRUCTED = 16;
export const RESULT_TOO_HIGH = 17;
export const RESULT_NO_SUPPORT = 18;
export const RESULT_ENEMY_NEAR = 19;
export const RESULT_NOT_YOURS = 20;
export const RESULT_NO_SNAP = 21;
/** A pickup or repair refused. DAMAGED means the structure has been harmed, and WAIT means it is too soon or too late. */
export const RESULT_DAMAGED = 22;
export const RESULT_WAIT = 23;
/** LOCKED means no PIN opens it, PIN means it wants its PIN, and NOT_EMPTY means it must be empty before pickup. */
export const RESULT_LOCKED = 24;
export const RESULT_PIN = 25;
export const RESULT_NOT_EMPTY = 26;

const ownKind = counter();
export const OWN_SESSION = ownKind();
/** base tick u32, then for health, food, water, oxygen: value uint53, rate svarint, max uint53 (millionths of a point). */
export const OWN_VITALS = ownKind();
/**
 * box 1 bit, capacity varint, bag size varint, full 1 bit (forget every slot first), count u16, then per slot: index varint,
 * item u16, and if the item is not 0: count u16, quality u8, flags u8 (SLOT_ bits, protocol 12), durability u16, spoil tick u32, and 1
 * bit for "it holds something", then if so: ammunition item u16, rounds u8, attachment item u16.
 */
export const OWN_SLOTS = ownKind();
/**
 * A slot's flags, protocol 12. The slot holds a blueprint of its item: one alone, at its quality, crafted from
 * (CMD_CRAFT_BLUEPRINT) and never spent. Stacks join only at the same quality and flags (shared/sim/items.ts FLAG_BLUEPRINT).
 */
export const SLOT_BLUEPRINT = 1;
/**
 * A slot's flags, protocol 13 (planning/reference/weapons-plan.md, M10): the weapon's attachment, a flashlight or a laser, is
 * switched on (shared/sim/items.ts FLAG_ON). Only the weapon in hand is ever on.
 */
export const SLOT_ON = 2;

/**
 * open 1 bit, and if open: capacity varint, name string, and since protocol 41 flags u8 (OPEN_ bits). Its slots follow as
 * OWN_SLOTS for the open box.
 */
export const OWN_OPEN = ownKind();
/** The open box is only taken from (a supply drop's capsule): the client offers no way to put a stack in. */
export const OPEN_TAKE_ONLY = 1;
/**
 * Bytes of the open box's name: the server cuts a longer one at a whole character and the client reads no more. It is
 * a supply capsule's at its longest ("Ringed", a tier's and a class's name at SUPPLY_NAME_BYTES each, "drop").
 */
export const MAX_OPEN_NAME_BYTES = 208;
/** count u8, then per marker: kind u8, x f32, y f32, z f32, tick u32. Oldest first. */
export const OWN_MARKERS = ownKind();
/**
 * The places a survivor without a body may rise at, sent whenever they change while it chooses: why it chooses (CHOOSE_), the
 * list's number u8 (CMD_RESPAWN names it), count u8, then per place: the bed's structure kind u16 (0 for one of the map's spawn
 * points), name string, x f32, z f32, and the tick it is ready from u32 (0 for now).
 */
export const OWN_RESPAWN = ownKind();
/** Why a survivor has no body and chooses where to rise: it died, it arrived from another server, it travels from a bed. */
export const CHOOSE_DIED = 0;
export const CHOOSE_ARRIVED = 1;
export const CHOOSE_TRAVEL = 2;

/**
 * experience u32, level u16, unspent stat points u16, unspent engram points varint, learned engrams (count varint, content
 * index u16 each), crafting jobs (count u8, then recipe u16, units left u8, tick the current unit is done u32 each).
 */
export const OWN_PROGRESSION = ownKind();

/** 28 bytes. Sent when the survivor gets a body. */
export const OWN_LOOK = ownKind();

/** Hotbar slot u8, 255 for none. */
export const OWN_HELD = ownKind();
/** count u8, then per buff: content index u16, end tick u32 (0 for no end). */
export const OWN_BUFFS = ownKind();
/** The server rules a client acts on, which may change while it runs: flags u16 of RULE_ bits. */
export const OWN_RULES = ownKind();
const ruleFlag = flags();
export const RULE_DAMAGE_NUMBERS = ruleFlag();
export const RULE_GLOBAL_CHAT = ruleFlag();
export const RULE_HIT_MARKERS = ruleFlag();
export const RULE_THIRD_PERSON = ruleFlag();
export const RULE_CROSSHAIR = ruleFlag();
export const RULE_MAP_LOCATION = ruleFlag();
export const RULE_CORPSE_LOCATOR = ruleFlag();
/** Protocol 34. The server shows creative mode (bShowCreativeMode): the game's menu has a Creative entry. */
export const RULE_CREATIVE = ruleFlag();
/** Survivors pass through one another (SurvivorsBlock off, server/blocking.ts). */
export const RULE_SURVIVORS_PASS = ruleFlag();
/**
 * team varint, tribe name string (empty for a survivor alone, and then rank and members are absent), rank u8, members (count
 * u8, then per member: name string, online 1 bit, owner 1 bit). Then a pending invitation: tribe name string (empty for
 * none) and, if there is one, the inviter's name string.
 */
export const OWN_TRIBE = ownKind();
/** What the session needs to open the voice socket: speaker number u16, token (8 bytes), permissions u8 (bit 0: speak). */
export const OWN_VOICE = ownKind();
/**
 * The creature whose inventory the session has open: present 1 bit, then being tamed 1 bit, owned 1 bit, level u16, taming
 * progress and effectiveness and its torpor and food as shares of their maximum (thousandths, 10 bits each), entity index
 * u32, unspent levels u8, stance 2 bits, following 1 bit, saddled 1 bit. Then breeding: its species breeds 1 bit, may mate
 * 1 bit, female 1 bit, growth stage 2 bits (baby, juvenile, adolescent, grown), maturity and its pair's mating progress
 * (thousandths, 10 bits each), and the seconds until a female may mate again (varint).
 */
export const OWN_SUBJECT = ownKind();
/**
 * The creature the survivor looks at (server/overhead.ts): present 1 bit, then entity index u32, and each only where the viewer
 * is told it: health, food and torpor as shares (1 bit, then thousandths in 10 bits each), taming 1 bit then its progress and
 * effectiveness (10 bits each), its pair's mating progress (1 bit, 10 bits), its tribe's name (1 bit, string).
 */
export const OWN_OVERHEAD = ownKind();
/**
 * Protocol 12, laid out again in 17. The open station, sent when it changes: the station's kind u16 (0 when what is open is
 * no longer a station, and all that follows 0), its structure ref u32, the tick its fire is due to go out u32 (0 when it does
 * not burn), a count u8 of what its fire makes by itself and per lane: item u16, the tick its unit is done u32 (0 while it
 * waits); then a count u8 of jobs and per job: item u16, units left u8, done tick u32, and the ticks left of a unit paused for
 * want of fuel u32 (0 for one that is not).
 */
export const OWN_STATION = ownKind();
/**
 * Protocol 40. The tames kept in the soul balls of a box (server/balls.ts), sent whole after that box's slots whenever a
 * ball in it changed: box 1 bit, count varint, then per full ball: slot varint, species content index u16, level u16, name
 * string (empty for one not named). A session is told only of balls in its own inventory and in the box it has open.
 */
export const OWN_KEPT = ownKind();

export const MARKER_DEATH = 1;

/**
 * Kinds of S_EVENT, each after a u8 naming it.
 * HIT, to the attacker: position (3 x f32), zone 4 bits, damage u16, killed 1 bit, armor stopped some 1 bit.
 * HURT, to the victim: damage u16, the side it came from (u8, 256ths of a turn, as a facing), zone 4 bits, and
 *   whether the side is shown 1 bit (0 for a silenced shot, whose side is then sent as 0: planning/reference/weapons-plan.md, M10).
 * DEATH, to the victim: the HURT fields, then killer name string, weapon content index u16 (0 for bare hands), distance u16 (tenths of a metre).
 * KILL, to the killer: victim name string, its level u16, experience gained u16 (tenths).
 */
const eventKind = counter();
export const EVENT_HIT = eventKind();
/** 24 characters of up to three bytes each. */
export const EVENT_NAME_BYTES = 72;
export const EVENT_HURT = eventKind();
export const EVENT_DEATH = eventKind();
export const EVENT_KILL = eventKind();
/**
 * SHOT, to other clients nearby: origin (3 x f32), ammunition content index u16, flies 1 bit, then 3 x f32. For a shot that
 * flies they are its velocity, followed by the ticks since it left u8. Otherwise they are where it ended. Then rays u8 (1:
 * the shot is the one ray above), seed u32 (0: the seed a shot of many rays is cast from, W3 of
 * planning/reference/weapons-plan.md), and silenced 1 bit (its weapon has a silencer, and no flash is drawn: M10).
 */
export const EVENT_SHOT = eventKind();
/**
 * BLAST, to clients nearby (shared/net/rockets.ts): where, the way out of what it went off on, its reach, the item that
 * blew, its round's number (0 for none) and what it met.
 */
export const EVENT_BLAST = eventKind();
/**
 * TAMED, to the new owner: entity handle u32, species content index u16, level u16, taming effectiveness u8 in percent (255
 * for one claimed as young, not tamed). The client then asks for a name.
 */
export const EVENT_TAMED = eventKind();
/**
 * Protocol 40. BALL, to clients nearby: a tame went into a soul ball (1 bit set) or came out of one, the place of its feet
 * (3 x f32), and its body's radius and height in metres (2 x f32).
 */
export const EVENT_BALL = eventKind();
/**
 * IMPACT, to clients within IMPACT_HEARD of a body a blow landed on, at most IMPACTS_PER_TICK a tick each:
 * the body's handle u32, the bone the blow's ray hit u8 (255 for none: a blast, a bite or a car), the way the blow went as a
 * facing u8 (256ths of a turn) and a pitch s8 (127ths of a quarter turn, up positive), how hard u8 (255 for IMPACT_FULL
 * damage or more), and its kind 2 bits (IMPACT_). Every watcher's draw of that body snaps back from it
 * (client/core/render/impact-springs.ts); it changes nothing the server judges.
 */
export const EVENT_IMPACT = eventKind();
export const IMPACT_SHOT = 0;
export const IMPACT_MELEE = 1;
export const IMPACT_BLAST = 2;
export const IMPACT_VEHICLE = 3;
/** Damage of a blow that strikes as hard as any is drawn, metres an impact is told within, and impacts a client is told a tick. */
export const IMPACT_FULL = 40;
export const IMPACT_HEARD = 150;
export const IMPACTS_PER_TICK = 16;
/**
 * COLLAPSE, to clients within the reach of the lists of pieces gone (S_GONE): one break took more than COLLAPSE_PIECES of
 * the map's pieces from a chunk in a tick. The middle of what fell, x and z (2 x f32), its foot s16 in half metres, how
 * far across it stood u8 in metres, and how tall u8 in steps of 2 m. A client far off draws a column of dust there.
 */
export const EVENT_COLLAPSE = eventKind();
export const COLLAPSE_PIECES = 16;
/** GROAN, to clients within 150 m: a building of the map has lost what carried it and is about to come down. Where it gave (3 x f32). */
export const EVENT_GROAN = eventKind();
/**
 * BOLTS, to clients within hearing of a round's muzzle or sight of its way: the rounds that flew off this tick, in one
 * message (shared/net/bolts.ts): a count u8, then each round's start, way, ammunition and the ticks since it left.
 */
export const EVENT_BOLTS = eventKind();
/** Metres on the ground within which a shot is heard: a client told of one from further, for its round's sake, plays no report. */
export const SHOT_HEARD = 260;
/**
 * ROCKET, to clients within hearing of a round that will go off where it ends, its shooter among them
 * (shared/net/rockets.ts): its start, way, ammunition, number and the ticks since it left. One who comes within hearing of
 * it later is told then. Its blast says its number.
 */
export const EVENT_ROCKET = eventKind();
/** A survivor's own swing landed: server tick u32, node kind varint (0 for other targets), then world position (3 x f32) for a node. */
export const EVENT_STRIKE = eventKind();

/** A removal older than this many ticks is sent as taken, without its cause. */
export const REMOVAL_NEWS_TICKS = 60;

export const TEXT_CONSOLE = 0;
export const TEXT_NOTICE = 1;
/** Chat channels: everyone, those nearby, the tribe. The text is "name: words". */
export const TEXT_GLOBAL = 2;
export const TEXT_LOCAL = 3;
export const TEXT_TRIBE = 4;
/** The server's name and message of the day, shown as a notice for the seconds the WELCOME gives. */
export const TEXT_MOTD = 5;
/** Both in characters. */
export const MAX_CHAT_CHARS = 120;
export const MAX_TRIBE_NAME = 24;

/**
 * The snapshot input margin when no input has arrived yet. The client must not steer its clock by it. A margin is the
 * newest input less the tick due on the server loop's clock, which is the tick it steps while the loop keeps up.
 */
export const MARGIN_UNKNOWN = -128;

/** Inputs carried per packet. Losing up to three packets in a row costs nothing. */
export const INPUT_REDUNDANCY = 4;
/**
 * How many ticks ahead of the server tick an input may be and still be buffered: a page's lead and what it sends while the
 * server stalls, for eight seconds, which a loop then catches up (server/main.ts CATCH_UP_MS) or gives up and the page
 * waits out. A tick steps a body once whatever is buffered, so inputs sent early buy nothing.
 */
export const INPUT_WINDOW = 256;
/**
 * Ticks the server goes on with a client's last input when none comes: about a quarter of a second, as in ARK. After that the
 * body stops moving and lets go of every button but INPUT_KEPT, its stance.
 */
export const INPUT_HOLD_TICKS = 8;
/**
 * The same for a vehicle someone drives or flies, a second: a stream that lost a segment holds the inputs behind it about
 * that long, and a helicopter let go brakes and comes down. A driver who has truly gone drives on as long.
 */
export const VEHICLE_HOLD_TICKS = 30;
export const INPUT_KEPT = BTN_CROUCH | BTN_PRONE;
/** In bytes. */
export const MAX_CLIENT_MESSAGE = 512;
export const MAX_NAME_BYTES = 24;
/** A place a survivor may rise at, as OWN_RESPAWN names it: a bed's name, or a map's spawn point's, which may be longer. */
export const MAX_PLACE_NAME_BYTES = 48;
/** A console line from a client. */
export const MAX_TEXT_BYTES = 200;
/** A chat line from a client. Each of its MAX_CHAT_CHARS takes at most three bytes, whatever the script. */
export const MAX_CHAT_BYTES = 360;
/** A text message from the server. */
export const MAX_SERVER_TEXT_BYTES = 1000;
/** Bits of an input's buttons on the wire: one a button. InputBuffer.set clears any outside the mask. */
export const BUTTON_BITS = buttonCount();
export const BUTTON_MASK = (1 << BUTTON_BITS) - 1;
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
  /** While aimed, the look's yaw and pitch past their units, in 256ths of one, for the shot alone (D1083). */
  readonly fineYaw: Int8Array;
  readonly finePitch: Int8Array;
  /**
   * Server only. The world tick the client says it was drawing when it sampled this input: its newest snapshot minus how far
   * behind that it draws. Unchecked, so its user must bound it.
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
    this.fineYaw = new Int8Array(size);
    this.finePitch = new Int8Array(size);
    this.view = new Float64Array(size);
  }

  has(tick: number): boolean {
    return this.tick[tick & this.mask] === tick;
  }

  /** Clamps every field to its legal range. */
  set(tick: number, moveX: number, moveZ: number, yaw: number, pitch: number, buttons: number, fineYaw = 0, finePitch = 0): void {
    const i = tick & this.mask;
    this.fineYaw[i] = fineYaw < -127 ? -127 : fineYaw > 127 ? 127 : fineYaw;
    this.finePitch[i] = finePitch < -127 ? -127 : finePitch > 127 ? 127 : finePitch;
    this.tick[i] = tick;
    this.moveX[i] = moveX < -127 ? -127 : moveX > 127 ? 127 : moveX;
    this.moveZ[i] = moveZ < -127 ? -127 : moveZ > 127 ? 127 : moveZ;
    this.yaw[i] = yaw;
    this.pitch[i] = pitch < -PITCH_LIMIT ? -PITCH_LIMIT : pitch > PITCH_LIMIT ? PITCH_LIMIT : pitch;
    this.buttons[i] = buttons & BUTTON_MASK;
  }
}

/**
 * 380 bits: position and velocity exactly, then the rest of the predicted state. Protocol 13 added the aim's bloom and the
 * recoil's kick (a byte each, stepped by stepAim in shared/sim/aim.ts), and the flyers' contracts (protocol 16) the flight
 * counters.
 */
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
  w.bits(b.mflags, 6);
  w.u16(b.kind);
  w.u16(b.yaw);
  w.u16(b.held);
  w.bits(b.act, 3);
  w.u8(b.actTicks);
  w.u8(b.rounds);
  w.u8(b.reloadTo);
  w.u8(b.bloom);
  w.u8(b.kick);
  // Ground ability prediction counters; ordinary bodies pay only the presence bit.
  const creature = b.creatureMode !== 0 || b.creatureCooldown !== 0 || b.creaturePower !== 0 || b.creatureSide !== 0 || b.creaturePrimaryCooldown !== 0;
  w.bool(creature);
  if (creature) { w.bits(b.creatureMode, 2); w.bits(b.creatureCooldown, 10); w.u8(b.creaturePower); w.bits(b.creatureSide, 1); w.bits(b.creaturePrimaryCooldown, 10); }
  const suit = b.jetGear !== 0 || b.jetSpent !== 0 || b.jetRecovery !== 0;
  w.bool(suit);
  if (suit) {
    w.bits(b.jetGear, 5);
    w.bits(b.jetSpent, JET_SPENT_BITS);
    w.bits(b.jetThrust, 3);
    w.bits(b.jetKeys, 3);
    w.bits(b.jetJumpTap, 4);
    w.bits(b.jetSprintTap, 4);
    w.bits(b.jetRecovery, 6);
  }
  // A blow it reels from: a body standing steady pays the one bit.
  const reeling = b.react !== 0 || b.reactTicks !== 0;
  w.bool(reeling);
  if (reeling) { w.bits(b.react, REACT_BITS); w.u8(b.reactTicks); }
  // The glider (protocol 39): a body that carries none pays the one bit.
  const glider = b.glideGear !== 0 || b.glide !== 0 || b.glideKeys !== 0;
  w.bool(glider);
  if (glider) {
    w.bits(b.glideGear, 2);
    w.bits(b.glide, 1);
    w.bits(b.glideKeys, 2);
  }
  writeFlight(w, b);
  writeVehicle(w, b);
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
  b.mflags = r.bits(6);
  b.kind = r.u16();
  b.yaw = r.u16();
  b.held = r.u16();
  b.act = r.bits(3);
  b.actTicks = r.u8();
  b.rounds = r.u8();
  b.reloadTo = r.u8();
  b.bloom = r.u8();
  b.kick = r.u8();
  if (r.bool()) { b.creatureMode = r.bits(2); b.creatureCooldown = r.bits(10); b.creaturePower = r.u8(); b.creatureSide = r.bits(1); b.creaturePrimaryCooldown = r.bits(10); }
  else b.creatureMode = b.creatureCooldown = b.creaturePower = b.creatureSide = b.creaturePrimaryCooldown = 0;
  if (r.bool()) {
    b.jetGear = r.bits(5);
    b.jetSpent = r.bits(JET_SPENT_BITS);
    b.jetThrust = r.bits(3);
    b.jetKeys = r.bits(3);
    b.jetJumpTap = r.bits(4);
    b.jetSprintTap = r.bits(4);
    b.jetRecovery = r.bits(6);
  } else b.jetGear = b.jetSpent = b.jetThrust = b.jetKeys = b.jetJumpTap = b.jetSprintTap = b.jetRecovery = 0;
  if (r.bool()) { b.react = r.bits(REACT_BITS); b.reactTicks = r.u8(); }
  else b.react = b.reactTicks = 0;
  if (r.bool()) {
    b.glideGear = r.bits(2);
    b.glide = r.bits(1);
    b.glideKeys = r.bits(2);
  } else b.glideGear = b.glide = b.glideKeys = 0;
  readFlight(r, b);
  readVehicle(r, b);
}

/** `key` must be KEY_BYTES long, and a `ticket` TICKET_BYTES. */
export function writeHello(w: BitWriter, version: number, contentHash: number, clipHash: number, name: string, flags: number, key: Uint8Array, look: Uint8Array | null = null, password = "", ticket: Uint8Array | null = null, createRequest?: Uint8Array): void {
  w.bits(C_HELLO, 4);
  w.u32(version);
  w.u32(contentHash);
  w.u32(clipHash);
  w.string(name);
  const marked = look ? flags | HELLO_LOOK : flags & ~HELLO_LOOK;
  w.u8(ticket ? marked | HELLO_TICKET : marked & ~HELLO_TICKET);
  for (let i = 0; i < KEY_BYTES; i++) w.u8(key[i] ?? 0);
  if (look) for (let i = 0; i < LOOK_BYTES; i++) w.u8(look[i] ?? 0);
  if (ticket) for (let i = 0; i < TICKET_BYTES; i++) w.u8(ticket[i] ?? 0);
  w.string(password);
  if ((flags & HELLO_NEW) && createRequest?.length===KEY_BYTES) for(const b of createRequest)w.u8(b);
}

/** A connection's commands are numbered from 1 without gaps. After 65,535 comes 1, since 0 names no command. */
export function nextCommandSeq(seq: number): number {
  return seq >= 0xffff ? 1 : seq + 1;
}

/** The caller appends the op's arguments. */
export function writeCommand(w: BitWriter, seq: number, op: number): void {
  w.bits(C_COMMAND, 4);
  w.u16(seq);
  w.u8(op);
}

/** INPUT's "behind" byte counts 1/VIEW_STEPS of a tick. */
export const VIEW_STEPS = 16;
/** Maximum interpolation behind a passenger’s acknowledged snapshot when presenting and resolving a shot. */
export const PASSENGER_VIEW_DELAY = 4;

/** `ack` is the newest snapshot decoded. `behind` is how many ticks behind it the client draws everyone else, and is clamped to 255 sixteenths. */
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
        inputs.buttons[i] === inputs.buttons[prev] &&
        inputs.fineYaw[i] === inputs.fineYaw[prev] &&
        inputs.finePitch[i] === inputs.finePitch[prev];
      w.bool(same);
      if (same) continue;
    }
    w.sbits(inputs.moveX[i]!, 8);
    w.sbits(inputs.moveZ[i]!, 8);
    w.u16(inputs.yaw[i]!);
    w.sbits(inputs.pitch[i]!, 16);
    w.bits(inputs.buttons[i]!, BUTTON_BITS);
    // An aimed look's 256ths of a unit, where it has any (protocol 42, D1083).
    const fine = inputs.fineYaw[i] !== 0 || inputs.finePitch[i] !== 0;
    w.bool(fine);
    if (fine) {
      w.sbits(inputs.fineYaw[i]!, 8);
      w.sbits(inputs.finePitch[i]!, 8);
    }
    prev = i;
  }
}

/**
 * Call after reading `ack` and `behind` (in ticks). Keeps only ticks in (serverTick, serverTick + INPUT_WINDOW) not already
 * present, and hands `late` the buttons of each tick named that the server has stepped. Returns the newest tick named, or
 * 0 if the message was malformed.
 */
export function readInputs(r: BitReader, inputs: InputBuffer, serverTick: number, ack = 0, behind = 0, ackHistory?: Uint32Array, late?: (tick: number, buttons: number) => void): number {
  const newest = r.u32();
  const count = r.bits(3) + 1;
  let moveX = 0;
  let moveZ = 0;
  let yaw = 0;
  let pitch = 0;
  let buttons = 0;
  let fineYaw = 0;
  let finePitch = 0;
  for (let k = 0; k < count; k++) {
    if (k === 0 || !r.bool()) {
      moveX = r.sbits(8);
      moveZ = r.sbits(8);
      yaw = r.u16();
      pitch = r.sbits(16);
      buttons = r.bits(BUTTON_BITS);
      const fine = r.bool();
      fineYaw = fine ? r.sbits(8) : 0;
      finePitch = fine ? r.sbits(8) : 0;
    }
    const tick = newest - k;
    if (tick > serverTick && tick < serverTick + INPUT_WINDOW && !inputs.has(tick)) {
      inputs.set(tick, moveX, moveZ, yaw, pitch, buttons, fineYaw, finePitch);
      // `ack - behind` is when the newest input was sampled. Each older input was sampled one tick earlier.
      inputs.view[tick & inputs.mask] = ack - behind - k;
      // Preserve the packet acknowledgement separately from the interpolated view. Redundant
      // copies received later cannot replace the acknowledgement of the first accepted copy.
      if (ackHistory) ackHistory[tick & inputs.mask] = ack;
    } else if (tick <= serverTick) late?.(tick, buttons);
  }
  return r.overflow ? 0 : newest;
}
