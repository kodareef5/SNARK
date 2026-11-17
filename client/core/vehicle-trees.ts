// Only the local driver's collision view may omit a predicted fracture. Drawing and every other body see native nodes.
import type { Registry } from "../../shared/content/registry.ts";
import { TreeFracture } from "../../shared/sim/vehicle-tree.ts";
import type { VehicleContact, VehicleSpec, VehicleState } from "../../shared/sim/vehicle.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import type { NodeField } from "../../shared/world/nodes.ts";
import { StaticVehicleWorld } from "../../shared/world/vehicle.ts";

const MOST_PREDICTED = 32, WAIT_TICKS = 15;
export class PredictedTrees extends StaticVehicleWorld {
  private readonly fracture: TreeFracture;
  private readonly broken: Map<number, number>;
  private readonly field: NodeField;
  private tick = 0;
  private handle = 0;

  constructor(world: CollisionWorld, reg: Registry, field: NodeField) {
    const broken = new Map<number, number>();
    super(world, undefined, ref => broken.has(ref));
    this.broken = broken; this.field = field; this.fracture = new TreeFracture(reg, field.forms);
  }

  /** Replays must encounter each still-unconfirmed tree again and pay its work exactly once in that timeline. */
  begin(tick: number, handle: number): void {
    if (handle !== this.handle) this.broken.clear();
    this.handle = handle; this.tick = tick;
    for (const [ref, at] of this.broken) if (at >= tick || tick - at > WAIT_TICKS) this.broken.delete(ref);
  }

  /** A later authoritative body without a matching depletion rejects the speculation after a small feed-order grace. */
  acknowledge(tick: number): void {
    for (const [ref, at] of this.broken) if (tick >= at + 3) this.broken.delete(ref);
  }

  /** Reliable authoritative depletion always wins; the rendered/shared field is changed by its ordinary receiver only. */
  confirm(chunk: number, gone: readonly number[]): void {
    for (const [ref] of this.broken) if (Math.floor(ref / 65536) === chunk && gone.includes(ref & 65535)) this.broken.delete(ref);
  }

  breakContact(state: VehicleState, spec: VehicleSpec, hit: VehicleContact): number | null {
    if (!hit.reason.startsWith("node:") || this.broken.size >= MOST_PREDICTED) return null;
    const ref = Number(hit.reason.slice(5)), row = this.field.store.chunks[Math.floor(ref / 65536)], form = row?.kind[ref & 65535] ?? 0;
    const impulse = this.fracture.impulse(state, spec, hit, form);
    if (!Number.isFinite(impulse)) return null;
    this.broken.set(ref, this.tick);
    return this.fracture.apply(state, spec, hit, form, impulse);
  }
}
