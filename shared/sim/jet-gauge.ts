// A jet's readings, apart from its flight (jet.ts), so the first frame's instruments and views read a jet without the
// flight's code, which comes with the jet's late file (client/core/jet-late.ts).

import { quatNormalize, quatUnrotate } from "../math/quat.ts";
import { clamp, detAtan2 } from "../math/scalar.ts";

/**
 * A jet's throttle, spool and nozzle ride in the rotor fields a body, the store and the wire carry for any aircraft: the
 * collective, the rotor speed and the rotor phase. The jet's family (families/jet.ts) alone writes them; everything else
 * reads them here.
 */
interface JetFields { readonly vehicleCollective: number; readonly vehicleRotorRpm: number; readonly vehicleRotorPhase: number }
/** The pilot's throttle, 0 to 1 of military thrust. */
export const jetThrottle = (b: JetFields): number => b.vehicleCollective;
/** The thrust the engine makes, as a share of military: past 1 with the afterburner lit. */
export const jetSpool = (b: JetFields): number => b.vehicleRotorRpm;
/** How far the nozzle and lift fan are swung to VTOL, 0 to 1. */
export const jetNozzle = (b: JetFields): number => b.vehicleRotorPhase;
/** The same, from vehicle row `v` of the entity columns. */
export const jetThrottleAt = (c: { readonly vehicleCollective: ArrayLike<number> }, v: number): number => c.vehicleCollective[v]!;
export const jetSpoolAt = (c: { readonly vehicleRotorRpm: ArrayLike<number> }, v: number): number => c.vehicleRotorRpm[v]!;
export const jetNozzleAt = (c: { readonly vehicleRotorPhase: ArrayLike<number> }, v: number): number => c.vehicleRotorPhase[v]!;
/** An observer's rotor word for a jet is its nozzle alone, in 255ths, so it costs nothing on the wire while it holds. */
export const packJetNozzle = (nozzle: number): number => Math.round(clamp(nozzle, 0, 1) * 255);
export const unpackJetNozzle = (word: number): number => (word & 255) / 255;
/** The engine speed the drive word carries: idle at 3000, 7000 more at full military thrust. */
export const JET_IDLE_RPM = 3000;
export const JET_RPM_SPAN = 7000;
/** A jet's spool from the engine speed an observer is sent. */
export const jetSpoolOfRpm = (rpm: number, running: boolean): number => Math.max(0, (rpm - (running ? JET_IDLE_RPM : 0)) / JET_RPM_SPAN);

const q = new Float64Array(4), local = new Float64Array(3);

/** The angle of attack of a jet at attitude (qx, qy, qz, qw) moving at (vx, vy, vz): 0 flying backwards or at rest. */
export function jetAngleOfAttack(qx: number, qy: number, qz: number, qw: number, vx: number, vy: number, vz: number): number {
  q[0] = qx; q[1] = qy; q[2] = qz; q[3] = qw;
  quatNormalize(q, 0);
  quatUnrotate(q, 0, vx, vy, vz, local, 0);
  return local[2]! > 1e-3 ? detAtan2(-local[1]!, local[2]!) : 0;
}
