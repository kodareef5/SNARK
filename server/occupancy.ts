import { MAX_SEATS, SEAT_ID } from '../shared/sim/seats.ts';

/** Server-owned seat transitions. Persistent IDs are independent of entity slots.
 * Callers apply returned effects synchronously before publishing the tick. Authority
 * callbacks must be pure; they own permissions, door corridors and safe landings.
 */
export type OccupancyKind = 'enter' | 'exit' | 'carjack';
export interface OccupancySeat { id: string; driver?: boolean }
export interface OccupancyLanding { x: number; y: number; z: number; yaw: number }
export interface OccupancyRequest {
  actor: number;
  actorEpoch: number;
  requestId: number;
  host: number;
  seat: string;
  kind: OccupancyKind;
}
export interface OccupancyAction extends OccupancyRequest {
  id: number;
  actorHandle: number;
  hostHandle: number;
  victim: number;
  victimHandle: number;
  seatRevision: number;
  startedAt: number;
  dueAt: number;
  expiresAt: number;
}
export type OccupancyApproval = { ok: true; landing?: OccupancyLanding } | { ok: false; reason: string };
export interface OccupancyAuthority {
  actor(pid: number): { handle: number; alive: boolean; ready: boolean } | null;
  host(pid: number): { handle: number; ready: boolean; speed: number } | null;
  /** Validate access, proximity, door corridor and landing for this phase. */
  check(action: Readonly<OccupancyAction>, phase: 'begin' | 'commit'): OccupancyApproval;
  /** Operation permission is independent of legal ownership and cargo access. */
  canControl(actor: number, host: number): boolean;
}
export interface OccupancyOptions {
  /** Fresh, nonzero server incarnation; never reuse after restoring/restarting. */
  runtimeEpoch: number;
  maxHosts?: number;
  maxActors?: number;
  maxClaims?: number;
  maxDuration?: number;
  expiryGrace?: number;
  maxInteractionSpeed?: number;
}
export interface OccupancyControl {
  host: number;
  hostHandle: number;
  actor: number;
  revision: number;
  runtimeEpoch: number;
}
export type OccupancyEffect =
  | { type: 'commit'; action: Readonly<OccupancyAction>; tick: number;
      landing?: OccupancyLanding; control: OccupancyControl }
  | { type: 'cancel'; action: Readonly<OccupancyAction>; tick: number; reason: string }
  | { type: 'detach'; actor: number; actorHandle: number; host: number; hostHandle: number;
      seat: string; tick: number; control: OccupancyControl };
export type OccupancyBegin = { ok: true; action: Readonly<OccupancyAction> } | { ok: false; reason: string };
export interface OccupancySnapshot {
  version: 1;
  nextActionId: number;
  hosts: { pid: number; controlRevision: number;
    seats: { id: string; actor: number; revision: number }[] }[];
}
interface SeatState { driver: boolean; actor: number; actorHandle: number; revision: number; claim: number }
interface HostState { handle: number; seats: Map<string, SeatState>; controlRevision: number }
interface ActorScope { epoch: number; lastRequest: number }
interface Place { host: number; seat: string }

const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
const revision = (n: number) => Number.isSafeInteger(n) && n >= 0 && n < Number.MAX_SAFE_INTEGER;
const handle = (n: number) => Number.isInteger(n) && n > 0 && n <= 0xffffffff;
const finiteLanding = (p: OccupancyLanding | undefined): p is OccupancyLanding =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && Number.isFinite(p.yaw);

export class Occupancy {
  private readonly authority: OccupancyAuthority;
  private readonly hosts = new Map<number, HostState>();
  private readonly places = new Map<number, Place>();
  private readonly scopes = new Map<number, ActorScope>();
  private readonly claims = new Map<number, Readonly<OccupancyAction>>();
  private readonly actorClaims = new Map<number, number>();
  private readonly limits: Required<OccupancyOptions>;
  private nextActionId = 1;
  private tick = 0;

  constructor(authority: OccupancyAuthority, options: OccupancyOptions) {
    this.authority = authority;
    this.limits = { maxHosts: 1024, maxActors: 4096, maxClaims: 128,
      maxDuration: 900, expiryGrace: 30, maxInteractionSpeed: 1, ...options };
    const l = this.limits;
    if (![l.runtimeEpoch, l.maxHosts, l.maxActors, l.maxClaims, l.maxDuration].every(positive) ||
      !revision(l.expiryGrace) || !Number.isFinite(l.maxInteractionSpeed) || l.maxInteractionSpeed < 0) {
      throw new Error('Invalid occupancy options');
    }
  }

  /** Definitions are registered once. Recycled runtime hosts must be removed first. */
  addHost(pid: number, hostHandle: number, seats: readonly OccupancySeat[]): void {
    if (!positive(pid) || !handle(hostHandle) || this.hosts.has(pid) ||
      this.hosts.size >= this.limits.maxHosts || seats.length > MAX_SEATS) {
      throw new Error('Invalid or duplicate occupancy host');
    }
    const states = new Map<string, SeatState>();
    let drivers = 0;
    for (const seat of seats) {
      if (!SEAT_ID.test(seat.id) || states.has(seat.id)) throw new Error('Invalid seat name');
      if (seat.driver && ++drivers > 1) throw new Error('Multiple driver seats');
      states.set(seat.id, { driver: !!seat.driver, actor: 0, actorHandle: 0, revision: 0, claim: 0 });
    }
    this.hosts.set(pid, { handle: hostHandle, seats: states, controlRevision: 0 });
  }

  /** Monotonic authenticated connection/NPC generation. Same epoch never resets replay state.
   * Rebinding cancels pending work but preserves a committed occupant.
   */
  bindActor(actor: number, actorEpoch: number, now = this.tick): OccupancyEffect[] {
    this.advance(now);
    if (!positive(actor) || !positive(actorEpoch)) throw new Error('Invalid actor scope');
    const old = this.scopes.get(actor);
    if (old && actorEpoch < old.epoch) throw new Error('Stale actor epoch');
    if (old?.epoch === actorEpoch) return [];
    if (!old && this.scopes.size >= this.limits.maxActors) throw new Error('Actor scope capacity reached');
    const effects = this.cancel(actor, now, 'actor-rebound');
    this.scopes.set(actor, { epoch: actorEpoch, lastRequest: 0 });
    // A replacement input producer must not inherit delayed controls from its predecessor.
    const place = this.places.get(actor);
    const host = place ? this.hosts.get(place.host) : undefined;
    if (host && host.seats.get(place!.seat)?.driver) host.controlRevision++;
    return effects;
  }

  /** Explicit retirement only; caller must never reuse the retired actor epoch. */
  retireActor(actor: number, now = this.tick): OccupancyEffect[] {
    if (this.places.has(actor)) throw new Error('Cannot retire a seated actor');
    const effects = this.cancel(actor, now, 'actor-retired');
    this.scopes.delete(actor);
    return effects;
  }

  begin(request: OccupancyRequest, now: number, duration: number): OccupancyBegin {
    this.advance(now);
    const scope = this.scopes.get(request.actor);
    if (!scope || request.actorEpoch !== scope.epoch) return { ok: false, reason: 'actor-epoch' };
    if (!positive(request.requestId) || request.requestId <= scope.lastRequest) return { ok: false, reason: 'request-replayed' };
    // Consume even refused requests; retrying requires a new authenticated request id.
    scope.lastRequest = request.requestId;
    if (!positive(duration) || duration > this.limits.maxDuration ||
      !revision(now + duration + this.limits.expiryGrace)) return { ok: false, reason: 'duration' };
    if (this.claims.size >= this.limits.maxClaims) return { ok: false, reason: 'claim-capacity' };
    const host = this.hosts.get(request.host);
    const seat = host?.seats.get(request.seat);
    if (!host || !seat) return { ok: false, reason: 'seat-missing' };
    if (seat.claim || this.actorClaims.has(request.actor)) return { ok: false, reason: 'claimed' };
    const place = this.places.get(request.actor);
    if (request.kind === 'exit') {
      if (seat.actor !== request.actor || place?.host !== request.host || place.seat !== request.seat) {
        return { ok: false, reason: 'not-occupant' };
      }
    } else if (request.kind === 'enter' || request.kind === 'carjack') {
      if (place) return { ok: false, reason: 'already-seated' };
      if (request.kind === 'enter' && seat.actor) return { ok: false, reason: 'occupied' };
      if (request.kind === 'carjack' && (!seat.driver || !seat.actor || seat.actor === request.actor)) {
        return { ok: false, reason: 'no-driver-victim' };
      }
    } else return { ok: false, reason: 'kind' };
    const victim = request.kind === 'carjack' ? seat.actor : 0;
    if (victim && this.actorClaims.has(victim)) return { ok: false, reason: 'victim-claimed' };
    const actorState = this.authority.actor(request.actor);
    const victimState = victim ? this.authority.actor(victim) : null;
    if (!actorState || (victim && !victimState)) return { ok: false, reason: 'actor-missing' };
    if (!revision(this.nextActionId) || !revision(seat.revision + 1) || !revision(host.controlRevision + 1)) {
      return { ok: false, reason: 'revision-exhausted' };
    }
    const action: Readonly<OccupancyAction> = Object.freeze({ ...request, id: this.nextActionId,
      actorHandle: actorState.handle, hostHandle: host.handle, victim, victimHandle: victimState?.handle ?? 0,
      seatRevision: seat.revision, startedAt: now, dueAt: now + duration,
      expiresAt: now + duration + this.limits.expiryGrace });
    const approval = this.validate(action, 'begin');
    if (!approval.ok) return approval;
    this.nextActionId++;
    this.claims.set(action.id, action);
    seat.claim = action.id;
    this.actorClaims.set(action.actor, action.id);
    if (victim) this.actorClaims.set(victim, action.id);
    return { ok: true, action };
  }

  /** Fixed-tick owner calls this before publishing effects/replication. */
  step(now: number): OccupancyEffect[] {
    this.advance(now);
    const effects: OccupancyEffect[] = [];
    for (const action of this.claims.values()) {
      if (now > action.expiresAt) {
        effects.push(this.drop(action, now, 'expired'));
        continue;
      }
      const state = this.stateReason(action);
      if (state) {
        effects.push(this.drop(action, now, state));
        continue;
      }
      if (now < action.dueAt) continue;
      const approval = this.validate(action, 'commit');
      if (!approval.ok) {
        effects.push(this.drop(action, now, approval.reason));
        continue;
      }
      const host = this.hosts.get(action.host)!;
      const seat = host.seats.get(action.seat)!;
      this.release(action);
      if (action.kind === 'exit') {
        seat.actor = 0;
        seat.actorHandle = 0;
        this.places.delete(action.actor);
      } else {
        if (action.victim) this.places.delete(action.victim);
        seat.actor = action.actor;
        seat.actorHandle = action.actorHandle;
        this.places.set(action.actor, { host: action.host, seat: action.seat });
      }
      seat.revision++;
      if (seat.driver) host.controlRevision++;
      effects.push({ type: 'commit', action, tick: now,
        ...(approval.landing ? { landing: { ...approval.landing } } : {}), control: this.control(action.host)! });
    }
    return effects;
  }

  cancel(actor: number, now = this.tick, reason = 'cancelled'): OccupancyEffect[] {
    this.advance(now);
    const id = this.actorClaims.get(actor);
    const action = id === undefined ? undefined : this.claims.get(id);
    return action ? [this.drop(action, now, reason)] : [];
  }

  /** Interrupt pending work on knockout/disconnect. Detach only dead/removed actors;
   * living occupants require a validated exit so invalidation never drops them into walls.
   */
  invalidateActor(actor: number, now = this.tick): OccupancyEffect[] {
    const effects = this.cancel(actor, now, 'actor-invalidated');
    const place = this.places.get(actor);
    const state = this.authority.actor(actor);
    if (!place || state?.alive) return effects;
    return [...effects, this.unseat(actor, place, now)];
  }

  /** The actor leaves its seat now, alive or not, because its body is leaving the world: the caller stands it somewhere. */
  remove(actor: number, now = this.tick): OccupancyEffect[] {
    const effects = this.cancel(actor, now, 'actor-removed');
    const place = this.places.get(actor);
    return place ? [...effects, this.unseat(actor, place, now)] : effects;
  }

  private unseat(actor: number, place: Place, now: number): OccupancyEffect {
    const host = this.hosts.get(place.host)!;
    const seat = host.seats.get(place.seat)!;
    const actorHandle = seat.actorHandle;
    seat.actor = 0;
    seat.actorHandle = 0;
    seat.revision++;
    this.places.delete(actor);
    if (seat.driver) host.controlRevision++;
    return { type: 'detach', actor, actorHandle, host: place.host,
      hostHandle: host.handle, seat: place.seat, tick: now, control: this.control(place.host)! };
  }

  /** Occupied hosts must survive as disabled wrecks until validated exits/deaths resolve. */
  removeHost(pid: number): boolean {
    const host = this.hosts.get(pid);
    if (!host) return false;
    for (const seat of host.seats.values()) if (seat.actor || seat.claim) return false;
    return this.hosts.delete(pid);
  }

  /** The host's entity is gone (destroyed, despawned, slot recycled). Pending work on it is
   * cancelled, every occupant is detached whether alive or not, and the definition is
   * removed so the PID can register again. The caller stands living occupants up.
   */
  evictHost(pid: number, now = this.tick): OccupancyEffect[] {
    this.advance(now);
    const host = this.hosts.get(pid);
    if (!host) return [];
    const effects: OccupancyEffect[] = [];
    for (const action of [...this.claims.values()]) if (action.host === pid) effects.push(this.drop(action, now, 'host-removed'));
    for (const [id, seat] of host.seats) {
      if (!seat.actor) continue;
      const actor = seat.actor, actorHandle = seat.actorHandle;
      seat.actor = 0; seat.actorHandle = 0; seat.revision++;
      this.places.delete(actor);
      if (seat.driver) host.controlRevision++;
      effects.push({ type: 'detach', actor, actorHandle, host: pid, hostHandle: host.handle, seat: id, tick: now,
        control: { host: pid, hostHandle: host.handle, actor: 0, revision: host.controlRevision, runtimeEpoch: this.limits.runtimeEpoch } });
    }
    this.hosts.delete(pid);
    return effects;
  }
  /** Idle actors (no seat, no pending claim) may be retired so the scope table stays bounded. */
  idle(actor: number): boolean { return !this.places.has(actor) && !this.actorClaims.has(actor); }

  seatOf(actor: number): Readonly<Place> | null {
    const place = this.places.get(actor);
    return place ? { ...place } : null;
  }
  occupant(host: number, seat: string): number { return this.hosts.get(host)?.seats.get(seat)?.actor ?? 0; }
  /** Captured runtime identity; a rematerialized PID must not inherit an old body's attachment. */
  occupantHandle(host: number, seat: string): number { return this.hosts.get(host)?.seats.get(seat)?.actorHandle ?? 0; }
  pending(actor: number): Readonly<OccupancyAction> | null {
    const id = this.actorClaims.get(actor);
    return id === undefined ? null : this.claims.get(id) ?? null;
  }
  control(pid: number): OccupancyControl | null {
    const host = this.hosts.get(pid);
    if (!host) return null;
    let actor = 0;
    let actorHandle = 0;
    for (const seat of host.seats.values()) if (seat.driver) { actor = seat.actor; actorHandle = seat.actorHandle; }
    const actorState = actor ? this.authority.actor(actor) : null;
    const hostState = this.authority.host(pid);
    if (!actorState?.alive || !actorState.ready || actorState.handle !== actorHandle || !handle(actorHandle) || !hostState?.ready || hostState.handle !== host.handle ||
      !this.authority.canControl(actor, pid)) actor = 0;
    return { host: pid, hostHandle: host.handle, actor, revision: host.controlRevision, runtimeEpoch: this.limits.runtimeEpoch };
  }
  acceptsControl(token: OccupancyControl): boolean {
    const current = this.control(token.host);
    return !!current && token.actor !== 0 && current.actor === token.actor &&
      current.hostHandle === token.hostHandle && current.revision === token.revision &&
      current.runtimeEpoch === token.runtimeEpoch;
  }

  snapshot(): OccupancySnapshot {
    return { version: 1, nextActionId: this.nextActionId,
      hosts: [...this.hosts].sort(([a], [b]) => a - b).map(([pid, host]) => ({ pid,
        controlRevision: host.controlRevision,
        seats: [...host.seats].map(([id, seat]) => ({ id, actor: seat.actor, revision: seat.revision })) })) };
  }

  /** Load into registered current definitions. Reject invalid saves atomically. Runtime
   * handles, pending claims and request scopes are never saved. Bind fresh actor epochs
   * afterward; use a fresh constructor runtimeEpoch for each server incarnation.
   */
  restore(snapshot: OccupancySnapshot): void {
    if (snapshot.version !== 1 || !positive(snapshot.nextActionId)) throw new Error('Invalid occupancy snapshot');
    const staged = new Map<number, HostState>();
    const places = new Map<number, Place>();
    for (const saved of snapshot.hosts) {
      const existing = this.hosts.get(saved.pid);
      if (!existing || staged.has(saved.pid) || !revision(saved.controlRevision) ||
        !revision(Math.max(saved.controlRevision, existing.controlRevision) + 1) ||
        saved.seats.length !== existing.seats.size) throw new Error('Invalid saved host');
      const seats = new Map<string, SeatState>();
      for (const savedSeat of saved.seats) {
        const definition = existing.seats.get(savedSeat.id);
        if (!definition || seats.has(savedSeat.id) || !revision(savedSeat.revision) ||
          (savedSeat.actor !== 0 && !positive(savedSeat.actor))) throw new Error('Invalid saved seat');
        if (savedSeat.actor) {
          if (places.has(savedSeat.actor) || !this.authority.actor(savedSeat.actor)?.alive) {
            throw new Error('Duplicate or missing saved actor');
          }
          places.set(savedSeat.actor, { host: saved.pid, seat: savedSeat.id });
        }
        seats.set(savedSeat.id, { driver: definition.driver, actor: savedSeat.actor, actorHandle: this.authority.actor(savedSeat.actor)?.handle ?? 0, revision: savedSeat.revision, claim: 0 });
      }
      staged.set(saved.pid, { handle: existing.handle, seats, controlRevision: Math.max(saved.controlRevision, existing.controlRevision) + 1 });
    }
    if (staged.size !== this.hosts.size || places.size > this.limits.maxActors) throw new Error('Incomplete occupancy snapshot');
    this.hosts.clear();
    for (const [pid, host] of staged) this.hosts.set(pid, host);
    this.places.clear();
    for (const [pid, place] of places) this.places.set(pid, place);
    this.claims.clear();
    this.actorClaims.clear();
    this.scopes.clear();
    this.nextActionId = Math.max(this.nextActionId, snapshot.nextActionId);
  }

  private advance(now: number): void {
    if (!revision(now) || now < this.tick) throw new Error('Occupancy tick must be monotonic');
    this.tick = now;
  }
  private stateReason(action: Readonly<OccupancyAction>): string | null {
    const host = this.hosts.get(action.host);
    const seat = host?.seats.get(action.seat);
    if (!host || !seat || host.handle !== action.hostHandle || seat.revision !== action.seatRevision) return 'seat-changed';
    const expected = action.kind === 'enter' ? 0 : action.kind === 'exit' ? action.actor : action.victim;
    if (seat.actor !== expected) return 'occupant-changed';
    const hostState = this.authority.host(action.host);
    if (!hostState?.ready || hostState.handle !== action.hostHandle || !handle(hostState.handle)) return 'host-invalid';
    // Nobody gets into a moving vehicle or pulls its driver out, but anyone may get out of one, as a rider may always get off.
    if (action.kind !== 'exit' && (!Number.isFinite(hostState.speed) || Math.abs(hostState.speed) > this.limits.maxInteractionSpeed)) return 'host-moving';
    const actor = this.authority.actor(action.actor);
    if (!actor?.alive || !actor.ready || actor.handle !== action.actorHandle || !handle(actor.handle)) return 'actor-invalid';
    if (action.victim) {
      const victim = this.authority.actor(action.victim);
      // A driver who cannot act (tangled) can still be pulled out; one who cannot act is no shield for the car.
      if (!victim?.alive || victim.handle !== action.victimHandle || !handle(victim.handle)) return 'victim-invalid';
    }
    return null;
  }
  private validate(action: Readonly<OccupancyAction>, phase: 'begin' | 'commit'): OccupancyApproval {
    const reason = this.stateReason(action);
    if (reason) return { ok: false, reason };
    let approval: OccupancyApproval;
    try { approval = this.authority.check(action, phase); }
    catch { return { ok: false, reason: 'authority-error' }; }
    if (!approval.ok) return { ok: false, reason: approval.reason };
    if (action.kind !== 'enter' && !finiteLanding(approval.landing)) return { ok: false, reason: 'landing-required' };
    return approval.landing ? { ok: true, landing: { ...approval.landing } } : { ok: true };
  }
  private release(action: Readonly<OccupancyAction>): void {
    this.claims.delete(action.id);
    this.actorClaims.delete(action.actor);
    if (action.victim) this.actorClaims.delete(action.victim);
    const seat = this.hosts.get(action.host)?.seats.get(action.seat);
    if (seat?.claim === action.id) seat.claim = 0;
  }
  private drop(action: Readonly<OccupancyAction>, tick: number, reason: string): OccupancyEffect {
    this.release(action);
    return { type: 'cancel', action, tick, reason };
  }
}
