// Deterministic high-level commute tasks. Existing movement/traffic adapters own
// pathfinding, physical motion and collision; this module never teleports actors.
import type { Occupancy, OccupancyControl, OccupancyEffect } from './occupancy.ts';

export interface CivilianPoint { x: number; y: number; z: number }
export interface CivilianRoute {
  id: string;
  waypoints: readonly CivilianPoint[];
  parking: CivilianPoint;
  workplace: CivilianPoint;
}
export interface CivilianDefinition {
  pid: number;
  name: string;
  occupation: string;
  backstory: string;
  home: number;
  work: number;
  vehicle: number;
  /** Legal owner expected by this appointment; can be an actor, tribe or business PID. */
  vehicleOwner: number;
  seat: string;
  departTick: number;
  route: CivilianRoute;
}
export type CivilianPhase = 'idle' | 'approach' | 'enter' | 'drive' | 'park' | 'exit' | 'walk' | 'blocked' | 'react';
export type CivilianGoal = 'commute' | 'work' | 'seek-help';
export interface CivilianMemory {
  kind: 'carjacked';
  actionId: number;
  tick: number;
  offender: number;
  vehicle: number;
}
export interface CivilianState {
  phase: CivilianPhase;
  goal: CivilianGoal;
  revision: number;
  waypoint: number;
  nextTick: number;
  completedDepartTick: number | null;
  blockedReason: string | null;
  resume: Exclude<CivilianPhase, 'blocked'>;
  nextRequestId: number;
  lastIncidentId: number;
  lastTick: number;
  memories: CivilianMemory[];
}
export interface CivilianOptions {
  /** Fresh authenticated NPC producer epoch; register it in occupancy before stepping. */
  actorEpoch: number;
  retryTicks?: number;
  actionTicks?: number;
  saved?: CivilianState;
}
export interface CivilianMotionResult {
  revision: number;
  status: 'moving' | 'arrived' | 'blocked';
  reason?: string;
}
export interface CivilianWorld {
  occupancy: Occupancy;
  actor(pid: number): 'ready' | 'paused' | 'dead';
  owner(vehicle: number): number | null;
  approach(vehicle: number, seat: string): CivilianPoint | null;
  walk(actor: number, target: Readonly<CivilianPoint>, taskRevision: number): CivilianMotionResult;
  drive(actor: number, control: OccupancyControl, target: Readonly<CivilianPoint>, taskRevision: number): CivilianMotionResult;
  park(actor: number, control: OccupancyControl, target: Readonly<CivilianPoint>, taskRevision: number): CivilianMotionResult;
  /** A null token stops on-foot movement only; never brake someone else's vehicle. */
  stop(actor: number, control: OccupancyControl | null, taskRevision: number): void;
  react(actor: number, memory: Readonly<CivilianMemory>, taskRevision: number): void;
}
export interface CivilianSnapshot { version: 1; definition: CivilianDefinition; state: CivilianState }

const natural = (n: number) => Number.isSafeInteger(n) && n >= 0 && n < Number.MAX_SAFE_INTEGER;
const positive = (n: number) => natural(n) && n > 0;
const point = (p: CivilianPoint) => !!p && [p.x, p.y, p.z].every(Number.isFinite);
const phases: readonly CivilianPhase[] = ['idle', 'approach', 'enter', 'drive', 'park', 'exit', 'walk', 'blocked', 'react'];

export class Civilian {
  readonly definition: Readonly<CivilianDefinition>;
  private readonly actorEpoch: number;
  private readonly retryTicks: number;
  private readonly actionTicks: number;
  private readonly state: CivilianState;
  private pendingAction = 0;

  constructor(definition: CivilianDefinition, options: CivilianOptions) {
    validateDefinition(definition);
    this.actorEpoch = options.actorEpoch;
    this.retryTicks = options.retryTicks ?? 30;
    this.actionTicks = options.actionTicks ?? 15;
    if (![this.actorEpoch, this.retryTicks, this.actionTicks].every(positive)) throw new Error('Invalid civilian options');
    // Definitions and saves belong to the controller after construction; external changes
    // cannot move an appointment's goal posts or rewrite a remembered incident.
    this.definition = structuredClone(definition);
    Object.freeze(this.definition.route.waypoints);
    for (const p of this.definition.route.waypoints) Object.freeze(p);
    Object.freeze(this.definition.route.parking);
    Object.freeze(this.definition.route.workplace);
    Object.freeze(this.definition.route);
    Object.freeze(this.definition);
    this.state = options.saved ? structuredClone(options.saved) : {
      phase: 'idle', goal: 'commute', revision: 1, waypoint: 0, nextTick: definition.departTick,
      completedDepartTick: null, blockedReason: null, resume: 'idle', nextRequestId: 1,
      lastIncidentId: 0, lastTick: -1, memories: [],
    };
    validateState(this.state, definition);
  }

  /** Authority steps occupancy and applies its effects separately. Call this at most once
   * per authoritative simulation tick; duplicate calls are harmless. Async path adapters
   * return their request revision, so old replies cannot finish a replacement task.
   */
  step(tick: number, world: CivilianWorld): Readonly<CivilianState> {
    const s = this.state, d = this.definition;
    if (!natural(tick) || tick < s.lastTick) throw new Error('Civilian tick must be monotonic');
    if (tick === s.lastTick) return this.view();
    s.lastTick = tick;
    const actorState = world.actor(d.pid);
    if (actorState !== 'ready') {
      // The authority also invalidates seat actions and publishes their cancellation
      // effects on death/knockout; this planner only preempts its own intent.
      this.block('actor-' + actorState, tick, world);
      return this.view();
    }
    if (s.phase === 'blocked') {
      if (tick < s.nextTick) {
        this.stop(world);
        return this.view();
      }
      this.transition(s.resume);
    }
    switch (s.phase) {
      case 'idle':
        if (s.goal === 'commute' && s.completedDepartTick === null && tick >= d.departTick) this.transition('approach');
        break;
      case 'approach': {
        if (!this.available(world, tick)) break;
        if (this.seated(world)) { this.transition('drive'); break; }
        if (world.occupancy.seatOf(d.pid)) { this.block('seated-elsewhere', tick, world); break; }
        const target = world.approach(d.vehicle, d.seat);
        if (!target || !point(target)) { this.block('approach-unavailable', tick, world); break; }
        this.motion(world.walk(d.pid, target, s.revision), 'enter', tick, world);
        break;
      }
      case 'enter':
        if (!this.available(world, tick)) break;
        if (this.seated(world)) { this.transition('drive'); break; }
        this.interact('enter', tick, world);
        break;
      case 'drive': {
        const control = this.driver(world, tick);
        if (!control) break;
        const target = d.route.waypoints[s.waypoint];
        if (!target) { this.transition('park'); break; }
        const result = world.drive(d.pid, control, target, s.revision);
        if (result.revision !== s.revision) break;
        if (result.status === 'blocked') this.block(result.reason ?? 'route-blocked', tick, world);
        else if (result.status === 'arrived') {
          s.waypoint++;
          // Each waypoint is a fresh task, invalidating delayed replies for the previous one.
          this.transition(s.waypoint >= d.route.waypoints.length ? 'park' : 'drive');
        }
        break;
      }
      case 'park': {
        const control = this.driver(world, tick);
        if (control) this.motion(world.park(d.pid, control, d.route.parking, s.revision), 'exit', tick, world);
        break;
      }
      case 'exit':
        if (!world.occupancy.seatOf(d.pid)) { this.transition('walk'); break; }
        if (!this.seated(world)) { this.block('seated-elsewhere', tick, world); break; }
        this.stop(world);
        this.interact('exit', tick, world);
        break;
      case 'walk': {
        const result = world.walk(d.pid, d.route.workplace, s.revision);
        if (result.revision !== s.revision) break;
        if (result.status === 'blocked') this.block(result.reason ?? 'walk-blocked', tick, world);
        else if (result.status === 'arrived') {
          s.goal = 'work';
          s.completedDepartTick = d.departTick;
          this.transition('idle');
        }
        break;
      }
      case 'react': {
        this.stop(world);
        const memory = s.memories.at(-1);
        if (memory) world.react(d.pid, { ...memory }, s.revision);
        this.transition('idle'); // seek-help remains a durable goal for a future planner.
        break;
      }
    }
    return this.view();
  }

  /** Feed the authoritative committed effect, after its victim landing was applied.
   * A stolen car changes memory/goal, never legal ownership. Re-observation is idempotent
   * even after the bounded memory ring has evicted older incidents.
   */
  observe(effect: OccupancyEffect): boolean {
    if (effect.type !== 'commit' || effect.action.kind !== 'carjack' ||
      effect.action.victim !== this.definition.pid || effect.action.id <= this.state.lastIncidentId) return false;
    const s = this.state;
    s.lastIncidentId = effect.action.id;
    s.memories.push({ kind: 'carjacked', actionId: effect.action.id, tick: effect.tick,
      offender: effect.action.actor, vehicle: effect.action.host });
    if (s.memories.length > 8) s.memories.shift();
    s.goal = 'seek-help';
    this.transition('react');
    return true;
  }

  snapshot(): CivilianSnapshot {
    return { version: 1, definition: structuredClone(this.definition), state: this.view() };
  }

  private view(): CivilianState { return structuredClone(this.state); }
  private transition(phase: Exclude<CivilianPhase, 'blocked'>): void {
    this.state.phase = phase;
    this.state.resume = phase;
    this.state.blockedReason = null;
    this.state.revision++;
    this.pendingAction = 0;
  }
  private seated(world: CivilianWorld): boolean {
    const place = world.occupancy.seatOf(this.definition.pid);
    return place?.host === this.definition.vehicle && place.seat === this.definition.seat;
  }
  private token(world: CivilianWorld): OccupancyControl | null {
    const control = world.occupancy.control(this.definition.vehicle);
    return control?.actor === this.definition.pid && world.occupancy.acceptsControl(control) ? control : null;
  }
  private stop(world: CivilianWorld): void { world.stop(this.definition.pid, this.token(world), this.state.revision); }
  private available(world: CivilianWorld, tick: number): boolean {
    if (world.owner(this.definition.vehicle) !== this.definition.vehicleOwner) {
      this.block('vehicle-owner-changed', tick, world);
      return false;
    }
    const occupant = world.occupancy.occupant(this.definition.vehicle, this.definition.seat);
    if (occupant && occupant !== this.definition.pid) {
      this.block('vehicle-in-use', tick, world);
      return false;
    }
    return true;
  }
  private driver(world: CivilianWorld, tick: number): OccupancyControl | null {
    if (!this.available(world, tick)) return null;
    const token = this.token(world);
    if (!token) this.block('control-lost', tick, world);
    return token;
  }
  private block(reason: string, tick: number, world: CivilianWorld): void {
    const s = this.state;
    if (s.phase !== 'blocked') { s.resume = s.phase; s.phase = 'blocked'; s.revision++; }
    s.blockedReason = reason;
    s.nextTick = tick + this.retryTicks;
    this.pendingAction = 0;
    this.stop(world);
  }
  private motion(result: CivilianMotionResult, next: Exclude<CivilianPhase, 'blocked'>, tick: number, world: CivilianWorld): void {
    if (result.revision !== this.state.revision) return;
    if (result.status === 'blocked') this.block(result.reason ?? 'movement-blocked', tick, world);
    else if (result.status === 'arrived') this.transition(next);
  }
  private interact(kind: 'enter' | 'exit', tick: number, world: CivilianWorld): void {
    const d = this.definition;
    const pending = world.occupancy.pending(d.pid);
    if (pending) return;
    if (this.pendingAction) {
      this.block('interaction-interrupted', tick, world);
      return;
    }
    const result = world.occupancy.begin({ actor: d.pid, actorEpoch: this.actorEpoch,
      requestId: this.state.nextRequestId++, host: d.vehicle, seat: d.seat, kind }, tick, this.actionTicks);
    if (!result.ok) this.block(result.reason, tick, world);
    else this.pendingAction = result.action.id;
  }
}

function validateDefinition(d: CivilianDefinition): void {
  if (![d.pid, d.home, d.work, d.vehicle, d.vehicleOwner].every(positive) || !natural(d.departTick) ||
    !/^[a-z][a-z0-9_]{0,47}$/.test(d.seat) ||
    ![d.name, d.occupation, d.backstory, d.route.id].every(s => typeof s === 'string' && s.length > 0 && s.length <= 2048) ||
    !Array.isArray(d.route.waypoints) || d.route.waypoints.length < 1 || d.route.waypoints.length > 64 ||
    !d.route.waypoints.every(point) || !point(d.route.parking) || !point(d.route.workplace)) {
    throw new Error('Invalid civilian definition');
  }
}
function validateState(s: CivilianState, d: CivilianDefinition): void {
  if (!phases.includes(s.phase) || !phases.includes(s.resume) || (s.resume as string) === 'blocked' ||
    !['commute', 'work', 'seek-help'].includes(s.goal) ||
    ![s.revision, s.nextRequestId].every(positive) || ![s.waypoint, s.nextTick, s.lastIncidentId].every(natural) ||
    s.waypoint > d.route.waypoints.length || (s.lastTick !== -1 && !natural(s.lastTick)) ||
    (s.completedDepartTick !== null && s.completedDepartTick !== d.departTick) ||
    (s.blockedReason !== null && (typeof s.blockedReason !== 'string' || s.blockedReason.length > 2048)) ||
    !Array.isArray(s.memories) || s.memories.length > 8) throw new Error('Invalid civilian state');
  let prior = 0;
  for (const memory of s.memories) {
    if (memory.kind !== 'carjacked' || ![memory.actionId, memory.offender, memory.vehicle].every(positive) ||
      !natural(memory.tick) || memory.actionId <= prior || memory.actionId > s.lastIncidentId) throw new Error('Invalid civilian memory');
    prior = memory.actionId;
  }
}
