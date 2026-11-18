import { IMPALE_SLOT } from "../shared/sim/seats.ts";
// The authoritative game loop. It owns no socket or clock. The transport and the calls to
// tick() come from outside, so tests run a whole server in memory.

import { CHUNK_SIZE, STRUCT_UNITS, TICK_DT, TICK_RATE, chunkAt, chunkCount, chunkCx, chunkCz } from "../shared/coords.ts";
import { TAU, detCos, detSin } from "../shared/math/scalar.ts";
import { BitReader, BitWriter, Named } from "../shared/net/codec.ts";
import {
  CMD_STATICS,
  CMD_VIEW,
  C_COMMAND,
  C_HELLO,
  C_INPUT,
  HELLO_LOOK,
  HELLO_SPECTATE,
  HELLO_STATICS, HELLO_NEW, HELLO_RESUME,
  HELLO_TICKET,
  INPUT_HOLD_TICKS,
  VEHICLE_HOLD_TICKS,
  INPUT_KEPT,
  INPUT_WINDOW,
  InputBuffer,
  KEY_BYTES,
  MARGIN_UNKNOWN,
  MAX_CLIENT_MESSAGE,
  MAX_NAME_BYTES,
  MAX_PASSWORD_BYTES,
  OWN_SESSION,
  PROTOCOL_VERSION,
  REJECT_CONTENT,
  REJECT_DENIED,
  REJECT_KICKED,
  TEXT_NOTICE,
  REJECT_FULL,
  REJECT_MALFORMED,
  REJECT_NAME,
  REJECT_PASSWORD,
  REJECT_TRAVEL,
  REJECT_VERSION,
  RESULT_BUSY,
  RESULT_DENIED,
  RESULT_INVALID,
  RESULT_OK,
  SESSION_ALIVE,
  SESSION_CREATING,
  SESSION_DEAD,
  CHOOSE_DIED,
  SESSION_SPECTATING,
  S_CHUNK,
  S_CHUNK_DROP,
  S_OWN,
  VIEW_STEPS,
  S_REJECT,
  S_RESULT,
  S_SNAPSHOT,
  S_TEXT,
  S_TRAVEL,
  REMOVAL_NEWS_TICKS,
  S_WELCOME,
  TICKET_BYTES,
  nextCommandSeq,
  readInputs,
  writeBody,
} from "../shared/net/protocol.ts";
import { CH_RELIABLE, CH_UNRELIABLE, type Connection, type Listener } from "../shared/net/transport.ts";
import { PassengerView } from "./passenger-view.ts";
import { MAX_VIEW, SentView, VIEW_DEFAULT, VIEW_RING, ViewRing, quantX, quantY, writeViewDelta } from "../shared/net/view.ts";
import { ContactSnapshot, writeContacts } from "../shared/net/contact.ts";
import { BTN_JUMP, BTN_SECONDARY, Body, MODE_GHOST, MODE_NONE, stepBody, stepOut } from "../shared/sim/character.ts";
import { stepVehicleBody, packVehicleDrive, packVehiclePose, quantVehicleWheel, packVehicleRide } from "../shared/sim/vehicle-body.ts";
import { packVehicleRotor, packVehicleSystems, packVehicleQuaternionPair, packBoatWater } from "../shared/sim/vehicle-presentation.ts";
import { drivetrainShifting } from "../shared/sim/vehicle-drivetrain.ts";
import { cancelCreatureAction, creatureHold, stepCreature } from "../shared/sim/creature-actions.ts";
import { ACT_NONE, FISTS, actionOut, biteCost, stepAction } from "../shared/sim/weapon.ts";
import { stepAim } from "../shared/sim/aim.ts";
import { F_AWAKE, F_PLAYER, F_ALIVE, F_PROP, F_GROUNDED } from "../shared/sim/entities.ts";
import { LOOK_BYTES, validLook } from "../shared/anim/look.ts";
import { GONE_TAKEN, RECENT } from "../shared/world/structures.ts";
import { sortU32 } from "../shared/sort.ts";
import { groundStands, groundUnder } from "../shared/world/collide.ts";
import type { ChunkTable } from "../shared/world/structures.ts";
import { staticKinds, type MapStatics } from "../shared/world/mapfile.ts";
import { Allowance, Guesses, countedAs } from "./guesses.ts";
import { freeAt, freePlace, placeFree } from "./place.ts";
import type { ServerWorld } from "./world.ts";
import { NO_BUS, event, type Bus } from "./events/bus.ts";
import type { Place } from "./beds.ts";

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

/** Constant-time, so timing does not leak how much of a password matched. */
function sameText(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i % (b.length || 1));
  return diff === 0;
}

/** Unreliable messages from one client per tick. The rest are dropped. */
const MAX_PACKETS_PER_TICK = 8;
/** Reliable messages from one client per tick. A command past this is answered busy, and anything else is a strike. */
const MAX_RELIABLE_PER_TICK = 32;
/** Malformed messages tolerated before disconnecting. */
const MAX_STRIKES = 8;
/** Connections waiting to say hello, and the ticks each may take while there is room. */
const MAX_PENDING = 64;
const HELLO_TICKS = 150;
/** With no room, one that has waited this long is put out for a newcomer. A client says hello at once, so this is a slow link's round trip. */
const HELLO_GRACE_TICKS = 15;
const COMMAND_QUEUE = 16;
const COMMANDS_PER_TICK = 4;
/** The least snapshot budget a client may ask for, in bytes. The quarter of it that a crowd of players leaves the rest holds any one create. */
const SNAPSHOT_BYTES_MIN = 600;
/** The most bits one row of a chunk message takes: slot 25, in place 1, kind 17, x and z 30, height 41, yaw 17, owner 41, health 33. */
const ROW_BITS = 205;
/**
 * Chunk bytes a client may have on the way, or two ticks of the slot budget if that is more. On one stream everything
 * sent before a snapshot it has read has reached it, so what was sent since its newest acknowledged snapshot is still
 * coming, ahead of the snapshots after it.
 */
const CHUNK_WINDOW = 16 * 1024;
const NAME = /^[A-Za-z0-9 _-]{1,24}$/;
/** Metres. */
const SPECTATOR_LIFT = 1.6;
/** New names one machine may make in NEW_NAME_TICKS, an hour (Allowance). */
const NEW_NAMES = 8;
const NEW_NAME_TICKS = 108000;

/** A device key and machine whose command threw are refused this long, ten minutes. */
const FAULT_REFUSED_TICKS = 10 * 60 * TICK_RATE;
/** Refusals kept. Past this the oldest goes. */
const REFUSALS_KEPT = 4096;

/** What a refusal names of a connection: its device key, and its machine (countedAs). */
const refusedAs = (key: Uint8Array, address: string | undefined): string[] => (address === undefined ? [`key:${key.toHex()}`] : [`key:${key.toHex()}`, `at:${countedAs(address)[0]}`]);

/** Who is refused until a tick (refusedAs). A sidecar of the save, so that a stop does not forgive it. */
export class Refusals {
  dirty = false;
  private readonly until = new Map<string, number>();

  refuse(who: readonly string[], tick: number, until: number): void {
    for (const [k, t] of this.until) if (t <= tick) this.until.delete(k);
    for (const k of who) {
      if (this.until.size >= REFUSALS_KEPT) this.until.delete(this.until.keys().next().value!);
      this.until.delete(k);
      this.until.set(k, until);
    }
    this.dirty = true;
  }

  refused(who: readonly string[], tick: number): boolean {
    return who.some((k) => (this.until.get(k) ?? 0) > tick);
  }

  serialize(): string {
    return JSON.stringify([...this.until]);
  }

  restore(saved: string | null): void {
    for (const [k, t] of JSON.parse(saved ?? "[]") as [string, number][]) this.until.set(k, t);
  }
}

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

/** A connection that has not said hello, the tick it came on, and the machine it came from (countedAs). It holds no slot and none of a session's memory. */
interface Pending {
  readonly conn: Connection;
  readonly since: number;
  readonly from: string;
}

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
  readonly inputs = new InputBuffer(INPUT_WINDOW);
  /** First snapshot actually sent with the current urban seat. -1 from the authoritative board until send. */
  vehicleSeatSnapshot = 0;
  /** The snapshot acknowledged by the first packet accepted for each input. */
  readonly inputAcks = new Uint32Array(INPUT_WINDOW);
  /** The tick on which each buffered input arrived, by its own tick: how far ahead the client really sent it. */
  readonly arrived = new Uint32Array(INPUT_WINDOW);
  heldX = 0;
  heldZ = 0;
  heldYaw = 0;
  heldPitch = 0;
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
  sentProgress = -1;
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
  /** Each sent field is the version of owner-private state this connection last got. -1 means nothing yet. */
  sentVitals = -1;
  sentInv = -1;
  sentMarkers = -1;
  /** What was last sent of the creature it has open, packed into one number, and when. */
  sentSubject = -1;
  sentSubjectAt = 0;
  /**
   * Without a body, why it chooses where to rise (CHOOSE_). The places it was last sent (server/beds.ts), in their order, the
   * list's number, and the version of the beds they were made from (-1 for none sent).
   */
  why = CHOOSE_DIED;
  readonly respawnAt: Place[] = [];
  placesList = 0;
  sentPlaces = -1;
  sentLook: Uint8Array | null = null;
  sentHeld = -2;
  sentBuffs = -1;
  sentRules = -1;
  /** inviteUntil is the tick the invitation it was shown expires, or 0. */
  sentTribe = -1;
  inviteUntil = 0;
  sentVoice: Uint8Array | null = null;
  /** Record id of the container it has open, or 0. */
  open = 0;
  sentOpen = 0;
  sentOpenVersion = -1;

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
    this.newestInput = this.highestAck = this.ackTick = this.lastSnapshot = 0;
    this.views.clear();
    this.known.fill(0);
    this.nodesKnown.fill(0);
    this.sentProgress = -1;
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
    this.sentVitals = this.sentInv = this.sentMarkers = this.sentOpenVersion = -1;
    this.sentPlaces = -1;
    this.sentLook = null;
    this.sentHeld = -2;
    this.sentBuffs = -1;
    this.sentRules = -1;
    this.sentTribe = -1;
    this.inviteUntil = 0;
    this.sentVoice = null;
    this.open = this.sentOpen = 0;
    this.pressed = this.before = 0;
  }
}

const SESSION_LOGIN = event("session.login");
const CONTAINER_OPEN = event("container.open");
const NAME_SET = event("name.set");

export class GameServer {
  readonly world: ServerWorld;
  readonly opts: GameOptions;
  bus: Bus = NO_BUS;
  readonly clients: (Client | null)[];
  /** New survivor names made from each machine in the last hour. */
  private readonly newNames = new Allowance(NEW_NAMES, NEW_NAME_TICKS);
  /** Wrong join passwords, by the address they came from. */
  readonly guesses = new Guesses();
  /** Wrong cheat passwords, counted apart: joining with the right password must not forgive them. */
  readonly cheatGuesses = new Guesses();
  /** `overflows` counts snapshots and chunk messages that outgrew the writer and were not sent, and `faults` commands that threw. */
  readonly stats = { malformed: 0, throttled: 0, lateInputs: 0, heldInputs: 0, commands: 0, chunkBytes: 0, overflows: 0, faults: 0 };
  /** Device keys and machines whose command threw, refused for a while. */
  readonly refusals = new Refusals();
  /**
   * A command's handler threw `err`. Its key and machine are refused (refusals). Returns whether the world goes on, its
   * session then put out; false, or no hook, throws on, so the server stops as at any throw and saves nothing of the tick.
   */
  onFault: ((c: Client, op: number, command: Uint8Array, err: unknown) => boolean) | null = null;
  /** May this device key use this name? Called before anything is created. */
  nameAway: ((name:string)=>boolean)|null=null;
  sameCreation: ((name:string,key:Uint8Array,request:Uint8Array)=>boolean)|null=null;
  owns: ((name: string, key: Uint8Array) => boolean) | null = null;
  authorize: ((name: string, key: Uint8Array) => boolean) | null = null;
  /**
   * A survivor arriving from another server of the cluster with a travel ticket, for this name and device key. Returns "" once
   * it is here, bound to that key, or why it is not. Called after a hello's own checks, with room for the session.
   */
  arrive: ((name: string, key: Uint8Array, ticket: Uint8Array) => string) | null = null;
  /** Why this name cannot join here now because its survivor is on another server, or "". Called before `authorize`. */
  away: ((name: string, key: Uint8Array) => string) | null = null;
  /** A session became active (it has a body or a spectator's focus). */
  onEnter: ((c: Client) => void) | null = null;
  /** Called before the session's body, if any, is removed. */
  onExit: ((c: Client) => void) | null = null;
  /** The connection dropped while the body lingers, or a reconnect took the body over. */
  onPresence: ((c: Client) => void) | null = null;
  /** An entity was created for the session: at login, on respawn, or when it stops spectating. */
  onBody: ((c: Client) => void) | null = null;
  /** The session's entity is about to be destroyed. */
  onBodyGone: ((c: Client) => void) | null = null;
  /** Called once per tick before bodies move, to apply changes queued outside the step. */
  onBeforeStep: (() => void) | null = null;
  /** Called once per tick after bodies move and commands run, before replication. */
  onStep: ((tick: number) => void) | null = null;
  /** Called for each connected session just before its snapshot. */
  onReplicate: ((c: Client) => void) | null = null;
  /** The complete view actually sent, after budget selection and a successful snapshot write. */
  onSnapshot: ((c: Client, view: SentView) => void) | null = null;
  /** Authority-provided contact neighbourhood for driver prediction, independent of the render view. */
  contactProxies: ((c: Client, out: ContactSnapshot) => void) | null = null;
  /** The shared view around a session as that session may be sent it, or the same view. */
  viewFor: ((c: Client, cur: SentView) => SentView) | null = null;
  /** Whether the session may run command `op` now. A refused command answers RESULT_DENIED and its handler is not called. */
  allows: ((c: Client, op: number) => boolean) | null = null;
  /** speed is in metres per second. onMountLand is told of a driven creature `e` landing. */
  onLand: ((c: Client, speed: number) => void) | null = null;
  onMountLand: ((e: number, speed: number) => void) | null = null;
  /** A rising secondary input on the mounted body, after movement and its ordinary bite step. */
  onMountSecondary: ((e: number) => void) | null = null;
  /** A driven flyer `e` took off, set down from flight or began a barrel roll this tick, as stepOut still says. */
  onMountFlight: ((e: number) => void) | null = null;
  /** Vehicle report is still current; authoritative damage consumes it immediately after the body is stored. */
  onVehicleStep: ((e: number) => void) | null = null;
  /** The host adds resource contacts around this same shared vehicle step. */
  vehicleStep: typeof stepVehicleBody = stepVehicleBody;
  /** Without this hook nobody is sent to the creator. */
  needsLook: ((name: string) => boolean) | null = null;
  /** Null for a new survivor. `dead` means it joins with no body and chooses where to respawn. */
  savedPosition: ((name: string) => { x: number; y: number; z: number; yaw: number; dead?: boolean; team?: number } | null) | null = null;

  private readonly handlers: (CommandHandler | null)[] = new Array(256).fill(null);
  /** Connections that have not said hello, oldest first. They hold no slot, so a returning survivor can reclaim its lingering session on a full server. */
  private readonly pending = new Set<Pending>();
  private readonly survivor: number;
  private readonly w: BitWriter;
  /** Sized for the tuning string a welcome carries. */
  private readonly welcomeW: BitWriter;
  private readonly r = new BitReader();
  private readonly contactSnapshot = new ContactSnapshot();
  /** The entities around each chunk that is some client's centre this tick, gathered once and shared by every client centred there. */
  private readonly around: SentView[] = [];
  /** For each of those lists, each entry's place in the order it was chosen in. A client is sent the entries below its cap. */
  private readonly ranks: Uint16Array[] = [];
  private gathered = 0;
  /** `opts.viewCap`, held to what a view can hold. */
  private readonly cap: number;
  /** Per chunk: the tick `around[aroundAt]` was gathered for it. */
  private readonly aroundTick: Uint32Array;
  private readonly aroundAt: Uint16Array;
  /** A slot changed, times 2, plus 1 where it was moved, made or emptied. */
  private readonly changed = new Uint32Array(RECENT);
  /** The map's statics' kinds as content indices. */
  private readonly staticKinds: Uint16Array | null;
  /** Kept through the rows of one chunk message: the last row's slot and height, and the values it has named. */
  private rowSlot = -1;
  private rowY = 0;
  private readonly kinds = new Named();
  private readonly yaws = new Named();
  private readonly owners = new Named();
  private readonly ids = new Uint32Array(MAX_VIEW);
  private readonly movers = new Uint32Array(MAX_VIEW);
  private readonly idle = new Uint32Array(MAX_VIEW);
  private readonly entityOffsets: Int16Array;
  private readonly structOffsets: Int16Array;

  constructor(world: ServerWorld, opts: Partial<GameOptions> = {}) {
    this.world = world;
    this.opts = { ...DEFAULTS, ...opts };
    this.clients = new Array(this.opts.maxClients).fill(null);
    this.cap = Math.max(1, Math.min(MAX_VIEW, Math.floor(this.opts.viewCap)));
    // Removes are sent whatever they cost, 6.7 KB for 2,048 of them, and an update can take two bytes more than it was budgeted at.
    this.w = new BitWriter(Math.max(16384, 8192 + 2 * Math.max(this.opts.snapshotBytes, this.opts.snapshotBytesMax)));
    this.welcomeW = new BitWriter(1024 + world.reg.tuning.length * 4);
    this.aroundTick = new Uint32Array(chunkCount(world.dims));
    this.aroundAt = new Uint16Array(chunkCount(world.dims));
    this.entityOffsets = nearestFirst(this.opts.entityRadius);
    this.structOffsets = nearestFirst(this.opts.structRadius);
    this.survivor = world.reg.index.get("core:survivor")!;
    this.staticKinds = world.statics ? staticKinds(world.statics, world.reg) : null;
  }

  listen(listener: Listener): void {
    listener.onConnection = (conn) => this.accept(conn);
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

    this.onBeforeStep?.();

    for (const c of this.clients) {
      if (!c) continue;
      c.packets = 0;
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
          if (combat && driving) stepCreature(world, b, c.heldX, c.heldZ, c.heldYaw, c.heldPitch, c.heldButtons, c.pressed, world.reg.tamedMove[b.kind]!, combat, TICK_DT, true, c.closed || T - c.inputAt > INPUT_HOLD_TICKS);
          else stepBody(world, b, c.heldX, c.heldZ, c.heldYaw, c.heldPitch, c.heldButtons, world.reg.tamedMove[b.kind]!, TICK_DT);
        } else { b.yaw = c.heldYaw; stepOut.landSpeed = 0; }
        if (!driving) {
          // Enclosed cabins stow weapons while preserving the held inventory slot for exit.
          const stowed = passenger && (ents.seatSlot[e] === IMPALE_SLOT || world.reg.vehicle[ents.kind[parent]!]?.seats[ents.seatSlot[e]! - 1]?.weapons === false);
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
        if (driving && !vehicle && (c.pressed & BTN_SECONDARY) !== 0 && b.act === ACT_NONE) this.onMountSecondary?.(e);
        if (vehicle) this.onVehicleStep?.(e);
        ents.pitch[e] = c.heldPitch;
        ents.pose(e, T);
        if (driving && (stepOut.tookOff || stepOut.setDown || stepOut.rolled)) this.onMountFlight?.(e);
        if (stepOut.landSpeed > 0) {
          if (driving) this.onMountLand?.(e, stepOut.landSpeed);
          else this.onLand?.(c, stepOut.landSpeed);
        }
      } else {
        b.kind = c.kind;
        stepBody(world, b, c.heldX, c.heldZ, c.heldYaw, c.heldPitch, c.heldButtons, world.reg.move[c.kind]!, TICK_DT);
      }
      c.chunk = chunkAt(world.dims, b.x, b.z);
    }

    for (const c of this.clients) if (c?.active && c.queue.length > 0) this.runCommands(c);
    for (const c of this.clients) if (c?.closed && T >= c.lingerUntil) this.finalize(c);
    for (const p of this.pending) if (T - p.since >= HELLO_TICKS) this.turnAway(p, REJECT_MALFORMED);

    this.onStep?.(T);
    // History records the world as this tick's snapshots show it.
    world.history.record(T);

    const snap = T % this.opts.snapshotEvery === 0;
    this.gathered = 0;
    for (const c of this.clients) {
      if (!c?.active || c.closed) continue;
      // Commands and systems may have moved or replaced the body since it stepped.
      const at = c.drive >= 0 ? c.drive : c.ent;
      if (at >= 0) {
        ents.loadBody(at, c.body);
        c.chunk = chunkAt(world.dims, c.body.x, c.body.z);
      }
      if (c.ownDirty) this.sendOwn(c);
      this.onReplicate?.(c);
      if (snap) this.snapshot(c, T);
      this.syncChunks(c, T);
    }
  }

  /** Whether modules let a session open a box, a body or a creature's bag. A session refused is told why. */
  mayOpen(c: Client, pid: number): boolean {
    const refused = this.bus.before(CONTAINER_OPEN, { byPid: c.pid, pid });
    if (refused !== "") this.sendText(c, TEXT_NOTICE, refused);
    return refused === "";
  }

  reject(c: Client, reason: number): void {
    c.left = reason === REJECT_KICKED ? "kicked" : "refused";
    this.close(c.conn, reason);
  }

  /** Tells a connection why, and closes it. REJECT_TRAVEL says why in words. */
  private close(conn: Connection, reason: number, why = ""): void {
    const w = this.w;
    w.reset();
    w.u8(S_REJECT);
    w.u8(reason);
    if (reason === REJECT_TRAVEL) w.string(why.slice(0, 330));
    conn.send(CH_RELIABLE, w.bytes());
    conn.close();
  }

  /**
   * Ends a session whose survivor is leaving for another server: its body goes now, with no lingering, and its connection is
   * handed back open and unheard, for the caller to send the ticket on (`travel`) once the leaving is saved.
   */
  part(c: Client): Connection {
    const conn = c.conn;
    conn.onMessage = null;
    conn.onClose = null;
    c.left = "travelled";
    c.queue.length = 0;
    this.finalize(c);
    return conn;
  }

  /** Sends a parted connection its travel ticket and closes it. */
  travel(conn: Connection, ticket: Uint8Array, world: number): void {
    const w = this.w;
    w.reset();
    w.u8(S_TRAVEL);
    for (let i = 0; i < TICKET_BYTES; i++) w.u8(ticket[i] ?? 0);
    w.u16(world);
    conn.send(CH_RELIABLE, w.bytes());
    conn.close();
  }

  private turnAway(p: Pending, reason: number): void {
    this.pending.delete(p);
    this.close(p.conn, reason);
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

  markAllOwn(): void {
    for (const c of this.clients) if (c?.active) c.ownDirty = true;
  }

  /** A spectator's body is private: stepped by the same function, but never in the entity store. Returns false if there is no room to return. */
  setSpectating(c: Client, on: boolean): boolean {
    if (on === (c.state === SESSION_SPECTATING)) return true;
    if (on) {
      this.dropBody(c);
      this.makeGhost(c);
    } else if (!this.spawnBody(c)) return false;
    c.ownDirty = true;
    return true;
  }

  kill(c: Client): void {
    this.dropBody(c);
    this.makeDead(c);
    c.ownDirty = true;
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

  /** False if the session is not in the creator or there is no room. */
  create(c: Client, look: Uint8Array, spawn?: number): boolean {
    if (c.state !== SESSION_CREATING) return false;
    const place = spawn === undefined ? undefined : this.world.spawns[spawn];
    if (spawn !== undefined && !place) return false;
    c.look = look;
    if (!this.spawnBody(c, place && { ...place, y: this.world.hf.heightAt(place.x, place.z) })) return false;
    c.ownDirty = true;
    return true;
  }

  /** Without `y` the place is on the ground, and a free spot around it will do. With `y` it is a bed, which is stood on or nothing. */
  revive(c: Client, x: number, z: number, yaw: number, y?: number): boolean {
    if (c.state !== SESSION_DEAD || !this.spawnBody(c, { x, y: y ?? this.world.hf.heightAt(x, z), z, yaw }, y !== undefined)) return false;
    c.ownDirty = true;
    return true;
  }

  private makeDead(c: Client): void {
    const b = c.body;
    b.vx = b.vy = b.vz = 0;
    b.grounded = false;
    b.mode = MODE_NONE;
    c.state = SESSION_DEAD;
  }

  private makeGhost(c: Client): void {
    const b = c.body;
    b.y += SPECTATOR_LIFT;
    b.vx = b.vy = b.vz = 0;
    b.grounded = false;
    b.mode = MODE_GHOST;
    c.state = SESSION_SPECTATING;
  }

  /**
   * Spawns at `at`, else where the survivor was last seen, else the spawn point. Where it was last seen, if that is inside
   * something, it is set at the nearest free place it reaches without passing through another team's piece (freePlace), else
   * at the spawn point. Around `at` or the spawn point, if that spot is taken, the first free one on the ground around it, or one
   * beside another body if every one is taken. An `exact` place, a bed, is stood on whoever else is there, as in ARK, and
   * nowhere else. False if there is no room: a body is never put inside anything, loaded or not.
   */
  private spawnBody(c: Client, at?: { x: number; y: number; z: number; yaw: number }, exact = false): boolean {
    const world = this.world;
    const kind = this.survivor;
    const p = world.reg.move[kind]!;
    const saved = at ? null : (this.savedPosition?.(c.name) ?? null);
    const want = at ?? saved;
    const cx = at ? at.x : world.spawn.x;
    const cz = at ? at.z : world.spawn.z;
    let x = cx;
    let z = cz;
    let y = 0;
    let yaw = at ? at.yaw : world.spawn.yaw;
    // A place on the ground is lifted to where the body rests there.
    // A bed is stood on as it is. A spawn point on ground too steep to stand on is taken as taken.
    const wantY = want ? (exact ? want.y : Math.max(want.y, groundUnder(world.hf, want.x, want.z, p.radius))) : 0;
    const slides = want !== null && !exact && wantY === groundUnder(world.hf, want.x, want.z, p.radius) && !groundStands(p.slopeCos);
    if (want && placeFree(world, want.x, wantY, want.z, p.radius, p.height) && (exact || !(at && (slides || this.occupied(want.x, wantY, want.z))))) {
      x = want.x;
      y = wantY;
      z = want.z;
      yaw = want.yaw;
    } else if (saved && freePlace(world, saved.x, wantY, saved.z, p.radius, p.height, saved.team ?? 0, p.stepUp, p.slopeCos)) {
      x = freeAt.x;
      y = freeAt.y;
      z = freeAt.z;
      yaw = saved.yaw;
    } else {
      if (exact) return false;
      // First free spot on rings around the place that is not too steep to stand on, else the first that only another body is
      // in, else the first where it would slide.
      let free = false;
      let beside = false;
      let besideStands = false;
      let bx = 0;
      let bz = 0;
      for (let k = 0; k < 96 && !free; k++) {
        const ring = Math.ceil(k / 8);
        const a = (k * TAU) / 8 + ring * 0.4;
        x = cx + detSin(a) * ring * 1.5;
        z = cz + detCos(a) * ring * 1.5;
        y = groundUnder(world.hf, x, z, p.radius);
        const stands = groundStands(p.slopeCos);
        if (!placeFree(world, x, y, z, p.radius, p.height)) continue;
        free = stands && !this.occupied(x, y, z);
        if (!free && (!beside || (stands && !besideStands))) {
          beside = true;
          besideStands = stands;
          bx = x;
          bz = z;
        }
      }
      if (!free) {
        if (!beside) return false;
        x = bx;
        z = bz;
        y = groundUnder(world.hf, x, z, p.radius);
      }
    }
    const ents = world.ents;
    const e = ents.create(kind, x, y, z, F_PLAYER | F_AWAKE);
    if (e >= 0) world.history.track(e);
    if (e < 0) return false;
    ents.yaw[e] = yaw;
    c.ent = e;
    c.kind = kind;
    c.state = SESSION_ALIVE;
    c.heldYaw = yaw;
    ents.loadBody(e, c.body);
    c.chunk = ents.chunk[e]!;
    this.onBody?.(c);
    return true;
  }

  /** Remove the session's entity, keeping where it was as the session's focus. */
  private dropBody(c: Client): void {
    this.release(c);
    if (c.ent < 0) return;
    const ents = this.world.ents;
    this.onBodyGone?.(c);
    ents.loadBody(c.ent, c.body);
    this.world.history.untrack(c.ent);
    ents.destroy(c.ent);
    c.ent = -1;
  }

  private accept(conn: Connection): void {
    const T = this.world.tick;
    const share = conn.address === undefined ? 0 : this.opts.pendingPerAddress;
    const from = conn.address === undefined ? "" : countedAs(conn.address)[0]!;
    let first: Pending | null = null;
    let own: Pending | null = null;
    let mine = 0;
    for (const p of this.pending) {
      first ??= p;
      if (share === 0 || p.from !== from) continue;
      own ??= p;
      mine++;
    }
    // With no room, among its own address's share or among them all, the one that has waited longest makes way. A client says
    // hello at once, so one that has had the time and said nothing was holding the place, and holding places keeps nobody out.
    // If none has had the time, as when a full server reconnects at once, the newcomer is the one turned away.
    const out = share > 0 && mine >= share ? own : this.pending.size >= Math.max(MAX_PENDING, this.opts.maxClients) ? first : null;
    if (out) {
      if (T - out.since < HELLO_GRACE_TICKS) return this.close(conn, REJECT_FULL);
      this.turnAway(out, REJECT_FULL);
    }
    const p: Pending = { conn, since: T, from };
    this.pending.add(p);
    conn.onMessage = (channel, data) => this.greet(p, channel, data);
    conn.onClose = () => void this.pending.delete(p);
  }

  /** The first message of a connection must be its hello. Anything else ends it. */
  private greet(p: Pending, channel: number, data: Uint8Array): void {
    if (!this.pending.delete(p)) return;
    const r = this.r;
    r.reset(data);
    if (channel === CH_RELIABLE && data.length <= MAX_CLIENT_MESSAGE && r.bits(4) === C_HELLO && this.hello(p.conn, r)) return;
    this.stats.malformed++;
    this.close(p.conn, REJECT_MALFORMED);
  }

  private bind(c: Client, conn: Connection): void {
    conn.onMessage = (channel, data) => this.receive(c, channel, data);
    conn.onClose = () => this.remove(c, conn);
  }

  /** The connection closed. A living body lingers, anything else leaves now. */
  private remove(c: Client, conn: Connection): void {
    if (this.clients[c.id] !== c || c.conn !== conn || c.closed) return;
    if (c.active && c.ent >= 0 && this.opts.lingerTicks > 0) {
      this.release(c);
      c.closed = true;
      c.lingerUntil = this.world.tick + this.opts.lingerTicks;
      c.queue.length = 0;
      this.onPresence?.(c);
      return;
    }
    this.finalize(c);
  }

  private finalize(c: Client): void {
    if (this.clients[c.id] !== c) return;
    if (c.active) {
      this.onExit?.(c);
      this.dropBody(c);
    }
    c.active = false;
    c.closed = false;
    this.clients[c.id] = null;
  }

  private receive(c: Client, channel: number, data: Uint8Array): void {
    if (c.closed) return;
    let over = false;
    if (channel !== CH_RELIABLE) {
      if (++c.packets > MAX_PACKETS_PER_TICK) {
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
      if (++c.strikes > MAX_STRIKES) this.reject(c, REJECT_MALFORMED);
    }
  }

  private input(c: Client, r: BitReader): boolean {
    const ack = r.u32();
    const behind = r.u8() / VIEW_STEPS;
    const validAck = ack >= c.highestAck && ack <= c.lastSnapshot && c.views.find(ack) ? ack : 0;
    const newest = readInputs(r, c.inputs, this.world.tick, validAck, behind, c.inputAcks);
    if (newest === 0) return false;
    if (newest <= this.world.tick) this.stats.lateInputs++;
    // Track the newest tick even when it is too far ahead to buffer, because the margin sent back tells a
    // client its clock has run away. It moves backward only by a whole window, which is a restarted clock.
    const fresh = newest > c.newestInput || newest < c.newestInput - INPUT_WINDOW;
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
        code = op === CMD_VIEW ? this.askView(c, r) : op === CMD_STATICS ? this.takeStatics(c) : !handler ? RESULT_INVALID : this.allows && !this.allows(c, op) ? RESULT_DENIED : handler(c, r);
      } catch (err) {
        this.stats.faults++;
        this.refusals.refuse(refusedAs(c.key, c.conn.address), this.world.tick, this.world.tick + FAULT_REFUSED_TICKS);
        if (!this.onFault?.(c, op, data, err)) throw err;
        this.sendText(c, TEXT_NOTICE, `the server could not carry out a command of yours, so it has put you out; you may come back in ${FAULT_REFUSED_TICKS / TICK_RATE / 60} minutes`);
        this.reject(c, REJECT_DENIED);
        return;
      }
      this.stats.commands++;
      // The handler may have ended the session (a kick, too many password attempts).
      if (this.clients[c.id] !== c || c.closed || !c.conn.open) return;
      this.result(c, seq, code);
    }
  }

  /** CMD_STATICS. Every chunk message sent after the answer takes from the map what is as the map has it. */
  private takeStatics(c: Client): number {
    if (!this.world.statics) return RESULT_INVALID;
    c.statics = true;
    return RESULT_OK;
  }

  /** CMD_VIEW. The snapshot takes up what was asked. */
  private askView(c: Client, r: BitReader): number {
    const view = r.u16();
    const bytes = r.u16();
    if (r.overflow) return RESULT_INVALID;
    c.wantView = Math.max(1, Math.min(view, this.cap));
    c.wantBytes = Math.max(SNAPSHOT_BYTES_MIN, Math.min(bytes, this.opts.snapshotBytesMax));
    return RESULT_OK;
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

  /** False if the hello is malformed. One that is refused is told why. Only one that is accepted is given a session. */
  private hello(conn: Connection, r: BitReader): boolean {
    const version = r.u16();
    // Another version lays the rest out differently, so nothing more is read.
    if (!r.overflow && version !== PROTOCOL_VERSION) return this.refuse(conn, REJECT_VERSION);
    const contentHash = r.u32();
    const clipHash = r.u32();
    const name = r.string(MAX_NAME_BYTES);
    const flags = r.u8();
    const key = new Uint8Array(KEY_BYTES);
    for (let i = 0; i < KEY_BYTES; i++) key[i] = r.u8();
    let look: Uint8Array | null = null;
    if ((flags & HELLO_LOOK) !== 0) {
      look = new Uint8Array(LOOK_BYTES);
      for (let i = 0; i < LOOK_BYTES; i++) look[i] = r.u8();
    }
    let ticket: Uint8Array | null = null;
    if ((flags & HELLO_TICKET) !== 0) {
      ticket = new Uint8Array(TICKET_BYTES);
      for (let i = 0; i < TICKET_BYTES; i++) ticket[i] = r.u8();
    }
    const password = r.string(MAX_PASSWORD_BYTES);
    const request=(flags & HELLO_NEW) && r.remainingBits>=KEY_BYTES*8 ? Uint8Array.from({length:KEY_BYTES},()=>r.u8()):null;
    if (r.overflow) return false;
    if (look && !validLook(look)) return this.refuse(conn, REJECT_MALFORMED);
    const world = this.world;
    // The client hashes content as written. The welcome tells it this server's tuning, and it derives the rest.
    if (contentHash !== world.reg.baseHash || clipHash !== world.anim.set.hash) return this.refuse(conn, REJECT_CONTENT);
    // A reconnect to a lingering body is asked too.
    if (this.opts.password !== "") {
      const who = conn.address ?? name;
      if (this.guesses.wait(who, world.tick) > 0) return this.refuse(conn, REJECT_PASSWORD);
      if (!sameText(password, this.opts.password)) {
        this.guesses.wrong(who, world.tick);
        return this.refuse(conn, REJECT_PASSWORD);
      }
      this.guesses.right(who);
    }
    if (!NAME.test(name)) return this.refuse(conn, REJECT_NAME);
    if (this.refusals.refused(refusedAs(key, conn.address), world.tick)) return this.refuse(conn, REJECT_DENIED);
    // A module may turn a login away, or a name nobody has had before. A survivor's name is who it is, so it is not reworded.
    const isNew = this.savedPosition?.(name) == null;
    if(flags & HELLO_NEW){
      if(ticket || this.nameAway?.(name))return this.refuse(conn,REJECT_NAME);
      const active=this.clients.find(c=>c?.active && c.name===name);
      const retry=request && (this.sameCreation?.(name,key,request) || (active?.createRequest && key.every((b,i)=>active.key[i]===b) && request.every((b,i)=>active.createRequest![i]===b)));
      if(name.trim()!==name || (!isNew || active) && !retry)return this.refuse(conn,REJECT_NAME);
    }
    if (isNew && this.bus.before(NAME_SET, { what: "survivor", text: name }) !== "") return this.refuse(conn, REJECT_NAME);
    if (this.bus.before(SESSION_LOGIN, { name, address: conn.address ?? "", isNew }) !== "") return this.refuse(conn, REJECT_DENIED);
    // A survivor arriving takes nothing until there is room for its session, so a full server leaves its ticket unused.
    if (ticket) {
      if (!this.clients.includes(null)) return this.refuse(conn, REJECT_FULL);
      const why = this.arrive ? this.arrive(name, key, ticket) : "this server is not in a cluster";
      if (why !== "") return this.refuse(conn, REJECT_TRAVEL, why);
    } else {
      const why = this.away?.(name, key) ?? "";
      if (why !== "") return this.refuse(conn, REJECT_TRAVEL, why);
    }
    if ((flags & HELLO_RESUME) && this.savedPosition?.(name) == null) return this.refuse(conn, REJECT_NAME);
    if (this.authorize && !this.authorize(name, key)) return this.refuse(conn, REJECT_DENIED);
    // One body per survivor. A second login with the session's own key is its device back, and takes over the body. Nothing
    // may have closed the connection that device lost, so one still open is dropped here as if it had closed.
    for (const other of this.clients) {
      if (!other?.active || other.name !== name) continue;
      if (!other.closed) {
        if (!key.every((b, i) => b === other.key[i]) && !this.owns?.(name,key)) return this.refuse(conn, REJECT_NAME);
        const old = other.conn;
        old.onMessage = null;
        this.close(old, REJECT_NAME);
        this.remove(other, old);
        // It had no body to linger in, so the session ended and this is a login like any other.
        if (!other.active) break;
      }
      other.key = key;
      other.relink(conn);
      other.statics = (flags & HELLO_STATICS) !== 0 && world.statics !== null;
      this.bind(other, conn);
      this.welcome(other);
      this.onPresence?.(other);
      return true;
    }

    // A dead survivor joins dead, whatever it asks. As a spectator it could ask for its body back and get one that cannot die.
    const spectate = (flags & HELLO_SPECTATE) !== 0 && !this.savedPosition?.(name)?.dead;
    if (spectate && this.opts.spectators !== "anyone") return this.refuse(conn, REJECT_DENIED);
    // Every new name leaves a survivor record for good, so one machine may make only so many an hour.
    if (conn.address !== undefined && this.savedPosition && this.savedPosition(name) === null && !this.newNames.take(conn.address, world.tick)) return this.refuse(conn, REJECT_DENIED);
    const slot = this.clients.indexOf(null);
    if (slot < 0) return this.refuse(conn, REJECT_FULL);
    // Nothing was kept for the connection until here. A session's memory is given only to a hello that is let in.
    const c = new Client(slot, conn, chunkCount(world.dims));
    this.clients[slot] = c;
    this.bind(c, conn);
    c.name = name;
    c.createRequest=request;
    c.key = key;
    c.look = look;
    c.statics = (flags & HELLO_STATICS) !== 0 && world.statics !== null;
    c.kind = this.survivor;
    if (spectate) {
      const b = c.body;
      b.x = world.spawn.x;
      b.z = world.spawn.z;
      b.y = world.hf.heightAt(b.x, b.z);
      this.makeGhost(c);
      c.chunk = chunkAt(world.dims, b.x, b.z);
    } else {
      const saved = this.savedPosition?.(name);
      if (saved?.dead) {
        // It died before it left, so it joins with no body and chooses where to respawn.
        c.body.x = saved.x;
        c.body.y = saved.y;
        c.body.z = saved.z;
        this.makeDead(c);
        c.chunk = chunkAt(world.dims, saved.x, saved.z);
      } else if (!look && this.needsLook?.(name)) {
        // A new survivor without a look waits in the creator, bodiless.
        const b = c.body;
        b.x = world.spawn.x;
        b.z = world.spawn.z;
        b.y = world.hf.heightAt(b.x, b.z);
        this.makeDead(c);
        c.state = SESSION_CREATING;
        c.chunk = chunkAt(world.dims, b.x, b.z);
      } else if (!this.spawnBody(c)) {
        this.clients[slot] = null;
        return this.refuse(conn, REJECT_FULL);
      }
    }
    c.active = true;
    c.activeAt = this.world.tick;
    this.onEnter?.(c);
    this.welcome(c);
    return true;
  }

  private welcome(c: Client): void {
    const world = this.world;
    const ents = world.ents;
    const w = this.welcomeW;
    w.reset();
    w.u8(S_WELCOME);
    w.u16(PROTOCOL_VERSION);
    w.u32(world.tick);
    w.u32(c.ent >= 0 ? ents.handleOf(c.ent) : 0);
    w.u16(c.kind);
    w.bits(c.state, 2);
    w.bool(c.admin);
    w.u32(world.dayOffset);
    w.string(world.mapId);
    w.u32(world.mapHash);
    w.u8(world.dims.chunksX - 1);
    w.u8(world.dims.chunksZ - 1);
    if (c.ent >= 0) ents.loadBody(c.ent, c.body);
    writeBody(w, c.body);
    w.u16(c.heldYaw);
    // The tuned content's hash, and the tuning that derives it from content as written.
    w.u32(world.reg.hash);
    w.string(world.reg.tuning);
    w.f64(world.clock.cycle);
    w.f64(world.clock.day);
    w.f64(world.clock.night);
    w.u16(Math.min(65535, Math.max(0, Math.round(this.opts.motdSeconds))));
    w.bool(c.statics);
    c.conn.send(CH_RELIABLE, w.bytes());
  }

  private sendOwn(c: Client): void {
    const w = this.w;
    w.reset();
    w.u8(S_OWN);
    w.u8(OWN_SESSION);
    w.bits(c.state, 2);
    w.bool(c.admin);
    w.u32(c.ent >= 0 ? this.world.ents.handleOf(c.ent) : 0);
    w.u32(this.world.dayOffset);
    c.conn.send(CH_RELIABLE, w.bytes());
    c.ownDirty = false;
  }

  private refuse(conn: Connection, reason: number, why = ""): boolean {
    this.close(conn, reason, why);
    return true;
  }

  /** Whether a survivor's body is within a metre of the spot, on its level and not a floor above or below. */
  private occupied(x: number, y: number, z: number): boolean {
    const ents = this.world.ents;
    const tall = this.world.reg.move[this.survivor]!.height;
    for (const c of this.clients) {
      if (!c?.active || c.ent < 0) continue;
      const dx = ents.x[c.ent]! - x;
      const dy = ents.y[c.ent]! - y;
      const dz = ents.z[c.ent]! - z;
      if (dx * dx + dz * dz < 1 && dy < tall && dy > -tall) return true;
    }
    return false;
  }

  /**
   * Where in `around` and `ranks` the entities are that a client centred on `chunk` may see at tick `T`, sorted by index. Every
   * client centred there shares the list, so it includes each one's own body, and the delta writer leaves that out. Players and
   * what they ride are chosen first, then anything moving or acting, then idle entities and props, so with more entities than the server's cap or
   * a client's own, a crowd of idle creatures never hides a player.
   */
  private viewAround(chunk: number, T: number): number {
    if (this.aroundTick[chunk] === T) return this.aroundAt[chunk]!;
    const world = this.world;
    const ents = world.ents;
    const dims = world.dims;
    const ccx = chunkCx(dims, chunk);
    const ccz = chunkCz(dims, chunk);
    const ids = this.ids;
    const movers = this.movers;
    const idle = this.idle;
    const offsets = this.entityOffsets;
    const cap = this.cap;
    let n = 0;
    let nm = 0;
    let ni = 0;
    for (let o = 0; o < offsets.length; o += 2) {
      const cx = ccx + offsets[o]!;
      const cz = ccz + offsets[o + 1]!;
      if (cx < 0 || cz < 0 || cx >= dims.chunksX || cz >= dims.chunksZ) continue;
      for (let i = ents.chunkHead[cz * dims.chunksX + cx]!; i >= 0; i = ents.next[i]!) {
        const f = ents.flags[i]!;
        if ((f & F_PLAYER) !== 0 || ents.driven[i] !== 0) {
          if (n < cap) ids[n++] = i;
        } else if ((f & F_PROP) === 0 && (ents.vx[i] !== 0 || ents.vz[i] !== 0 || ents.vy[i] !== 0 || ents.act[i] !== 0)) {
          if (nm < cap) movers[nm++] = i;
        } else if (ni < cap) idle[ni++] = i;
      }
    }
    for (let k = 0; k < nm && n < cap; k++) ids[n++] = movers[k]!;
    for (let k = 0; k < ni && n < cap; k++) ids[n++] = idle[k]!;
    // Each is sorted with the rank it was chosen at. An index is under 2^20 (shared/ids.ts), so the two fit one number.
    for (let k = 0; k < n; k++) ids[k] = ids[k]! * MAX_VIEW + k;
    sortU32(ids, n);
    const at = this.gathered++;
    const cur = (this.around[at] ??= new SentView());
    const rank = (this.ranks[at] ??= new Uint16Array(MAX_VIEW));
    cur.count = 0;
    for (let k = 0; k < n; k++) {
      const i = Math.floor(ids[k]! / MAX_VIEW);
      rank[k] = ids[k]! % MAX_VIEW;
      const vehicle = this.world.reg.vehicle[ents.kind[i]!], rotor = vehicle?.movement === "rotor", v = ents.vrow[i]!;
      cur.push(i, ents.gen[i]!, ents.kind[i]!, quantX(ents.x[i]!), quantY(ents.y[i]!), quantX(ents.z[i]!), ents.yaw[i]! >>> 6,
        (ents.flags[i]! >>> 1) & 0xf, ents.anim[i]!, ents.rev[i]!, ents.cue[i]!,
        vehicle ? packVehiclePose(ents.vehiclePitch[v]!, ents.vehicleRoll[v]!, ents.steering[v]!) : 0,
        vehicle ? quantVehicleWheel(ents.wheelAngle[v]!) : 0,
        vehicle ? packVehicleRide(ents.vehicleGroundPitch[v]!, ents.vehicleGroundRoll[v]!, ents.vehicleRideOffset[v]!, (ents.flags[i]! & F_GROUNDED) !== 0) : 0,
        ents.vehicleDoors[v]!, vehicle && !rotor ? packVehicleDrive(ents.vehicleGear[v]!, ents.vehicleRpm[v]!, vehicle.movement === "boat" ? ents.vehicleShiftTime[v]! > 0 : drivetrainShifting(ents.vehicleShiftTime[v]!, vehicle.spec.drivetrain)) : 0,
        rotor ? packVehicleRotor(ents.vehicleRotorRpm[v]!, ents.vehicleRotorPhase[v]!) : 0,
        vehicle ? packVehicleSystems(ents.fuel[v]!, vehicle.spec.fuelCapacity, ents.vehicleEngineCondition[v]!, ents.vehicleRotorCondition[v]!, ents.vehicleEngineOn[v] !== 0) : 0,
        vehicle ? packVehicleQuaternionPair(ents.vehicleQx[v]!, ents.vehicleQy[v]!) : 0,
        vehicle ? packVehicleQuaternionPair(ents.vehicleQz[v]!, ents.vehicleQw[v]!) : 0,
        vehicle ? packBoatWater(ents.vehicleHullCondition[v]!, ents.vehicleFlooding[v]!) : 0);
      cur.urgent[k] = (ents.flags[i]! & F_PLAYER) !== 0 || ents.driven[i] !== 0 ? 1 : 0;
    }
    this.aroundTick[chunk] = T;
    this.aroundAt[chunk] = at;
    return at;
  }

  private snapshot(c: Client, T: number): void {
    const ents = this.world.ents;
    // The client predicts its own body, so the view leaves it out. While it drives a mount, both bodies are in the view.
    const self = c.drive >= 0 ? -1 : c.ent;
    const at = this.viewAround(c.chunk, T);
    const cur = this.viewFor ? this.viewFor(c, this.around[at]!) : this.around[at]!;
    // What it asked for takes effect once a second at most, so that it cannot have its view sent over and over.
    if ((c.wantView !== c.viewCap || c.wantBytes !== c.snapshotBytes) && T >= c.viewReadyAt) {
      c.viewCap = c.wantView;
      c.snapshotBytes = c.wantBytes;
      c.viewReadyAt = T + TICK_RATE;
    }
    const limit = c.viewCap !== 0 ? c.viewCap : Math.min(VIEW_DEFAULT, this.cap);

    const age = T - c.ackTick;
    const base = c.ackTick > 0 && age < VIEW_RING ? c.views.find(c.ackTick) : null;
    const next = c.views.alloc(T);

    const w = this.w;
    w.reset();
    w.u8(S_SNAPSHOT);
    w.u32(T);
    w.u8(base ? age : 0);
    // Before the first input there is no margin. Sending 0 - T would tell a client joining a
    // long-running world that it is hopelessly late.
    let margin = c.newestInput - T;
    if (c.newestInput === 0) margin = MARGIN_UNKNOWN;
    else if (margin < -127) margin = -127;
    else if (margin > 127) margin = 127;
    w.sbits(margin, 8);
    w.bits(c.state, 2);
    // 0 for its own body, else the index of the entity it drives plus one.
    w.varint(c.drive + 1);
    writeBody(w, c.body);
    const bytes = c.snapshotBytes !== 0 ? c.snapshotBytes : this.opts.snapshotBytes;
    const contacts = this.contactSnapshot;
    contacts.tick = T;
    contacts.owner = contacts.epoch = contacts.count = 0;
    contacts.truncated = false;
    if (c.drive >= 0 && this.world.reg.vehicle[c.body.kind]) this.contactProxies?.(c, contacts);
    // Leave at least two thirds of the remaining packet for the ordinary view, and never exceed the selected snapshot budget.
    writeContacts(w, contacts, Math.min(320 * 8, Math.floor((bytes * 8 - w.pos) / 3)));
    c.rotate = writeViewDelta(w, base, cur, next, bytes * 8 - w.pos, c.rotate, ents, self, limit < cur.count ? this.ranks[at]! : null, limit, c.views);
    if (w.overflow) {
      // Part of a snapshot is of no use. Nothing is sent, and the view the client would have held is forgotten.
      this.stats.overflows++;
      next.tick = 0;
      return;
    }
    next.recordSeat(this.world, c.ent, c.drive >= 0);
    c.lastSnapshot = T;
    if (c.vehicleSeatSnapshot === -1) c.vehicleSeatSnapshot = T;
    c.conn.send(CH_UNRELIABLE, w.bytes());
    this.onSnapshot?.(c, next);
  }

  /** What is left of a client's chunk window (D230) on tick T. */
  private windowLeft(c: Client, T: number): number {
    const slot = T & 31;
    if (c.chunkSentAt[slot] !== T) {
      c.chunkSent[slot] = 0;
      c.chunkSentAt[slot] = T;
    }
    let owed = 0;
    for (let i = 0; i < 32; i++) if (c.chunkSentAt[i]! >= c.ackTick && c.chunkSentAt[i]! + 32 > T) owed += c.chunkSent[i]!;
    return Math.max(CHUNK_WINDOW, (this.opts.chunkSlotsPerTick * ROW_BITS) / 4) - owed;
  }

  /**
   * Counts `bytes` of another reliable feed in the client's chunk window, if the chunk rows of the tick before left room for
   * them, and says whether they did. Such a feed sends only what fits, so it never holds rows back.
   */
  spendChunkWindow(c: Client, bytes: number): boolean {
    const T = this.world.tick;
    if (c.rowsWaiting || bytes > this.windowLeft(c, T)) return false;
    c.chunkSent[T & 31] = c.chunkSent[T & 31]! + bytes;
    return true;
  }

  /** Nearest chunk first, within the per-tick slot budget. */
  private syncChunks(c: Client, T: number): void {
    const world = this.world;
    const dims = world.dims;
    const ccx = chunkCx(dims, c.chunk);
    const ccz = chunkCz(dims, c.chunk);
    const offsets = this.structOffsets;
    let budget = Math.min(this.opts.chunkSlotsPerTick, Math.floor(this.windowLeft(c, T) / (ROW_BITS / 8)));
    for (let o = 0; o < offsets.length && budget > 0; o += 2) {
      const cx = ccx + offsets[o]!;
      const cz = ccz + offsets[o + 1]!;
      if (cx < 0 || cz < 0 || cx >= dims.chunksX || cz >= dims.chunksZ) continue;
      const chunk = cz * dims.chunksX + cx;
      const t = world.structs.chunks[chunk];
      if (t && t.version > c.known[chunk]!) budget = this.sendChunk(c, chunk, t, budget);
    }
    c.rowsWaiting = budget <= 0;

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
        w.u8(S_CHUNK_DROP);
        w.u16(chunk);
        c.conn.send(CH_RELIABLE, w.bytes());
      }
    }
  }

  /**
   * Collects into `changed` the slots of `t` changed since version `from`, from its log, in ascending order, each times 2
   * plus 1 where one of those changes moved, made or emptied it. Returns how many, or -1 if the log does not reach back
   * that far or holds more than `most`.
   */
  private changedSince(t: ChunkTable, from: number, byRemoval: boolean, most: number): number {
    const slots = t.recentSlot;
    const vers = t.recentVer;
    const shaped = t.recentShaped;
    if (!slots || !vers || !shaped || from < t.recentFloor) return -1;
    const changed = this.changed;
    let n = 0;
    for (let k = 1, held = Math.min(t.recentCount, RECENT); k <= held; k++) {
      const at = (t.recentCount - k) % RECENT;
      if (vers[at]! <= from) break;
      const slot = slots[at]!;
      if (byRemoval && t.kind[slot] === 0) continue;
      changed[n++] = slot * 2 + shaped[at]!;
    }
    changed.subarray(0, n).sort();
    // A slot changed twice is sent once, and in place only if neither change moved it.
    let m = 0;
    for (let i = 0; i < n; i++) {
      if (m > 0 && changed[m - 1]! >> 1 === changed[i]! >> 1) changed[m - 1] = changed[m - 1]! | changed[i]!;
      else if (m === most) return -1;
      else changed[m++] = changed[i]!;
    }
    return m;
  }

  /** Whether slot `s` of `t` holds the map's static `m` as placeStatics set it down. */
  private asMap(t: ChunkTable, s: number, statics: MapStatics, m: number): boolean {
    const kind = this.staticKinds![statics.kind[m]!]!;
    return s < t.high && t.kind[s] === kind && t.x[s] === statics.x[m] && t.y[s] === statics.y[m] && t.z[s] === statics.z[m] && t.yaw[s] === statics.yaw[m] && t.owner[s] === 0 && t.hp[s] === this.world.reg.maxHp[kind];
  }

  /** A row of a chunk message (CHUNK in shared/net/protocol.ts). In place, only its owner and health. */
  private row(w: BitWriter, t: ChunkTable, s: number, x0: number, z0: number, inPlace: boolean): void {
    const gap = s - this.rowSlot - 1;
    this.rowSlot = s;
    w.bool(gap === 0);
    if (gap !== 0) w.varint(gap - 1);
    w.bool(inPlace);
    const kind = s < t.high ? t.kind[s]! : 0;
    if (!inPlace) {
      this.kinds.write(w, kind, 16);
      if (kind === 0) return;
      w.bits(Math.round((t.x[s]! - x0) * STRUCT_UNITS), 15);
      w.bits(Math.round((t.z[s]! - z0) * STRUCT_UNITS), 15);
      const y = Math.round(t.y[s]! * STRUCT_UNITS);
      w.bool(y === this.rowY);
      if (y !== this.rowY) w.svarint(y - this.rowY);
      this.rowY = y;
      this.yaws.write(w, t.yaw[s]!, 16);
    }
    this.owners.write(w, t.owner[s]!, 0);
    const full = t.hp[s] === this.world.reg.maxHp[kind];
    w.bool(full);
    if (!full) w.f32(t.hp[s]!);
  }

  /** Returns the budget left, or 0 if the chunk is unfinished. */
  private sendChunk(c: Client, chunk: number, t: ChunkTable, budget: number): number {
    // One unfinished chunk keeps its place across ticks. A chunk that finishes within the tick leaves that
    // place alone. Otherwise a near chunk that changes every tick restarts a large one forever.
    const resumed = c.syncChunk === chunk;
    const from = resumed ? c.syncFrom : c.known[chunk]!;
    const target = resumed ? c.syncTarget : t.version;
    let cursor = resumed ? c.syncCursor : 0;
    // A chunk that remembers every removal since this client's version sends those whole.
    let byRemoval = resumed ? c.syncByRemoval : from > 0;
    if (byRemoval && from < t.goneFloor) {
      // A removal has been forgotten. Start again, row by row.
      byRemoval = false;
      cursor = 0;
    }
    const dims = this.world.dims;
    const x0 = chunkCx(dims, chunk) * CHUNK_SIZE;
    const z0 = chunkCz(dims, chunk) * CHUNK_SIZE;
    const w = this.w;
    w.reset();
    w.u8(S_CHUNK);
    w.u16(chunk);
    w.u32(target);
    const header = w.pos;
    w.bits(0, 1 + 16);
    // A client with the map's statics that holds none of this chunk takes the slots still as the map has them from its own copy.
    const statics = c.statics ? this.world.statics : null;
    const first = statics ? statics.first[chunk]! : 0;
    const mapped = statics ? statics.first[chunk + 1]! - first : 0;
    const filling = mapped > 0 && from === 0;
    if (mapped > 0) w.bool(filling);
    const fill = w.pos;
    if (filling) w.bits(0, 32);
    this.rowSlot = -1;
    this.rowY = 0;
    this.kinds.reset();
    this.yaws.reset();
    this.owners.reset();
    // Only rows count against the budget. Slots taken from the map cost no bytes, and their setting down is the client's.
    let count = 0;
    let rows = 0;
    let s = cursor;
    let final = true;
    // A client a few changes behind is sent those from the chunk's log. Otherwise every slot is looked at.
    const logged = cursor === 0 && !filling ? this.changedSince(t, from, byRemoval, budget) : -1;
    if (logged >= 0) {
      for (; rows < logged; rows++) this.row(w, t, this.changed[rows]! >> 1, x0, z0, (this.changed[rows]! & 1) === 0);
      count = rows;
    } else {
      // Rows stop where another might not fit, with a byte left for the count of removals.
      const room = w.buf.length * 8 - ROW_BITS - 8;
      const end = filling ? Math.max(t.high, mapped) : t.high;
      // A chunk still as the map placed it is all the map's slots and nothing else.
      if (filling && t.high === mapped && this.world.structs.asPlaced(chunk)) s = end;
      for (; s < end && count < budget && w.pos <= room; s++) {
        if (filling && s < mapped) {
          if (this.asMap(t, s, statics!, first + s)) continue;
        } else if (t.mod[s]! <= from || (byRemoval && t.kind[s] === 0)) continue;
        count++;
        this.row(w, t, s, x0, z0, false);
        rows++;
      }
      final = s >= end;
      if (filling && cursor < mapped) {
        const pos = w.pos;
        w.pos = fill;
        w.u16(cursor);
        w.u16(Math.min(s, mapped) - cursor);
        w.pos = pos;
      }
    }
    // Removals go with the last rows, each as runs of slots.
    let removals = 0;
    const at = w.pos;
    w.u8(0);
    if (final && byRemoval) {
      const T = this.world.tick;
      for (const g of t.gone) {
        if (g.version <= from || g.version > target) continue;
        // The cause is news only briefly. After that the rows are just gone.
        const cause = T - g.stamp <= REMOVAL_NEWS_TICKS ? g.cause : GONE_TAKEN;
        w.varint(target - g.version);
        w.bits(cause, 2);
        if (cause !== GONE_TAKEN) {
          w.f32(g.x);
          w.f32(g.y);
          w.f32(g.z);
          w.u32(g.stamp);
        }
        // Each run is coded from where the one before ended.
        w.varint(g.runs.length / 2);
        let last = 0;
        for (let k = 0; k < g.runs.length; k += 2) {
          w.svarint(g.runs[k]! - last);
          w.varint(g.runs[k + 1]! - 1);
          last = g.runs[k]! + g.runs[k + 1]!;
        }
        removals++;
        count += g.runs.length / 2;
      }
    }
    if (w.overflow) {
      // The removals do not fit one message, and part of them is of no use. Nothing is sent, and from the next
      // tick the chunk goes row by row, where a row that is gone says only that.
      this.stats.overflows++;
      c.syncChunk = chunk;
      c.syncCursor = 0;
      c.syncFrom = from;
      c.syncTarget = target;
      c.syncByRemoval = false;
      return 0;
    }
    const end = w.pos;
    w.pos = at;
    w.u8(removals);
    w.pos = header;
    // The header bits were written as zeros, so OR-ing the real values in is safe.
    w.bits(final ? 1 : 0, 1);
    w.bits(rows, 16);
    w.pos = end;
    const bytes = w.bytes();
    this.stats.chunkBytes += bytes.length;
    const k = this.world.tick & 31;
    c.chunkSent[k] = c.chunkSent[k]! + bytes.length;
    c.conn.send(CH_RELIABLE, bytes);
    if (final) {
      if (c.known[chunk] === 0 && !c.subscribed.includes(chunk)) c.subscribed.push(chunk);
      c.known[chunk] = target;
      if (resumed) c.syncChunk = -1;
      return budget - count;
    }
    c.syncChunk = chunk;
    c.syncCursor = s;
    c.syncFrom = from;
    c.syncTarget = target;
    c.syncByRemoval = byRemoval;
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
