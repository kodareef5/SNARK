import { CHUNK_SIZE, TICK_DT, TICK_RATE } from "../shared/coords.ts";
import { BitWriter, type BitReader } from "../shared/net/codec.ts";
import {
  RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_FULL, RESULT_INVALID, RESULT_NOT_YOURS,
  RESULT_OBSTRUCTED, RESULT_OK, RESULT_SHORT, RESULT_WAIT, SESSION_ALIVE, S_AIR_SUPPORT, TEXT_NOTICE,
} from "../shared/net/protocol.ts";
import { AIR_ACTION, AIR_BAYS, AIR_PHASE, AIR_VIEW_LIMIT, emptyAirSupport, writeAirSupport,
  type AirCarrier, type AirPod, type AirPose, type AirSupportView } from "../shared/sim/air-support.ts";
import { AIR_FRAME, airBayZ } from "../shared/world/air-support-art.ts";
import { F_ALIVE, F_GROUNDED, F_PROP } from "../shared/sim/entities.ts";
import { CargoSpace, angle, offset, towedPose, wireYaw } from "./air-cargo-space.ts";
import { AirFlights, type AirFlightContext } from "./air-flight.ts";
import type { Client } from "./game.ts";
import type { Urban } from "./urban.ts";

export interface AirSupportContext extends Omit<AirFlightContext, "valid"> { urban: Urban }
interface Tractor extends AirPose { pitch: number; roll: number; qx: number; qy: number; qz: number; qw: number }
interface Rack extends AirPod { owner: number; team: number; rig: number; ref: number; opening: boolean; tractor: Tractor | null }
interface Order extends AirCarrier {
  owner: number; team: number; rig: number; ground: AirPose | null; since: number; wait: number; still: number;
  mark: AirPose | null; edge: AirPose; speed: number; stop: number; stock: number;
}
interface SavedAir { next: number; racks: Rack[]; calls: Order[]; cooldown: [number, number][] }
const P = AIR_PHASE, A = AIR_ACTION;
const FAR_VIEW = 560;
const CELLS = 4;
const distance = (a: AirPose, b: AirPose) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const finite = (p: AirPose) => Number.isFinite(p.x + p.y + p.z + p.yaw);
const position = (to: AirPose, p: AirPose) => { to.x = p.x; to.y = p.y; to.z = p.z; to.yaw = p.yaw; };

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
  private readonly groups = new Map<number, Set<Rack>>();
  private readonly changedGroups = new Set<number>();
  private readonly working = new Set<Rack>();
  private readonly sample = new BitWriter(12288);
  private readonly space: CargoSpace | null;
  private next = 1;

  private readonly ctx: AirSupportContext;
  constructor(ctx: AirSupportContext) {
    this.ctx = ctx;
    ctx.world.structs.onShape.push(chunk => {
      const group = this.group(chunk);
      if (this.groups.has(group)) this.changedGroups.add(group);
    });
    this.space = ctx.world.reg.index.has("core:semi") ? new CargoSpace(ctx.world) : null;
    this.flights = new AirFlights({ ...ctx, valid: (c, id) => {
      const rack = this.racks.get(id);
      return !!rack && this.access(c, rack, false);
    } });
  }

  begin(data: string | null): void {
    if (!data) return;
    const state = JSON.parse(data) as SavedAir;
    this.next = state.next;
    for (const rack of state.racks) if (this.exists(rack)) this.addRack(rack);
    for (const order of state.calls) this.calls.set(order.id, order);
    for (const [rig, until] of state.cooldown) this.cooldown.set(rig, until);
    this.saved.dirty = this.racks.size !== state.racks.length;
  }

  private group(chunk: number): number {
    const nx = this.ctx.world.dims.chunksX;
    return Math.floor(chunk % nx / CELLS) + Math.floor(chunk / nx / CELLS) * Math.ceil(nx / CELLS);
  }

  private index(r: Rack, add: boolean): void {
    const group = this.group(Math.floor(r.ref / 65536));
    let rows = this.groups.get(group);
    if (add) { if (!rows) this.groups.set(group, rows = new Set()); rows.add(r); }
    else if (rows) { rows.delete(r); if (!rows.size) this.groups.delete(group); }
  }

  private addRack(rack: Rack): void {
    this.racks.set(rack.id, rack); this.index(rack, true);
    if (rack.hitched || rack.open !== Number(rack.opening)) this.working.add(rack);
  }

  private movedRef(r: Rack, ref: number): void {
    if (ref === r.ref) return;
    this.index(r, false); r.ref = ref; this.index(r, true);
  }

  private solid(trailer: boolean, open = false): number {
    return this.ctx.world.reg.index.get("core:air_pod_" + (trailer ? "chassis" : "ground") + (open ? "_open" : "")) ?? -1;
  }

  private exists(rack: Rack): boolean {
    const t = this.ctx.world.structs.chunks[Math.floor(rack.ref / 65536)], s = rack.ref & 65535;
    return !!t && (t.kind[s] === this.solid(rack.trailer) || t.kind[s] === this.solid(rack.trailer, true)) &&
      Math.abs(t.x[s]! - rack.x) < .003 && Math.abs(t.z[s]! - rack.z) < .003;
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
    const { records, world } = this.ctx, ents = world.ents, e = records.entOf.get(pid) ?? -1;
    return e >= 0 && ents.pid[e] === pid && world.reg.ids[ents.kind[e]!] === "core:semi" &&
      (ents.flags[e]! & (F_ALIVE | F_PROP)) === F_ALIVE ? e : -1;
  }

  private seated(c: Client): number {
    if (!this.living(c)) return -1;
    const { world, records } = this.ctx, ents = world.ents, e = ents.seat[c.ent]! - 1;
    if (e < 0 || !ents.seatSlot[c.ent] || ents.seatGen[c.ent] !== ents.gen[e] || this.rigEntity(ents.pid[e]!) !== e) return -1;
    const vehicle = records.byPid.get(ents.pid[e]!)!, actor = records.byPid.get(c.pid)!;
    return vehicle.team === 0 || vehicle.team === actor.team ? e : -1;
  }

  private tractor(e: number): Tractor {
    const ents = this.ctx.world.ents, v = ents.vrow[e]!;
    return { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, yaw: ents.vehicleYaw[v]!, pitch: ents.vehiclePitch[v]!, roll: ents.vehicleRoll[v]!,
      qx: ents.vehicleQx[v]!, qy: ents.vehicleQy[v]!, qz: ents.vehicleQz[v]!, qw: ents.vehicleQw[v]! };
  }

  private stationary(e: number): boolean {
    if (e < 0) return false;
    const a = this.ctx.world.ents, v = a.vrow[e]!;
    return !!(a.flags[e]! & F_GROUNDED) && Math.abs(a.vehiclePitch[v]!) < .24 && Math.abs(a.vehicleRoll[v]!) < .20 &&
      Math.hypot(a.vx[e]!, a.vy[e]!, a.vz[e]!) < .30 && Math.abs(a.vehicleYawRate[v]!) < .09;
  }

  private access(c: Client, rack: Rack, hitching: boolean): boolean {
    if (!this.living(c)) return false;
    const { records, world, rules } = this.ctx, ents = world.ents, rig = this.seated(c);
    const driver = rig >= 0 && c.drive === rig && c.driveGen === ents.gen[rig];
    if (rack.hitched && driver && ents.pid[rig] === rack.rig) return true;
    const actor = records.byPid.get(c.pid)!;
    if (rack.owner !== c.pid && (!rack.team || rack.team !== actor.team)) return false;
    const dx = ents.x[c.ent]! - rack.x, dz = ents.z[c.ent]! - rack.z, sn = Math.sin(rack.yaw), cs = Math.cos(rack.yaw);
    const lateral = Math.max(0, Math.abs(dx * cs - dz * sn) - 1.25);
    const along = Math.max(0, Math.abs(dz * cs + dx * sn) - 3.9);
    const height = Math.max(0, Math.abs(ents.y[c.ent]! - rack.y - 1.4) - 2.1);
    return Math.hypot(lateral, height, along) <= rules.num("AirSupportReach") && (hitching && driver || !!this.space?.sees(rack, c.ent, rack.ref));
  }

  private occupied(pid: number): boolean {
    for (const r of this.racks.values()) if (r.rig === pid && r.hitched) return true;
    return false;
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
    const { world, rules, records } = this.ctx, e = this.seated(c);
    if (!rules.on("AirSupportEnabled") || e < 0 || !this.space) return this.tell(c, "Call freight from an authorized semi cab.", RESULT_DENIED);
    const rig = world.ents.pid[e]!, at = this.tractor(e);
    if ([...this.calls.values()].some(o => o.phase < P.release && (o.rig === rig || o.owner === c.pid))) return this.tell(c, "A freight carrier is already on call.", RESULT_BUSY);
    if ((this.cooldown.get(rig) ?? 0) > world.tick) return this.tell(c, "Freight dispatch is cooling down.", RESULT_WAIT);
    if (!ground && this.occupied(rig)) return this.tell(c, "Unhitch the current trailer first.", RESULT_BUSY);
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

  private fly(o: Order): void {
    const { world, game } = this.ctx, now = world.tick;
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
    const at = this.tractor(e), target = o.ground ? { ...o.ground } : towedPose(at);
    if (o.ground && Math.hypot(at.x - target.x, at.z - target.z) > 24) {
      this.depart(o, c, "The semi left the marked delivery site."); return;
    }
    const hover = { ...target, y: this.cruise(o, target), yaw: at.yaw };
    if (o.phase === P.inbound) {
      if (now - o.since > o.wait + 50 * TICK_RATE) {
        this.depart(o, c, "The carrier lost the moving rig. It is taking the cargo home."); return;
      }
      if (moveTo(o, hover, o.speed)) {
        o.phase = P.follow; o.since = now;
        this.tell(c, "Carrier overhead. Stop the semi and leave room behind it.");
      }
      return;
    }
    if (now - o.since >= o.wait) { this.depart(o, c, "Delivery timed out. The carrier is returning with its cargo."); return; }
    if (o.trailer && this.occupied(o.rig)) { this.depart(o, c, "The fifth wheel is occupied. The carrier is leaving with its cargo."); return; }
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
    const ground = this.space!.ground(target, o.trailer, false, -1);
    if (ground === null) {
      if (o.phase === P.lower || o.still === o.stop) this.tell(c, "Choose dry, level ground with room for the load.");
      o.phase = P.follow; return;
    }
    target.y = ground;
    if (!this.space!.clear(target, o.trailer, "land", -1, o.trailer ? e : -1)) {
      if (o.phase === P.lower || o.still === o.stop) this.tell(c, "The delivery path is blocked. Move to an open area.");
      o.phase = P.follow; return;
    }
    o.phase = P.lower;
    if (!moveTo(o, target, 8)) return;
    const ref = world.structs.add(this.solid(o.trailer), target.x, target.y, target.z, wireYaw(target.yaw), o.team, 4800);
    if (ref < 0) { this.depart(o, c, "This area cannot accept delivery. The carrier is taking its cargo home."); return; }
    const rack: Rack = { ...target, id: o.id, trailer: o.trailer, hitched: o.trailer, open: 0, opening: false,
      slots: (1 << o.stock) - 1, selected: 0, rig: o.trailer ? o.rig : 0, tractor: o.trailer ? at : null, ref, owner: o.owner, team: o.team };
    this.addRack(rack);
    o.loaded = false; o.phase = P.release; o.since = now;
    this.tell(c, o.trailer ? "Trailer secured. Open the rack to select a drone." : "Pod delivered. Open its rack on foot or mount it at the semi.");
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
    const rack = this.racks.get(target);
    if (!rack || !this.exists(rack)) return RESULT_INVALID;
    const hitch = action === A.hitch || action === A.mount;
    if (!this.access(c, rack, hitch)) return RESULT_NOT_YOURS;
    if (hitch || action === A.unhitch) return this.attach(c, rack, action);
    if (rack.hitched && !this.stationary(this.rigEntity(rack.rig))) return this.tell(c, "Stop the semi to operate the drone rack.", RESULT_BUSY);
    if (action === A.panels) {
      const rig = this.rigEntity(rack.rig);
      if (!this.space!.clear(rack, rack.trailer, "panels", rack.ref, rig)) return this.tell(c, "Clear the space beside and above the panels.", RESULT_OBSTRUCTED);
      rack.opening = !rack.opening; this.working.add(rack);
    } else if (action === A.select || action === A.launch) {
      if (bay >= AIR_BAYS || !(rack.slots & (1 << bay))) return this.tell(c, "That bay is empty.", RESULT_SHORT);
      if (!rack.opening || rack.open < 1) return this.tell(c, "Open the rack and wait for the panels.", RESULT_WAIT);
      rack.selected = bay;
      if (action === A.launch) {
        const origin = offset(rack, 0, (rack.trailer ? AIR_FRAME.deck : 0) + AIR_FRAME.bayY, airBayZ(bay));
        origin.yaw += Math.PI / 2;
        const result = this.flights.launch(c, origin, rack.id, bay);
        if (result !== RESULT_OK) return result;
        rack.slots &= ~(1 << bay);
        if (rack.slots) rack.selected = Math.log2(rack.slots & -rack.slots);
      }
    } else return RESULT_INVALID;
    this.saved.dirty = true; this.feed.delete(c);
    return RESULT_OK;
  }

  private attach(c: Client, r: Rack, action: number): number {
    const { world } = this.ctx, e = this.seated(c);
    if (e < 0 || c.drive !== e || !this.stationary(e)) return this.tell(c, "Use the driver seat of a stopped semi.", RESULT_BUSY);
    const pid = world.ents.pid[e]!;
    if (r.open > 0 || r.opening) return this.tell(c, "Close the rack before moving its hitch.", RESULT_BUSY);
    if (action === A.unhitch) {
      if (!r.hitched || r.rig !== pid) return RESULT_INVALID;
      r.hitched = false; r.rig = 0; r.tractor = null;
    } else {
      if (r.hitched || this.occupied(pid) || (action === A.mount) === r.trailer) return RESULT_BUSY;
      const tractor = this.tractor(e), target = towedPose(tractor);
      const reach = r.trailer ? 2.5 : this.ctx.rules.num("AirSupportReach");
      if (distance(r, target) > reach || r.trailer && Math.abs(angle(r.yaw - target.yaw)) > .44) {
        return this.tell(c, "Back the fifth wheel up to the front of the cargo.", RESULT_FAR);
      }
      const y = this.space!.ground(target, true, false, r.ref);
      if (y === null) return RESULT_OBSTRUCTED;
      target.y = y;
      if (!this.space!.clear(target, true, "tow", r.ref, e) || !r.trailer && !this.space!.transfer(r, target, r.ref, e)) {
        return this.tell(c, "The cargo path to the fifth wheel is blocked.", RESULT_OBSTRUCTED);
      }
      const ref = world.structs.relocate(r.ref, this.solid(true), target.x, y, target.z, wireYaw(target.yaw));
      if (ref < 0) return RESULT_FULL;
      position(r, target); this.movedRef(r, ref); this.working.add(r); r.hitched = r.trailer = true; r.rig = pid; r.tractor = tractor;
    }
    this.saved.dirty = true;
    return this.tell(c, r.hitched ? "Kingpin locked. The trailer is ready to roll." : "Landing gear down. The trailer is parked.");
  }

  private tow(r: Rack): void {
    const { world, urban } = this.ctx, a = world.ents, e = this.rigEntity(r.rig);
    if (e < 0 || !r.tractor) { r.hitched = false; r.rig = 0; r.tractor = null; this.saved.dirty = true; return; }
    const at = this.tractor(e), old = r.tractor;
    if (distance(at, old) < .001 && Math.abs(angle(at.yaw - old.yaw)) < .0004) return;
    const target = towedPose(at, r), y = this.space!.ground(target, true, true, r.ref);
    if (y !== null) target.y = y;
    const canMove = y !== null && r.open <= .02 && !r.opening && this.space!.clear(target, true, "tow", r.ref, e, r);
    if (canMove) {
      const ref = world.structs.relocate(r.ref, this.solid(true), target.x, target.y, target.z, wireYaw(target.yaw));
      if (ref >= 0) { position(r, target); r.tractor = at; this.movedRef(r, ref); this.saved.dirty = true; return; }
    }
    const v = a.vrow[e]!;
    a.setPosition(e, old.x, old.y, old.z);
    a.vehicleYaw[v] = old.yaw; a.yaw[e] = wireYaw(old.yaw);
    a.vehiclePitch[v] = old.pitch; a.vehicleRoll[v] = old.roll;
    a.vehicleQx[v] = old.qx; a.vehicleQy[v] = old.qy; a.vehicleQz[v] = old.qz; a.vehicleQw[v] = old.qw;
    a.vx[e] = a.vy[e] = a.vz[e] = a.vehicleYawRate[v] = a.vehiclePitchRate[v] = a.vehicleRollRate[v] = 0;
    urban.syncAfterContact(e);
  }

  step(tick = this.ctx.world.tick): void {
    for (const o of this.calls.values()) { this.fly(o); this.saved.dirty = true; }
    for (const group of this.changedGroups) for (const r of this.groups.get(group) ?? []) {
      if (!this.exists(r)) {
        this.racks.delete(r.id); this.index(r, false); this.working.delete(r); this.saved.dirty = true;
      }
    }
    this.changedGroups.clear();
    for (const r of this.working) {
      if (r.hitched) this.tow(r);
      const goal = r.opening ? 1 : 0;
      if (r.open !== goal) {
        const clear = this.space!.clear(r, r.trailer, "panels", r.ref, this.rigEntity(r.rig));
        if (clear) {
          r.open = Math.max(0, Math.min(1, r.open + (r.opening ? 1 : -1) * TICK_DT / 1.6));
          if (r.open === goal) this.ctx.world.structs.swap(r.ref, this.solid(r.trailer, r.opening));
          this.saved.dirty = true;
        }
      }
      if (!r.hitched && r.open === Number(r.opening)) this.working.delete(r);
    }
    for (const [pid, until] of this.cooldown) if (tick >= until) { this.cooldown.delete(pid); this.saved.dirty = true; }
    this.flights.step(tick);
  }

  view(c: Client): AirSupportView {
    const { world } = this.ctx, result = emptyAirSupport();
    result.tick = world.tick;
    const camera = this.flights.camera(c);
    const x = camera?.x ?? (c.ent >= 0 ? world.ents.x[c.ent]! : 0), z = camera?.z ?? (c.ent >= 0 ? world.ents.z[c.ent]! : 0);
    const range = (r: AirPose) => Math.hypot(r.x - x, r.z - z);
    for (const o of this.calls.values()) {
      if (o.owner === c.pid && o.phase < P.release) result.order = o.id;
      if (range(o) <= FAR_VIEW || o.id === result.order) result.carriers.push(o);
    }
    if (result.carriers.length > AIR_VIEW_LIMIT) {
      result.carriers.sort((a, b) => Number(b.id === result.order) - Number(a.id === result.order) || range(a) - range(b));
      result.carriers.length = AIR_VIEW_LIMIT;
    }
    let nearest = Infinity;
    const size = CELLS * CHUNK_SIZE, nx = Math.ceil(world.dims.chunksX / CELLS), nz = Math.ceil(world.dims.chunksZ / CELLS);
    for (let gz = Math.max(0, Math.floor((z - FAR_VIEW) / size)); gz < Math.min(nz, 1 + Math.floor((z + FAR_VIEW) / size)); gz++) {
      for (let gx = Math.max(0, Math.floor((x - FAR_VIEW) / size)); gx < Math.min(nx, 1 + Math.floor((x + FAR_VIEW) / size)); gx++) {
        for (const r of this.groups.get(gz * nx + gx) ?? []) {
          const d = range(r);
          if (d > FAR_VIEW) continue;
          result.pods.push(r);
          if (d < nearest && this.access(c, r, true)) { result.pod = r.id; nearest = d; }
        }
      }
    }
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
