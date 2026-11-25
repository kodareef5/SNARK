// A destroyed jet keeps its attitude and momentum and falls as rigid salvage, as a helicopter's wreck does
// (shared/sim/helicopter-wreck.ts). The server alone steps it; observers receive its pose. Its speed is held within the
// jet's own cap, 180 m/s, where a helicopter wreck's is held within 120.
import { TICK_DT } from "../coords.ts";
import { quatAxis, quatMul, quatNlerp, quatNormalize } from "../math/quat.ts";
import { len3 } from "../math/scalar.ts";
import type { JetState, JetWorld } from "./jet.ts";
import { JET_SPEED_CAP, type JetVehicleDefinition } from "./vehicle.ts";

const q = new Float64Array(4), turn = new Float64Array(4), fromQ = new Float64Array(4), toQ = new Float64Array(4);
/** Clamps a wreck's velocity to the jet's speed cap, keeping its direction. */
export function clampJetWreck(s: JetState): void {
  const speed = len3(s.vx, s.vy, s.vz);
  if (speed > JET_SPEED_CAP) { const k = JET_SPEED_CAP / speed; s.vx *= k; s.vy *= k; s.vz *= k; }
}

/** Returns true only when solid support arrests the fall. Impact takes out spin and sliding, never rights the wreck. */
export function stepJetWreck(s: JetState, def: JetVehicleDefinition, world: JetWorld): boolean {
  s.engineOn = false; s.spool = s.throttle = s.engineRpm = 0; s.shiftTime = 0; s.grounded = false;
  clampJetWreck(s);
  const angular = len3(s.pitchRate, s.yawRate, s.rollRate);
  const count = Math.max(2, Math.min(24, Math.ceil((len3(s.vx, s.vy, s.vz) + angular * 8) * TICK_DT / .5)));
  const dt = TICK_DT / count, p = def.spec;
  let supported = false;
  for (let i = 0; i < count; i++) {
    const before = { ...s };
    // In the water it slows hard and sinks; in the air it falls with a little drag.
    const wet = s.y + p.clearance < world.waterAt(s.x, s.z), keep = 1 - (wet ? 2.5 : .05) * dt, spin = 1 - (wet ? 2 : .35) * dt;
    s.vx *= keep; s.vz *= keep; s.vy = wet ? s.vy * keep - 1.5 * dt : s.vy * keep - p.gravity * dt;
    s.pitchRate *= spin; s.yawRate *= spin; s.rollRate *= spin;
    q[0] = s.qx; q[1] = s.qy; q[2] = s.qz; q[3] = s.qw;
    const rate = len3(s.pitchRate, s.yawRate, s.rollRate);
    if (rate > 1e-6) {
      quatAxis(turn, 0, -s.pitchRate / rate, s.yawRate / rate, s.rollRate / rate, rate * dt);
      quatMul(q, 0, q, 0, turn, 0); quatNormalize(q, 0);
      s.qx = q[0]!; s.qy = q[1]!; s.qz = q[2]!; s.qw = q[3]!;
    }
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    let hit = world.blocked(before, s, def);
    if (!hit) continue;
    // The first touching pose, by halving, and its face's normal.
    let nx = hit.nx ?? 0, ny = hit.ny ?? 0, nz = hit.nz ?? 0, low = 0, high = 1;
    const next = { ...s }, safe = { ...before };
    fromQ[0] = before.qx; fromQ[1] = before.qy; fromQ[2] = before.qz; fromQ[3] = before.qw;
    toQ[0] = s.qx; toQ[1] = s.qy; toQ[2] = s.qz; toQ[3] = s.qw;
    for (let probe = 0; probe < 6; probe++) {
      const fraction = (low + high) / 2;
      quatNlerp(q, 0, fromQ, 0, toQ, 0, fraction);
      const candidate = { ...next, x: before.x + (next.x - before.x) * fraction, y: before.y + (next.y - before.y) * fraction, z: before.z + (next.z - before.z) * fraction,
        qx: q[0]!, qy: q[1]!, qz: q[2]!, qw: q[3]! };
      hit = world.blocked(before, candidate, def);
      if (hit) { high = fraction; nx = hit.nx ?? 0; ny = hit.ny ?? 0; nz = hit.nz ?? 0; }
      else { low = fraction; Object.assign(safe, candidate); }
    }
    const into = Math.min(0, s.vx * nx + s.vy * ny + s.vz * nz);
    const vx = (s.vx - into * nx) * .55, vy = (s.vy - into * ny) * .55, vz = (s.vz - into * nz) * .55;
    Object.assign(s, safe, { vx, vy, vz, yawRate: 0, pitchRate: 0, rollRate: 0 });
    const slide = { ...s, x: s.x + vx * dt, y: s.y + vy * dt, z: s.z + vz * dt };
    if (!world.blocked(s, slide, def)) Object.assign(s, slide);
    else { s.vx = s.vy = s.vz = 0; }
    supported ||= ny > .45;
  }
  for (const field of ["x", "y", "z", "vx", "vy", "vz", "qx", "qy", "qz", "qw", "pitchRate", "yawRate", "rollRate"] as const) s[field] = Math.fround(s[field]);
  s.grounded = supported && len3(s.vx, s.vy, s.vz) < .08;
  return s.grounded;
}
