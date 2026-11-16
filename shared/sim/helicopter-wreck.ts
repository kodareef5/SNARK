// A destroyed aircraft keeps its complete attitude and momentum. The server alone steps this rigid salvage;
// observers receive its pose, including while inverted. Broken blades no longer collide as a spinning disc.
import { TICK_DT } from "../coords.ts";
import { WET_DAMP, WET_GRAVITY } from "../anim/ragdoll.ts";
import { quatAxis, quatMul, quatNlerp, quatNormalize } from "../math/quat.ts";
import { len3 } from "../math/scalar.ts";
import type { HelicopterState, HelicopterWorld } from "./helicopter.ts";
import type { RotorVehicleDefinition } from "./vehicle.ts";
import { helicopterImmersion } from "./helicopter-immersion.ts";

const q = new Float64Array(4), turn = new Float64Array(4), fromQ = new Float64Array(4), toQ = new Float64Array(4);
const definitions = new WeakMap<RotorVehicleDefinition, RotorVehicleDefinition>();
/** Retains the native cabin, skids, boom and fins. The broken rotor has no live disc. */
export function helicopterWreckDefinition(def: RotorVehicleDefinition): RotorVehicleDefinition {
  let wreck = definitions.get(def);
  if (!wreck) { wreck = { ...def, rotors: [] }; definitions.set(def, wreck); }
  return wreck;
}

/** Returns true only when solid support arrests the fall. Impact dissipates spin and sliding, never rights the wreck. */
export function stepHelicopterWreck(s: HelicopterState, def: RotorVehicleDefinition, world: HelicopterWorld): boolean {
  const wreck = helicopterWreckDefinition(def);
  s.engineOn = false; s.rotorRpm = s.engineRpm = s.collective = 0; s.grounded = false;
  const wet = helicopterImmersion(s, def.spec, world.waterAt(s.x, s.z)) > .5;
  const angular = len3(s.pitchRate, s.yawRate, s.rollRate);
  const count = Math.max(2, Math.min(32, Math.ceil((len3(s.vx, s.vy, s.vz) + angular * 7) * TICK_DT / .12)));
  const dt = TICK_DT / count;
  let supported = false;
  for (let i = 0; i < count; i++) {
    const before = { ...s };
    const drag = wet ? WET_DAMP : .08;
    s.vx *= 1 - drag * dt; s.vy = s.vy * (1 - drag * dt) - (wet ? WET_GRAVITY : def.spec.gravity) * dt; s.vz *= 1 - drag * dt;
    s.pitchRate *= 1 - (wet ? 3 : .35) * dt; s.yawRate *= 1 - (wet ? 3 : .35) * dt; s.rollRate *= 1 - (wet ? 3 : .35) * dt;
    q.set([s.qx, s.qy, s.qz, s.qw]);
    const rate = len3(s.pitchRate, s.yawRate, s.rollRate);
    if (rate > 1e-6) {
      quatAxis(turn, 0, -s.pitchRate / rate, s.yawRate / rate, s.rollRate / rate, rate * dt);
      quatMul(q, 0, q, 0, turn, 0); quatNormalize(q, 0);
      s.qx = q[0]!; s.qy = q[1]!; s.qz = q[2]!; s.qw = q[3]!;
    }
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    let hit = world.blocked(before, s, wreck);
    if (!hit) continue;
    // Find the first contact, rather than stopping as much as one whole substep above a narrow fin or skid.
    // Its normal is also the first touching face, not a side face selected after a deep attempted penetration.
    let nx = hit.nx ?? 0, ny = hit.ny ?? 0, nz = hit.nz ?? 0, low = 0, high = 1;
    const next = { ...s }, safe = { ...before };
    fromQ.set([before.qx, before.qy, before.qz, before.qw]); toQ.set([s.qx, s.qy, s.qz, s.qw]);
    for (let probe = 0; probe < 6; probe++) {
      const fraction = (low + high) / 2;
      quatNlerp(q, 0, fromQ, 0, toQ, 0, fraction);
      const candidate = { ...next, x: before.x + (next.x - before.x) * fraction, y: before.y + (next.y - before.y) * fraction, z: before.z + (next.z - before.z) * fraction,
        qx: q[0]!, qy: q[1]!, qz: q[2]!, qw: q[3]! };
      hit = world.blocked(before, candidate, wreck);
      if (hit) { high = fraction; nx = hit.nx ?? 0; ny = hit.ny ?? 0; nz = hit.nz ?? 0; }
      else { low = fraction; Object.assign(safe, candidate); }
    }
    const into = Math.min(0, s.vx * nx + s.vy * ny + s.vz * nz);
    const vx = (s.vx - into * nx) * .65, vy = (s.vy - into * ny) * .65, vz = (s.vz - into * nz) * .65;
    Object.assign(s, safe, { vx, vy, vz, yawRate: 0, pitchRate: 0, rollRate: 0 });
    const slide = { ...s, x: s.x + vx * dt, y: s.y + vy * dt, z: s.z + vz * dt };
    if (!world.blocked(s, slide, wreck)) Object.assign(s, slide);
    else { s.vx = s.vy = s.vz = 0; }
    supported ||= ny > .45;
  }
  for (const field of ["x", "y", "z", "vx", "vy", "vz", "qx", "qy", "qz", "qw", "pitchRate", "yawRate", "rollRate"] as const) s[field] = Math.fround(s[field]);
  s.grounded = supported && len3(s.vx, s.vy, s.vz) < .08;
  return s.grounded;
}
