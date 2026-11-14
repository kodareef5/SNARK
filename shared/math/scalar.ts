// Only + - * / Math.floor Math.sqrt Math.abs are used here. The specification requires those to be exactly rounded, so
// JavaScriptCore (server) and V8 (browser) agree to the last bit. Math.sin and the other transcendentals carry no such promise.

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
const INV_TAU = 0.15915494309189535;
const HALF_PI = 1.5707963267948966;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** detSin and detCos have an absolute error below 1e-9. */
export function detSin(x: number): number {
  let t = x * INV_TAU;
  t -= Math.floor(t + 0.5); // turns in [-0.5, 0.5)
  if (t > 0.25) t = 0.5 - t;
  else if (t < -0.25) t = -0.5 - t;
  const a = t * TAU;
  const a2 = a * a;
  return a * (1 + a2 * (-1 / 6 + a2 * (1 / 120 + a2 * (-1 / 5040 + a2 * (1 / 362880 + a2 * (-1 / 39916800 + a2 * (1 / 6227020800)))))));
}

export function detCos(x: number): number {
  return detSin(x + HALF_PI);
}

/** Returns an angle in (-PI, PI] with an absolute error below 2e-5 radians. */
export function detAtan2(y: number, x: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax === 0 && ay === 0) return 0;
  const lo = ax < ay ? ax : ay;
  const hi = ax < ay ? ay : ax;
  const z = lo / hi;
  const z2 = z * z;
  let a = z * (0.999866 + z2 * (-0.3302995 + z2 * (0.180141 + z2 * (-0.085133 + z2 * 0.0208351))));
  if (ay > ax) a = HALF_PI - a;
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}
