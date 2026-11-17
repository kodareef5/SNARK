// Riding a creature. A saddled creature is a host with the seats its saddle declares (shared/sim/seats.ts), and who sits
// in them is occupancy's (server/occupancy.ts), as a car's seats are for server/urban.ts: getting on and off are short
// claims checked when pressed and again when they land, and whoever gets off is set where it fits beside the mount.
// The rider's inputs drive the mount's body in place of its own (GameServer.take, D73). A rider stays its own entity (D74),
// unstepped and pinned each tick in its seat's whole frame on the posed mount, where every client draws it and it is hit.
// There is no carjacking a creature: ARK has none.

import { bodySeed, AnimState } from "../shared/anim/pose.ts";
import { seatOn, SEAT_FLOATS } from "../shared/anim/seat.ts";
import { OccupantBody } from "../shared/anim/occupant.ts";
import type { PackRig } from "../shared/pack/pack.ts";
import { makeHandle } from "../shared/ids.ts";
import { TAU } from "../shared/math/scalar.ts";
import { RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OBSTRUCTED, RESULT_OK, RESULT_SHORT, SESSION_ALIVE, TEXT_NOTICE } from "../shared/net/protocol.ts";
import type { Connection } from "../shared/net/transport.ts";
import { Body, MODE_FLYER, MODE_SWIM, MODE_WALK, STANCE_CROUCH } from "../shared/sim/character.ts";
import { F_ALIVE, F_GROUNDED } from "../shared/sim/entities.ts";
import type { Seat } from "../shared/sim/seats.ts";
import { capsuleFree, groundUnder } from "../shared/world/collide.ts";
import { event } from "./events/bus.ts";
import type { Client, GameServer } from "./game.ts";
import { Occupancy, type OccupancyAction, type OccupancyApproval, type OccupancyEffect } from "./occupancy.ts";
import type { EntityRecord, Records } from "./records.ts";
import { Seating, type Point } from "./seating.ts";
import type { Tribes } from "./tribes.ts";
import type { ServerWorld } from "./world.ts";

/** Metres from the creature's centre, on top of its body radius. */
const MOUNT_REACH = 3.5;
/** Metres over the water's surface within which a flyer's feet touch it. A flyer over deep water skims at the surface. */
const WET = 0.01;
/** Ticks from the press to the seat, getting on or off. */
const SEAT_TICKS = 4;
/** On foot, a rider is set down no further than this below its mount's feet: never off a ledge. */
const DROP = 1.2;

/** A claim's end in a rider's words. */
const WHY: Readonly<Record<string, string>> = {
  "too-far": "it is out of reach",
  "landing-blocked": "there is no room to get off",
  "not-ready": "it cannot be ridden now",
  "not-yours": "it is not your tribe's",
  "driven": "someone else steers it",
  "seat-changed": "the seat was taken",
  "occupant-changed": "the seat was taken",
  "host-invalid": "it cannot be ridden now",
  "actor-invalid": "you cannot ride now",
  "unconscious": "you were knocked out",
};

const RIDE_MOUNT = event("ride.mount");
const RIDE_DISMOUNT = event("ride.dismount");

export interface RidingContext {
  readonly world: ServerWorld;
  readonly rigs?: readonly PackRig[];
  readonly game: GameServer;
  readonly records: Records;
  readonly tribes: Tribes;
  /** Recomputes what derives from a record. Riding calls it for a mount's load when a rider gets on or off. */
  refresh(rec: EntityRecord): void;
  /** Whether a bola holds the body (server/entangle.ts): "creatures cannot be mounted while immobilized by the Bola" (Bola), nor does a held survivor get on. */
  tangled?(rec: EntityRecord): boolean;
}

/** A saddled creature with seats, and where it stood when last seen: where its riders get off, though it be gone by then. */
interface Host { entity: number; handle: number; saddle: number; seats: readonly Seat[]; last: Point & { yaw: number } }
interface Scope { epoch: number; request: number; connection: Connection | null }

export class Riding {
  mounted = 0;
  dismounted = 0;
  readonly occupancy: Occupancy;
  private readonly ctx: RidingContext;
  private readonly occupant: OccupantBody;
  private readonly seating: Seating;
  /** By the mount's record id. */
  private readonly hosts = new Map<number, Host>();
  /** By the record id of whoever sits in a seat or is getting on or off one. */
  private readonly scopes = new Map<number, Scope>();
  private epochs = 0;
  /** The stance the landing of the exit being committed was found for. */
  private landed = { action: 0, stance: 0 };
  private stopping = false;
  private readonly st = new AnimState();
  private readonly body = new Body();
  private readonly frame = new Float64Array(SEAT_FLOATS);

  constructor(ctx: RidingContext) {
    this.ctx = ctx;
    this.occupant = new OccupantBody(ctx.rigs);
    this.seating = new Seating(ctx.world, ctx.records);
    const { world, records, tribes } = ctx;
    this.occupancy = new Occupancy({
      actor: (pid) => {
        const e = this.seating.entity(pid), rec = records.byPid.get(pid);
        // A bola'd rider stays on, and steers (D450); one knocked out does neither.
        return e < 0 || !rec ? null : { handle: makeHandle(e, world.ents.gen[e]!), alive: !rec.dead, ready: !rec.out };
      },
      host: (pid) => {
        const host = this.hosts.get(pid), e = host ? this.live(pid, host) : -1, rec = records.byPid.get(pid);
        return e < 0 || !rec ? null : { handle: host!.handle, ready: !rec.dead && !rec.out, speed: Math.hypot(world.ents.vx[e]!, world.ents.vz[e]!) };
      },
      check: (action, phase) => this.check(action, phase),
      canControl: (actor, host) => tribes.may(records.byPid.get(actor), records.byPid.get(host)?.team ?? 0),
      // A mount may be got onto moving, as before, if it is in reach when the claim begins and when it lands.
    }, { runtimeEpoch: 1, maxHosts: 1 << 16, maxActors: 1 << 16, maxInteractionSpeed: 1e6 });
  }

  /** The record of whoever sits in the seat that steers creature `e`, or null. */
  riderOf(e: number): EntityRecord | null {
    const ents = this.ctx.world.ents, pid = ents.pid[e]!, host = this.hosts.get(pid);
    if (!host || this.live(pid, host) !== e) return null;
    const seat = host.seats.find((s) => s.driver)!;
    const actor = this.occupancy.occupant(pid, seat.id);
    return actor && this.seated(actor, pid, seat.id) >= 0 ? (this.ctx.records.byPid.get(actor) ?? null) : null;
  }

  /** Whether the session sits on a creature, steering or not. */
  riding(c: Client): boolean {
    const place = this.occupancy.seatOf(c.pid);
    return place !== null && this.hosts.has(place.host);
  }

  /** Who sits on creature `e` or is getting on it: what weighs on it besides its own inventory. */
  riders(e: number): EntityRecord[] {
    const { world, records } = this.ctx, pid = world.ents.pid[e]!, host = this.hosts.get(pid), out: EntityRecord[] = [];
    if (!host || this.live(pid, host) !== e) return out;
    for (const seat of host.seats) {
      const actor = this.occupancy.occupant(pid, seat.id);
      const rec = actor && this.seated(actor, pid, seat.id) >= 0 ? records.byPid.get(actor) : undefined;
      if (rec) out.push(rec);
    }
    for (const actor of this.scopes.keys()) {
      const action = this.occupancy.pending(actor);
      const rec = action?.kind === "enter" && action.host === pid ? records.byPid.get(actor) : undefined;
      if (rec) out.push(rec);
    }
    return out;
  }

  /** Whether anyone sits on creature `e` or is getting on or off it, so its saddle stays on. */
  occupied(e: number): boolean {
    const pid = this.ctx.world.ents.pid[e]!, host = this.hosts.get(pid);
    if (!host || this.live(pid, host) !== e) return false;
    for (const seat of host.seats) if (this.occupancy.occupant(pid, seat.id) !== 0) return true;
    for (const actor of this.scopes.keys()) if (this.occupancy.pending(actor)?.host === pid) return true;
    return false;
  }

  /** Returns a RESULT code. Getting on takes SEAT_TICKS: the steering seat if it is free, else a free passenger's. */
  mount(c: Client, e: number): number {
    const { world, game, records, tribes } = this.ctx;
    const ents = world.ents;
    const me = records.byPid.get(c.pid);
    if (!me || c.state !== SESSION_ALIVE || c.ent < 0 || me.out || c.drive >= 0 || ents.seat[c.ent] !== 0 || this.occupancy.seatOf(c.pid)) return RESULT_DENIED;
    const rec = e >= 0 && (ents.flags[e]! & F_ALIVE) !== 0 ? records.byPid.get(ents.pid[e]!) : undefined;
    if (!rec || rec.keyHash !== null || world.reg.defs[rec.kind]?.type !== "species" || world.reg.vehicle[rec.kind]) return RESULT_INVALID;
    if (rec.team === 0 || !tribes.may(me, rec.team)) return RESULT_NOT_YOURS;
    if (rec.saddle === 0) return RESULT_SHORT;
    if (rec.out || this.ctx.tangled?.(rec) || this.ctx.tangled?.(me)) return RESULT_DENIED;
    if (this.occupancy.pending(c.pid)) return RESULT_BUSY;
    if (this.far(c.ent, e)) return RESULT_FAR;
    if (!this.register(e)) return RESULT_INVALID;
    const host = this.hosts.get(rec.pid)!;
    const free = (seat: Seat): boolean => this.occupancy.occupant(rec.pid, seat.id) === 0 && ![...this.scopes.keys()].some((a) => {
      const action = this.occupancy.pending(a);
      return action?.host === rec.pid && action.seat === seat.id;
    });
    const seat = host.seats.find((s) => s.driver && free(s)) ?? host.seats.find((s) => !s.driver && free(s));
    if (!seat) return RESULT_BUSY;
    const refused = game.bus.before(RIDE_MOUNT, { pid: me.pid, mount: rec.pid });
    if (refused !== "") {
      game.sendText(c, TEXT_NOTICE, refused);
      return RESULT_DENIED;
    }
    const result = this.begin(c.pid, rec.pid, seat.id, "enter");
    // Who is getting on weighs on the mount from the start, as who is getting off does until the end.
    if (result === RESULT_OK) this.ctx.refresh(rec);
    return result;
  }

  /** Gets off whatever creature the session sits on, in SEAT_TICKS, to where it fits; or stops getting on. */
  dismount(c: Client): void {
    const tick = this.ctx.world.tick;
    for (const effect of this.occupancy.cancel(c.pid, tick)) this.apply(effect);
    const place = this.occupancy.seatOf(c.pid);
    if (!place || !this.hosts.has(place.host)) return;
    const result = this.begin(c.pid, place.host, place.seat, "exit");
    if (result !== RESULT_OK) this.ctx.game.notify(c, result);
  }

  /** Seats are not saved. Before a seated body leaves the world, and for everyone as the server stops, it is put off. */
  standDown(pid: number): void {
    const place = this.occupancy.seatOf(pid);
    if (place && this.hosts.has(place.host)) this.putOff(pid, false);
    else for (const effect of this.occupancy.cancel(pid, this.ctx.world.tick)) this.apply(effect);
  }

  /** As the server stops: a flyer is saved flying, and loaded it sets down as one whose rider went quiet does. */
  standDownAll(): void {
    this.stopping = true;
    for (const pid of [...this.scopes.keys()]) this.standDown(pid);
    this.stopping = false;
  }

  /** Commits getting on and off before the players' inputs drive any body. Call once a tick, before they move. */
  beforeStep(): void {
    const { world, records } = this.ctx;
    for (const [pid, host] of this.hosts) if (this.live(pid, host) < 0) this.evict(pid);
    for (const pid of [...this.scopes.keys()]) {
      const rec = records.byPid.get(pid);
      if (!rec || rec.dead || this.seating.entity(pid) < 0) {
        for (const effect of this.occupancy.invalidateActor(pid, world.tick)) this.apply(effect);
        continue;
      }
      if (rec.out) {
        for (const effect of this.occupancy.cancel(pid, world.tick, "unconscious")) this.apply(effect);
        continue;
      }
      this.scope(pid);
    }
    for (const effect of this.occupancy.step(world.tick)) this.apply(effect);
    // Scopes and hosts are kept only while someone sits or is getting on or off, so the work here follows riding, not
    // everyone who ever rode.
    for (const pid of [...this.scopes.keys()]) {
      if (!this.occupancy.idle(pid)) continue;
      this.occupancy.retireActor(pid, world.tick);
      this.scopes.delete(pid);
    }
    for (const [pid, host] of this.hosts) if (!this.occupied(host.entity) && this.occupancy.removeHost(pid)) this.hosts.delete(pid);
  }

  /**
   * Call once a tick, after every body has moved. A rider is pinned to its seat, or put off: one knocked out, whose mount is
   * knocked out, dead or gone, who is no longer of its tribe, whose connection dropped, or whose flyer touched water.
   */
  step(): void {
    if (this.hosts.size === 0) return;
    const { world, records, tribes } = this.ctx;
    const ents = world.ents;
    for (const [pid, host] of [...this.hosts]) {
      const e = this.live(pid, host), rec = records.byPid.get(pid);
      if (e < 0 || !rec || rec.saddle !== host.saddle) {
        this.evict(pid);
        continue;
      }
      host.last.x = ents.x[e]!;
      host.last.y = ents.y[e]!;
      host.last.z = ents.z[e]!;
      host.last.yaw = ents.yaw[e]!;
      const wet = this.wet(e);
      for (const seat of host.seats) {
        const actor = this.occupancy.occupant(pid, seat.id);
        if (!actor) continue;
        const me = records.byPid.get(actor), c = this.client(actor);
        const gone = !c || !c.active || c.closed || c.ent < 0 || c.state !== SESSION_ALIVE || (seat.driver === true && c.drive !== e);
        if (!me || me.out || rec.out || gone || !tribes.may(me, rec.team)) this.putOff(actor, false);
        else if (wet) this.putOff(actor, true);
        else this.pin(actor, host, seat);
      }
    }
  }

  /** After a contact moves a surviving mount. Preserve the earlier pre-combat pin and all occupancy claim timing. */
  syncAfterContact(e: number): void {
    const ents = this.ctx.world.ents, pid = ents.pid[e]!, host = this.hosts.get(pid);
    if (!host || this.live(pid, host) !== e) return;
    host.last.x = ents.x[e]!; host.last.y = ents.y[e]!; host.last.z = ents.z[e]!; host.last.yaw = ents.yaw[e]!;
    for (const seat of host.seats) {
      const actor = this.occupancy.occupant(pid, seat.id);
      if (actor) this.pin(actor, host, seat);
    }
  }

  /** Before vital deadlines: read the posed eye from the current host, even if the rider has not been pinned yet. */
  eye(e: number, out: Float64Array): boolean {
    const world = this.ctx.world, ents = world.ents, carrier = ents.seat[e]! - 1;
    if (carrier < 0 || ents.seatGen[e] !== ents.gen[carrier]) return false;
    const pid = ents.pid[carrier]!, host = this.hosts.get(pid), seat = host?.seats[ents.seatSlot[e]! - 1];
    if (!host || !seat || this.live(pid, host) !== carrier || this.seated(ents.pid[e]!, pid, seat.id) !== e) return false;
    this.frameOn(host, seat);
    this.st.unpack(ents.anim[e]!, ents.cue[e]!);
    this.st.seed = bodySeed(e);
    const definition = world.reg.defs[ents.kind[e]!];
    const rest = this.occupant.rest(definition?.type === "species" ? definition.mesh : "human");
    this.occupant.saddle(world.anim, this.st, world.tick, this.frame, seat.driver === true, ents.yaw[e]! * TAU / 65536, rest);
    this.occupant.eye(out);
    return true;
  }

  /** Registers a saddled creature as a host of its saddle's seats. */
  private register(e: number): boolean {
    const { world, records } = this.ctx, ents = world.ents, pid = ents.pid[e]!, rec = records.byPid.get(pid);
    const seats = rec ? world.reg.saddleSeats[rec.saddle] : null;
    if (!rec || !seats || (ents.flags[e]! & F_ALIVE) === 0) return false;
    const handle = makeHandle(e, ents.gen[e]!), known = this.hosts.get(pid);
    if (known?.handle === handle && known.saddle === rec.saddle) return true;
    if (known) this.evict(pid);
    this.occupancy.addHost(pid, handle, seats);
    this.hosts.set(pid, { entity: e, handle, saddle: rec.saddle, seats, last: { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, yaw: ents.yaw[e]! } });
    return true;
  }

  /** The host's entity if it is still the creature that was registered, else -1. */
  private live(pid: number, host: Host): number {
    const e = this.seating.entity(pid);
    return e === host.entity && makeHandle(e, this.ctx.world.ents.gen[e]!) === host.handle ? e : -1;
  }

  /** The entity of `actor` if it is the body that took seat `seat` on `host`, else -1. */
  private seated(actor: number, host: number, seat: string): number {
    const e = this.seating.entity(actor);
    return e >= 0 && makeHandle(e, this.ctx.world.ents.gen[e]!) === this.occupancy.occupantHandle(host, seat) ? e : -1;
  }

  private far(body: number, e: number): boolean {
    const { world } = this.ctx, ents = world.ents;
    return Math.hypot(ents.x[e]! - ents.x[body]!, ents.z[e]! - ents.z[body]!) > MOUNT_REACH + world.reg.bodyRadius[ents.kind[e]!]!;
  }

  private client(pid: number): Client | null {
    return this.ctx.game.clients.find((c) => c?.pid === pid && c.ent >= 0) ?? null;
  }

  private scope(pid: number): Scope {
    const connection = this.client(pid)?.conn ?? null;
    let scope = this.scopes.get(pid);
    // Epochs come from one counter, so a scope retired and made again never reuses one.
    if (!scope) {
      scope = { epoch: ++this.epochs, request: 1, connection };
      this.scopes.set(pid, scope);
      for (const effect of this.occupancy.bindActor(pid, scope.epoch, this.ctx.world.tick)) this.apply(effect);
    } else if (scope.connection !== connection) {
      // A rider whose connection dropped and came back is no longer seated.
      if (this.occupancy.seatOf(pid)) this.putOff(pid, false);
      scope.connection = connection;
      scope.epoch = ++this.epochs;
      scope.request = 1;
      for (const effect of this.occupancy.bindActor(pid, scope.epoch, this.ctx.world.tick)) this.apply(effect);
    }
    return scope;
  }

  private begin(actor: number, host: number, seat: string, kind: "enter" | "exit"): number {
    const scope = this.scope(actor);
    const result = this.occupancy.begin({ actor, actorEpoch: scope.epoch, requestId: scope.request++, host, seat, kind }, this.ctx.world.tick, SEAT_TICKS);
    if (result.ok) return RESULT_OK;
    if (result.reason === "too-far") return RESULT_FAR;
    if (result.reason === "not-yours") return RESULT_NOT_YOURS;
    if (result.reason === "claimed" || result.reason === "occupied" || result.reason === "driven") return RESULT_BUSY;
    if (result.reason.includes("blocked") || result.reason === "landing-required") return RESULT_OBSTRUCTED;
    return RESULT_DENIED;
  }

  private check(action: Readonly<OccupancyAction>, phase: "begin" | "commit"): OccupancyApproval {
    const { world, records, tribes } = this.ctx, ents = world.ents;
    if (action.kind === "carjack") return { ok: false, reason: "no-carjack" };
    const host = this.hosts.get(action.host), e = host ? this.live(action.host, host) : -1, ae = this.seating.entity(action.actor);
    const seat = host?.seats.find((s) => s.id === action.seat);
    const rec = records.byPid.get(action.host), me = records.byPid.get(action.actor);
    if (!host || e < 0 || ae < 0 || !seat || !rec || !me) return { ok: false, reason: "missing" };
    if (action.kind === "exit") {
      const found = this.landing(e, seat, ae);
      if (!found) return { ok: false, reason: "landing-blocked" };
      if (phase === "commit") this.landed = { action: action.id, stance: found.stance };
      return { ok: true, landing: { x: found.x, y: found.y, z: found.z, yaw: (ents.yaw[e]! / 65536) * TAU } };
    }
    const c = this.client(action.actor);
    if (c && (c.drive >= 0 || c.state !== SESSION_ALIVE || c.closed || ents.seat[ae] !== 0)) return { ok: false, reason: "actor-busy" };
    // Checked again when it lands: a tribe change, a bola or a saddle taken off meanwhile still refuses it.
    if (rec.team === 0 || !tribes.may(me, rec.team)) return { ok: false, reason: "not-yours" };
    if (rec.saddle !== host.saddle || rec.grown !== 0 || this.ctx.tangled?.(rec) || this.ctx.tangled?.(me)) return { ok: false, reason: "not-ready" };
    if (seat.driver && ents.driven[e] !== 0) return { ok: false, reason: "driven" };
    if (this.far(ae, e)) return { ok: false, reason: "too-far" };
    return { ok: true };
  }

  /**
   * Where the body `ae` getting off seat `seat` of creature `e` can be set, and in what stance: beside the seat's side, the
   * other side, behind, ahead, or where the mount stands, each reached from where the mount stands through nothing but
   * the mount. On foot it is never set further than DROP above what is under it; in the air or the water it is set at the
   * mount's height, to fall or swim from there. Null where it fits nowhere.
   */
  private landing(e: number, seat: Seat, ae: number): (Point & { stance: number }) | null {
    const { world } = this.ctx, ents = world.ents;
    const p = world.reg.move[ents.kind[ae]!]!;
    const x = ents.x[e]!, y = ents.y[e]!, z = ents.z[e]!;
    const a = (ents.yaw[e]! / 65536) * TAU, s = Math.sin(a), co = Math.cos(a);
    const off = world.reg.bodyRadius[ents.kind[e]!]! + p.radius + 0.25;
    const side = seat.entry[0] >= 0 ? 1 : -1, wide = Math.max(Math.abs(seat.entry[0]), off), along = seat.entry[2];
    const afloat = ents.mode[e] === MODE_FLYER || ents.mode[e] === MODE_SWIM || (ents.flags[e]! & F_GROUNDED) === 0;
    const from = { x, y, z };
    const host = ents.pid[e]!;
    for (const [lx, lz] of [[side * wide, along], [-side * wide, along], [0, -off], [side * wide, -off], [-side * wide, -off], [side * wide, off], [-side * wide, off], [0, off], [0, 0]] as const) {
      const px = x + co * lx + s * lz, pz = z + co * lz - s * lx;
      const py = afloat ? y : Math.max(y, groundUnder(world.hf, px, pz, p.radius));
      // Nothing within DROP under it is a ledge, or a cliff.
      if (!afloat && capsuleFree(world, px, py - DROP, pz, p.radius, DROP)) continue;
      const at = { x: px, y: py, z: pz };
      const stance = this.seating.stance(ae, from, at, host, lx === 0 && lz === 0);
      if (stance >= 0) return { ...at, stance };
    }
    return null;
  }

  /** Puts `actor` off its creature now: the seat is freed and the body set where it fits, or where it is, crouched. */
  private putOff(actor: number, wet: boolean): void {
    for (const effect of this.occupancy.remove(actor, this.ctx.world.tick)) this.apply(effect, wet);
  }

  /** Puts everyone off a creature whose entity is gone or no longer wears the saddle its seats were, and forgets it. */
  private evict(pid: number): void {
    for (const effect of this.occupancy.evictHost(pid, this.ctx.world.tick)) this.apply(effect);
    this.hosts.delete(pid);
  }

  private apply(effect: OccupancyEffect, wet = false): void {
    const { world, game, records } = this.ctx, ents = world.ents;
    if (effect.type === "cancel") {
      const c = this.client(effect.action.actor);
      if (c && !c.closed && effect.reason !== "actor-removed" && effect.reason !== "host-removed") game.sendText(c, TEXT_NOTICE, `${effect.action.kind === "exit" ? "Getting off" : "Getting on"} stopped: ${WHY[effect.reason] ?? effect.reason}`);
      // Who was getting on weighs on the mount no more.
      const rec = records.byPid.get(effect.action.host);
      if (rec && effect.action.kind === "enter") this.ctx.refresh(rec);
      return;
    }
    const host = this.hosts.get(effect.type === "commit" ? effect.action.host : effect.host);
    if (!host) return;
    const action = effect.type === "commit" ? effect.action : null;
    const actor = action ? action.actor : (effect as { actor: number }).actor;
    const actorHandle = action ? action.actorHandle : (effect as { actorHandle: number }).actorHandle;
    const slot = host.seats.findIndex((s) => s.id === (action ? action.seat : (effect as { seat: string }).seat));
    const seat = host.seats[slot]!;
    const c = this.client(actor);
    const ae = this.seating.entity(actor);
    const body = ae >= 0 && makeHandle(ae, ents.gen[ae]!) === actorHandle ? ae : -1;
    const rec = records.byPid.get(effect.type === "commit" ? effect.action.host : effect.host);
    if (action?.kind === "enter") {
      if (body < 0) return;
      if (seat.driver && c && !game.take(c, host.entity)) console.error(`creature ${action.host}: validated mounting by ${actor} was refused`);
      ents.setSeat(body, host.entity, slot + 1);
      // A seated body is still. The crouch stance gives it the eye and height of one sitting.
      ents.vx[body] = ents.vy[body] = ents.vz[body] = 0;
      ents.stance[body] = STANCE_CROUCH;
      this.pin(actor, host, seat);
      this.mounted++;
      if (c) {
        c.open = 0;
        c.ownDirty = true;
      }
      if (rec) this.ctx.refresh(rec);
      return;
    }
    // Getting off, or put off.
    const e = this.live(rec?.pid ?? 0, host);
    if (seat.driver && c && c.drive === host.entity) game.release(c);
    // A flyer let go of in the air stops flying and falls, hurt once as any fall is (ASE 203.1); put off by water, it floats.
    if (seat.driver && e >= 0 && ents.mode[e] === MODE_FLYER && !this.stopping) ents.mode[e] = wet ? MODE_SWIM : MODE_WALK;
    if (body >= 0) {
      ents.setSeat(body, -1);
      if (action && effect.type === "commit" && effect.landing) {
        ents.setPosition(body, effect.landing.x, effect.landing.y, effect.landing.z);
        ents.stance[body] = this.landed.action === action.id ? this.landed.stance : STANCE_CROUCH;
      } else if (e >= 0) {
        const found = this.landing(e, seat, body);
        if (found) {
          ents.setPosition(body, found.x, found.y, found.z);
          ents.stance[body] = found.stance;
        } else ents.stance[body] = STANCE_CROUCH;
      } else {
        // The mount is gone: set down where it last stood, or as near as there is room.
        const l = host.last;
        this.seating.standAt(body, l, [l], 0);
      }
      ents.vx[body] = ents.vy[body] = ents.vz[body] = 0;
      ents.pose(body, world.tick);
      records.dirty.add(actor);
    }
    game.bus.after(RIDE_DISMOUNT, { pid: actor, mount: rec?.pid ?? 0 });
    this.dismounted++;
    if (c) c.ownDirty = true;
    if (rec && e >= 0) this.ctx.refresh(rec);
  }

  /** Moves the seated body of `actor` to its seat on its mount, as the mount is posed. One that steers faces as its mount does. */
  private pin(actor: number, host: Host, seat: Seat): void {
    const world = this.ctx.world, ents = world.ents, e = host.entity;
    const body = this.seated(actor, ents.pid[e]!, seat.id);
    if (body < 0) return;
    const frame = this.frame;
    this.frameOn(host, seat);
    const b = this.body;
    ents.loadBody(body, b);
    b.x = frame[0]!;
    b.y = frame[1]!;
    b.z = frame[2]!;
    if (seat.driver) b.yaw = ents.yaw[e]!;
    b.vx = ents.vx[e]!;
    b.vy = ents.vy[e]!;
    b.vz = ents.vz[e]!;
    b.stance = STANCE_CROUCH;
    ents.storeBody(body, b);
    ents.pose(body, world.tick);
  }

  private frameOn(host: Host, seat: Seat): void {
    const world = this.ctx.world, ents = world.ents, e = host.entity, st = this.st;
    st.unpack(ents.anim[e]!, ents.cue[e]!);
    st.seed = bodySeed(e);
    seatOn(world.anims[ents.kind[e]!] ?? null, seat, st, world.tick, ents.x[e]!, ents.y[e]!, ents.z[e]!, (ents.yaw[e]! / 65536) * TAU, this.frame);
  }

  /** Whether `e`, if it flies, touches water: swimming, or in flight with its feet at or under the surface over water. */
  private wet(e: number): boolean {
    const world = this.ctx.world;
    const ents = world.ents;
    const kind = ents.kind[e]!;
    if (world.reg.flies[kind] !== 1) return false;
    if (ents.mode[e] === MODE_SWIM) return true;
    const sea = world.hf.waterAt(ents.x[e]!, ents.z[e]!);
    return ents.mode[e] === MODE_FLYER && ents.y[e]! <= sea + WET && groundUnder(world.hf, ents.x[e]!, ents.z[e]!, world.reg.bodyRadius[kind]!) < sea;
  }
}
