// Per-vehicle prediction omits fractures without mutating native nodes. Only the local driver consumes reversible presentation events.
import type { Registry } from "../../shared/content/registry.ts";
import { TreeFracture } from "../../shared/sim/vehicle-tree.ts";
import type { VehicleContact, VehicleSpec, VehicleState } from "../../shared/sim/vehicle.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import type { NodeField } from "../../shared/world/nodes.ts";
import { StaticVehicleWorld } from "../../shared/world/vehicle.ts";

export interface TreePresentationEvent {
  action: "break" | "revoke" | "confirm"; ref: number; kind: number; form: number; x: number; y: number; z: number; yaw: number; dx: number; dz: number; tick: number;
}
const MOST_PREDICTED = 32, WAIT_TICKS = 15;
export class PredictedTrees extends StaticVehicleWorld {
  private readonly fracture: TreeFracture;
  private readonly broken: Map<number, number>;
  private readonly field: NodeField;
  private readonly pending = new Map<number, TreePresentationEvent>();
  private readonly shown = new Map<number, TreePresentationEvent>();
  private readonly presented: TreePresentationEvent[] = [];
  private readonly spot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  presentationVersion = 0;
  private tick = 0;
  private handle = 0;

  constructor(world: CollisionWorld, reg: Registry, field: NodeField) {
    const broken = new Map<number, number>();
    super(world, undefined, ref => broken.has(ref));
    this.broken = broken; this.field = field; this.fracture = new TreeFracture(reg, field.forms);
  }

  /** Replays must encounter each still-unconfirmed tree again and pay its work exactly once in that timeline. */
  begin(tick: number, handle: number): void {
    if (handle !== this.handle) { this.broken.clear(); this.pending.clear(); }
    this.handle = handle; this.tick = tick;
    for (const [ref, at] of this.broken) if (at >= tick || tick - at > WAIT_TICKS) this.broken.delete(ref);
    for (const [ref] of this.pending) if (!this.broken.has(ref) && !this.shown.has(ref)) this.pending.delete(ref);
  }

  /** A later authoritative body without a matching depletion rejects the speculation after a small feed-order grace. */
  acknowledge(tick: number): void {
    for (const [ref, at] of this.broken) if (tick >= at + 3) this.broken.delete(ref);
  }

  /** Reliable authoritative depletion always wins; the rendered/shared field is changed by its ordinary receiver only. */
  confirm(chunk: number, gone: readonly number[], crushed: readonly number[] = gone): void {
    for (const [ref] of this.broken) if (Math.floor(ref / 65536) === chunk && gone.includes(ref & 65535)) this.broken.delete(ref);
    // The body acknowledgement may precede its reliable node packet in this same frame. Preserve the fall when the
    // eventual authoritative packet confirms it, even if acknowledge() already removed the collision-only omission.
    for (const entries of [this.pending, this.shown]) for (const [ref, event] of entries) {
      if (Math.floor(ref / 65536) === chunk && gone.includes(ref & 65535)) event.action = crushed.includes(ref & 65535) ? "confirm" : "revoke";
    }
  }

  /** Collision-only view of this vehicle's current prediction/replay timeline. */
  omits(ref: number): boolean { return this.broken.has(ref); }

  /** Only presentation reads this state. Shared collision/node data is never changed speculatively. */
  hidden(ref: number): boolean { return this.shown.has(ref); }
  /** Consume once after all simulation/replay in a frame. Re-fracturing during replay is not another effect. */
  present(): readonly TreePresentationEvent[] {
    const events = this.presented; events.length = 0;
    for (const [ref, event] of this.shown) if (!this.broken.has(ref)) {
      events.push({ ...event, action: event.action === "confirm" ? "confirm" : "revoke" });
      this.shown.delete(ref); this.pending.delete(ref); this.presentationVersion++;
    }
    for (const [ref] of this.broken) if (!this.shown.has(ref)) {
      const event = this.pending.get(ref); if (!event) continue;
      this.shown.set(ref, event); events.push({ ...event, action: "break" }); this.presentationVersion++;
    }
    for (const [ref] of this.pending) if (!this.broken.has(ref) && !this.shown.has(ref)) this.pending.delete(ref);
    return events;
  }

  breakContact(state: VehicleState, spec: VehicleSpec, hit: VehicleContact): number | null {
    if (!hit.reason.startsWith("node:") || this.broken.size >= MOST_PREDICTED) return null;
    const ref = Number(hit.reason.slice(5)), row = this.field.store.chunks[Math.floor(ref / 65536)], form = row?.kind[ref & 65535] ?? 0;
    const impulse = this.fracture.impulse(state, spec, hit, form);
    if (!Number.isFinite(impulse)) return null;
    this.broken.set(ref, this.tick);
    if (!this.shown.has(ref)) {
      const spot = this.spot; this.field.source.at(Math.floor(ref / 65536), ref & 65535, spot);
      this.pending.set(ref, { action: "break", ref, kind: spot.kind, form, x: spot.x, y: spot.y, z: spot.z, yaw: spot.yaw, dx: -hit.nx, dz: -hit.nz, tick: this.tick });
    }
    return this.fracture.apply(state, spec, hit, form, impulse);
  }
}
