// What a body weighs: for which bodies stop which (shared/sim/blockers.ts), how a vehicle's contact shares a blow
// (server/vehicle-contacts.ts), and what a seat or a car door carries (server/urban.ts). Client and server read it alike.

import type { Registry } from "../content/registry.ts";

/** A survivor's build. A body with no mass of its own weighs what one of this build would at its volume. */
const BUILD_RADIUS = 0.4;
const BUILD_HEIGHT = 1.8;
const BUILD_KG = 80;

/** Kilograms of a body of `kind` at `scale` times its grown size: its species' mass, or by its volume against a survivor's. */
export function bodyMass(reg: Registry, kind: number, scale = 1): number {
  const m = reg.mass[kind]!;
  const r = reg.bodyRadius[kind]! / BUILD_RADIUS;
  return (m > 0 ? m : BUILD_KG * r * r * (reg.bodyHeight[kind]! / BUILD_HEIGHT)) * scale * scale * scale;
}
