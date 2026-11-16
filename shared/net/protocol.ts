// Message layouts live here and nowhere else. Every message starts with its type, and each type has a fixed channel. A client's
// type is 4 bits. The server's is a byte, since it has many more kinds of message to tell apart: ids 15 to 255 are free.
//
//   client -> server
//     HELLO     reliable     version u16, content hash u32 (of the definitions as written, untuned), clip hash u32,
//                            name string, flags u8, device key (16 bytes), with HELLO_LOOK a look (28 bytes),
//                            with HELLO_TICKET a travel ticket (32 bytes), password string ("" for none)
//     INPUT     unreliable   ack tick u32, ticks behind it that others are drawn u8 (sixteenths), newest tick u32,
//                            count-1 (3 bits), then inputs newest first. Each after the first is preceded by
//                            one bit: 1 = same as the one before.
//     COMMAND   reliable     sequence u16 (1 to 65,535, then 1 again), op u8, arguments by op
//   server -> client
//     WELCOME   reliable     version u16, tick u32, own handle u32, species u16, session state 2 bits, admin 1 bit,
//                            day offset u32, map id string, map hash u32, chunksX-1 u8, chunksZ-1 u8, own body,
//                            yaw u16, tuned content hash u32, tuning string (shared/content/tuning.ts), the clock's
//                            cycle, day and night scales (f64 each), MOTD seconds u16, takes the map's statics 1 bit
//     SNAPSHOT  unreliable   tick u32, baseline age u8 (0 = none), input margin s8, session state 2 bits, driven
//                            entity index + 1 varint (0 = its own body), that body, entity delta (see view.ts)
//     CHUNK     reliable     chunk u16, version u32, final 1 bit, row count 16 bits; to a client that takes statics, for
//                            a chunk that holds map statics, from the map 1 bit, and if set first slot u16 and count
//                            u16 of the slots it takes as the map has them; rows, in ascending slots; then removals:
//                            count u8, and per removal: versions back varint, cause 2 bits (taken, destroyed, fell),
//                            unless taken where it began (3 x f32) and when (tick u32), then runs of slots: count
//                            varint, and per run: first slot minus the end of the run before svarint, length-1
//                            varint. Slots from the map are set first, then rows, then removals. A removal leaves
//                            alone any row newer than itself.
//                            A row: 1 bit set if its slot follows the last row's, else the gap less one varint; in
//                            place 1 bit, then owner (named varint) and health; else kind (named u16, 0 for an empty
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
//     NODES     reliable     chunk u16, version u32, count u8, used-up slots (u8 each)
//     EVENT     reliable     kind u8, then that kind's fields (see EVENT_*)
//     TRAVEL    reliable     travel ticket (32 bytes), destination's world id u16; the connection then closes
//
// The server never trusts a position or a target. Neither INPUT nor COMMAND has room for a coordinate of the client's own
// body or the identity of something to hit. Commands are applied at most once and never resent after a reconnect. The
// client learns the outcome from the state it is sent, and RESULT only tells the interface why something was refused.

import { BitReader, BitWriter } from "./codec.ts";
import { LOOK_BYTES } from "../anim/look.ts";
import { BTN_CROUCH, BTN_PRONE, Body } from "../sim/character.ts";

/**
 * 15: beds, the choosing list numbered with why a survivor chooses, and naming and travelling from a bed. 16: the flyers'.
 * 17: the stations wave's (planning/reference/stations-plan.md, S0), OWN_STATION's layout. 18: vehicles: a body's
 * mechanical state and seat after the flight counters, and a view entry's vehicle parts (view.ts).
 * 19: rotor state/condition, observer rotor and service parts, and vehicle maintenance/deployment commands.
 * 20: marine hull/flooding state and physical shoreline recovery. 21: compact chunk rows, rows in place, and chunks
 * taken from the map (HELLO_STATICS). 22: the map's statics told of after the hello (CMD_STATICS). 23: S_MOTION, a
 * travelling static's state.
 */
export const PROTOCOL_VERSION = 23;

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
  b.seat = r.bool() ? r.varint() + 1 : 0;
  b.seatSlot = b.seat !== 0 ? r.u8() : 0;
  b.seatGen = b.seat !== 0 ? r.bits(12) : 0;
}

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
export const S_NODES = 9;
export const S_EVENT = 10;
/**
 * One chunk's structures as the map shows them (shared/world/tactical.ts). Reliable. chunk u16, level 2 bits (cells of 4, 8, 16
 * or 32 m), team count 3 bits, a varint per team, then runs until the chunk's cells are covered, row by row: length-1 (8 bits,
 * less 2 for each level), filled 1 bit, and if filled: palette colour u8, height band 3 bits, owner 3 bits (an index into the
 * teams, or 7 for a team not among them).
 */
export const S_TACTICAL = 11;
/**
 * Tribe mates and tames anywhere on the map, once a second. Unreliable. The receiver's own place in the list u8 (255 for none),
 * the map zoom the server holds for it 2 bits, the players rule 2 bits (off, view, all), count u8, then per mark: kind 3 bits
 * (mate, tame, other), x and z as 14-bit shares of the map, heading 5 bits.
 */
export const S_MARKS = 12;
/**
 * Every tribe's structures beyond the view, to draw on the horizon (shared/world/tactical.ts). Reliable. chunk u16, then runs
 * until its 256 cells of 4 m are covered, row by row: length-1 u8, filled 1 bit, and if filled: palette colour u8, top u8
 * (half metres above the ground at the cell's middle to 64 m, then 2 m steps to 318 m). No owner or team. A chunk is sent
 * whole, and an emptied one is sent empty. Protocol 9.
 */
export const S_FAR = 13;
/**
 * Protocol 14. The survivor has left for another server of the cluster: the travel ticket (TICKET_BYTES) and the destination's
 * world id u16. The page takes the ticket to the destination, whose HELLO carries it, and the server closes this connection.
 */
export const S_TRAVEL = 14;
/**
 * Protocol 23. Where every static that travels when used stands (StructureDef.travel), sent whole to a client when it joins and
 * when one is thrown: count u8, then per static ref u32, where it left from and goes to u16 (the top bit set when it goes to
 * its second state, the rest the progress it left from in 1/32,767), and the tick it left u32. Its kind and place are the
 * client's map's (shared/sim/travel.ts).
 */
export const S_MOTION = 15;

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

export const HELLO_SPECTATE = 1;
/** A look follows the key. A new survivor gets it at once and skips the creator. */
export const HELLO_LOOK = 2;
/** Protocol 14. A travel ticket follows the look: the survivor arrives from another server of the cluster (S_TRAVEL). */
export const HELLO_TICKET = 4;
/** Protocol 21. The client holds the map's statics (shared/world/mapfile.ts) and takes a chunk's from them, all but the slots CHUNK sends. */
export const HELLO_STATICS = 8;
export const KEY_BYTES = 16;
/** A transfer's id (16 bytes), then the secret that lets one browser take it (16 bytes). */
export const TICKET_BYTES = 32;

export const SESSION_ALIVE = 0;
export const SESSION_DEAD = 1;
export const SESSION_SPECTATING = 2;
/** A new survivor with no look yet. It has no body until it sends a look with CMD_CREATE. */
export const SESSION_CREATING = 3;

export const CMD_TEXT = 1;
/** From box 1 bit, slot varint, to box 1 bit, slot varint, count u16 (0 = the whole stack), expected item u16. */
export const CMD_MOVE = 2;
/** Eats or uses the item in an own slot: slot varint, expected item u16. */
export const CMD_USE = 3;

/** Closes the open container. No arguments. */
export const CMD_CLOSE = 4;
/** Index u8 into the places OWN_RESPAWN listed, then that list's number u8. A place from a list since replaced is STALE. */
export const CMD_RESPAWN = 5;

/** Stat u8. It gets one level-up point. */
export const CMD_SPEND = 6;
/** Engram content index u16. */
export const CMD_LEARN = 7;
/** Recipe content index u16, count u8. */
export const CMD_CRAFT = 8;

/** A look, 28 bytes (shared/anim/look.ts). Accepted only in SESSION_CREATING. */
export const CMD_CREATE = 9;

/** Hotbar slot u8, 0 to 9, or 255 to put away the held item. */
export const CMD_SELECT = 10;
/** Weapon slot varint, ammunition item u16. The weapon then takes that ammunition, and rounds of another kind in it go back to the bag. */
export const CMD_LOAD = 11;
/** Weapon slot varint, attachment slot varint, both own slots. */
export const CMD_ATTACH = 12;
/** DETACH, UNLOAD and REPAIR each take an own slot varint. A repair costs a share of the item's ingredients. */
export const CMD_DETACH = 13;
export const CMD_UNLOAD = 14;
export const CMD_REPAIR = 15;
/** Slot varint, count u16 (0 = the whole stack), expected item u16. */
export const CMD_DROP = 16;
/** Channel 3 bits (TEXT_GLOBAL, TEXT_LOCAL or TEXT_TRIBE), then the text string. */
export const CMD_CHAT = 17;
/**
 * Places the building piece in hand: form index u8, then target u32. A structure ref is followed by its socket u8, and for
 * socket 255 (a thing set on top of it) by x and z (s32 lattice units) and yaw u16. 0xffffffff means open ground and is
 * followed by x and z (s32 lattice units), yaw u16 and lift (s8 steps). Last is the turn in place u8. The server works
 * the position out again itself.
 */
export const CMD_PLACE = 18;
/**
 * Structure ref u32, then a STRUCT_ action u8 (shared/world/upkeep.ts). STRUCT_PIN and STRUCT_USE add a PIN u16: 0 to 9999, or
 * 0xffff for none. STRUCT_NAME adds a name string.
 */
export const CMD_STRUCT = 19;
/**
 * Orders a tribe creature: entity index u32 or ORDER_ALL, then order u8. The order is an ORDER_ value, ORDER_STANCE plus a
 * stance (passive, neutral, aggressive), ORDER_YOURS, or ORDER_LEVEL plus a stat to spend one of its unspent levels on.
 */
export const CMD_ORDER = 20;
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
export const CMD_NAME = 21;
/** Feeds the creature whose inventory is open from that inventory: slot varint, expected item u16. */
export const CMD_FEED = 22;
/** Opens a tribe creature's inventory: entity index u32. The use button rides a saddled creature, so this command reaches its inventory. */
export const CMD_OPEN = 23;
/**
 * The most entities the client wants to be shown u16, and its snapshot byte budget u16. The server holds both to its own
 * limits and lets them change once a second. A client that never asks is shown VIEW_DEFAULT entities in the server's own budget.
 */
export const CMD_VIEW = 24;
/** The finest map zoom the client is showing, 2 bits. Structure cells are sent at the size that suits it (S_TACTICAL). */
export const CMD_MAP_ZOOM = 25;
/** Metres u16: how far off the client wants far cells (S_FAR). The server holds it to FarRadius and reads it once a second. 0, or never asking, is none. */
export const CMD_FAR = 26;
/**
 * Protocol 11. A creature in a survivor's arms: a CARRY_ action u8, and for CARRY_PICK_UP the creature's entity index u32.
 * Dropping and throwing name nothing: the throw goes where the body looks.
 */
export const CMD_CARRY = 27;
export const CARRY_PICK_UP = 0;
export const CARRY_DROP = 1;
export const CARRY_THROW = 2;
/** Protocol 11. Takes into the bag what lies in the world at an entity index u32: an egg. */
export const CMD_TAKE = 28;
/**
 * Protocol 12. Crafting at a station: item u16, count u8. Queued on the station the session has open, made from what lies in
 * it and put there; the session's survivor must know the engram, and gets the experience. Refused for an item made
 * elsewhere, and with no station open.
 */
export const CMD_CRAFT_AT = 29;
/**
 * Protocol 12. Crafting from a blueprint: box 1 bit (BOX_), slot varint, count u8. The blueprint lies in the inventory the
 * item is made from: the session's own (BOX_SELF) for an item made in the hands, the station it has open (BOX_OPEN) for one
 * made at a station, where the job is queued as CMD_CRAFT_AT's is. No engram is needed; the ingredients are the blueprint's
 * quality's, and what is made is of its quality or above. Refused for a slot that holds no blueprint and for the wrong
 * station (INVALID), and without the ingredients (SHORT).
 */
export const CMD_CRAFT_BLUEPRINT = 30;
/**
 * Protocol 14. The survivor leaves for another server of the cluster: its world id u16. Refused (DENIED, with a notice that
 * says why) where it may not go; on success the answer is S_TRAVEL, once its leaving is saved.
 */
export const CMD_TRAVEL = 31;
/** Vehicle service: action u8 then generation-qualified target u32 (refuel adds count u8, 0 fills).
 * Deploy instead sends own inventory slot u8, x/y/z f32 and yaw u16. */
export const CMD_VEHICLE = 32;
/**
 * Protocol 22. The client holds the map's statics now, as a browser does once the end of the map file has come, though its
 * hello did not say HELLO_STATICS. The answer, OK, is the place in the reliable stream from which chunks are sent as to a
 * client whose hello did; INVALID where the world has no map file.
 */
export const CMD_STATICS = 33;
export const VEHICLE_INSPECT = 0;
export const VEHICLE_REFUEL = 1;
export const VEHICLE_REPAIR = 2;
export const VEHICLE_DEPLOY = 3;
/** A nearby survivor pushes a stopped, engine-off boat toward reachable deeper water. */
export const VEHICLE_RECOVER = 4;

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

export const OWN_SESSION = 1;
/** base tick u32, then for health, food, water, oxygen: value uint53, rate svarint, max uint53 (millionths of a point). */
export const OWN_VITALS = 2;
/**
 * box 1 bit, capacity varint, bag size varint, full 1 bit (forget every slot first), count u16, then per slot: index varint,
 * item u16, and if the item is not 0: count u16, quality u8, flags u8 (SLOT_ bits, protocol 12), durability u16, spoil tick u32, and 1
 * bit for "it holds something", then if so: ammunition item u16, rounds u8, attachment item u16.
 */
export const OWN_SLOTS = 3;
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

/** open 1 bit, and if open: capacity varint, name string. Its slots follow as OWN_SLOTS for the open box. */
export const OWN_OPEN = 4;
/** count u8, then per marker: kind u8, x f32, y f32, z f32, tick u32. Oldest first. */
export const OWN_MARKERS = 5;
/**
 * The places a survivor without a body may rise at, sent whenever they change while it chooses: why it chooses (CHOOSE_), the
 * list's number u8 (CMD_RESPAWN names it), count u8, then per place: the bed's structure kind u16 (0 for one of the map's spawn
 * points), name string, x f32, z f32, and the tick it is ready from u32 (0 for now).
 */
export const OWN_RESPAWN = 6;
/** Why a survivor has no body and chooses where to rise: it died, it arrived from another server, it travels from a bed. */
export const CHOOSE_DIED = 0;
export const CHOOSE_ARRIVED = 1;
export const CHOOSE_TRAVEL = 2;

/**
 * experience u32, level u16, unspent stat points u16, unspent engram points varint, learned engrams (count varint, content
 * index u16 each), crafting jobs (count u8, then recipe u16, units left u8, tick the current unit is done u32 each).
 */
export const OWN_PROGRESSION = 7;

/** 28 bytes. Sent when the survivor gets a body. */
export const OWN_LOOK = 8;

/** Hotbar slot u8, 255 for none. */
export const OWN_HELD = 9;
/** count u8, then per buff: content index u16, end tick u32 (0 for no end). */
export const OWN_BUFFS = 10;
/** The server rules a client acts on, which may change while it runs: flags u16 of RULE_ bits. */
export const OWN_RULES = 11;
export const RULE_DAMAGE_NUMBERS = 1;
export const RULE_GLOBAL_CHAT = 2;
export const RULE_HIT_MARKERS = 4;
export const RULE_THIRD_PERSON = 8;
export const RULE_CROSSHAIR = 16;
export const RULE_MAP_LOCATION = 32;
export const RULE_CORPSE_LOCATOR = 64;
/**
 * team varint, tribe name string (empty for a survivor alone, and then rank and members are absent), rank u8, members (count
 * u8, then per member: name string, online 1 bit, owner 1 bit). Then a pending invitation: tribe name string (empty for
 * none) and, if there is one, the inviter's name string.
 */
export const OWN_TRIBE = 12;
/** What the session needs to open the voice socket: speaker number u16, token (8 bytes), permissions u8 (bit 0: speak). */
export const OWN_VOICE = 13;
/**
 * The creature whose inventory the session has open: present 1 bit, then being tamed 1 bit, owned 1 bit, level u16, taming
 * progress and effectiveness and its torpor and food as shares of their maximum (thousandths, 10 bits each), entity index
 * u32, unspent levels u8, stance 2 bits, following 1 bit, saddled 1 bit. Then breeding: its species breeds 1 bit, may mate
 * 1 bit, female 1 bit, growth stage 2 bits (baby, juvenile, adolescent, grown), maturity and its pair's mating progress
 * (thousandths, 10 bits each), and the seconds until a female may mate again (varint).
 */
export const OWN_SUBJECT = 14;
/**
 * The creature the survivor looks at (server/overhead.ts): present 1 bit, then entity index u32, and each only where the viewer
 * is told it: health, food and torpor as shares (1 bit, then thousandths in 10 bits each), taming 1 bit then its progress and
 * effectiveness (10 bits each), its pair's mating progress (1 bit, 10 bits), its tribe's name (1 bit, string).
 */
export const OWN_OVERHEAD = 15;
/**
 * Protocol 12, laid out again in 17. The open station, sent when it changes: the station's kind u16 (0 when what is open is
 * no longer a station, and all that follows 0), its structure ref u32, the tick its fire is due to go out u32 (0 when it does
 * not burn), a count u8 of what its fire makes by itself and per lane: item u16, the tick its unit is done u32 (0 while it
 * waits); then a count u8 of jobs and per job: item u16, units left u8, done tick u32, and the ticks left of a unit paused for
 * want of fuel u32 (0 for one that is not).
 */
export const OWN_STATION = 16;

export const MARKER_DEATH = 1;

/**
 * Kinds of S_EVENT, each after a u8 naming it.
 * HIT, to the attacker: position (3 x f32), zone 4 bits, damage u16, killed 1 bit, armor stopped some 1 bit.
 * HURT, to the victim: damage u16, the side it came from (u8, 256ths of a turn, as a facing), zone 4 bits, and
 *   whether the side is shown 1 bit (0 for a silenced shot, whose side is then sent as 0: planning/reference/weapons-plan.md, M10).
 * DEATH, to the victim: the HURT fields, then killer name string, weapon content index u16 (0 for bare hands), distance u16 (tenths of a metre).
 * KILL, to the killer: victim name string, its level u16, experience gained u16 (tenths).
 */
export const EVENT_HIT = 1;
/** 24 characters of up to three bytes each. */
export const EVENT_NAME_BYTES = 72;
export const EVENT_HURT = 2;
export const EVENT_DEATH = 3;
export const EVENT_KILL = 4;
/**
 * SHOT, to other clients nearby: origin (3 x f32), ammunition content index u16, flies 1 bit, then 3 x f32. For a shot that
 * flies they are its velocity, followed by the ticks since it left u8. Otherwise they are where it ended. Then rays u8 (1:
 * the shot is the one ray above), seed u32 (0: the seed a shot of many rays is cast from, W3 of
 * planning/reference/weapons-plan.md), and silenced 1 bit (its weapon has a silencer, and no flash is drawn: M10).
 */
export const EVENT_SHOT = 5;
/** BLAST, to clients nearby: position (3 x f32), reach f32 in metres. */
export const EVENT_BLAST = 6;
/**
 * TAMED, to the new owner: entity handle u32, species content index u16, level u16, taming effectiveness u8 in percent (255
 * for one claimed as young, not tamed). The client then asks for a name.
 */
export const EVENT_TAMED = 7;

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

/** The snapshot input margin when no input has arrived yet. The client must not steer its clock by it. */
export const MARGIN_UNKNOWN = -128;

/** Inputs carried per packet. Losing up to three packets in a row costs nothing. */
export const INPUT_REDUNDANCY = 4;
/** How many ticks ahead of the server tick an input may be and still be buffered. */
export const INPUT_WINDOW = 32;
/**
 * Ticks the server goes on with a client's last input when none comes: about a quarter of a second, as in ARK. After that the
 * body stops moving and lets go of every button but INPUT_KEPT, its stance.
 */
export const INPUT_HOLD_TICKS = 8;
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
/** Bits of an input's buttons on the wire. InputBuffer.set clears any outside the mask. */
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
    this.view = new Float64Array(size);
  }

  has(tick: number): boolean {
    return this.tick[tick & this.mask] === tick;
  }

  /** Clamps every field to its legal range. */
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

/**
 * 380 bits: position and velocity exactly, then the rest of the predicted state. Protocol 13 added the aim's bloom and the
 * recoil's kick (a byte each, always 0 until W1 of planning/reference/weapons-plan.md steps them), and the flyers'
 * contracts (protocol 16) the flight counters.
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
  w.bits(b.mflags, 5);
  w.u16(b.kind);
  w.u16(b.yaw);
  w.u16(b.held);
  w.bits(b.act, 3);
  w.u8(b.actTicks);
  w.u8(b.rounds);
  w.u8(b.reloadTo);
  w.u8(b.bloom);
  w.u8(b.kick);
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
  b.mflags = r.bits(5);
  b.kind = r.u16();
  b.yaw = r.u16();
  b.held = r.u16();
  b.act = r.bits(3);
  b.actTicks = r.u8();
  b.rounds = r.u8();
  b.reloadTo = r.u8();
  b.bloom = r.u8();
  b.kick = r.u8();
  readFlight(r, b);
  readVehicle(r, b);
}

/** `key` must be KEY_BYTES long, and a `ticket` TICKET_BYTES. */
export function writeHello(w: BitWriter, version: number, contentHash: number, clipHash: number, name: string, flags: number, key: Uint8Array, look: Uint8Array | null = null, password = "", ticket: Uint8Array | null = null): void {
  w.bits(C_HELLO, 4);
  w.u16(version);
  w.u32(contentHash);
  w.u32(clipHash);
  w.string(name);
  const marked = look ? flags | HELLO_LOOK : flags & ~HELLO_LOOK;
  w.u8(ticket ? marked | HELLO_TICKET : marked & ~HELLO_TICKET);
  for (let i = 0; i < KEY_BYTES; i++) w.u8(key[i] ?? 0);
  if (look) for (let i = 0; i < LOOK_BYTES; i++) w.u8(look[i] ?? 0);
  if (ticket) for (let i = 0; i < TICKET_BYTES; i++) w.u8(ticket[i] ?? 0);
  w.string(password);
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
 * Call after reading `ack` and `behind` (in ticks). Keeps only ticks in (serverTick, serverTick + INPUT_WINDOW) not already
 * present. Returns the newest tick named, or 0 if the message was malformed.
 */
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
      // `ack - behind` is when the newest input was sampled. Each older input was sampled one tick earlier.
      inputs.view[tick & inputs.mask] = ack - behind - k;
    }
  }
  return r.overflow ? 0 : newest;
}
