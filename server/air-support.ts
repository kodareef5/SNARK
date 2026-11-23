import { TICK_DT, TICK_RATE } from "../shared/coords.ts";
import { BitWriter, type BitReader } from "../shared/net/codec.ts";
import { makeHandle } from "../shared/ids.ts";
import {
  RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_NOT_YOURS,
  RESULT_OBSTRUCTED, RESULT_OK, RESULT_SHORT, RESULT_WAIT, SESSION_ALIVE, S_AIR_SUPPORT, TEXT_NOTICE,
} from "../shared/net/protocol.ts";
import { AIR_ACTION, AIR_BAYS, AIR_PHASE, AIR_VIEW_LIMIT, emptyAirSupport, writeAirSupport,
  type AirCarrier, type AirPod, type AirPose, type AirSupportView } from "../shared/sim/air-support.ts";
import { F_ALIVE, F_GROUNDED, F_PROP } from "../shared/sim/entities.ts";
import { isWheelVehicle, type WheelVehicleDefinition } from "../shared/sim/vehicle.ts";
import { AIR_TRAILER_ART as T } from "../content/vehicles/air-freight-art.ts";
import { CargoSpace, angle, framePoint, hitchedPose, isTrailer, offset, type Frame } from "./air-cargo-space.ts";
import { AirFlights, type AirFlightContext } from "./air-flight.ts";
import type { Client } from "./game.ts";
import type { Hitches } from "./hitches.ts";
import type { Urban } from "./urban.ts";

export interface AirSupportContext extends Omit<AirFlightContext, "valid"> {
  urban: Urban;
  hitches: Hitches;
  /** Parks a vehicle of kind `id`, owned by `team`, at this frame; returns its entity or -1. */
  spawn(id: string, at: Frame, team: number): number;
  /** Takes a vehicle out of the world for good. */
  discard(e: number): void;
}
/** A drone rack: the bays and panels of one trailer. `id` is small, for the wire; `pid` is the trailer's record. */
interface Rack { id: number; pid: number; owner: number; team: number; open: number; opening: boolean; slots: number; selected: number }
interface Order extends AirCarrier {
  owner: number; team: number; rig: number; ground: AirPose | null; since: number; wait: number; still: number;
  mark: AirPose | null; edge: AirPose; speed: number; stop: number; stock: number;
}
interface SavedAir { next: number; racks: Rack[]; calls: Order[]; cooldown: [number, number][] }
const P = AIR_PHASE, A = AIR_ACTION;
const FAR_VIEW = 560;
/** Faster than this, metres a second, a trailer closes its rack for the road. */
const ROLLING = .6;
const distance = (a: AirPose, b: AirPose) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const finite = (p: AirPose) => Number.isFinite(p.x + p.y + p.z + p.yaw);

function moveTo(p: AirPose, goal: AirPose, speed: number, turn = 1.8): boolean {
  const d = distance(p, goal), t = Math.min(1, speed * TICK_DT / Math.max(.001, d));
  p.x += (goal.x - p.x) * t; p.y += (goal.y - p.y) * t; p.z += (goal.z - p.z) * t;
  const delta = angle(goal.yaw - p.yaw);
  p.yaw += Math.max(-turn * TICK_DT, Math.min(turn * TICK_DT, delta));
  return d <= speed * TICK_DT + .005 && Math.abs(delta) < .03;
}

export class AirSupport {
  readonly racks = new Map<number, Rack>();
  readonly calls = new Map<number, Order>();
  readonly flights: AirFlights;
  readonly saved = { dirty: false, serialize: () => JSON.stringify({
    next: this.next, racks: [...this.racks.values()], calls: [...this.calls.values()], cooldown: [...this.cooldown],
  } satisfies SavedAir) };
  private readonly cooldown = new Map<number, number>();
  private readonly notices = new WeakMap<Client, { text: string; until: number }>();
  private readonly feed = new WeakMap<Client, { tick: number; bytes: Uint8Array; conn: Client["conn"] }>();
  private readonly sample = new BitWriter(12288);
  private readonly space: CargoSpace | null;
  private readonly trailer: WheelVehicleDefinition | null;
  private next = 1;

  private readonly ctx: AirSupportContext;
  constructor(ctx: AirSupportContext) {
    this.ctx = ctx;
    const kind = ctx.world.reg.index.get(T.id), def = kind === undefined ? undefined : ctx.world.reg.vehicle[kind];
    this.trailer = def && isWheelVehicle(def) ? def : null;
    this.space = this.trailer && ctx.world.reg.index.has("core:semi") ? new CargoSpace(ctx.world, this.trailer) : null;
    this.flights = new AirFlights({ ...ctx, valid: (c, id) => {
      const rack = this.racks.get(id);
      return !!rack && this.access(c, rack);
    }, spare: id => { const rack = this.racks.get(id); return rack ? this.entity(rack.pid) : -1; } });
  }

  begin(data: string | null): void {
    if (!data) return;
    const state = JSON.parse(data) as SavedAir;
    this.next = state.next;
    for (const rack of state.racks) this.racks.set(rack.id, rack);
    for (const order of state.calls) this.calls.set(order.id, order);
    for (const [rig, until] of state.cooldown) this.cooldown.set(rig, until);
  }

  /** The live entity of record `pid`, or -1. */
  private entity(pid: number): number {
    const ents = this.ctx.world.ents, e = this.ctx.records.entOf.get(pid) ?? -1;
    return e >= 0 && ents.pid[e] === pid && (ents.flags[e]! & (F_ALIVE | F_PROP)) === F_ALIVE ? e : -1;
  }

  private frameOf(e: number): Frame {
    const ents = this.ctx.world.ents, v = ents.vrow[e]!;
    return { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, yaw: ents.vehicleYaw[v]!, qx: ents.vehicleQx[v]!, qy: ents.vehicleQy[v]!, qz: ents.vehicleQz[v]!, qw: ents.vehicleQw[v]! };
  }

  private tell(c: Client | undefined, text: string, code = RESULT_OK): number {
    if (c) {
      this.notices.set(c, { text, until: this.ctx.world.tick + 5 * TICK_RATE });
      this.ctx.game.sendText(c, TEXT_NOTICE, text);
      this.feed.delete(c);
    }
    return code;
  }

  private living(c: Client): boolean {
    const actor = this.ctx.records.byPid.get(c.pid);
    return c.active && !c.closed && c.state === SESSION_ALIVE && c.ent >= 0 && !!actor && !actor.dead && !actor.out;
  }

  private rigEntity(pid: number): number {
    const { world } = this.ctx, e = this.entity(pid);
    return e >= 0 && world.reg.vehicle[world.ents.kind[e]!] && isWheelVehicle(world.reg.vehicle[world.ents.kind[e]!]!) &&
      (world.reg.vehicle[world.ents.kind[e]!] as WheelVehicleDefinition).spec.fifthWheel ? e : -1;
  }

  /** The tractor whose cab session `c` sits in, if its tribe may call: -1 otherwise. */
  private seated(c: Client): number {
    if (!this.living(c)) return -1;
    const { world, records } = this.ctx, ents = world.ents, e = ents.seat[c.ent]! - 1;
    if (e < 0 || !ents.seatSlot[c.ent] || ents.seatGen[c.ent] !== ents.gen[e] || this.rigEntity(ents.pid[e]!) !== e) return -1;
    const vehicle = records.byPid.get(ents.pid[e]!)!, actor = records.byPid.get(c.pid)!;
    return vehicle.team === 0 || vehicle.team === actor.team ? e : -1;
  }

  private stationary(e: number): boolean {
    if (e < 0) return false;
    const a = this.ctx.world.ents, v = a.vrow[e]!;
    return !!(a.flags[e]! & F_GROUNDED) && Math.abs(a.vehiclePitch[v]!) < .24 && Math.abs(a.vehicleRoll[v]!) < .20 &&
      Math.hypot(a.vx[e]!, a.vy[e]!, a.vz[e]!) < .30 && Math.abs(a.vehicleYawRate[v]!) < .09;
  }

  /** The driver of the tractor towing it, or its tribe within reach of it with a clear line to it. */
  private access(c: Client, rack: Rack): boolean {
    if (!this.living(c)) return false;
    const { records, world, rules, hitches } = this.ctx, ents = world.ents, trailer = this.entity(rack.pid);
    if (trailer < 0) return false;
    const tractor = hitches.tractorOf(trailer);
    if (tractor >= 0 && c.drive === tractor && c.driveGen === ents.gen[tractor]) return true;
    const actor = records.byPid.get(c.pid)!;
    if (rack.owner !== c.pid && (!rack.team || rack.team !== actor.team)) return false;
    const at = this.frameOf(trailer);
    const local = { x: ents.x[c.ent]! - at.x, z: ents.z[c.ent]! - at.z }, sn = Math.sin(at.yaw), cs = Math.cos(at.yaw);
    const lateral = Math.max(0, Math.abs(local.x * cs - local.z * sn) - T.container.max[0]);
    const along = Math.max(0, Math.abs(local.z * cs + local.x * sn) - T.container.max[2]);
    const height = Math.max(0, Math.abs(ents.y[c.ent]! - at.y - T.deck - 1) - 2.1);
    if (Math.hypot(lateral, height, along) > rules.num("AirSupportReach")) return false;
    const side = framePoint(at, Math.sign(local.x * cs - local.z * sn) * (T.container.max[0] + .3), T.deck + 1, 0);
    return c.ent >= 0 && !!this.space?.sees(side, c.ent);
  }

  /** The tribe's nearest rack session `c` may work, or null. */
  private nearest(c: Client): Rack | null {
    let best: Rack | null = null, near = Infinity;
    const ents = this.ctx.world.ents;
    if (c.ent < 0) return null;
    for (const rack of this.racks.values()) {
      const e = this.entity(rack.pid);
      if (e < 0) continue;
      const d = Math.hypot(ents.x[e]! - ents.x[c.ent]!, ents.z[e]! - ents.z[c.ent]!);
      if (d < near && d < 30 && this.access(c, rack)) { best = rack; near = d; }
    }
    return best;
  }

  private edge(at: AirPose): AirPose {
    const { world, game } = this.ctx, { sizeX, sizeZ } = world.hf, pad = FAR_VIEW + 45;
    const edges = [[-pad, at.z], [sizeX + pad, at.z], [at.x, -pad], [at.x, sizeZ + pad]];
    for (const u of [.12, .38, .62, .88]) {
      edges.push([-pad, sizeZ * u], [sizeX + pad, sizeZ * u], [sizeX * u, -pad], [sizeX * u, sizeZ + pad]);
    }
    let best = Infinity, chosen = at;
    for (const [x, z] of edges as [number, number][]) {
      const ex = Math.max(0, Math.min(sizeX, x)), ez = Math.max(0, Math.min(sizeZ, z));
      let near = Infinity;
      for (const c of game.clients) if (c?.active && !c.closed && c.ent >= 0) {
        near = Math.min(near, Math.hypot(world.ents.x[c.ent]! - ex, world.ents.z[c.ent]! - ez));
        const camera = this.flights.camera(c);
        if (camera) near = Math.min(near, Math.hypot(camera.x - ex, camera.z - ez));
      }
      const cost = Math.hypot(x - at.x, z - at.z) + (near < 120 ? 10000 + (120 - near) * 12 : 0);
      if (cost < best) {
        best = cost;
        chosen = { x, z, y: Math.max(at.y, world.hf.heightAt(ex, ez)) + 55, yaw: Math.atan2(at.x - x, at.z - z) };
      }
    }
    return chosen;
  }

  call(c: Client, ground: AirPose | null): number {
    const { world, rules, records, hitches } = this.ctx, e = this.seated(c);
    if (!rules.on("AirSupportEnabled") || e < 0 || !this.space) return this.tell(c, "Call freight from an authorized semi cab.", RESULT_DENIED);
    const rig = world.ents.pid[e]!, at = this.frameOf(e);
    if ([...this.calls.values()].some(o => o.phase < P.release && (o.rig === rig || o.owner === c.pid))) return this.tell(c, "A freight carrier is already on call.", RESULT_BUSY);
    if ((this.cooldown.get(rig) ?? 0) > world.tick) return this.tell(c, "Freight dispatch is cooling down.", RESULT_WAIT);
    if (!ground && hitches.trailerPid(rig)) return this.tell(c, "Unhitch the current trailer first.", RESULT_BUSY);
    if (ground) {
      if (!finite(ground) || Math.hypot(at.x - ground.x, at.z - ground.z) > 24) return this.tell(c, "Choose a delivery spot within 24 m of the semi.", RESULT_FAR);
      ground = { ...ground, yaw: angle(ground.yaw), y: at.y };
      if (!this.stationary(e)) return this.tell(c, "Park the semi before marking a ground delivery.", RESULT_BUSY);
    }
    const edge = this.edge(at), owner = records.byPid.get(c.pid)!;
    const order: Order = { ...edge, id: this.next++, phase: P.inbound, loaded: true, trailer: !ground, jaws: 0, owner: c.pid, team: owner.team,
      rig, ground, since: world.tick, wait: Math.ceil(rules.num("AirSupportWait") * TICK_RATE), still: 0, mark: null, edge,
      speed: Math.max(80, distance(at, edge) / 35), stop: Math.ceil(rules.num("AirSupportStop") * TICK_RATE), stock: rules.num("AirSupportStock") };
    this.calls.set(order.id, order);
    this.cooldown.set(rig, world.tick + Math.round(rules.num("AirSupportCooldown") * TICK_RATE));
    this.saved.dirty = true;
    return this.tell(c, "Freight dispatched. Stop on clear, level ground to receive delivery.");
  }

  private depart(o: Order, c?: Client, reason?: string): void {
    o.phase = P.outbound;
    o.edge = this.edge(o);
    o.since = this.ctx.world.tick;
    if (reason) this.tell(c, reason);
    this.saved.dirty = true;
  }

  /** Where the load is set down: on the fifth wheel, or the marked spot. */
  private target(o: Order, tractor: Frame, def: WheelVehicleDefinition): Frame {
    if (o.ground) return { ...o.ground, qx: 0, qy: Math.sin(o.ground.yaw / 2), qz: 0, qw: Math.cos(o.ground.yaw / 2) };
    return hitchedPose(tractor, def.spec.fifthWheel!);
  }

  private fly(o: Order): void {
    const { world, game, hitches } = this.ctx, now = world.tick;
    const c = game.clients.find(v => v?.pid === o.owner && v.active && !v.closed) ?? undefined;
    if (o.phase === P.release) {
      o.jaws = Math.min(1, (now - o.since) / (1.1 * TICK_RATE));
      if (o.jaws === 1) this.depart(o);
      return;
    }
    if (o.phase === P.outbound) {
      const y = this.cruise(o, o.edge);
      const exit = { ...o.edge, y: Math.max(y, o.edge.y), yaw: Math.atan2(o.edge.x - o.x, o.edge.z - o.z) };
      if (distance(o, exit) < 2) { this.calls.delete(o.id); return; }
      if (o.y + 2 < y) { o.y = Math.min(y, o.y + TICK_DT * 9); return; }
      moveTo(o, exit, Math.max(45, o.speed * .8));
      return;
    }
    const e = this.rigEntity(o.rig);
    if (!c || e < 0 || this.seated(c) !== e) { this.depart(o, c, "The carrier is taking its load home. The calling seat is empty."); return; }
    const def = world.reg.vehicle[world.ents.kind[e]!] as WheelVehicleDefinition, at = this.frameOf(e), target = this.target(o, at, def);
    if (o.ground && Math.hypot(at.x - target.x, at.z - target.z) > 24) {
      this.depart(o, c, "The semi left the marked delivery site."); return;
    }
    const hover = { ...target, y: this.cruise(o, target), yaw: target.yaw };
    if (o.phase === P.inbound) {
      if (now - o.since > o.wait + 50 * TICK_RATE) {
        this.depart(o, c, "The carrier lost the moving rig. It is taking the cargo home."); return;
      }
      if (moveTo(o, hover, o.speed)) {
        o.phase = P.follow; o.since = now;
        this.tell(c, o.ground ? "Carrier overhead. Keep the drop site clear." : "Carrier overhead. Stop the semi and leave room behind it.");
      }
      return;
    }
    if (now - o.since >= o.wait) { this.depart(o, c, "Delivery timed out. The carrier is returning with its cargo."); return; }
    if (o.trailer && hitches.trailerPid(o.rig)) { this.depart(o, c, "The fifth wheel is occupied. The carrier is leaving with its cargo."); return; }
    const stable = this.stationary(e);
    if (!stable || o.mark && (distance(o.mark, at) > .16 || Math.abs(angle(o.mark.yaw - at.yaw)) > .035)) {
      o.still = 0; o.mark = null;
      if (o.phase === P.lower) this.tell(c, "The semi moved. Hold still for another approach.");
      o.phase = P.follow;
    }
    if (stable) { o.mark ??= at; o.still++; }
    if (o.phase === P.follow) {
      const arrived = moveTo(o, hover, 44);
      if (!arrived || o.still < o.stop) return;
    }
    if (o.ground) {
      const ground = this.space!.ground(target);
      if (ground === null) {
        if (o.phase === P.lower || o.still === o.stop) this.tell(c, "Choose dry, level ground with room for the load.");
        o.phase = P.follow; return;
      }
      target.y = ground;
    }
    if (!this.space!.clear(target, "land", [e])) {
      if (o.phase === P.lower || o.still === o.stop) this.tell(c, "The delivery path is blocked. Move to an open area.");
      o.phase = P.follow; return;
    }
    o.phase = P.lower;
    if (!moveTo(o, target, 8)) return;
    const trailer = this.ctx.spawn(T.id, target, o.team);
    if (trailer < 0) { this.depart(o, c, "This area cannot accept delivery. The carrier is taking its cargo home."); return; }
    const pid = world.ents.pid[trailer]!;
    if (o.trailer) hitches.couple(o.rig, pid);
    this.racks.set(o.id, { id: o.id, pid, owner: o.owner, team: o.team, open: 0, opening: false, slots: (1 << o.stock) - 1, selected: 0 });
    o.loaded = false; o.phase = P.release; o.since = now;
    this.saved.dirty = true;
    this.tell(c, o.trailer ? "Kingpin locked. Open the rack to select a drone." : "Trailer delivered on its landing legs. Back the semi under it to tow it.");
  }

  private cruise(at: AirPose, dest: AirPose): number {
    const { world } = this.ctx;
    const dx = dest.x - at.x, dz = dest.z - at.z, f = Math.min(1, 45 / Math.max(1, Math.hypot(dx, dz)));
    const x = at.x + dx * f, z = at.z + dz * f;
    const top = world.structs.topIn(Math.min(at.x, x) - 5, Math.min(at.z, z) - 5, Math.max(at.x, x) + 5, Math.max(at.z, z) + 5);
    return Math.max(world.hf.heightAt(x, z) + 27, top + 12, dest.y);
  }

  command(c: Client, r: BitReader): number {
    const action = r.u8(), target = r.u32(), bay = r.u8();
    const ground = action === A.ground ? { x: r.f32(), z: r.f32(), yaw: r.f32(), y: 0 } : null;
    if (r.overflow) return RESULT_INVALID;
    if ((action === A.leave || action === A.payload) && this.flights.camera(c)?.id !== target) return RESULT_INVALID;
    if (action === A.leave) return this.flights.abort(c);
    if (action === A.payload) return this.flights.trigger(c);
    if (!this.living(c) || this.flights.active(c)) return RESULT_DENIED;
    if (action === A.ground || action === A.trailer) return this.call(c, ground);
    if (action === A.cancel) {
      const order = this.calls.get(target);
      if (!order || order.owner !== c.pid || order.phase >= P.release) return RESULT_INVALID;
      this.depart(order, c, "Call canceled. The carrier is taking its load home."); return RESULT_OK;
    }
    const rack = this.racks.get(target), trailer = rack ? this.entity(rack.pid) : -1;
    if (!rack || trailer < 0) return RESULT_INVALID;
    if (!this.access(c, rack)) return RESULT_NOT_YOURS;
    const { hitches, world } = this.ctx, tractor = hitches.tractorOf(trailer);
    if (action === A.unhitch) {
      if (tractor < 0) return RESULT_INVALID;
      if (!this.stationary(tractor)) return this.tell(c, "Stop the semi before unhitching.", RESULT_BUSY);
      hitches.release(rack.pid); this.saved.dirty = true;
      return this.tell(c, "Landing legs down. The trailer is parked.");
    }
    if (action === A.dismiss) {
      if (tractor >= 0) return this.tell(c, "Unhitch the trailer before sending it away.", RESULT_BUSY);
      if (rack.owner !== c.pid && world.ents.team[c.ent] !== rack.team) return RESULT_NOT_YOURS;
      this.racks.delete(rack.id); this.saved.dirty = true;
      this.ctx.discard(trailer);
      return this.tell(c, "Trailer recalled.");
    }
    const moving = !this.stationary(tractor >= 0 ? tractor : trailer);
    if (moving) return this.tell(c, "Stop the semi to operate the drone rack.", RESULT_BUSY);
    if (action === A.panels) {
      if (!rack.opening && !this.space!.clear(this.frameOf(trailer), "panels", tractor >= 0 ? [trailer, tractor] : [trailer])) {
        return this.tell(c, "Clear the space beside and above the panels.", RESULT_OBSTRUCTED);
      }
      rack.opening = !rack.opening;
    } else if (action === A.select || action === A.launch) {
      if (bay >= AIR_BAYS || !(rack.slots & (1 << bay))) return this.tell(c, "That bay is empty.", RESULT_SHORT);
      if (!rack.opening || rack.open < 1) return this.tell(c, "Open the rack and wait for the panels.", RESULT_WAIT);
      rack.selected = bay;
      if (action === A.launch) {
        const at = this.frameOf(trailer), cradle = T.anchors[`bay_${bay + 1}` as "bay_1"];
        const origin = framePoint(at, cradle[0], cradle[1], cradle[2]);
        origin.yaw = at.yaw + Math.PI / 2;
        const result = this.flights.launch(c, origin, rack.id, bay);
        if (result !== RESULT_OK) return result;
        rack.slots &= ~(1 << bay);
        if (rack.slots) rack.selected = Math.log2(rack.slots & -rack.slots);
      }
    } else return RESULT_INVALID;
    this.saved.dirty = true; this.feed.delete(c);
    return RESULT_OK;
  }

  step(tick = this.ctx.world.tick): void {
    for (const o of this.calls.values()) { this.fly(o); this.saved.dirty = true; }
    const ents = this.ctx.world.ents;
    for (const rack of this.racks.values()) {
      const trailer = this.entity(rack.pid);
      if (trailer < 0) {
        // A trailer whose record is gone takes its rack with it; one out of reach keeps it.
        if (!this.ctx.records.byPid.has(rack.pid)) { this.racks.delete(rack.id); this.saved.dirty = true; }
        continue;
      }
      // A rack closes for the road.
      if (rack.opening && Math.hypot(ents.vx[trailer]!, ents.vz[trailer]!) > ROLLING) {
        rack.opening = false;
        const c = this.ctx.game.clients.find(v => v?.active && v.drive === this.ctx.hitches.tractorOf(trailer)) ?? undefined;
        this.tell(c, "Rack closing for the road.");
      }
      const goal = rack.opening ? 1 : 0;
      if (rack.open !== goal) {
        rack.open = Math.max(0, Math.min(1, rack.open + (rack.opening ? 1 : -1) * TICK_DT / 1.6));
        this.saved.dirty = true;
      }
    }
    for (const [pid, until] of this.cooldown) if (tick >= until) { this.cooldown.delete(pid); this.saved.dirty = true; }
    this.flights.step(tick);
  }

  view(c: Client): AirSupportView {
    const { world } = this.ctx, ents = world.ents, result = emptyAirSupport();
    result.tick = world.tick;
    const camera = this.flights.camera(c);
    const x = camera?.x ?? (c.ent >= 0 ? ents.x[c.ent]! : 0), z = camera?.z ?? (c.ent >= 0 ? ents.z[c.ent]! : 0);
    const range = (r: AirPose) => Math.hypot(r.x - x, r.z - z);
    for (const o of this.calls.values()) {
      if (o.owner === c.pid && o.phase < P.release) result.order = o.id;
      if (range(o) <= FAR_VIEW || o.id === result.order) result.carriers.push(o);
    }
    if (result.carriers.length > AIR_VIEW_LIMIT) {
      result.carriers.sort((a, b) => Number(b.id === result.order) - Number(a.id === result.order) || range(a) - range(b));
      result.carriers.length = AIR_VIEW_LIMIT;
    }
    const mine = c.ent >= 0 && !camera ? this.nearest(c) : null;
    for (const rack of this.racks.values()) {
      const e = this.entity(rack.pid);
      if (e < 0) continue;
      const at = this.frameOf(e);
      if (range(at) > FAR_VIEW) continue;
      const row: AirPod = { id: rack.id, open: rack.open, slots: rack.slots, selected: rack.selected, x: at.x, y: at.y, z: at.z, yaw: at.yaw, ent: makeHandle(e, ents.gen[e]!), hitched: this.ctx.hitches.tractorOf(e) >= 0 };
      result.pods.push(row);
    }
    if (mine) result.pod = mine.id;
    if (result.pods.length > AIR_VIEW_LIMIT) result.pods = result.pods.sort((a, b) => range(a) - range(b)).slice(0, AIR_VIEW_LIMIT);
    const n = this.notices.get(c);
    if (n && n.until > world.tick) result.notice = n.text;
    this.flights.view(c, result);
    return result;
  }

  sync(c: Client): void {
    const { world, game } = this.ctx, last = this.feed.get(c);
    if (!last && !this.calls.size && !this.racks.size && !this.notices.has(c)) return;
    if (last?.conn === c.conn && world.tick - last.tick < 3) return;
    const view = this.view(c);
    this.sample.reset(); writeAirSupport(this.sample, view);
    const bytes = this.sample.bytes().subarray(4);
    if (last?.conn === c.conn && last.bytes.length === bytes.length && bytes.every((v, i) => v === last.bytes[i])) {
      last.tick = world.tick; return;
    }
    if (last || view.carriers.length || view.pods.length || view.drones.length || view.notice) {
      writeAirSupport(game.begin(S_AIR_SUPPORT), view); game.endOwn(c);
    }
    this.feed.set(c, { bytes: bytes.slice(), tick: world.tick, conn: c.conn });
  }
}

export { isTrailer, offset };
