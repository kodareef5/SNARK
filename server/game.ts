import { IMPALE_SLOT } from "../shared/sim/seats.ts";
// The authoritative game loop. It owns no socket or clock. The transport and the calls to
// tick() come from outside, so tests run a whole server in memory.

import { TICK_DT, TICK_RATE, chunkAt } from "../shared/coords.ts";
import { BitReader, BitWriter } from "../shared/net/codec.ts";
import {
  CMD_STATICS,
  CMD_VIEW,
  C_COMMAND,
  C_INPUT,
  INPUT_HOLD_TICKS,
  VEHICLE_HOLD_TICKS,
  INPUT_KEPT,
  INPUT_WINDOW,
  InputBuffer,
  KEY_BYTES,
  MAX_CLIENT_MESSAGE,
  OWN_STATION,
  OWN_SUBJECT,
  REJECT_DENIED,
  TEXT_NOTICE,
  REJECT_MALFORMED,
  RESULT_BUSY,
  RESULT_DENIED,
  RESULT_INVALID,
  SESSION_ALIVE,
  CHOOSE_DIED,
  S_OWN,
  VIEW_STEPS,
  S_RESULT,
  S_TEXT,
  nextCommandSeq,
  readInputs,
} from "../shared/net/protocol.ts";
import { CH_RELIABLE, type Connection } from "../shared/net/transport.ts";
import { PassengerView } from "./passenger-view.ts";
import { OwnState } from "./ownstate.ts";
import { Replication } from "./replication.ts";
import { FAULT_REFUSED_TICKS, Sessions } from "./sessions.ts";
import { Signal, Veto } from "./signal.ts";
import { SentView, ViewRing } from "../shared/net/view.ts";
import { BTN_JUMP, BTN_SECONDARY, Body, stepBody, stepOut } from "../shared/sim/character.ts";
import { stepVehicleBody } from "../shared/sim/vehicle-body.ts";
import { cancelCreatureAction, creatureHold, stepCreature } from "../shared/sim/creature-actions.ts";
import { ACT_NONE, FISTS, actionOut, biteCost, stepAction } from "../shared/sim/weapon.ts";
import { stepAim } from "../shared/sim/aim.ts";
import { F_PLAYER, F_ALIVE, F_PROP } from "../shared/sim/entities.ts";
import type { ServerWorld } from "./world.ts";
import { NO_BUS, event, type Bus } from "./events/bus.ts";
import type { Place } from "./beds.ts";
import { PART, TickParts } from "./admin/parts.ts";
import { Lane } from "./lane.ts";
import { BodyBlocking } from "./blocking.ts";
import { ServerFootContacts } from "./foot-contacts.ts";

export interface GameOptions {
  /** In ticks. */
  snapshotEvery: number;
  /** Byte budget for the deferrable part of one snapshot, for a client that has not asked for another. */
  snapshotBytes: number;
  /** The most a client may ask for. */
  snapshotBytesMax: number;
  /** The most entities any client is shown, up to MAX_VIEW. A client that has not asked is shown VIEW_DEFAULT of them. */
  viewCap: number;
  /** Interest radii, in chunks. */
  entityRadius: number;
  structRadius: number;
  chunkSlotsPerTick: number;
  maxClients: number;
  /** A body stays this many ticks after its connection closes, so logging out does not dodge a fight. */
  lingerTicks: number;
  spectators: "off" | "admin" | "anyone";
  /** "" for none. */
  password: string;
  motdSeconds: number;
  /** The most connections from one address that may be waiting to say hello. 0 for no limit. */
  pendingPerAddress: number;
}

const DEFAULTS: GameOptions = {
  snapshotEvery: 1,
  snapshotBytes: 1100,
  snapshotBytesMax: 1100,
  viewCap: 1024,
  entityRadius: 3,
  structRadius: 3,
  chunkSlotsPerTick: 256,
  maxClients: 128,
  lingerTicks: 150,
  spectators: "admin",
  password: "",
  motdSeconds: 20,
  pendingPerAddress: 8,
};

/** What the server counts of its sessions' traffic since it started. */
export interface GameStats {
  malformed: number;
  throttled: number;
  lateInputs: number;
  heldInputs: number;
  commands: number;
  chunkBytes: number;
  overflows: number;
  faults: number;
}

/**
 * Unreliable messages from one client: this many a tick, and up to PACKETS_HELD at once, what a page sends at most, one a
 * tick, in the ticks of input the server buffers, which a stalled loop reads in one go. The rest are dropped.
 */
const MAX_PACKETS_PER_TICK = 8;
const PACKETS_HELD = INPUT_WINDOW;
/** An input this many ticks older than a client's newest is from its clock started again, which a page does a second back (client/core/session.ts). */
const RESTARTED = 16;
/** Reliable messages from one client per tick. A command past this is answered busy, and anything else is a strike. */
const MAX_RELIABLE_PER_TICK = 32;
/** Malformed messages tolerated before disconnecting. */
const MAX_STRIKES = 8;
const COMMAND_QUEUE = 16;
const COMMANDS_PER_TICK = 4;

/** Bits of Client.did, set by the action step on the tick just stepped. */
export const DID_STRIKE = 1;
/** The mount it drives landed a bite. */
export const DID_BITE = 8;
export const DID_FIRE = 2;
export const DID_RELOAD = 4;
/** The flyer it drives began a barrel roll. */
export const DID_ROLL = 16;

/** Read every argument and check r.overflow before acting. Returns a RESULT code. */
export type CommandHandler = (c: Client, r: BitReader) => number;

/** One survivor's session, made when its hello is accepted. It outlives its connection by lingerTicks, and a reconnect with the same name and key takes it over. */

export class Client {
  /** Slot in `GameServer.clients`. */
  id: number;
  conn: Connection;
  active = false;
  /** The connection is gone; the body stays until `lingerUntil`. */
  closed = false;
  lingerUntil = 0;
  name = "";
  key: Uint8Array = new Uint8Array(KEY_BYTES);
  createRequest:Uint8Array|null=null;
  /** Survivor record id, set by the host. 0 until the session has had a body. */
  pid = 0;
  state = SESSION_ALIVE;
  /** Cheats enabled. Belongs to the connection, never saved. */
  admin = false;
  /** Tick of its last input change or command, for the idle kick. */
  activeAt = 0;
  cheatAttempts = 0;
  /** The session is in the world, with a body or without. A body it gets after that is a respawn. */
  entered = false;
  /** Modules have been told the session has a survivor. */
  joined = false;
  /** Why the session ended, for modules: "left" unless the server put it out. */
  left = "left";
  /** Entity index of the visible body, or -1 (spectating, dead). */
  ent = -1;
  /** Species whose movement parameters step the body. */
  kind = 0;
  /** The entity its inputs drive in place of its own body (a mount), or -1. driveGen notices one that has gone. */
  drive = -1;
  driveGen = 0;
  /** With an entity, a copy of its columns after the latest tick. Without one, the only copy. */
  readonly body = new Body();
  /** Centre of this session's interest. */
  chunk = 0;
  /** The chunks a sight's cone has had it sent, and the tick each may be let go from (Replication.syncChunks, D1087). */
  readonly coneKept = new Map<number, number>();
  /** Its view with what its sight's cone adds (Replication.cone), and their ranks; made the first time it has one. */
  wide: SentView | null = null;
  wideRanks: Uint16Array | null = null;
  readonly inputs = new InputBuffer(INPUT_WINDOW);
  /** First snapshot actually sent with the current urban seat. -1 from the authoritative board until send. */
  vehicleSeatSnapshot = 0;
  /** The snapshot acknowledged by the first packet accepted for each input. */
  readonly inputAcks = new Uint32Array(INPUT_WINDOW);
  /** The tick of the last impacts this client was told (EVENT_IMPACT), and how many it was told then. */
  impactsAt = 0;
  impacts = 0;
  /** The tick on which each buffered input arrived, by its own tick: how far ahead the client really sent it. */
  readonly arrived = new Uint32Array(INPUT_WINDOW);
  heldX = 0;
  heldZ = 0;
  heldYaw = 0;
  heldPitch = 0;
  /** The aimed look past its units, in 256ths (InputBuffer.fineYaw), for a shot. */
  heldFineYaw = 0;
  heldFinePitch = 0;
  heldButtons = 0;
  /** The tick its last input was for. Past INPUT_HOLD_TICKS without another, the body stops; a vehicle driven, VEHICLE_HOLD_TICKS. */
  inputAt = 0;
  /** Buttons that went down this tick. */
  pressed = 0;
  /** DID_ bits for this tick, and how far a shot was drawn. */
  did = 0;
  drawn = 0;
  private before = 0;
  newestInput = 0;
  /** What GameServer.given was at its welcome: a snapshot tells it the ticks given up since. */
  givenAt = 0;
  /**
   * The buttons each tick was stepped with, by its own tick. The buttons of an input that came after its tick, which that
   * tick stepped without, are carried into the next tick stepped (`carry`), and its snapshot says so (`carried`), so a
   * press is not lost to a late input and the page replays it where the server stepped it.
   */
  readonly stepped = new Uint16Array(INPUT_WINDOW);
  readonly steppedAt = new Uint32Array(INPUT_WINDOW);
  carry = 0;
  carried = 0;
  /** The oldest tick a late input may carry from: a press more than a second late is let go, its moment past. */
  lateFrom = 0;
  /** For readInputs: the buttons of an input for `tick`, which has been stepped. */
  readonly late = (tick: number, buttons: number): void => {
    const k = tick & (INPUT_WINDOW - 1);
    if (tick < this.lateFrom || this.steppedAt[k] !== tick) return;
    this.carry |= buttons & ~this.stepped[k]!;
    this.stepped[k] |= buttons;
  };
  /** Newest snapshot the client says it decoded. */
  ackTick = 0;
  /** High-water mark even while an ACK of zero requests a fresh full snapshot. */
  highestAck = 0;
  lastSnapshot = 0;
  readonly views = new ViewRing(() => new PassengerView());
  /** Structure table version the client holds, per chunk. */
  readonly known: Uint32Array;
  /** Version of each chunk's used-up nodes the client holds. */
  readonly nodesKnown: Uint32Array;
  readonly subscribed: number[] = [];
  syncChunk = -1;
  /** Bytes of chunk messages sent on each of the last 32 ticks, and the tick each slot is for. */
  readonly chunkSent = new Uint32Array(32);
  readonly chunkSentAt = new Uint32Array(32);
  /** The last chunk sync used all the room it was given, so rows may still wait. */
  rowsWaiting = false;
  syncCursor = 0;
  syncFrom = 0;
  syncTarget = 0;
  /** Removed rows of the chunk being synced go as grouped removals, not row by row. */
  syncByRemoval = false;
  /** It holds the map's statics and takes a chunk's from them (HELLO_STATICS). */
  statics = false;
  rotate = 0;
  /** The most entities it is shown and its snapshot byte budget, where it has asked. 0 for the server's own. */
  viewCap = 0;
  snapshotBytes = 0;
  /** What CMD_VIEW last asked for, held to the server's limits, and the tick from which those two may next change. */
  wantView = 0;
  wantBytes = 0;
  viewReadyAt = 0;
  strikes = 0;
  packets = 0;
  reliable = 0;
  cmdSeq = 0;
  readonly queue: Uint8Array[] = [];
  /** The look this connection brought or chose in the creator, for a survivor that has none yet. */
  look: Uint8Array | null = null;
  textReadyAt = 0;
  /** OWN_SESSION must be sent. */
  ownDirty = false;
  /** What this connection was last sent of each kind of owner state, by OWN_ kind (server/ownstate.ts). Nothing at a kind: it was sent none. */
  readonly sent: unknown[] = [];
  /** Without a body, why it chooses where to rise (CHOOSE_). The places it was last sent (server/beds.ts), in their order, and the list's number. */
  why = CHOOSE_DIED;
  readonly respawnAt: Place[] = [];
  placesList = 0;
  /** Record id of the container it has open, or 0. */
  open = 0;

  edges(): void {
    this.pressed = this.heldButtons & ~this.before;
    this.before = this.heldButtons;
  }

  constructor(id: number, conn: Connection, chunks: number) {
    this.id = id;
    this.conn = conn;
    this.known = new Uint32Array(chunks);
    this.nodesKnown = new Uint32Array(chunks);
  }

  /** Forget everything that belonged to the previous connection. */
  relink(conn: Connection): void {
    this.conn = conn;
    this.closed = false;
    this.inputs.tick.fill(0);
    this.vehicleSeatSnapshot = this.vehicleSeatSnapshot === 0 ? 0 : -1;
    this.heldX = this.heldZ = this.heldButtons = 0;
    this.carry = this.carried = 0;
    this.steppedAt.fill(0);
    this.newestInput = this.highestAck = this.ackTick = this.lastSnapshot = 0;
    this.views.clear();
    this.known.fill(0);
    this.nodesKnown.fill(0);
    this.subscribed.length = 0;
    this.syncChunk = -1;
    this.chunkSent.fill(0);
    this.rowsWaiting = false;
    this.rotate = 0;
    this.viewCap = this.snapshotBytes = this.wantView = this.wantBytes = this.viewReadyAt = 0;
    this.strikes = 0;
    this.cmdSeq = 0;
    this.queue.length = 0;
    this.textReadyAt = 0;
    this.admin = false;
    this.cheatAttempts = 0;
    this.entered = false;
    this.joined = false;
    this.left = "left";
    this.ownDirty = false;
    // What it was sent of the creature and the station it had open is kept, so the new connection is told that they closed.
    for (let k = 0; k < this.sent.length; k++) if (k !== OWN_SUBJECT && k !== OWN_STATION) this.sent[k] = undefined;
    this.open = 0;
    this.pressed = this.before = 0;
  }
}

const CONTAINER_OPEN = event("container.open");

export class GameServer {
  readonly world: ServerWorld;
  readonly opts: GameOptions;
  bus: Bus = NO_BUS;
  readonly clients: (Client | null)[];
  /** `overflows` counts snapshots and chunk messages that outgrew the writer and were not sent, and `faults` commands that threw. */
  readonly stats: GameStats = { malformed: 0, throttled: 0, lateInputs: 0, heldInputs: 0, commands: 0, chunkBytes: 0, overflows: 0, faults: 0 };
  /**
   * A command's handler threw `err`. Its key and machine are refused (refusals). Returns whether the world goes on, its
   * session then put out; false, or no hook, throws on, so the server stops as at any throw and saves nothing of the tick.
   */
  onFault: ((c: Client, op: number, command: Uint8Array, err: unknown) => boolean) | null = null;
  /** What only a survivor's own session is sent of it. A system registers the kinds it owns here (server/ownstate.ts). */
  readonly own = new OwnState(this);
  /** Who is in the world and on which connection: the hello, bodies, spectators, lingering (server/sessions.ts). */
  readonly sessions: Sessions;
  /** What each session is sent each tick: its view, its snapshot, its chunk rows (server/replication.ts). */
  readonly replication: Replication;
  /** Called once per tick before bodies move, to apply changes queued outside the step. */
  onBeforeStep: (() => void) | null = null;
  /** Called once per tick after bodies move and commands run, before replication. */
  onStep: ((tick: number) => void) | null = null;
  /** Whether the session may run command `op` now: any listener may refuse. A refused command answers RESULT_DENIED and its handler is not called. */
  readonly allows = new Veto<[c: Client, op: number]>(true);
  /** speed is in metres per second. onMountLand is told of a driven creature `e` landing. */
  readonly onLand = new Signal<[c: Client, speed: number]>();
  /** A survivor's glider opened this tick, or folded (planning/workstreams/glider.md). */
  readonly onGlide = new Signal<[c: Client, opened: boolean]>();
  readonly onMountLand = new Signal<[e: number, speed: number]>();
  /** A rising secondary input on the mounted body, after movement and its ordinary bite step. */
  readonly onMountSecondary = new Signal<[e: number]>();
  /** A driven flyer `e` took off, set down from flight or began a barrel roll this tick, as stepOut still says. */
  readonly onMountFlight = new Signal<[e: number]>();
  /** Vehicle report is still current; authoritative damage consumes it immediately after the body is stored. */
  readonly onVehicleStep = new Signal<[e: number]>();
  /** The host adds resource contacts around this same shared vehicle step. */
  vehicleStep: typeof stepVehicleBody = stepVehicleBody;
  /** Where each tick's time went, part by part (server/admin/parts.ts). The host marks the parts of its step in it. */
  readonly parts = new TickParts();
  /** Physics' time in each tick, kept for it before the work that can wait (server/lane.ts). */
  readonly lane = new Lane();
  /** A body a session drives on foot meets the vehicles round it in its own step, as the page predicting it does. */
  readonly feet: ServerFootContacts;
  /** Bodies a walker cannot walk through (server/blocking.ts). */
  readonly blocking: BodyBlocking;
  /** The bodies besides the sessions' that may block a walker this tick: the awake creatures (server/creatures.ts). */
  blockBodies: (() => readonly [ArrayLike<number>, number]) | null = null;
  private sessionBodies = new Int32Array(64);
  private readonly footBefore = new Body();

  private readonly handlers: (CommandHandler | null)[] = new Array(256).fill(null);
  private readonly w: BitWriter;
  private readonly r = new BitReader();

  constructor(world: ServerWorld, opts: Partial<GameOptions> = {}) {
    this.world = world;
    this.opts = { ...DEFAULTS, ...opts };
    this.feet = new ServerFootContacts(world);
    this.blocking = new BodyBlocking(world);
    this.clients = new Array(this.opts.maxClients).fill(null);
    // Removes are sent whatever they cost, 6.7 KB for 2,048 of them, and an update can take two bytes more than it was budgeted at.
    this.w = new BitWriter(Math.max(16384, 8192 + 2 * Math.max(this.opts.snapshotBytes, this.opts.snapshotBytesMax)));
    this.replication = new Replication({ world, opts: this.opts, clients: this.clients, stats: this.stats, w: this.w, parts: this.parts });
    this.sessions = new Sessions({ world, opts: this.opts, clients: this.clients, stats: this.stats, w: this.w, r: this.r, game: this, players: this, replication: this.replication });
  }

  /** Lingering bodies are not counted. */
  get playerCount(): number {
    let n = 0;
    for (const c of this.clients) if (c?.active && !c.closed) n++;
    return n;
  }

  handle(op: number, fn: CommandHandler): void {
    this.handlers[op] = fn;
  }

  /** How long a client's last input goes on when none comes: longer for a vehicle it drives or flies. */
  private holdTicks(c: Client): number {
    return c.drive >= 0 && this.world.reg.vehicle[this.world.ents.kind[c.drive]!] ? VEHICLE_HOLD_TICKS : INPUT_HOLD_TICKS;
  }

  tick(): void {
    const world = this.world;
    const ents = world.ents;
    const T = ++world.tick;
    const parts = this.parts;
    parts.begin();
    this.lane.begin();

    this.onBeforeStep?.();
    parts.mark(PART.before);
    // The sessions' own bodies step first, as physics: what they predict is never put off.
    this.lane.enter();
    // Every body that may block a walker, where this tick's snapshots will carry it.
    let sessions = 0;
    for (const c of this.clients) {
      if (!c?.active) continue;
      const e = c.drive >= 0 ? c.drive : c.ent;
      if (e < 0) continue;
      if (sessions === this.sessionBodies.length) {
        const wider = new Int32Array(sessions * 2);
        wider.set(this.sessionBodies);
        this.sessionBodies = wider;
      }
      this.sessionBodies[sessions++] = e;
    }
    const others = this.blockBodies?.();
    if (others) this.blocking.begin([this.sessionBodies, others[0]], [sessions, others[1]]);
    else this.blocking.begin([this.sessionBodies], [sessions]);

    for (const c of this.clients) {
      if (!c) continue;
      c.packets = Math.max(0, c.packets - MAX_PACKETS_PER_TICK);
      c.reliable = 0;
      if (!c.active) continue;
      const inputs = c.inputs;
      if (c.closed) {
        c.heldX = c.heldZ = c.heldButtons = 0;
      } else if (inputs.has(T)) {
        const i = T & inputs.mask;
        // Any change of input counts as activity.
        if (c.heldX !== inputs.moveX[i] || c.heldZ !== inputs.moveZ[i] || c.heldYaw !== inputs.yaw[i] || c.heldPitch !== inputs.pitch[i] || c.heldButtons !== inputs.buttons[i]) c.activeAt = T;
        c.heldX = inputs.moveX[i]!;
        c.heldZ = inputs.moveZ[i]!;
        c.heldYaw = inputs.yaw[i]!;
        c.heldPitch = inputs.pitch[i]!;
        c.heldFineYaw = inputs.fineYaw[i]!;
        c.heldFinePitch = inputs.finePitch[i]!;
        c.heldButtons = inputs.buttons[i]!;
        c.inputAt = T;
      } else {
        this.stats.heldInputs++;
        // A client gone quiet, a hidden tab for one, stops where it is and keeps only its stance.
        if (T - c.inputAt > this.holdTicks(c)) {
          c.heldX = c.heldZ = 0;
          c.heldButtons &= INPUT_KEPT;
        }
      }
      c.carried = c.closed ? 0 : c.carry;
      c.heldButtons |= c.carried;
      c.carry = 0;
      c.stepped[T & (INPUT_WINDOW - 1)] = c.heldButtons;
      c.steppedAt[T & (INPUT_WINDOW - 1)] = T;
      c.lateFrom = T - TICK_RATE;
      c.edges();
      if (c.ent >= 0 && ents.seatSlot[c.ent] === IMPALE_SLOT && ents.seat[c.ent] !== 0) {
        c.heldButtons = c.pressed = 0;
        c.heldX = c.heldZ = 0;
      }
      c.did = 0;
      const b = c.body;
      // Let go of a mount that died or was replaced.
      if (c.drive >= 0 && ((ents.flags[c.drive]! & F_ALIVE) === 0 || ents.gen[c.drive] !== c.driveGen)) this.release(c);
      const driving = c.drive >= 0;
      const e = driving ? c.drive : c.ent;
      if (e >= 0) {
        ents.loadBody(e, b);
        const vehicle = world.reg.vehicle[b.kind];
        const combat = world.reg.combat[b.kind];
        const parent = ents.seat[e]! - 1;
        // Who sits in a seat of a car or a saddle and does not steer it is held there; a carried body has no seat slot.
        const passenger = !driving && parent >= 0 && ents.seatSlot[e] !== 0 && ents.gen[parent] === ents.seatGen[e];
        if (vehicle) {
          const quiet = c.closed || T - c.inputAt > VEHICLE_HOLD_TICKS;
          this.vehicleStep(world, b, quiet ? 0 : c.heldX, quiet ? 0 : c.heldZ, quiet ? (vehicle.movement === "rotor" ? 0 : BTN_JUMP) : c.heldButtons, vehicle, TICK_DT, c.heldYaw, !quiet);
        } else if (!passenger) {
          // A survivor's tamed numbers are its own. A body that is driven is a tame's.
          this.footBefore.copy(b);
          const moving = world.reg.tamedMove[b.kind]!;
          // The bodies about it as the snapshot its client stepped this tick with showed them, where it says which.
          const ack = c.inputs.has(T) ? c.inputAcks[T & c.inputs.mask]! : 0;
          const seen = ack !== 0 ? c.views.find(ack) : null;
          // Its tribe is the survivor's, riding or not, as its client knows it (OWN_TRIBE).
          const team = c.ent >= 0 ? ents.team[c.ent]! : ents.team[e]!;
          world.blockers = seen ? this.blocking.inView(e, seen, b.x, b.y, b.z, moving.radius, team) : this.blocking.around(e, b.x, b.y, b.z, moving.radius, team);
          if (combat && driving) stepCreature(world, b, c.heldX, c.heldZ, c.heldYaw, c.heldPitch, c.heldButtons, c.pressed, world.reg.tamedMove[b.kind]!, combat, TICK_DT, true, c.closed || T - c.inputAt > INPUT_HOLD_TICKS);
          else stepBody(world, b, c.heldX, c.heldZ, c.heldYaw, c.heldPitch, c.heldButtons, world.reg.tamedMove[b.kind]!, TICK_DT);
          world.blockers = null;
          this.feet.meet(e, this.footBefore, b, world.reg.tamedMove[b.kind]!);
        } else {
          b.yaw = c.heldYaw;
          b.jetThrust = b.jetKeys = b.jetJumpTap = b.jetSprintTap = 0;
          stepOut.landSpeed = 0;
        }
        if (!driving) {
          // Enclosed cabins stow weapons while preserving the held inventory slot for exit.
          // Both hands are on an open glider, which stows what they held as a cabin does.
          const stowed = b.glide !== 0 || (passenger && (ents.seatSlot[e] === IMPALE_SLOT || world.reg.vehicle[ents.kind[parent]!]?.seats[ents.seatSlot[e]! - 1]?.weapons === false));
          if (stowed) { b.act = ACT_NONE; b.actTicks = 0; }
          // Hits are resolved later, once every body has moved.
          stepAction(b, stowed ? 0 : c.heldButtons, stowed ? 0 : c.pressed, stowed ? FISTS : world.reg.weapon[b.held] ?? FISTS);
          c.did = (actionOut.strike ? DID_STRIKE : 0) | (actionOut.fire ? DID_FIRE : 0) | (actionOut.reloaded ? DID_RELOAD : 0);
          c.drawn = actionOut.draw;
          stepAim(b, stowed ? FISTS : world.reg.weapon[b.held] ?? FISTS, T);
        } else {
          // A mount's bite goes through the same action step as any blow.
          const jaws = world.reg.weapon[b.kind];
          if (jaws && !combat) {
            stepAction(b, c.heldButtons, c.pressed, jaws);
            if (actionOut.strike) c.did = DID_BITE;
            biteCost(b, world.reg.biteStamina[b.kind]!);
          }
          if (stepOut.rolled) c.did |= DID_ROLL;
        }
        ents.storeBody(e, b);
        if (combat) ents.hold[e] = creatureHold(b);
        if (driving && !vehicle && (c.pressed & BTN_SECONDARY) !== 0 && b.act === ACT_NONE) this.onMountSecondary.emit(e);
        if (vehicle) this.onVehicleStep.emit(e);
        ents.pitch[e] = c.heldPitch;
        ents.pose(e, T);
        if (driving && (stepOut.tookOff || stepOut.setDown || stepOut.rolled)) this.onMountFlight.emit(e);
        if (!driving && (stepOut.glideOpened || stepOut.glideFolded)) this.onGlide.emit(c, stepOut.glideOpened);
        if (stepOut.landSpeed > 0) {
          if (driving) this.onMountLand.emit(e, stepOut.landSpeed);
          else this.onLand.emit(c, stepOut.landSpeed);
        }
      } else {
        b.kind = c.kind;
        stepBody(world, b, c.heldX, c.heldZ, c.heldYaw, c.heldPitch, c.heldButtons, world.reg.move[c.kind]!, TICK_DT);
      }
      c.chunk = chunkAt(world.dims, b.x, b.z);
    }
    this.lane.leave();
    parts.mark(PART.bodies);

    for (const c of this.clients) if (c?.active && c.queue.length > 0) this.runCommands(c);
    this.sessions.expire(T);
    parts.mark(PART.commands);

    this.onStep?.(T);
    parts.mark(PART.save);
    // History records the world as this tick's snapshots show it.
    world.history.record(T);
    parts.mark(PART.history);

    this.replication.send(T);
    parts.end(T);
  }

  /** Whether modules let a session open a box, a body or a creature's bag. A session refused is told why. */
  mayOpen(c: Client, pid: number): boolean {
    const refused = this.bus.before(CONTAINER_OPEN, { byPid: c.pid, pid });
    if (refused !== "") this.sendText(c, TEXT_NOTICE, refused);
    return refused === "";
  }

  /** One message per line. */
  sendText(c: Client, channel: number, text: string): void {
    if (c.closed) return;
    const w = this.w;
    for (const line of text.split("\n")) {
      w.reset();
      w.u8(S_TEXT);
      w.u8(channel);
      // 330 characters is under the client's byte limit even at three bytes each.
      w.string(line.length > 330 ? line.slice(0, 330) : line);
      c.conn.send(CH_RELIABLE, w.bytes());
    }
  }

  /** Start an OWN message. Write its fields to the returned writer, then call endOwn. */
  beginOwn(component: number): BitWriter {
    const w = this.w;
    w.reset();
    w.u8(S_OWN);
    w.u8(component);
    return w;
  }

  endOwn(c: Client): void {
    c.conn.send(CH_RELIABLE, this.w.bytes());
  }

  /** Start a reliable message of another type; finish it with `endOwn`. */
  begin(type: number): BitWriter {
    const w = this.w;
    w.reset();
    w.u8(type);
    return w;
  }

  /** Put a session's inputs in charge of entity `e`. Its own body stays, unstepped, until `release`. */
  take(c: Client, e: number): boolean {
    const ents = this.world.ents;
    if (c.ent < 0 || c.drive >= 0 || e === c.ent || (ents.flags[e]! & (F_ALIVE | F_PLAYER | F_PROP)) !== F_ALIVE || ents.driven[e] !== 0) return false;
    if (!this.world.reg.move[ents.kind[e]!]) return false;
    c.drive = e;
    c.driveGen = ents.gen[e]!;
    ents.driven[e] = 1;
    return true;
  }

  release(c: Client): void {
    const ents = this.world.ents;
    if (c.drive < 0) return;
    if ((ents.flags[c.drive]! & F_ALIVE) !== 0 && ents.gen[c.drive] === c.driveGen) {
      ents.driven[c.drive] = 0;
      const combat = this.world.reg.combat[ents.kind[c.drive]!];
      if (combat) {
        const body = new Body();
        ents.loadBody(c.drive, body);
        cancelCreatureAction(body, combat);
        ents.storeBody(c.drive, body);
        ents.hold[c.drive] = creatureHold(body);
        ents.pose(c.drive, this.world.tick);
      }
    }
    c.drive = -1;
  }

  receive(c: Client, channel: number, data: Uint8Array): void {
    if (c.closed) return;
    let over = false;
    if (channel !== CH_RELIABLE) {
      if (++c.packets > PACKETS_HELD) {
        this.stats.throttled++;
        return;
      }
    } else over = ++c.reliable > MAX_RELIABLE_PER_TICK;
    let ok = data.length <= MAX_CLIENT_MESSAGE;
    if (ok) {
      const r = this.r;
      r.reset(data);
      const type = r.bits(4);
      // A stalled connection delivers a burst of commands in one tick. Each is still read for its place in the sequence.
      if (over && !(type === C_COMMAND && c.active)) ok = false;
      else if (type === C_INPUT && c.active) ok = this.input(c, r);
      else if (type === C_COMMAND && c.active && channel === CH_RELIABLE) ok = this.command(c, r, data, over);
      else ok = false;
    }
    if (!ok) {
      this.stats.malformed++;
      if (++c.strikes > MAX_STRIKES) this.sessions.reject(c, REJECT_MALFORMED);
    }
  }

  private input(c: Client, r: BitReader): boolean {
    const ack = r.u32();
    const behind = r.u8() / VIEW_STEPS;
    const validAck = ack >= c.highestAck && ack <= c.lastSnapshot && c.views.find(ack) ? ack : 0;
    const newest = readInputs(r, c.inputs, this.world.tick, validAck, behind, c.inputAcks, c.late);
    if (newest === 0) return false;
    if (newest <= this.world.tick) this.stats.lateInputs++;
    // Track the newest tick even when it is too far ahead to buffer, because the margin sent back tells a
    // client its clock has run away. It moves backward only by more than RESTARTED, which is a restarted clock.
    const fresh = newest > c.newestInput || newest < c.newestInput - RESTARTED;
    if (fresh) {
      // A stream delivers in order, so an input arrives with the first message whose newest reaches it.
      for (let t = Math.max(newest > c.newestInput ? c.newestInput + 1 : 0, newest - INPUT_WINDOW + 1); t <= newest; t++) c.arrived[t & (INPUT_WINDOW - 1)] = this.world.tick;
      c.newestInput = newest;
    }
    // An ack can only name a snapshot that was sent, and only move forward. An ack of 0 says the client cannot read against
    // the view it acknowledged, so the next snapshot is whole. An input that arrives out of order may not say that.
    if (ack === 0) {
      if (fresh) c.ackTick = 0;
    } else if (validAck > c.ackTick) c.highestAck = c.ackTick = validAck;
    return true;
  }

  /** A gap in the sequence means a broken client. A command `over` the tick's limit, or the queue's, is answered busy and not run. */
  private command(c: Client, r: BitReader, data: Uint8Array, over: boolean): boolean {
    const seq = r.u16();
    r.u8();
    if (r.overflow || seq !== nextCommandSeq(c.cmdSeq)) return false;
    c.cmdSeq = seq;
    c.activeAt = this.world.tick;
    if (over || c.queue.length >= COMMAND_QUEUE) this.result(c, seq, RESULT_BUSY);
    else c.queue.push(data);
    return true;
  }

  private runCommands(c: Client): void {
    const r = this.r;
    for (let n = 0; n < COMMANDS_PER_TICK && c.queue.length > 0; n++) {
      const data = c.queue.shift()!;
      r.reset(data);
      r.bits(4);
      const seq = r.u16();
      const op = r.u8();
      const handler = this.handlers[op];
      let code: number;
      try {
        // What a session is shown is its own to ask in any state, so that is answered here.
        code = op === CMD_VIEW ? this.replication.askView(c, r) : op === CMD_STATICS ? this.replication.takeStatics(c) : !handler ? RESULT_INVALID : !this.allows.ask(c, op) ? RESULT_DENIED : handler(c, r);
      } catch (err) {
        this.stats.faults++;
        this.sessions.fault(c);
        if (!this.onFault?.(c, op, data, err)) throw err;
        this.sendText(c, TEXT_NOTICE, `the server could not carry out a command of yours, so it has put you out; you may come back in ${FAULT_REFUSED_TICKS / TICK_RATE / 60} minutes`);
        this.sessions.reject(c, REJECT_DENIED);
        return;
      }
      this.stats.commands++;
      // The handler may have ended the session (a kick, too many password attempts).
      if (this.clients[c.id] !== c || c.closed || !c.conn.open) return;
      this.result(c, seq, code);
    }
  }

  /** A result with no sequence number, for news no command asked for. */
  notify(c: Client, code: number): void {
    this.result(c, 0, code);
  }

  private result(c: Client, seq: number, code: number): void {
    const w = this.w;
    w.reset();
    w.u8(S_RESULT);
    w.u16(seq);
    w.u8(code);
    c.conn.send(CH_RELIABLE, w.bytes());
  }

}
