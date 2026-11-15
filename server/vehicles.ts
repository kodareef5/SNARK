// Opt-in engine seam: session-independent occupancy, vehicle stepping and attachment publication.
// The production host must call this at its agreed simulation phase and serialize its outputs through the real protocol.
import { vehiclePoint, vehicleRotation } from "../shared/sim/vehicle-frame.ts";
import { stepVehicle, validateVehicleSpec, type VehicleDefinition, type VehicleInput, type VehicleState, type VehicleStep, type VehicleWorld } from "../shared/sim/vehicle.ts";
import { Occupancy, type OccupancyAuthority, type OccupancyControl, type OccupancyEffect } from "./occupancy.ts";

export interface VehicleRecord {
  readonly pid: number;
  readonly handle: number;
  /** Legal title is deliberately independent of the current driver. */
  readonly owner: number;
  readonly definition: VehicleDefinition;
  readonly state: VehicleState;
}

export interface VehicleAttachment {
  actor: number;
  actorHandle: number;
  host: number;
  hostHandle: number;
  seat: string;
  role: "drive" | "passenger";
  position: number[];
  rotation: number[];
}

export interface VehicleTickHooks {
  /** Apply landings, interruption and memories before publishing any observer state. */
  effect(effect: OccupancyEffect): void;
  /** Human input and NPC intent share drive(); this runs after committed seat transitions. */
  plan(): void;
  /** Renderer and hit-capsule consumers resolve the same anchor with their actual body proportions. */
  attach(attachment: VehicleAttachment): void;
  contact?(vehicle: VehicleRecord, result: VehicleStep): void;
}

export class Vehicles {
  readonly occupancy: Occupancy;
  private readonly records = new Map<number, VehicleRecord>();
  private readonly inputs = new Map<number, { token: OccupancyControl; input: VehicleInput }>();
  private readonly world: VehicleWorld;
  private readonly actors: Omit<OccupancyAuthority, "host">;
  private tick = -1;

  constructor(world: VehicleWorld, actors: Omit<OccupancyAuthority, "host">, runtimeEpoch: number) {
    this.world = world;
    this.actors = actors;
    this.occupancy = new Occupancy({ actor: (pid) => actors.actor(pid), check: (action, phase) => actors.check(action, phase), canControl: (actor, host) => actors.canControl(actor, host), host: (pid) => {
      const v = this.records.get(pid);
      return v ? { handle: v.handle, ready: true, speed: Math.sqrt(v.state.vx * v.state.vx + v.state.vz * v.state.vz) } : null;
    } }, { runtimeEpoch });
  }

  add(record: VehicleRecord): void {
    validateVehicleSpec(record.definition.spec);
    if (this.records.has(record.pid) || !Number.isSafeInteger(record.owner) || record.owner <= 0 ||
      !Object.values(record.state).every(Number.isFinite) || record.state.fuel < 0 || record.state.fuel > record.definition.spec.fuelCapacity ||
      record.definition.seats.some((s) => s.anchor.length !== 3 || s.entry.length !== 3 || ![...s.anchor, ...s.entry].every(Number.isFinite))) {
      throw new Error("Invalid vehicle record");
    }
    // Copy content/state at this authority boundary so callers cannot mutate permission-critical identity through aliases.
    const copy: VehicleRecord = { ...record, state: { ...record.state }, definition: {
      id: record.definition.id, spec: { ...record.definition.spec },
      seats: record.definition.seats.map((s) => ({ ...s, anchor: [...s.anchor], entry: [...s.entry] })),
    } };
    this.occupancy.addHost(copy.pid, copy.handle, copy.definition.seats);
    this.records.set(copy.pid, copy);
  }

  get(pid: number): VehicleRecord | null { return this.records.get(pid) ?? null; }

  drive(token: OccupancyControl, input: VehicleInput): boolean {
    if (!this.records.has(token.host) || !this.occupancy.acceptsControl(token)) return false;
    this.inputs.set(token.host, { token: { ...token }, input: { ...input } });
    return true;
  }

  /** One world tick, never a render clock. Lost or stale control brakes the car instead of replaying an old throttle. */
  step(tick: number, hooks: VehicleTickHooks): void {
    if (!Number.isSafeInteger(tick) || tick < 0 || (this.tick >= 0 && tick !== this.tick + 1)) throw new Error("Vehicle tick must advance once");
    this.tick = tick;
    for (const effect of this.occupancy.step(tick)) hooks.effect(effect);
    hooks.plan();
    for (const v of this.records.values()) {
      const command = this.inputs.get(v.pid);
      const input = command && this.occupancy.acceptsControl(command.token) ? command.input : { throttle: 0, steer: 0, brake: 1, handbrake: true };
      const result = stepVehicle(v.state, input, v.definition.spec, this.world);
      if (result.blocked) hooks.contact?.(v, result);
      for (const seat of v.definition.seats) {
        const actor = this.occupancy.occupant(v.pid, seat.id);
        if (!actor) continue;
        const actorHandle = this.occupancy.occupantHandle(v.pid, seat.id);
        const current = this.actors.actor(actor);
        if (!current?.alive || current.handle !== actorHandle) continue;
        const position = [0, 0, 0], rotation = [0, 0, 0, 1];
        vehiclePoint(v.state, seat.anchor, position);
        vehicleRotation(v.state, rotation);
        hooks.attach({ actor, actorHandle, host: v.pid, hostHandle: v.handle, seat: seat.id, role: seat.driver ? "drive" : "passenger", position, rotation });
      }
    }
    this.inputs.clear();
  }
}
