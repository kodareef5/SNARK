// Sessions: who is in the world and on which connection. The hello and its checks, the welcome, a survivor's body made
// and taken away, spectators, a body that lingers when its connection goes, and the same device taking its session up
// again. What a session sends once it is in is the player step's (server/players.ts).

import { TICK_RATE, chunkAt, chunkCount } from "../shared/coords.ts";
import { TAU, detCos, detSin } from "../shared/math/scalar.ts";
import { type BitReader, BitWriter } from "../shared/net/codec.ts";
import {
  C_HELLO,
  HELLO_LOOK,
  HELLO_NEW,
  HELLO_RESUME,
  HELLO_SPECTATE,
  HELLO_STATICS,
  HELLO_TICKET,
  KEY_BYTES,
  MAX_CLIENT_MESSAGE,
  MAX_NAME_BYTES,
  MAX_PASSWORD_BYTES,
  PROTOCOL_VERSION,
  REJECT_CONTENT,
  REJECT_DENIED,
  REJECT_FULL,
  REJECT_KICKED,
  REJECT_MALFORMED,
  REJECT_NAME,
  REJECT_PASSWORD,
  REJECT_TRAVEL,
  REJECT_VERSION,
  SESSION_ALIVE,
  SESSION_CREATING,
  SESSION_DEAD,
  SESSION_SPECTATING,
  S_REJECT,
  S_TRAVEL,
  S_WELCOME,
  TICKET_BYTES,
  writeBody,
} from "../shared/net/protocol.ts";
import { CH_RELIABLE, type Connection, type Listener } from "../shared/net/transport.ts";
import { MODE_GHOST, MODE_NONE } from "../shared/sim/character.ts";
import { F_AWAKE, F_PLAYER } from "../shared/sim/entities.ts";
import { LOOK_BYTES, validLook } from "../shared/anim/look.ts";
import { groundStands, groundUnder } from "../shared/world/collide.ts";
import { Client, type GameOptions, type GameStats } from "./game.ts";
import { Allowance, Guesses, countedAs } from "./guesses.ts";
import { freeAt, freePlace, placeFree } from "./place.ts";
import { Signal } from "./signal.ts";
import type { ServerWorld } from "./world.ts";
import { event, type Bus } from "./events/bus.ts";

/** Constant-time, so timing does not leak how much of a password matched. */
function sameText(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i % (b.length || 1));
  return diff === 0;
}

/** Connections waiting to say hello, and the ticks each may take while there is room. */
const MAX_PENDING = 64;
const HELLO_TICKS = 150;
/** With no room, one that has waited this long is put out for a newcomer. A client says hello at once, so this is a slow link's round trip. */
const HELLO_GRACE_TICKS = 15;
const NAME = /^[A-Za-z0-9 _-]{1,24}$/;
/** Metres. */
const SPECTATOR_LIFT = 1.6;
/** New names one machine may make in NEW_NAME_TICKS, an hour (Allowance). */
const NEW_NAMES = 8;
const NEW_NAME_TICKS = 108000;

/** A device key and machine whose command threw are refused this long, ten minutes. */
export const FAULT_REFUSED_TICKS = 10 * 60 * TICK_RATE;
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

/** A connection that has not said hello, the tick it came on, and the machine it came from (countedAs). It holds no slot and none of a session's memory. */
interface Pending {
  readonly conn: Connection;
  readonly since: number;
  readonly from: string;
}

const SESSION_LOGIN = event("session.login");
const NAME_SET = event("name.set");

/** What the sessions need: of the game, and one or two things of the other two parts. */
export interface SessionsContext {
  readonly world: ServerWorld;
  readonly opts: GameOptions;
  /** The sessions, by slot (GameServer.clients). This part fills and empties the slots. */
  readonly clients: (Client | null)[];
  readonly stats: GameStats;
  /** The game's one writer and one reader: a refusal and a ticket are written in the one, a hello is read from the other. */
  readonly w: BitWriter;
  readonly r: BitReader;
  /** The game, for the modules' bus as it is now: the host sets it after the game is made. */
  readonly game: { readonly bus: Bus };
  /** Of the player step: what a session's connection sends is its to read, and a body that goes lets go of what it drove. */
  readonly players: { receive(c: Client, channel: number, data: Uint8Array): void; release(c: Client): void };
  /** Of replication: the ticks the loop has given up, which a welcome notes. */
  readonly replication: { readonly given: number };
}

export class Sessions {
  private readonly world: ServerWorld;
  private readonly opts: GameOptions;
  private readonly clients: (Client | null)[];
  private readonly stats: GameStats;
  private readonly w: BitWriter;
  private readonly r: BitReader;
  private readonly game: SessionsContext["game"];
  private readonly players: SessionsContext["players"];
  private readonly replication: SessionsContext["replication"];
  /** New survivor names made from each machine in the last hour. */
  private readonly newNames = new Allowance(NEW_NAMES, NEW_NAME_TICKS);
  /** Wrong join passwords, by the address they came from. */
  readonly guesses = new Guesses();
  /** Wrong cheat passwords, counted apart: joining with the right password must not forgive them. */
  readonly cheatGuesses = new Guesses();
  /** Device keys and machines whose command threw, refused for a while. */
  readonly refusals = new Refusals();
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
  readonly onEnter = new Signal<[c: Client]>();
  /** Called before the session's body, if any, is removed. */
  readonly onExit = new Signal<[c: Client]>();
  /** The connection dropped while the body lingers, or a reconnect took the body over. */
  readonly onPresence = new Signal<[c: Client]>();
  /** An entity was created for the session: at login, on respawn, or when it stops spectating. */
  readonly onBody = new Signal<[c: Client]>();
  /** The session's entity is about to be destroyed. */
  readonly onBodyGone = new Signal<[c: Client]>();
  /** Without this hook nobody is sent to the creator. */
  needsLook: ((name: string) => boolean) | null = null;
  /** Null for a new survivor. `dead` means it joins with no body and chooses where to respawn. */
  savedPosition: ((name: string) => { x: number; y: number; z: number; yaw: number; dead?: boolean; team?: number } | null) | null = null;
  /** Connections that have not said hello, oldest first. They hold no slot, so a returning survivor can reclaim its lingering session on a full server. */
  private readonly pending = new Set<Pending>();
  private readonly survivor: number;
  /** Sized for the tuning string a welcome carries. */
  private welcomeW: BitWriter;
  /** The length of the tuning it was sized for: a server's settings may make its tuning longer while it runs. */
  private welcomeFor: number;

  constructor(ctx: SessionsContext) {
    const world = (this.world = ctx.world);
    this.opts = ctx.opts;
    this.clients = ctx.clients;
    this.stats = ctx.stats;
    this.w = ctx.w;
    this.r = ctx.r;
    this.game = ctx.game;
    this.players = ctx.players;
    this.replication = ctx.replication;
    this.welcomeFor = world.reg.tuning.length;
    this.welcomeW = new BitWriter(1024 + this.welcomeFor * 4);
    this.survivor = world.reg.index.get("core:survivor")!;
  }

  listen(listener: Listener): void {
    listener.onConnection = (conn) => this.accept(conn);
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

  /** False if the hello is malformed. One that is refused is told why. Only one that is accepted is given a session. */
  private hello(conn: Connection, r: BitReader): boolean {
    const version = r.u32();
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
    if (isNew && this.game.bus.before(NAME_SET, { what: "survivor", text: name }) !== "") return this.refuse(conn, REJECT_NAME);
    if (this.game.bus.before(SESSION_LOGIN, { name, address: conn.address ?? "", isNew }) !== "") return this.refuse(conn, REJECT_DENIED);
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
      this.onPresence.emit(other);
      return true;
    }

    // A dead survivor joins dead, whatever it asks. As a spectator it could ask for its body back and get one that cannot die.
    const spectate = (flags & HELLO_SPECTATE) !== 0 && !this.savedPosition?.(name)?.dead;
    if (spectate && this.opts.spectators !== "anyone") return this.refuse(conn, REJECT_DENIED);
    // Every new name leaves a survivor record for good, so one machine may make only so many an hour.
    if (conn.address !== undefined && this.savedPosition && this.savedPosition(name) === null && !this.newNames.take(conn.address, world.tick)) return this.refuse(conn, REJECT_DENIED);
    const slot = this.clients.indexOf(null);
    // Seats may outnumber MaxPlayers, where it was lowered while the server runs.
    let seated = 0;
    for (const other of this.clients) if (other) seated++;
    if (slot < 0 || seated >= this.opts.maxClients) return this.refuse(conn, REJECT_FULL);
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
    this.onEnter.emit(c);
    this.welcome(c);
    return true;
  }

  private welcome(c: Client): void {
    c.givenAt = this.replication.given;
    const world = this.world;
    const ents = world.ents;
    if (world.reg.tuning.length !== this.welcomeFor) {
      this.welcomeFor = world.reg.tuning.length;
      this.welcomeW = new BitWriter(1024 + this.welcomeFor * 4);
    }
    const w = this.welcomeW;
    w.reset();
    w.u8(S_WELCOME);
    w.u32(PROTOCOL_VERSION);
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

  private refuse(conn: Connection, reason: number, why = ""): boolean {
    this.close(conn, reason, why);
    return true;
  }

  private bind(c: Client, conn: Connection): void {
    conn.onMessage = (channel, data) => this.players.receive(c, channel, data);
    conn.onClose = () => this.remove(c, conn);
  }

  /** The connection closed. A living body lingers, anything else leaves now. */
  private remove(c: Client, conn: Connection): void {
    if (this.clients[c.id] !== c || c.conn !== conn || c.closed) return;
    if (c.active && c.ent >= 0 && this.opts.lingerTicks > 0) {
      this.players.release(c);
      c.closed = true;
      c.lingerUntil = this.world.tick + this.opts.lingerTicks;
      c.queue.length = 0;
      this.onPresence.emit(c);
      return;
    }
    this.finalize(c);
  }

  private finalize(c: Client): void {
    if (this.clients[c.id] !== c) return;
    if (c.active) {
      this.onExit.emit(c);
      this.dropBody(c);
    }
    c.active = false;
    c.closed = false;
    this.clients[c.id] = null;
  }

  /** Once a tick, after commands: a body that has lingered its time goes, and a connection that never said hello is turned away. */
  expire(T: number): void {
    for (const c of this.clients) if (c?.closed && T >= c.lingerUntil) this.finalize(c);
    for (const p of this.pending) if (T - p.since >= HELLO_TICKS) this.turnAway(p, REJECT_MALFORMED);
  }

  reject(c: Client, reason: number): void {
    c.left = reason === REJECT_KICKED ? "kicked" : "refused";
    this.close(c.conn, reason);
  }

  /** A command of `c`'s threw: its device key and its machine are refused for FAULT_REFUSED_TICKS. */
  fault(c: Client): void {
    this.refusals.refuse(refusedAs(c.key, c.conn.address), this.world.tick, this.world.tick + FAULT_REFUSED_TICKS);
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

  private turnAway(p: Pending, reason: number): void {
    this.pending.delete(p);
    this.close(p.conn, reason);
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
    this.onBody.emit(c);
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

  /** Remove the session's entity, keeping where it was as the session's focus. */
  private dropBody(c: Client): void {
    this.players.release(c);
    if (c.ent < 0) return;
    const ents = this.world.ents;
    this.onBodyGone.emit(c);
    ents.loadBody(c.ent, c.body);
    this.world.history.untrack(c.ent);
    ents.destroy(c.ent);
    c.ent = -1;
  }
}
