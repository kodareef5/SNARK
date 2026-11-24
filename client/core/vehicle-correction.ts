// Display-only angular correction. Simulation and camera collision retain their explicit poses.
import { quatIdentity, quatMul, quatNlerp, type Numbers } from '../../shared/math/quat.ts';
import type { Body } from '../../shared/sim/character.ts';
const identity = new Float64Array([0, 0, 0, 1]);
/** Time constant, in milliseconds, of the fade that hides a correction: of a place, and of an attitude. */
export const CORRECTION_FADE_MS = 90;
export class VehicleCorrection {
  readonly q = new Float64Array(identity);
  private readonly before = new Float64Array(4);
  private readonly after = new Float64Array(4);
  private readonly previous = new Float64Array(4);
  private readonly current = new Float64Array(4);

  reset(): void { quatIdentity(this.q, 0); }
  get angle(): number { return 2 * Math.acos(Math.min(1, Math.abs(this.q[3]!))); }

  capture(body: Body, previous: Body = body, alpha = 1): void {
    this.interpolate(body, previous, alpha, this.before);
    quatMul(this.before, 0, this.q, 0, this.before, 0);
  }
  captureQuaternion(x: number, y: number, z: number, w: number): void {
    this.before[0] = x; this.before[1] = y; this.before[2] = z; this.before[3] = w;
    quatMul(this.before, 0, this.q, 0, this.before, 0);
  }
  reconcile(body: Body, allow: boolean, previous: Body = body, alpha = 1): void {
    this.interpolate(body, previous, alpha, this.after);
    this.reconcileQuaternion(this.after[0]!, this.after[1]!, this.after[2]!, this.after[3]!, allow);
  }
  reconcileQuaternion(x: number, y: number, z: number, w: number, allow: boolean): void {
    if (!allow) { this.reset(); return; }
    this.after[0] = -x; this.after[1] = -y; this.after[2] = -z; this.after[3] = w;
    quatMul(this.q, 0, this.before, 0, this.after, 0);
    // A large collision correction is still continuous. Only a qualified discontinuity cuts the fade.
  }
  update(dtMs: number): void { quatNlerp(this.q, 0, this.q, 0, identity, 0, 1 - Math.exp(-dtMs / CORRECTION_FADE_MS)); }
  apply(q: Numbers): void { quatMul(q, 0, this.q, 0, q, 0); }

  private interpolate(body: Body, previous: Body, alpha: number, out: Float64Array): void {
    this.previous[0] = previous.vehicleQx; this.previous[1] = previous.vehicleQy;
    this.previous[2] = previous.vehicleQz; this.previous[3] = previous.vehicleQw;
    this.current[0] = body.vehicleQx; this.current[1] = body.vehicleQy;
    this.current[2] = body.vehicleQz; this.current[3] = body.vehicleQw;
    quatNlerp(out, 0, this.previous, 0, this.current, 0, alpha);
  }
}
