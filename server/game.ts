// The authoritative game loop. It owns no socket or clock. The transport and the calls to
// tick() come from outside, so tests run a whole server in memory.

import { CHUNK_SIZE, STRUCT_UNITS, TICK_DT, chunkAt, chunkCount, chunkCx, chunkCz } from "../shared/coords.ts";
import { TAU, detCos, detSin } from "../shared/math/scalar.ts";
import { BitReader, BitWriter } from "../shared/net/codec.ts";
import {
  C_COMMAND,
  C_HELLO,
  C_INPUT,
  HELLO_LOOK,
  HELLO_SPECTATE,
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
  REJECT_FULL,
  REJECT_MALFORMED,
  REJECT_NAME,
  REJECT_PASSWORD,
  REJECT_VERSION,
  RESULT_BUSY,
  RESULT_DENIED,
  RESULT_INVALID,
  SESSION_ALIVE,
  SESSION_CREATING,
  SESSION_DEAD,
  SESSION_SPECTATING,
  S_CHUNK,
  S_CHUNK_DROP,
  S_OWN,
  VIEW_STEPS,
  S_REJECT,
  S_RESULT,
  S_SNAPSHOT,
  S_TEXT,
  REMOVAL_NEWS_TICKS,
  S_WELCOME,
  readInputs,
  writeBody,
} from "../shared/net/protocol.ts";
import { CH_RELIABLE, CH_UNRELIABLE, type Connection, type Listener } from "../shared/net/transport.ts";
import { MAX_VIEW, SentView, VIEW_RING, ViewRing, quantX, quantY, writeViewDelta } from "../shared/net/view.ts";
import { Body, MODE_GHOST, MODE_NONE, stepBody, stepOut } from "../shared/sim/character.ts";
import { FISTS, actionOut, stepAction } from "../shared/sim/weapon.ts";
import { F_AWAKE, F_PLAYER, F_ALIVE, F_PROP } from "../shared/sim/entities.ts";
import { LOOK_BYTES, validLook } from "../shared/anim/look.ts";
import { GONE_TAKEN, RECENT } from "../shared/world/structures.ts";
import { sortU32 } from "../shared/sort.ts";
import { capsuleFree } from "../shared/world/collide.ts";
import type { ChunkTable } from "../shared/world/structures.ts";
import { Guesses } from "./guesses.ts";
import type { ServerWorld } from "./world.ts";
import { NO_BUS, event, type Bus } from "./events/bus.ts";

export interface GameOptions {
  /** In ticks. */
  snapshotEvery: number;
  /** Byte budget for the deferrable part of one snapshot. */
  snapshotBytes: number;
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
}

const DEFAULTS: GameOptions = {
  snapshotEvery: 1,
  snapshotBytes: 1100,
  entityRadius: 3,
  structRadius: 3,
  chunkSlotsPerTick: 256,
  maxClients: 128,
  lingerTicks: 150,
  spectators: "admin",
  password: "",
  motdSeconds: 20,
};

/** Constant-time, so timing does not leak how much of a password matched. */
function sameText(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i % (b.length || 1));
  return diff === 0;
}

/** Unreliable messages from one client per tick. The rest are dropped. */
const MAX_PACKETS_PER_TICK = 8;
/** Reliable messages are never dropped, so more than this per tick is a strike. */
const MAX_RELIABLE_PER_TICK = 32;
/** Malformed messages tolerated before disconnecting. */
const MAX_STRIKES = 8;
/** Connections waiting to say hello, and the ticks each may take. */
const MAX_PENDING = 64;
const HELLO_TICKS = 150;
const COMMAND_QUEUE = 16;
const COMMANDS_PER_TICK = 4;
const NAME = /^[A-Za-z0-9 _-]{1,24}$/;
/** Metres. */
const SPECTATOR_LIFT = 1.6;
/** New names one address may make in NEW_NAME_TICKS, an hour. */
const NEW_NAMES = 8;
const NEW_NAME_TICKS = 108000;

/** Bits of Client.did, set by the action step on the tick just stepped. */
export const DID_STRIKE = 1;
/** The mount it drives landed a bite. */
export const DID_BITE = 8;
export const DID_FIRE = 2;
export const DID_RELOAD = 4;

/** Read every argument and check r.overflow before acting. Returns a RESULT code. */
export type CommandHandler = (c: Client, r: BitReader) => number;

/** One survivor's session. It outlives its connection by lingerTicks, and a reconnect with the same name and key takes it over. */
export class Client {
  /** Slot in `GameServer.clients`, or -1 until its hello is accepted. */
  id: number;
  helloBy = 0;
  conn: Connection;
  active = false;
  /** The connection is gone; the body stays until `lingerUntil`. */
  closed = false;
  lingerUntil = 0;
  name = "";
  key: Uint8Array = new Uint8Array(KEY_BYTES);
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
  heldX = 0;
  heldZ = 0;
  heldYaw = 0;
  heldPitch = 0;
  heldButtons = 0;
  /** Buttons that went down this tick. */
  pressed = 0;
  /** DID_ bits for this tick, and how far a shot was drawn. */
  did = 0;
  drawn = 0;
  private before = 0;
  newestInput = 0;
  /** Newest snapshot the client says it decoded. */
  ackTick = 0;
  lastSnapshot = 0;
  readonly views = new ViewRing(() => new SentView());
  /** Structure table version the client holds, per chunk. */
  readonly known: Uint32Array;
  /** Version of each chunk's used-up nodes the client holds. */
  readonly nodesKnown: Uint32Array;
  sentProgress = -1;
  readonly subscribed: number[] = [];
  syncChunk = -1;
  syncCursor = 0;
  syncFrom = 0;
  syncTarget = 0;
  /** Removed rows of the chunk being synced go as grouped removals, not row by row. */
  syncByRemoval = false;
  rotate = 0;
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
  sentRespawn = false;
  /** What was last sent of the creature it has open, packed into one number, and when. */
  sentSubject = -1;
  sentSubjectAt = 0;
  /** Respawn choices in the order sent. bed is a structure ref, or -1. */
  readonly respawnAt: { x: number; y: number; z: number; yaw: number; bed: number }[] = [];
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
    this.heldX = this.heldZ = this.heldButtons = 0;
    this.newestInput = this.ackTick = this.lastSnapshot = 0;
    this.views.clear();
    this.known.fill(0);
    this.nodesKnown.fill(0);
    this.sentProgress = -1;
    this.subscribed.length = 0;
    this.syncChunk = -1;
    this.rotate = 0;
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
    this.sentRespawn = false;
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
const NAME_SET = event("name.set");

export class GameServer {
  readonly world: ServerWorld;
  readonly opts: GameOptions;
  bus: Bus = NO_BUS;
  readonly clients: (Client | null)[];
  /** New survivor names made from each address in the last hour. */
  private readonly newNames = new Map<string, { n: number; since: number }>();
  /** Wrong passwords, for joining and for cheats, by the address they came from. */
  readonly guesses = new Guesses();
  readonly stats = { malformed: 0, throttled: 0, lateInputs: 0, heldInputs: 0, commands: 0, chunkBytes: 0 };
  /** May this device key use this name? Called before anything is created. */
  authorize: ((name: string, key: Uint8Array) => boolean) | null = null;
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
  /** Called once per tick after bodies move and commands run, before replication. */
  onStep: ((tick: number) => void) | null = null;
  /** Called for each connected session just before its snapshot. */
  onReplicate: ((c: Client) => void) | null = null;
  /** Whether the session may run command `op` now. A refused command answers RESULT_DENIED and its handler is not called. */
  allows: ((c: Client, op: number) => boolean) | null = null;
  /** speed is in metres per second. */
  onLand: ((c: Client, speed: number) => void) | null = null;
  /** Without this hook nobody is sent to the creator. */
  needsLook: ((name: string) => boolean) | null = null;
  /** Null for a new survivor. `dead` means it joins with no body and chooses where to respawn. */
  savedPosition: ((name: string) => { x: number; y: number; z: number; yaw: number; dead?: boolean } | null) | null = null;

  private readonly handlers: (CommandHandler | null)[] = new Array(256).fill(null);
  /** Connections that have not said hello hold no slot, so a returning survivor can reclaim its lingering session on a full server. */
  private readonly pending = new Set<Client>();
  private readonly survivor: number;
  private readonly w = new BitWriter(16384);
  /** Sized for the tuning string a welcome carries. */
  private readonly welcomeW: BitWriter;
  private readonly r = new BitReader();
  /** The entities around each chunk that is some client's centre this tick, gathered once and shared by every client centred there. */
  private readonly around: SentView[] = [];
  private gathered = 0;
  /** Per chunk: the tick `around[aroundAt]` was gathered for it. */
  private readonly aroundTick: Uint32Array;
  private readonly aroundAt: Uint16Array;
  private readonly changed = new Uint16Array(RECENT);
  private readonly ids = new Uint32Array(MAX_VIEW);
  private readonly movers = new Uint32Array(MAX_VIEW);
  private readonly idle = new Uint32Array(MAX_VIEW);
  private readonly entityOffsets: Int16Array;
  private readonly structOffsets: Int16Array;

  constructor(world: ServerWorld, opts: Partial<GameOptions> = {}) {
    this.world = world;
    this.opts = { ...DEFAULTS, ...opts };
    this.clients = new Array(this.opts.maxClients).fill(null);
    this.welcomeW = new BitWriter(1024 + world.reg.tuning.length * 4);
    this.aroundTick = new Uint32Array(chunkCount(world.dims));
    this.aroundAt = new Uint16Array(chunkCount(world.dims));
    this.entityOffsets = nearestFirst(this.opts.entityRadius);
    this.structOffsets = nearestFirst(this.opts.structRadius);
    this.survivor = world.reg.index.get("core:survivor")!;
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

  tick(): void {
    const world = this.world;
    const ents = world.ents;
    const T = ++world.tick;

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
      } else this.stats.heldInputs++;
      c.edges();
      c.did = 0;
      const b = c.body;
      // Let go of a mount that died or was replaced.
      if (c.drive >= 0 && ((ents.flags[c.drive]! & F_ALIVE) === 0 || ents.gen[c.drive] !== c.driveGen)) this.release(c);
      const driving = c.drive >= 0;
      const e = driving ? c.drive : c.ent;
      if (e >= 0) {
        ents.loadBody(e, b);
        stepBody(world, b, c.heldX, c.heldZ, c.heldYaw, c.heldPitch, c.heldButtons, world.reg.move[b.kind]!, TICK_DT);
        if (!driving) {
          // Hits are resolved later, once every body has moved.
          stepAction(b, c.heldButtons, c.pressed, world.reg.weapon[b.held] ?? FISTS);
          c.did = (actionOut.strike ? DID_STRIKE : 0) | (actionOut.fire ? DID_FIRE : 0) | (actionOut.reloaded ? DID_RELOAD : 0);
          c.drawn = actionOut.draw;
        } else {
          // A mount's bite goes through the same action step as any blow.
          const jaws = world.reg.weapon[b.kind];
          if (jaws) {
            stepAction(b, c.heldButtons, c.pressed, jaws);
            if (actionOut.strike) c.did = DID_BITE;
          }
        }
        ents.storeBody(e, b);
        ents.pitch[e] = c.heldPitch;
        ents.pose(e, T);
        if (!driving && stepOut.landSpeed > 0) this.onLand?.(c, stepOut.landSpeed);
      } else {
        b.kind = c.kind;
        stepBody(world, b, c.heldX, c.heldZ, c.heldYaw, c.heldPitch, c.heldButtons, world.reg.move[c.kind]!, TICK_DT);
      }
      c.chunk = chunkAt(world.dims, b.x, b.z);
    }

    for (const c of this.clients) if (c?.active && c.queue.length > 0) this.runCommands(c);
    for (const c of this.clients) if (c?.closed && T >= c.lingerUntil) this.finalize(c);
    for (const c of this.pending) if (T >= c.helloBy) this.reject(c, REJECT_MALFORMED);

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

  reject(c: Client, reason: number): void {
    c.left = reason === REJECT_KICKED ? "kicked" : "refused";
    const w = this.w;
    w.reset();
    w.bits(S_REJECT, 4);
    w.u8(reason);
    c.conn.send(CH_RELIABLE, w.bytes());
    c.conn.close();
  }

  /** One message per line. */
  sendText(c: Client, channel: number, text: string): void {
    if (c.closed) return;
    const w = this.w;
    for (const line of text.split("\n")) {
      w.reset();
      w.bits(S_TEXT, 4);
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
    w.bits(S_OWN, 4);
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
    w.bits(type, 4);
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
    if ((ents.flags[c.drive]! & F_ALIVE) !== 0 && ents.gen[c.drive] === c.driveGen) ents.driven[c.drive] = 0;
    c.drive = -1;
  }

  /** False if the session is not in the creator or there is no room. */
  create(c: Client, look: Uint8Array): boolean {
    if (c.state !== SESSION_CREATING) return false;
    c.look = look;
    if (!this.spawnBody(c)) return false;
    c.ownDirty = true;
    return true;
  }

  /** `y` defaults to the ground. A bed on an upper floor passes its own. */
  revive(c: Client, x: number, z: number, yaw: number, y = this.world.hf.heightAt(x, z)): boolean {
    if (c.state !== SESSION_DEAD || !this.spawnBody(c, { x, y, z, yaw })) return false;
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

  /** Spawns at `at`, else where the survivor was last seen, else the spawn point. If that spot is taken, the first free one around it. */
  private spawnBody(c: Client, at?: { x: number; y: number; z: number; yaw: number }): boolean {
    const world = this.world;
    const kind = this.survivor;
    const p = world.reg.move[kind]!;
    const want = at ?? this.savedPosition?.(c.name) ?? null;
    const cx = at ? at.x : world.spawn.x;
    const cz = at ? at.z : world.spawn.z;
    let x = cx;
    let z = cz;
    let y = 0;
    let yaw = at ? at.yaw : world.spawn.yaw;
    if (want && capsuleFree(world, want.x, want.y, want.z, p.radius, p.height) && !(at && this.occupied(want.x, want.z))) {
      x = want.x;
      y = want.y;
      z = want.z;
      yaw = want.yaw;
    } else {
      // First free spot on rings around the place.
      for (let k = 0; k < 96; k++) {
        const ring = Math.ceil(k / 8);
        const a = (k * TAU) / 8 + ring * 0.4;
        x = cx + detSin(a) * ring * 1.5;
        z = cz + detCos(a) * ring * 1.5;
        if (capsuleFree(world, x, world.hf.heightAt(x, z), z, p.radius, p.height) && !this.occupied(x, z)) break;
      }
      y = world.hf.heightAt(x, z);
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
    // A full server reconnecting at once is not an attack.
    if (this.pending.size >= Math.max(MAX_PENDING, this.opts.maxClients)) {
      const w = this.w;
      w.reset();
      w.bits(S_REJECT, 4);
      w.u8(REJECT_FULL);
      conn.send(CH_RELIABLE, w.bytes());
      conn.close();
      return;
    }
    const c = new Client(-1, conn, chunkCount(this.world.dims));
    c.helloBy = this.world.tick + HELLO_TICKS;
    this.pending.add(c);
    this.bind(c, conn);
  }

  private bind(c: Client, conn: Connection): void {
    conn.onMessage = (channel, data) => this.receive(c, channel, data);
    conn.onClose = () => this.remove(c, conn);
  }

  /** The connection closed. A living body lingers, anything else leaves now. */
  private remove(c: Client, conn: Connection): void {
    if (this.pending.delete(c)) return;
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
    let ok = true;
    if (channel !== CH_RELIABLE) {
      if (++c.packets > MAX_PACKETS_PER_TICK) {
        this.stats.throttled++;
        return;
      }
    } else if (++c.reliable > MAX_RELIABLE_PER_TICK) ok = false;
    if (ok) ok = data.length <= MAX_CLIENT_MESSAGE;
    if (ok) {
      const r = this.r;
      r.reset(data);
      const type = r.bits(4);
      if (type === C_INPUT && c.active) ok = this.input(c, r);
      else if (type === C_COMMAND && c.active && channel === CH_RELIABLE) ok = this.command(c, r, data);
      else if (type === C_HELLO && !c.active && channel === CH_RELIABLE) ok = this.hello(c, r);
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
    const newest = readInputs(r, c.inputs, this.world.tick, ack, behind);
    if (newest === 0) return false;
    if (newest <= this.world.tick) this.stats.lateInputs++;
    // Track the newest tick even when it is too far ahead to buffer, because the margin sent back tells a
    // client its clock has run away. It moves backward only by a whole window, which is a restarted clock.
    if (newest > c.newestInput || newest < c.newestInput - INPUT_WINDOW) c.newestInput = newest;
    // An ack can only name a snapshot that was sent, and only move forward.
    if (ack > c.ackTick && ack <= c.lastSnapshot) c.ackTick = ack;
    return true;
  }

  /** A gap in the sequence means a broken client. */
  private command(c: Client, r: BitReader, data: Uint8Array): boolean {
    const seq = r.u16();
    r.u8();
    if (r.overflow || seq !== ((c.cmdSeq + 1) & 0xffff)) return false;
    c.cmdSeq = seq;
    c.activeAt = this.world.tick;
    if (c.queue.length >= COMMAND_QUEUE) this.result(c, seq, RESULT_BUSY);
    else c.queue.push(data);
    return true;
  }

  private runCommands(c: Client): void {
    const r = this.r;
    for (let n = 0; n < COMMANDS_PER_TICK && c.queue.length > 0; n++) {
      r.reset(c.queue.shift()!);
      r.bits(4);
      const seq = r.u16();
      const op = r.u8();
      const handler = this.handlers[op];
      const code = !handler ? RESULT_INVALID : this.allows && !this.allows(c, op) ? RESULT_DENIED : handler(c, r);
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
    w.bits(S_RESULT, 4);
    w.u16(seq);
    w.u8(code);
    c.conn.send(CH_RELIABLE, w.bytes());
  }

  private hello(c: Client, r: BitReader): boolean {
    const version = r.u16();
    // Another version lays the rest out differently, so nothing more is read.
    if (!r.overflow && version !== PROTOCOL_VERSION) return this.refuse(c, REJECT_VERSION);
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
    const password = r.string(MAX_PASSWORD_BYTES);
    if (r.overflow) return false;
    if (look && !validLook(look)) return this.refuse(c, REJECT_MALFORMED);
    const world = this.world;
    // The client hashes content as written. The welcome tells it this server's tuning, and it derives the rest.
    if (contentHash !== world.reg.baseHash || clipHash !== world.anim.set.hash) return this.refuse(c, REJECT_CONTENT);
    // A reconnect to a lingering body is asked too.
    if (this.opts.password !== "") {
      const who = c.conn.address ?? name;
      if (this.guesses.wait(who, world.tick) > 0) return this.refuse(c, REJECT_PASSWORD);
      if (!sameText(password, this.opts.password)) {
        this.guesses.wrong(who, world.tick);
        return this.refuse(c, REJECT_PASSWORD);
      }
      this.guesses.right(who);
    }
    if (!NAME.test(name)) return this.refuse(c, REJECT_NAME);
    // A module may turn a login away, or a name nobody has had before. A survivor's name is who it is, so it is not reworded.
    const isNew = this.savedPosition?.(name) == null;
    if (isNew && this.bus.before(NAME_SET, { what: "survivor", text: name }) !== "") return this.refuse(c, REJECT_NAME);
    if (this.bus.before(SESSION_LOGIN, { name, address: c.conn.address ?? "", isNew }) !== "") return this.refuse(c, REJECT_DENIED);
    if (this.authorize && !this.authorize(name, key)) return this.refuse(c, REJECT_DENIED);
    // One body per survivor. A second login is refused unless the first connection is gone, and then it takes over the body.
    for (const other of this.clients) {
      if (!other?.active || other.name !== name) continue;
      if (!other.closed) return this.refuse(c, REJECT_NAME);
      this.pending.delete(c);
      other.relink(c.conn);
      this.bind(other, c.conn);
      this.welcome(other);
      this.onPresence?.(other);
      return true;
    }

    // Every new name leaves a survivor record for good, so one address may make only so many an hour.
    if (c.conn.address !== undefined && this.savedPosition && this.savedPosition(name) === null) {
      const made = this.newNames.get(c.conn.address);
      if (made && world.tick - made.since < NEW_NAME_TICKS) {
        if (made.n >= NEW_NAMES) return this.refuse(c, REJECT_DENIED);
        made.n++;
      } else {
        if (this.newNames.size > 4096) this.newNames.clear();
        this.newNames.set(c.conn.address, { n: 1, since: world.tick });
      }
    }
    const slot = this.clients.indexOf(null);
    if (slot < 0) return this.refuse(c, REJECT_FULL);
    this.pending.delete(c);
    this.clients[slot] = c;
    c.id = slot;
    c.name = name;
    c.key = key;
    c.look = look;
    c.kind = this.survivor;
    // A dead survivor joins dead, whatever it asks. As a spectator it could ask for its body back and get one that cannot die.
    if ((flags & HELLO_SPECTATE) !== 0 && !this.savedPosition?.(name)?.dead) {
      if (this.opts.spectators !== "anyone") return this.refuse(c, REJECT_DENIED);
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
      } else if (!this.spawnBody(c)) return this.refuse(c, REJECT_FULL);
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
    w.bits(S_WELCOME, 4);
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
    c.conn.send(CH_RELIABLE, w.bytes());
  }

  private sendOwn(c: Client): void {
    const w = this.w;
    w.reset();
    w.bits(S_OWN, 4);
    w.u8(OWN_SESSION);
    w.bits(c.state, 2);
    w.bool(c.admin);
    w.u32(c.ent >= 0 ? this.world.ents.handleOf(c.ent) : 0);
    w.u32(this.world.dayOffset);
    c.conn.send(CH_RELIABLE, w.bytes());
    c.ownDirty = false;
  }

  private refuse(c: Client, reason: number): boolean {
    this.reject(c, reason);
    return true;
  }

  private occupied(x: number, z: number): boolean {
    const ents = this.world.ents;
    for (const c of this.clients) {
      if (!c?.active || c.ent < 0) continue;
      const dx = ents.x[c.ent]! - x;
      const dz = ents.z[c.ent]! - z;
      if (dx * dx + dz * dz < 1) return true;
    }
    return false;
  }

  /**
   * The entities a client centred on `chunk` may see at tick `T`, sorted by index. Every client centred there shares the list,
   * so it includes each one's own body, and the delta writer leaves that out. With more entities than a view holds, players
   * go in first, then anything moving or acting, then idle entities and props, so a crowd of idle creatures never hides a player.
   */
  private viewAround(chunk: number, T: number): SentView {
    if (this.aroundTick[chunk] === T) return this.around[this.aroundAt[chunk]!]!;
    const world = this.world;
    const ents = world.ents;
    const dims = world.dims;
    const ccx = chunkCx(dims, chunk);
    const ccz = chunkCz(dims, chunk);
    const ids = this.ids;
    const movers = this.movers;
    const idle = this.idle;
    const offsets = this.entityOffsets;
    let n = 0;
    let nm = 0;
    let ni = 0;
    for (let o = 0; o < offsets.length; o += 2) {
      const cx = ccx + offsets[o]!;
      const cz = ccz + offsets[o + 1]!;
      if (cx < 0 || cz < 0 || cx >= dims.chunksX || cz >= dims.chunksZ) continue;
      for (let i = ents.chunkHead[cz * dims.chunksX + cx]!; i >= 0; i = ents.next[i]!) {
        const f = ents.flags[i]!;
        if ((f & F_PLAYER) !== 0) {
          if (n < MAX_VIEW) ids[n++] = i;
        } else if ((f & F_PROP) === 0 && (ents.vx[i] !== 0 || ents.vz[i] !== 0 || ents.vy[i] !== 0 || ents.act[i] !== 0 || ents.driven[i] !== 0)) {
          if (nm < MAX_VIEW) movers[nm++] = i;
        } else if (ni < MAX_VIEW) idle[ni++] = i;
      }
    }
    for (let k = 0; k < nm && n < MAX_VIEW; k++) ids[n++] = movers[k]!;
    for (let k = 0; k < ni && n < MAX_VIEW; k++) ids[n++] = idle[k]!;
    sortU32(ids, n);
    const at = this.gathered++;
    const cur = (this.around[at] ??= new SentView());
    cur.count = 0;
    for (let k = 0; k < n; k++) {
      const i = ids[k]!;
      cur.push(i, ents.gen[i]!, ents.kind[i]!, quantX(ents.x[i]!), quantY(ents.y[i]!), quantX(ents.z[i]!), ents.yaw[i]! >>> 6, (ents.flags[i]! >>> 1) & 0xf, ents.anim[i]!, ents.rev[i]!);
      cur.urgent[k] = (ents.flags[i]! & F_PLAYER) !== 0 || ents.driven[i] !== 0 ? 1 : 0;
    }
    this.aroundTick[chunk] = T;
    this.aroundAt[chunk] = at;
    return cur;
  }

  private snapshot(c: Client, T: number): void {
    const ents = this.world.ents;
    // The client predicts its own body, so the view leaves it out. While it drives a mount, both bodies are in the view.
    const self = c.drive >= 0 ? -1 : c.ent;
    const cur = this.viewAround(c.chunk, T);

    const age = T - c.ackTick;
    const base = c.ackTick > 0 && age < VIEW_RING ? c.views.find(c.ackTick) : null;
    const next = c.views.alloc(T);

    const w = this.w;
    w.reset();
    w.bits(S_SNAPSHOT, 4);
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
    c.rotate = writeViewDelta(w, base, cur, next, this.opts.snapshotBytes * 8 - w.pos, c.rotate, ents, self);
    c.lastSnapshot = T;
    c.conn.send(CH_UNRELIABLE, w.bytes());
  }

  /** Nearest chunk first, within the per-tick slot budget. */
  private syncChunks(c: Client, T: number): void {
    const world = this.world;
    const dims = world.dims;
    const ccx = chunkCx(dims, c.chunk);
    const ccz = chunkCz(dims, c.chunk);
    const offsets = this.structOffsets;
    let budget = this.opts.chunkSlotsPerTick;
    for (let o = 0; o < offsets.length && budget > 0; o += 2) {
      const cx = ccx + offsets[o]!;
      const cz = ccz + offsets[o + 1]!;
      if (cx < 0 || cz < 0 || cx >= dims.chunksX || cz >= dims.chunksZ) continue;
      const chunk = cz * dims.chunksX + cx;
      const t = world.structs.chunks[chunk];
      if (t && t.version > c.known[chunk]!) budget = this.sendChunk(c, chunk, t, budget);
    }

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
        w.bits(S_CHUNK_DROP, 4);
        w.u16(chunk);
        c.conn.send(CH_RELIABLE, w.bytes());
      }
    }
  }

  /**
   * Collects into `changed` the slots of `t` changed since version `from`, from its log. Returns how many, or -1 if the
   * log does not reach back that far or holds more than `most`.
   */
  private changedSince(t: ChunkTable, from: number, byRemoval: boolean, most: number): number {
    const slots = t.recentSlot;
    const vers = t.recentVer;
    if (!slots || !vers || from < t.recentFloor) return -1;
    let n = 0;
    for (let k = 1, held = Math.min(t.recentCount, RECENT); k <= held; k++) {
      const at = (t.recentCount - k) % RECENT;
      const version = vers[at]!;
      if (version <= from) break;
      const slot = slots[at]!;
      // A slot changed twice is sent for its later change only.
      if (t.mod[slot] !== version || (byRemoval && t.kind[slot] === 0)) continue;
      if (n === most) return -1;
      this.changed[n++] = slot;
    }
    return n;
  }

  private row(w: BitWriter, t: ChunkTable, s: number, x0: number, z0: number): void {
    const kind = t.kind[s]!;
    w.u16(s);
    w.u16(kind);
    if (kind === 0) return;
    w.bits(Math.round((t.x[s]! - x0) * STRUCT_UNITS), 15);
    w.bits(Math.round((t.z[s]! - z0) * STRUCT_UNITS), 15);
    w.svarint(Math.round(t.y[s]! * STRUCT_UNITS));
    w.u16(t.yaw[s]!);
    w.varint(t.owner[s]!);
    w.f32(t.hp[s]!);
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
    w.bits(S_CHUNK, 4);
    w.u16(chunk);
    w.u32(target);
    const header = w.pos;
    w.bits(0, 1 + 16);
    let count = 0;
    let s = cursor;
    let final = true;
    // A client a few changes behind is sent those from the chunk's log. Otherwise every slot is looked at.
    const logged = cursor === 0 ? this.changedSince(t, from, byRemoval, budget) : -1;
    if (logged >= 0) {
      for (; count < logged; count++) this.row(w, t, this.changed[count]!, x0, z0);
    } else {
      for (; s < t.high && count < budget; s++) {
        if (t.mod[s]! <= from || (byRemoval && t.kind[s] === 0)) continue;
        this.row(w, t, s, x0, z0);
        count++;
      }
      final = s >= t.high;
    }
    const rows = count;
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
