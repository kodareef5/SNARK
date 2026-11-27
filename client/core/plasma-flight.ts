// The luminous mesh has its head at local zero and its tail one unit behind it.
export interface PlasmaBore {
  x: number; y: number; z: number;
  dx: number; dy: number; dz: number;
  mx: number; my: number; mz: number;
  bx: number; by: number; bz: number;
  mine: boolean; ammo: number; shooter?: number;
  posed: boolean;
  speed: number;
  born: number;
}

/** The distance over which the picture leaving the bore joins the collision ray from the eye. */
export const PLASMA_LEAVE = 8;

function point(b: PlasmaBore, s: number, join: number, maxBore: number, out: number[]): void {
  const straight = join * 0.5;
  const t = s <= straight ? 0 : s >= join ? 1 : (s - straight) / (join - straight);
  const w = t * t * (3 - 2 * t);
  const bore = Math.min(s, maxBore);
  out[0] = (b.mx + b.bx * bore) * (1 - w) + (b.x + b.dx * s) * w;
  out[1] = (b.my + b.by * bore) * (1 - w) + (b.y + b.dy * s) * w;
  out[2] = (b.mz + b.bz * bore) * (1 - w) + (b.z + b.dz * s) * w;
}

/** Draw both ends on the same path so the tail points back into the bore. */
export function plasmaSegment(b: PlasmaBore, travelled: number, end: number, tailLength: number, now: number, head: number[], tail: number[]): void {
  const age = Math.max(0, now - b.born) * b.speed * 0.001;
  const join = Math.min(PLASMA_LEAVE, end);
  const catchUp = Math.min(1, age / PLASMA_LEAVE);
  // The first frame shows a short tongue of light with its tail touching the muzzle.
  const first = Math.min(0.08, end);
  const s = Math.max(first, Math.min(travelled, age + Math.max(0, travelled - age) * catchUp * catchUp));
  // Clip the barrel line at close contact before blending onto the server line.
  const lead = (b.mx - b.x) * b.dx + (b.my - b.y) * b.dy + (b.mz - b.z) * b.dz;
  const forward = b.bx * b.dx + b.by * b.dy + b.bz * b.dz;
  const maxBore = forward > 0 ? Math.max(0, join - lead) / forward : Infinity;
  if (join <= lead && end <= PLASMA_LEAVE) {
    point(b, join, join, maxBore, head);
    for (let k = 0; k < 3; k++) tail[k] = head[k]!;
    return;
  }
  point(b, s, join, maxBore, head);
  point(b, Math.max(0, s - tailLength), join, maxBore, tail);
}
