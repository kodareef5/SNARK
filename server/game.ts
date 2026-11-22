// The authoritative game loop. It owns no socket or clock. The transport and the calls to
// tick() come from outside, so tests run a whole server in memory.
//
// The game is three parts, each in a file of its own: who is in the world (server/sessions.ts), what each session's
// input does each tick (server/players.ts), and what each session is sent (server/replication.ts). Here are the tick
// that calls them, what a session remembers (Client), and the messages any system may send a session.

import { BitReader, BitWriter } from "../shared/net/codec.ts";
import {
  INPUT_WINDOW,
  InputBuffer,
  KEY_BYTES,
  OWN_STATION,
  OWN_SUBJECT,
  TEXT_NOTICE,
  SESSION_ALIVE,
  CHOOSE_DIED,
  S_OWN,
  S_RESULT,
  S_TEXT,
  S_TUNING,
} from "../shared/net/protocol.ts";
import { CH_RELIABLE, type Connection } from "../shared/net/transport.ts";
import { PassengerView } from "./passenger-view.ts";
import { OwnState } from "./ownstate.ts";
import { Replication } from "./replication.ts";
import { type CommandHandler, Players } from "./players.ts";
import { Sessions } from "./sessions.ts";
import { SentView, ViewRing } from "../shared/net/view.ts";
import { Body } from "../shared/sim/character.ts";
import type { ServerWorld } from "./world.ts";
import { NO_BUS, event, type Bus } from "./events/bus.ts";
import type { Place } from "./beds.ts";
import { PART, TickParts } from "./admin/parts.ts";
import { Lane } from "./lane.ts";

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
  /** What Replication.given was at its welcome: a snapshot tells it the ticks given up since. */
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
  /** What only a survivor's own session is sent of it. A system registers the kinds it owns here (server/ownstate.ts). */
  readonly own = new OwnState(this);
  /** Who is in the world and on which connection: the hello, bodies, spectators, lingering (server/sessions.ts). */
  readonly sessions: Sessions;
  /** What each session sends and what the tick does with it: inputs, its body's step, commands (server/players.ts). */
  readonly players: Players;
  /** What each session is sent each tick: its view, its snapshot, its chunk rows (server/replication.ts). */
  readonly replication: Replication;
  /** Called once per tick before bodies move, to apply changes queued outside the step. */
  onBeforeStep: (() => void) | null = null;
  /** Called once per tick after bodies move and commands run, before replication. */
  onStep: ((tick: number) => void) | null = null;
  /** Where each tick's time went, part by part (server/admin/parts.ts). The host marks the parts of its step in it. */
  readonly parts = new TickParts();
  /** Physics' time in each tick, kept for it before the work that can wait (server/lane.ts). */
  readonly lane = new Lane();

  private readonly w: BitWriter;
  private readonly r = new BitReader();

  constructor(world: ServerWorld, opts: Partial<GameOptions> = {}) {
    this.world = world;
    this.opts = { ...DEFAULTS, ...opts };
    this.clients = new Array(this.opts.maxClients).fill(null);
    // Removes are sent whatever they cost, 6.7 KB for 2,048 of them, and an update can take two bytes more than it was budgeted at.
    this.w = new BitWriter(Math.max(16384, 8192 + 2 * Math.max(this.opts.snapshotBytes, this.opts.snapshotBytesMax)));
    this.replication = new Replication({ world, opts: this.opts, clients: this.clients, stats: this.stats, w: this.w, parts: this.parts });
    // The player step and the sessions each need the other: the step is made first, and reaches the sessions when it must.
    const sessions = { reject: (c: Client, reason: number): void => this.sessions.reject(c, reason), fault: (c: Client): void => this.sessions.fault(c) };
    this.players = new Players({ world, clients: this.clients, stats: this.stats, r: this.r, tell: this, sessions, replication: this.replication });
    this.sessions = new Sessions({ world, opts: this.opts, clients: this.clients, stats: this.stats, w: this.w, r: this.r, game: this, players: this.players, replication: this.replication });
  }

  /** Lingering bodies are not counted. */
  get playerCount(): number {
    let n = 0;
    for (const c of this.clients) if (c?.active && !c.closed) n++;
    return n;
  }

  /** Registers the handler of command `op`. The table is the player step's; every system calls this, so it is kept here. */
  handle(op: number, fn: CommandHandler): void {
    this.players.handle(op, fn);
  }

  /** Puts a session's inputs in charge of entity `e`, as the player step has it (Players.take). */
  take(c: Client, e: number): boolean {
    return this.players.take(c, e);
  }

  /** Gives a session's inputs back to its own body (Players.release). */
  release(c: Client): void {
    this.players.release(c);
  }

  tick(): void {
    const T = ++this.world.tick;
    const parts = this.parts;
    parts.begin();
    this.lane.begin();

    this.onBeforeStep?.();
    parts.mark(PART.before);
    // The sessions' own bodies step first, as physics: what they predict is never put off.
    this.lane.enter();
    this.players.step(T);
    this.lane.leave();
    parts.mark(PART.bodies);

    this.players.commands();
    this.sessions.expire(T);
    parts.mark(PART.commands);

    this.onStep?.(T);
    parts.mark(PART.save);
    // History records the world as this tick's snapshots show it.
    this.world.history.record(T);
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

  /** Tells every session the content the server's settings now make, which each derives as at its welcome (S_TUNING). */
  sendTuning(): void {
    const reg = this.world.reg;
    const w = new BitWriter(64 + reg.tuning.length * 4);
    w.u8(S_TUNING);
    w.u32(reg.hash);
    w.string(reg.tuning);
    const bytes = w.bytes();
    for (const c of this.clients) if (c?.active && !c.closed) c.conn.send(CH_RELIABLE, bytes);
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

  /** A result with no sequence number, for news no command asked for. */
  notify(c: Client, code: number): void {
    this.result(c, 0, code);
  }

  /** Answers command `seq` with a result code. */
  result(c: Client, seq: number, code: number): void {
    const w = this.w;
    w.reset();
    w.u8(S_RESULT);
    w.u16(seq);
    w.u8(code);
    c.conn.send(CH_RELIABLE, w.bytes());
  }
}
