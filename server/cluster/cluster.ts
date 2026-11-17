// The servers of a cluster as one of them sees them, and the survivors that leave it for another and come from one. The
// design, its durable states and how each is recovered are in planning/architecture/transfers.md.

import { resolve } from "node:path";
import type { Registry } from "../../shared/content/registry.ts";
import type { ItemDef } from "../../shared/content/defs.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { pidSeq, pidWorld } from "../../shared/ids.ts";
import { TRAVEL_TERMINAL } from "../../shared/world/obelisks.ts";
import { ACT_REACH } from "../../shared/world/upkeep.ts";
import { RESULT_INVALID, RESULT_OK, SESSION_ALIVE, TICKET_BYTES } from "../../shared/net/protocol.ts";
import { event, type Bus } from "../events/bus.ts";
import type { Client, GameServer } from "../game.ts";
import type { Items } from "../items.ts";
import { rebaseTicks } from "../persist/codec.ts";
import type { SaveLock } from "../persist/lock.ts";
import type { Persistence } from "../persist/persistence.ts";
import { TRANSFER_IN, TRANSFER_OUT, type TransferRow, type WorldStore } from "../persist/store.ts";
import { MAX_TEAM_WORLD, hashKey, type EntityRecord, type Records } from "../records.ts";
import type { Rules } from "../settings/rules.ts";
import type { Tribes } from "../tribes.ts";
import type { ServerWorld } from "../world.ts";
import { ClusterFolder, LIVE_MS, type Announcement, type ParcelPlace } from "./folder.ts";
import { PARCEL_FORMAT, hex, openParcel, parcelRecords, sealParcel, sha256, unhex, type Parcel, type ParcelHead } from "./parcel.ts";

/** Seconds a travel ticket may be used for. Past it the survivor goes back to the server it left. */
export const TICKET_SECONDS = 600;
/** Ticks between a server's news of itself in the folder, and its looks at what it sent that has not been taken. */
const ANNOUNCE_TICKS = 5 * TICK_RATE;
/** The key a file is taken for when the survivor in it had none. */
const NO_KEY = "0".repeat(32);

const TRANSFER_OUT_EVENT = event("transfer.out");
const TRANSFER_IN_EVENT = event("transfer.in");
const TRANSFER_DONE = event("transfer.done");

/** Another server of the cluster, as the travel list shows it. `why` says why a survivor cannot go there now, "" if it can. */
export interface Destination {
  world: number;
  name: string;
  map: string;
  port: number;
  url: string;
  players: number;
  max: number;
  why: string;
}

/** A map as a person reads it: the label content gives it, as the map screen shows it, or its id where it has none. */
export function mapLabel(reg: Registry, mapId: string): string {
  const def = reg.defs[reg.index.get(mapId) ?? 0];
  return (def?.type === "map" ? def.label : undefined) ?? mapId;
}

/** What the cluster needs of the world it is part of. */
export interface ClusterContext {
  readonly reg: Registry;
  readonly world: ServerWorld;
  readonly records: Records;
  readonly items: Items;
  readonly persistence: Persistence;
  readonly rules: Rules;
  readonly tribes: Tribes;
  readonly game: GameServer;
  readonly bus: Bus;
  /** Why the session's survivor cannot leave as it is now, or "". */
  mayLeave(c: Client, rec: EntityRecord): string;
  /** Stops a survivor's clock, or starts it again (Survival.suspend). */
  suspend(rec: EntityRecord, off: boolean): void;
  /** Puts a survivor that came while the world runs in it, out of the world as a save's survivor is loaded. */
  adopt(rec: EntityRecord): void;
  /** Lets go of what the systems keep of a record that is leaving the running world. */
  forget(rec: EntityRecord): void;
  say(line: string): void;
}

/** A survivor whose name is this world's and who is elsewhere: the transfer it left by, and where it went. */
interface Away {
  id: string;
  pid: number;
  to: number;
  /** Its file was taken: there is nothing more to wait for here. */
  settled: boolean;
}

export class Cluster {
  readonly folder: ClusterFolder;
  /** The -clusterid. */
  readonly id: string;
  readonly world: number;
  /** How pages reach this server, said in the folder: the port it listens on, and the address it is reached at from elsewhere. */
  port = 0;
  url = "";
  /** The wall clock, in milliseconds. Tickets end by it, and time in transit is measured by it. */
  now: () => number = () => Date.now();
  /** What recovering at the load did, one line each. */
  readonly recovered: string[] = [];
  /** Names given out here whose survivor is elsewhere. */
  readonly away = new Map<string, Away>();
  /**
   * Survivors that came from another server and have not chosen where to rise. Until they do they have no body, as a survivor
   * out of the world has none (DEV08): nothing reaches them or what they carry, and their clock is stopped. Their owner is
   * shown the spawn screen whenever it joins, and they are kept in the save, so a server that stops loses none of it.
   */
  readonly arriving = new Set<number>();
  private readonly arrivals = { dirty: false, serialize: (): string => JSON.stringify([...this.arriving]) };
  private ctx: ClusterContext | null = null;
  /** The world being started will resume what its records hold (start). */
  private resumes = false;
  private readonly lock: SaveLock;
  private readonly saveId: string;
  private readonly savePath: string;
  private namesAt = -1;
  private stopped = false;
  private failedAt = 0;

  private constructor(folder: ClusterFolder, id: string, world: number, lock: SaveLock, store: WorldStore) {
    this.folder = folder;
    this.id = id;
    this.world = world;
    this.lock = lock;
    this.saveId = store.saveId;
    this.savePath = resolve(store.path);
  }

  /**
   * Joins the cluster in folder `root` with a save, and says which world id the save's records are numbered under. A save made
   * before has one already (1 if it was made outside any cluster); a new save takes the lowest no save of the cluster has had.
   * Throws if another save of the cluster has the save's id, or the server for it is running, or the save was in a cluster
   * other than this one or in a folder that does not know it: what left it would be lost (ARK's uploads that vanish when two
   * servers' folders differ). The save keeps the cluster's id from here on.
   */
  static open(root: string, id: string, store: WorldStore): Cluster {
    const folder = new ClusterFolder(root);
    const blank = (world: number): Announcement => ({ world, saveId: store.saveId, save: resolve(store.path), name: "", map: "", port: 0, url: "", players: 0, max: 0, content: 0, survivors: false, items: false, at: 0 });
    const was = store.meta("cluster");
    if (was !== null && String(was) !== id) throw new Error(`this save is in the cluster ${was}, not ${id}: start it with -clusterid=${was}`);
    const own = folder.announcements().find((a) => a.saveId === store.saveId);
    if (!store.fresh || own) {
      const world = own?.world ?? Number(store.meta("world_id") ?? 1);
      const had = own ?? folder.announcement(world);
      if (had && had.saveId !== store.saveId) {
        throw new Error(`world ${world} of the cluster in ${root} is the save ${had.save}${had.map ? ` (${had.map})` : ""}, and this save's records are numbered as world ${world} too, so two things would share an id: start this save outside the cluster, or give the cluster a new save for this map`);
      }
      if (!had && was !== null) throw new Error(`this save is world ${world} of the cluster ${id}, and the folder ${root} does not know it, so what left this world is not there: start it with the folder it used (-ClusterDirOverride)`);
      const lock = folder.hold(world);
      if (!had) folder.announce(blank(world), true);
      return new Cluster(folder, id, world, lock, store);
    }
    for (let world = 1; world <= MAX_TEAM_WORLD; world++) {
      if (folder.announcement(world)) continue;
      let lock: SaveLock;
      try {
        lock = folder.hold(world);
      } catch {
        continue;
      }
      // Taken while it was looked at.
      if (folder.announcement(world)) {
        lock.release();
        continue;
      }
      folder.announce(blank(world), true);
      return new Cluster(folder, id, world, lock, store);
    }
    throw new Error(`the cluster in ${root} has no world id left for a new save`);
  }

  /**
   * Call once the world is loaded, before anything resumes: does over again what the save lost of the cluster's transfers.
   * A save that never committed has lost them too, since its world took its id before then.
   */
  start(ctx: ClusterContext, fresh: boolean): void {
    this.ctx = ctx;
    // The save keeps the cluster it is in from its next commit on (Cluster.open).
    ctx.persistence.sidecar("cluster", { dirty: true, serialize: () => this.id });
    ctx.persistence.sidecar("arrivals", this.arrivals);
    if (!fresh) {
      const kept = ctx.persistence.store.meta("arrivals");
      for (const pid of typeof kept === "string" ? (JSON.parse(kept) as number[]) : []) if (ctx.records.byPid.has(pid)) this.arriving.add(pid);
    }
    // What a loaded save holds resumes with the rest of it. A new world resumes nothing, so what comes into it now is put in.
    this.resumes = !fresh;
    this.recover();
    this.rebuildAway();
    this.expire(this.folder.places(), this.resumes);
    this.announce();
  }

  /** Every tick. Says how the server is, every few seconds, and takes back what it sent that is past its ticket. */
  step(tick: number): void {
    if (tick % ANNOUNCE_TICKS !== 0 || this.stopped) return;
    try {
      this.announce();
      const names = this.ctx!.persistence.survivors;
      if (names.size !== this.namesAt) {
        this.folder.writeNames(this.world, names);
        this.namesAt = names.size;
      }
      this.expire(this.folder.places(), false);
      this.folder.sweep(this.now());
    } catch (err) {
      // A folder that cannot be written now is tried again; the log says so once a minute.
      if (this.now() - this.failedAt > 60_000) this.ctx!.say(`the cluster's folder ${this.folder.root} could not be written: ${err instanceof Error ? err.message : String(err)}`);
      this.failedAt = this.now();
    }
  }

  /** The server listens, on `port`, and is reached from elsewhere at `url` ("" for nowhere): it says so at once. */
  listening(port: number, url: string): void {
    this.port = port;
    this.url = url;
    if (this.ctx && !this.stopped) this.announce();
  }

  /** Says it has stopped and lets go of its world id. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    try {
      if (this.ctx) this.folder.announce({ ...this.announcement(), at: 0 });
    } catch {
      // It will look stopped once its news is old.
    }
    this.lock.release();
  }

  private announcement(): Announcement {
    const { rules, world, game, reg } = this.ctx!;
    const map = mapLabel(reg, world.mapId);
    return {
      world: this.world,
      saveId: this.saveId,
      save: this.savePath,
      name: rules.text("SessionName") || map,
      map,
      port: this.port,
      url: this.url,
      players: game.playerCount,
      max: game.opts.maxClients,
      content: reg.baseHash,
      survivors: !rules.on("PreventDownloadSurvivors") && !rules.on("noTributeDownloads"),
      items: !rules.on("PreventDownloadItems") && !rules.on("noTributeDownloads"),
      at: this.now(),
    };
  }

  private announce(): void {
    this.folder.announce(this.announcement());
  }

  /** The name a world of the cluster goes by. */
  serverName(world: number): string {
    const a = this.folder.announcement(world);
    return a && a.name !== "" ? a.name : `world ${world}`;
  }

  /** This server as the others list it, so that a page can list it among them (server/site.ts). */
  here(): Destination {
    const a = this.announcement();
    return { world: a.world, name: a.name, map: a.map, port: a.port, url: a.url, players: a.players, max: a.max, why: "" };
  }

  /** The other servers of the cluster that are running, each with why a survivor of this one cannot go there now. */
  destinations(): Destination[] {
    const now = this.now();
    return this.folder
      .announcements()
      .filter((a) => a.world !== this.world && a.at > now - LIVE_MS)
      .map((a) => ({ world: a.world, name: a.name, map: a.map, port: a.port, url: a.url, players: a.players, max: a.max, why: this.whyNot(a) }));
  }

  private whyNot(a: Announcement): string {
    const { rules, reg } = this.ctx!;
    if (rules.on("PreventUploadSurvivors")) return "this server does not let survivors leave it";
    if (a.content !== reg.baseHash) return `${a.name} runs other content, which what a survivor carries may not exist in`;
    if (!a.survivors) return `${a.name} takes no survivors from other servers`;
    if (a.players >= a.max) return `${a.name} is full`;
    return "";
  }

  /** Whether the session's body stands within reach of the travel terminal `ref`, as the use key's reach is. */
  atTerminal(c: Client, ref: number): boolean {
    const { world, reg } = this.ctx!;
    const terminal = reg.index.get(TRAVEL_TERMINAL) ?? 0;
    const t = world.structs.chunks[Math.floor(ref / 65536)];
    const slot = ref & 0xffff;
    if (terminal === 0 || !t || slot >= t.high || t.kind[slot] !== terminal || c.ent < 0) return false;
    const e = world.ents;
    const far = Math.hypot(e.x[c.ent]! - t.x[slot]!, e.z[c.ent]! - t.z[slot]!) - Math.max(reg.halfX[terminal]!, reg.halfZ[terminal]!);
    return far <= ACT_REACH && Math.abs(e.y[c.ent]! - t.y[slot]!) <= ACT_REACH;
  }

  /**
   * The session's survivor leaves for world `to`. Returns why it cannot, or "" once it has gone: it is sealed in the folder, out
   * of this world, and its ticket goes to the session once that is saved. Refused before anything moves where it can be known.
   */
  leave(c: Client, to: number): string {
    const ctx = this.ctx!;
    const { records, items, rules, reg, persistence, tribes } = ctx;
    const rec = records.byPid.get(c.pid);
    if (!rec || c.ent < 0 || c.state !== SESSION_ALIVE || rec.dead) return "only a survivor in the world can travel";
    if (persistence.failing) return "this server cannot save just now, so nobody may leave it";
    if (to === this.world) return "you are on that server";
    const state = ctx.mayLeave(c, rec);
    if (state !== "") return state;
    // What it carries first, as ARK's message has it, then where it goes.
    items.inv(rec);
    const recs = this.carried(rec);
    const held = new Map<number, number>();
    for (const r of recs) items.held(r, held);
    for (const item of held.keys()) {
      const def = reg.defs[item] as ItemDef | undefined;
      if (def?.travels === false) return `you are carrying ${def.label ?? reg.ids[item]}, which cannot be transferred: drop such items and try again`;
    }
    if (held.size > 0 && rules.on("PreventUploadItems")) return "this server does not let things leave it: drop what you carry and try again";
    const dest = this.folder.announcement(to);
    if (!dest || dest.at <= this.now() - LIVE_MS) return `${dest?.name || `world ${to}`} is not running`;
    const why = this.whyNot(dest);
    if (why !== "") return why;
    if (held.size > 0 && !dest.items) return `${dest.name} takes no things from other servers: drop what you carry and try again`;
    const there = this.folder.names(to)?.get(rec.name);
    if (there !== undefined && there !== rec.pid) return `the name ${rec.name} belongs to another survivor on ${dest.name}`;
    const refused = ctx.bus.before(TRANSFER_OUT_EVENT, { op: "survivor", pid: rec.pid, what: rec.name });
    if (refused !== "") return refused;

    const ticket = crypto.getRandomValues(new Uint8Array(TICKET_BYTES));
    const id = hex(ticket.subarray(0, 16));
    const tribe = tribes.of(rec);
    const head: ParcelHead = {
      format: PARCEL_FORMAT,
      id,
      what: "survivor",
      from: this.world,
      to,
      name: rec.name,
      pid: rec.pid,
      hop: this.lastHop(rec.pid) + 1,
      tick: ctx.world.tick,
      made: this.now(),
      expires: this.now() + TICKET_SECONDS * 1000,
      ticket: sha256(ticket.subarray(16)),
      key: rec.keyHash ? hex(rec.keyHash) : "",
      content: reg.baseHash,
      tribe: tribe ? { team: tribe.id, name: tribe.name, owner: tribe.owner === rec.pid } : null,
      items: Object.fromEntries([...held].map(([item, n]) => [reg.ids[item]!, n])),
      pids: recs.map((r) => r.pid),
      seq: records.nextSeq,
      teams: records.nextTeam,
    };
    // Its clock stops as it leaves, as any survivor's does out of the world, and it goes from where it stands.
    ctx.suspend(rec, true);
    persistence.capture(rec, c.ent);
    try {
      this.folder.seal(id, this.world, sealParcel(reg, head, recs));
    } catch (err) {
      ctx.suspend(rec, false);
      ctx.say(`${rec.name} could not leave for ${dest.name}: ${err instanceof Error ? err.message : String(err)}`);
      return "the cluster's folder could not be written, so you have not left";
    }
    const conn = ctx.game.part(c);
    items.sentAway(held);
    for (const r of recs) {
      ctx.forget(r);
      records.delete(r.pid);
    }
    tribes.departed(rec);
    this.note(head, TRANSFER_OUT);
    this.away.set(rec.name, { id, pid: rec.pid, to, settled: false });
    persistence.afterCommit(() => ctx.game.travel(conn, ticket, to));
    ctx.say(`${rec.name} left for ${dest.name} by transfer ${id}`);
    return "";
  }

  /**
   * A survivor arrives with a ticket, for a session with this name and device key. Returns why not, or "" once it is here and
   * bound to that key: its file is taken, so nobody else can take it, and the next commit saves it here.
   */
  arrive(name: string, key: Uint8Array, ticket: Uint8Array): string {
    const ctx = this.ctx!;
    const id = hex(ticket.subarray(0, 16));
    const place = this.folder.place(id);
    const unknown = "no survivor of this cluster is travelling with that ticket";
    if (!place) return unknown;
    const parcel = this.read(place);
    if (!parcel) return "the travelling survivor's file is damaged, so it is left where it is for an operator";
    const head = parcel.head;
    if (sha256(ticket.subarray(16, TICKET_BYTES)) !== head.ticket) return unknown;
    if (head.name !== name) return `that ticket is for ${head.name}, not for ${name}`;
    // The device it was used for, joining again before it forgot the ticket, only joins: nothing moves.
    if (place.by === this.world) return place.key === hex(hashKey(key)) && ctx.records.byPid.has(head.pid) ? "" : "that ticket has been used";
    if (place.by === head.from) return `${head.name} went back to ${this.serverName(head.from)}`;
    if (place.by !== 0) return `that ticket was used on ${this.serverName(place.by)}`;
    if (head.to !== this.world) return `that ticket is for ${this.serverName(head.to)}`;
    if (head.expires !== 0 && this.now() >= head.expires) return `that ticket has expired, and ${head.name} goes back to ${this.serverName(head.from)}`;
    const why = this.refuses(head);
    if (why !== "") return why;
    let recs: EntityRecord[];
    try {
      recs = parcelRecords(ctx.reg, parcel);
    } catch (err) {
      return `${head.name} cannot come here: ${err instanceof Error ? err.message : String(err)}`;
    }
    const refused = ctx.bus.before(TRANSFER_IN_EVENT, { op: "survivor", what: head.name });
    if (refused !== "") return refused;
    const keyHash = hashKey(key);
    if (!this.folder.take(id, head.from, this.world, hex(keyHash))) return `${head.name} went back to ${this.serverName(head.from)}`;
    this.takeIn(parcel, recs, keyHash, false);
    ctx.bus.after(TRANSFER_DONE, { op: "survivor", what: head.name });
    ctx.say(`${head.name} came from ${this.serverName(head.from)} by transfer ${id}`);
    return "";
  }

  /** Why this server cannot take the survivor of `head`, or "". */
  private refuses(head: ParcelHead): string {
    const { rules, persistence, records } = this.ctx!;
    if (rules.on("PreventDownloadSurvivors") || rules.on("noTributeDownloads")) return "this server takes no survivors from other servers";
    if (Object.keys(head.items).length > 0 && rules.on("PreventDownloadItems")) return `this server takes no things from other servers, so ${head.name} must come carrying nothing`;
    const bound = persistence.survivors.get(head.name);
    if (bound !== undefined && bound !== head.pid) return `the name ${head.name} belongs to another survivor here`;
    if (records.byPid.has(head.pid)) return `${head.name} is here already`;
    return "";
  }

  /**
   * For a session that asks to join with no ticket. A survivor of this name that left from here and has not been taken comes
   * back for the device that owned it. Returns why the session cannot join as it asks, or "".
   */
  awayCheck(name: string, key: Uint8Array): string {
    const a = this.away.get(name);
    if (!a) return "";
    const place = this.folder.place(a.id);
    if (!place) return `${name} left for ${this.serverName(a.to)}, and the cluster's folder has no file of it: ask an operator`;
    if (place.by === this.world) return "";
    if (place.by !== 0) return `${name} is on ${this.serverName(place.by)}: travel back from there`;
    const parcel = this.read(place);
    if (!parcel) return `${name}'s file in the cluster's folder is damaged: ask an operator`;
    if (parcel.head.key === "" || hex(hashKey(key)) !== parcel.head.key) return `${name} is travelling to ${this.serverName(a.to)}`;
    return this.takeBack(parcel, false) ? "" : `${name} is on ${this.serverName(a.to)}: travel back from there`;
  }

  /**
   * The session's survivor came from another server and rises at the place it chose of those the spawn screen offered, alive,
   * with all it carried. Returns a RESULT code.
   */
  rise(c: Client, x: number, z: number, yaw: number, y?: number): number {
    if (!this.arriving.has(c.pid) || !this.ctx!.game.revive(c, x, z, yaw, y)) return RESULT_INVALID;
    this.arriving.delete(c.pid);
    this.arrivals.dirty = true;
    return RESULT_OK;
  }

  /** Takes a sealed transfer that left from here back. False if another server took it first, or this build cannot read it. */
  private takeBack(parcel: Parcel, loading: boolean): boolean {
    const head = parcel.head;
    let recs: EntityRecord[];
    try {
      recs = parcelRecords(this.ctx!.reg, parcel);
    } catch (err) {
      this.ctx!.say(`${head.name} cannot come back: ${err instanceof Error ? err.message : String(err)}; its file stays sealed for an operator`);
      return false;
    }
    if (!this.folder.take(head.id, head.from, this.world, head.key || NO_KEY)) return false;
    this.takeIn(parcel, recs, head.key ? unhex(head.key) : new Uint8Array(0), loading);
    return true;
  }

  /** Takes back what left from here and is past its ticket. `places` is the folder as it was just read. */
  private expire(places: readonly ParcelPlace[], loading: boolean): void {
    if (this.away.size === 0) return;
    const now = this.now();
    const where = new Map(places.map((p) => [p.id, p]));
    for (const [name, a] of this.away) {
      if (a.settled) continue;
      const place = where.get(a.id);
      if (!place) continue;
      if (place.by !== 0) {
        a.settled = true;
        continue;
      }
      const parcel = this.read(place);
      if (!parcel || parcel.head.expires === 0 || now < parcel.head.expires) continue;
      if (this.takeBack(parcel, loading)) this.ctx!.say(`${name}'s ticket to ${this.serverName(a.to)} ran out unused, so ${name} is back here`);
    }
  }

  /** Puts records that came by `parcel` in the world. `key` is the device key hash of whoever took it. */
  private takeIn(parcel: Parcel, recs: EntityRecord[], key: Uint8Array, loading: boolean): void {
    const ctx = this.ctx!;
    const { world, records, items, persistence } = ctx;
    const head = parcel.head;
    // Time passes for what it carries while it travels, as for a survivor out of the world. Its own clock was stopped.
    const transit = Math.max(0, Math.round(((this.now() - head.made) / 1000) * TICK_RATE));
    const delta = world.tick - head.tick - transit;
    for (const r of recs) rebaseTicks(r, delta);
    const rec = recs[0]!;
    if (key.length > 0) rec.keyHash = key.slice();
    // Every arrival, home included, chooses where it rises, at a spawn point or a bed of its tribe's, as on ARK's spawn screen,
    // and never where it last stood: that would let one leave from inside a base it broke into and come back inside it. Until
    // it chooses it is kept at the spawn point. One taken back from a ticket never used never left, as one that logs out and
    // in, so it stands where it was.
    if (head.from !== this.world) {
      rec.x = world.spawn.x;
      rec.z = world.spawn.z;
      rec.y = world.hf.heightAt(rec.x, rec.z);
      rec.yaw = world.spawn.yaw;
      this.arriving.add(rec.pid);
      this.arrivals.dirty = true;
    }
    for (const r of recs) {
      records.put(r);
      items.receive(r);
      if (pidWorld(r.pid) === this.world && pidSeq(r.pid) >= records.nextSeq) records.nextSeq = pidSeq(r.pid) + 1;
    }
    if (persistence.survivors.get(head.name) !== rec.pid) persistence.bindSurvivor(head.name, rec.pid);
    ctx.tribes.arrived(rec, head.tribe?.team === rec.team ? head.tribe.name : "", head.tribe?.owner ?? false);
    this.note(head, TRANSFER_IN);
    this.away.delete(head.name);
    if (!loading) ctx.adopt(rec);
  }

  /** The record and the records it carries: what its slots stand for (a fertilised egg). */
  private carried(rec: EntityRecord): EntityRecord[] {
    const out = [rec];
    const inv = rec.inv;
    for (let s = 0; inv?.ref && s < inv.cap; s++) {
      const ref = inv.ref[s]!;
      const r = ref !== 0 && inv.item[s] !== 0 ? this.ctx!.records.byPid.get(ref) : undefined;
      if (r && !out.includes(r)) out.push(r);
    }
    return out;
  }

  /** The highest hop a transfer of this record has had in this world's save. */
  private lastHop(pid: number): number {
    let hop = 0;
    for (const t of this.ctx!.persistence.transferRows) if (t.pid === pid && t.hop > hop) hop = t.hop;
    return hop;
  }

  private note(head: ParcelHead, dir: number): void {
    const row: TransferRow = { id: head.id, dir, pid: head.pid, name: head.name, hop: head.hop, peer: dir === TRANSFER_OUT ? head.to : head.from, at: this.now() };
    this.ctx!.persistence.noteTransfer(row);
  }

  /** The transfer in a file, or null, said once, if it is not whole. */
  private read(place: ParcelPlace): Parcel | null {
    const bytes = this.folder.read(place);
    if (!bytes) return null;
    try {
      return openParcel(bytes);
    } catch (err) {
      this.ctx?.say(`the cluster's file ${place.file} cannot be read: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Does over again, in order, every transfer in the folder that left this world or came to it and that the save does not
   * know: it was restored from before them, or stopped before it saved them. A survivor that left is given up again, and one
   * that came is taken in again, as its file has it.
   */
  private recover(): void {
    const ctx = this.ctx!;
    const known = new Set(ctx.persistence.transferRows.map((t) => `${t.id}/${t.dir}`));
    const events: { place: ParcelPlace; parcel: Parcel; dir: number }[] = [];
    for (const place of this.folder.places()) {
      const out = place.from === this.world && !known.has(`${place.id}/${TRANSFER_OUT}`);
      const into = place.by === this.world && !known.has(`${place.id}/${TRANSFER_IN}`);
      if (!out && !into) continue;
      const parcel = this.read(place);
      if (!parcel) {
        this.recovered.push(`transfer ${place.id} is damaged and was left as it is: what it carries is not here`);
        continue;
      }
      if (out) events.push({ place, parcel, dir: TRANSFER_OUT });
      if (into) events.push({ place, parcel, dir: TRANSFER_IN });
    }
    events.sort((a, b) => a.parcel.head.hop - b.parcel.head.hop || a.dir - b.dir);
    for (const e of events) {
      if (e.dir === TRANSFER_OUT) this.giveUpAgain(e.parcel.head);
      else this.takeInAgain(e.place, e.parcel);
    }
    for (const line of this.recovered) ctx.say(line);
  }

  /**
   * A survivor left this world by a transfer the save does not know. Whatever the save holds of it goes, and the ledger counts
   * what the transfer carried as sent; where the save held other than that, the difference is counted as minted or burned.
   */
  private giveUpAgain(head: ParcelHead): void {
    const { records, items, tribes, reg } = this.ctx!;
    const rec = records.byPid.get(head.pid);
    const recs = rec ? this.carried(rec) : [];
    const had = new Map<number, number>();
    for (const r of recs) items.held(r, had);
    const carried = new Map<number, number>();
    for (const [id, n] of Object.entries(head.items)) {
      const item = reg.index.get(id) ?? reg.redirects.get(id)?.[0];
      if (item !== undefined) carried.set(item, (carried.get(item) ?? 0) + n);
    }
    let differs = false;
    for (const item of new Set([...had.keys(), ...carried.keys()])) {
      const d = (carried.get(item) ?? 0) - (had.get(item) ?? 0);
      if (d === 0) continue;
      items.adjust(item, d);
      differs = true;
    }
    items.sentAway(carried);
    if (rec) tribes.departed(rec);
    if (this.arriving.delete(head.pid)) this.arrivals.dirty = true;
    for (const r of recs) records.delete(r.pid);
    if (head.seq > records.nextSeq) records.nextSeq = head.seq;
    if (head.teams > records.nextTeam) records.nextTeam = head.teams;
    this.note(head, TRANSFER_OUT);
    const lost = rec ? "" : ", which this save did not have";
    this.recovered.push(`${head.name} left for ${this.serverName(head.to)} by transfer ${head.id}, which this save did not know: given up again${lost}${differs ? "; what the save held of it and what the transfer carried differ, and the ledger counts the difference as the restore's" : ""}`);
  }

  /** A survivor came by a transfer the save does not know: it is taken in again as its file has it, or sealed again to go back. */
  private takeInAgain(place: ParcelPlace, parcel: Parcel): void {
    const { records, items, reg } = this.ctx!;
    const head = parcel.head;
    let recs: EntityRecord[];
    try {
      recs = parcelRecords(reg, parcel);
    } catch (err) {
      const sealed = this.folder.untake(place);
      this.recovered.push(`${head.name} came by transfer ${head.id}, which this save did not know, and cannot be kept: ${err instanceof Error ? err.message : String(err)}; ${sealed ? `it is sealed again, to go back to ${this.serverName(head.from)}` : "its file has moved"}`);
      return;
    }
    const old = records.byPid.get(head.pid);
    if (old) {
      // The save has it although the folder says it came after it left: the transfer's is the later.
      for (const r of this.carried(old)) {
        for (const [item, n] of items.held(r)) items.adjust(item, -n);
        records.delete(r.pid);
      }
    }
    this.takeIn(parcel, recs, place.key === NO_KEY ? new Uint8Array(0) : unhex(place.key), this.resumes);
    this.recovered.push(`${head.name} came from ${this.serverName(head.from)} by transfer ${head.id}, which this save did not know: taken in again`);
  }

  /** Names whose survivor's last transfer took it away from here. */
  private rebuildAway(): void {
    const { persistence, records } = this.ctx!;
    const last = new Map<number, TransferRow>();
    for (const t of persistence.transferRows) {
      const was = last.get(t.pid);
      if (!was || t.hop > was.hop || (t.hop === was.hop && t.dir > was.dir)) last.set(t.pid, t);
    }
    for (const t of last.values()) if (t.dir === TRANSFER_OUT && !records.byPid.has(t.pid)) this.away.set(t.name, { id: t.id, pid: t.pid, to: t.peer, settled: false });
  }
}
