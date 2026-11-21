// A wheeled vehicle's shade on itself. The sky's openness (skyopen.ts) is the street's, and a body's own surfaces take
// no contact (contact.ts), so without this a car's wheel arches, its floor and the tops of its tyres were lit by the
// whole sky. Here each is taken down from what the draw already has: the pixel's rest position and normal in the
// vehicle's own space, the rig's wheel centres (whose height is their radius) and the mesh's box. No texture is read.
// The shade takes the sky's light down as the texture's occlusion does; where the art has occlusion baked in, the
// darker of the two is kept, so the compact's bake is not darkened twice. The sun's light is the shadow maps' to take.
//
// The maths is here twice, as functions on numbers for the software rasterizer and as GLSL for SURFACE, which the
// lit probe holds to within one 8-bit level of each other (tools/probe-lit/street-finishes.ts).

/** The most of the sky the deepest part of a wheel arch loses, and the most a face under the floor loses. */
export const ARCH_MOST = 0.84;
export const FLOOR_MOST = 0.6;
/** The most of the sky a tyre's top loses under its arch, and its inner wall facing the car's underside. */
export const TYRE_TOP = 0.75;
export const TYRE_INNER = 0.38;
/** The share of the tyre's shade a wheel's metal takes: a rim's face looks out of the arch, not into it. */
const RIM_SHARE = 0.35;

const clamp = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * The share of the sky a body's own surface keeps past its wheel arches and over the shaded ground under its floor.
 * `p` is the rest position in the mesh's space, `n` the rest normal turned to the side seen, `down` how far the
 * world normal faces down (minus its height), `rest` the rig's rest joints, three numbers a bone, `wheels` the bit of
 * each wheel bone, and `center` and `half` the mesh's box. A rig is mirrored left to right, as every wheeled rig is,
 * so the wheels of one side serve both.
 */
export function bodyOpen(px: number, py: number, pz: number, nx: number, ny: number, nz: number, down: number,
  rest: ArrayLike<number>, wheels: number, center: ArrayLike<number>, half: ArrayLike<number>): number {
  // The wheel whose axle is nearest in the side view, and how far, in its radii.
  let best = 1e9, dx = 0, dy = 0, dz = 0, radius = 1;
  for (let i = 0; i < 32; i++) {
    if (2 ** i > wheels) break;
    if (((wheels >>> i) & 1) === 0 || rest[i * 3]! < 0) continue;
    const r = Math.max(0.12, rest[i * 3 + 1]!);
    const ex = Math.abs(px) - rest[i * 3]!, ey = py - rest[i * 3 + 1]!, ez = pz - rest[i * 3 + 2]!;
    const gap = (ey * ey + ez * ez) / (r * r);
    if (gap < best) {
      best = gap;
      dx = ex;
      dy = ey;
      dz = ez;
      radius = r;
    }
  }
  return archOpen(Math.sqrt(best), dx / radius, dy / radius, dz / radius, px < 0 ? -nx : nx, ny, nz) * floorOpen(px, pz, down, center, half);
}

/**
 * `bodyOpen`'s arch: `rr` is the distance from the axle in the side view and `x`, `y`, `z` the offset from the wheel's
 * centre, outward, up and forward, all in its radii; `n` the rest normal. Inside the arch's reach, most at its top: a
 * face looking squarely at the axle (the liner, the fender's return) is shaded by how far it lies in from the tyre's
 * outer face, a third at the lip; anything inboard of the tyre's inner face (the arch's inner wall, the chassis seen
 * through it) is shaded whole, but a face there looking out past the tyre only behind the tyre itself, since nothing
 * says a liner closes it in above. The outside of the body looks away from the axle, or only a little toward it where
 * it tucks under, so it keeps its sky; on the monster truck, whose body stands inboard of its wheels, only the part
 * behind a tyre is shaded. `n.x` is outward.
 */
export function archOpen(rr: number, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  const len = Math.max(Math.hypot(nx, ny, nz), 1e-6);
  const high = 0.55 + 0.45 * smooth(-0.4, 0.5, y);
  const reach = 1 - smooth(1.25, 1.6, rr), behind = 1 - smooth(1, 1.3, rr);
  const facing = smooth(0.25, 0.85, -(ny * y + nz * z) / (len * Math.max(rr, 1e-4)));
  const lip = smooth(0, 0.7, 0.25 - x), inboard = smooth(0, 0.3, -0.3 - x), outward = Math.max(0, nx / len);
  return 1 - ARCH_MOST * high * Math.max(facing * (0.45 + 0.55 * lip) * reach, inboard * (reach + (behind - reach) * outward));
}

/** `bodyOpen`'s floor: a face turned down over the inside of the mesh's footprint sees the ground the car shades. */
export function floorOpen(px: number, pz: number, down: number, center: ArrayLike<number>, half: ArrayLike<number>): number {
  const qx = Math.abs((px - center[0]!) / half[0]!), qz = Math.abs((pz - center[2]!) / half[2]!);
  return 1 - FLOOR_MOST * smooth(0.5, 0.9, down) * smooth(0.1, 0.35, 1 - Math.max(qx, qz));
}

/**
 * The share of the sky a wheel's surface keeps: its top under the arch and its inner wall less, by `up`, how far it
 * lies above the hub, and `outboard`, how far out along the axle, both in the wheel's radii; `rubber` is how much of
 * it is tyre (street-finish.ts `rubberShare`), and its metal takes a little of the shade.
 */
export function tyreOpen(up: number, outboard: number, rubber: number): number {
  const covered = smooth(0.1, 0.95, up) * (1 - 0.6 * smooth(0.12, 0.3, outboard));
  const inner = 1 - smooth(-0.3, 0, outboard);
  return Math.max(0.12, 1 - (TYRE_TOP * covered + TYRE_INNER * inner) * (RIM_SHARE + (1 - RIM_SHARE) * rubber));
}

/** What the shade reads of the draw, which SURFACE's vertex text reads too. */
export const VEHICLE_SHADE_UNIFORMS = `
uniform vec3 uWheelCenters[32];
uniform highp uint uWheelBones;
uniform vec3 uCenter, uHalf;
`;

/** The twins of `archOpen`, `floorOpen`, `bodyOpen` and `tyreOpen`, after VEHICLE_SHADE_UNIFORMS or the same names as constants. */
export const VEHICLE_SHADE_GLSL = `
float archOpen(float rr, vec3 d, vec3 n) {
  float len = max(length(n), 0.000001), high = 0.55 + 0.45 * smoothstep(-0.4, 0.5, d.y);
  float reach = 1.0 - smoothstep(1.25, 1.6, rr), behind = 1.0 - smoothstep(1.0, 1.3, rr);
  float facing = smoothstep(0.25, 0.85, -dot(n.yz, d.yz) / (len * max(rr, 0.0001)));
  float lip = smoothstep(0.0, 0.7, 0.25 - d.x), inboard = smoothstep(0.0, 0.3, -0.3 - d.x);
  return 1.0 - ${ARCH_MOST} * high * max(facing * (0.45 + 0.55 * lip) * reach, inboard * mix(reach, behind, max(0.0, n.x / len)));
}
float floorOpen(vec3 p, float down) {
  vec2 q = abs((p.xz - uCenter.xz) / uHalf.xz);
  return 1.0 - ${FLOOR_MOST} * smoothstep(0.5, 0.9, down) * smoothstep(0.1, 0.35, 1.0 - max(q.x, q.y));
}
float bodyOpen(vec3 p, vec3 n, float down) {
  float best = 1e9, radius = 1.0;
  vec3 d = vec3(0.0);
  for (int i = 0; i < 32; i++) {
    uint bit = 1u << uint(i);
    if (bit > uWheelBones) break;
    vec3 c = uWheelCenters[i];
    if ((uWheelBones & bit) == 0u || c.x < 0.0) continue;
    float r = max(0.12, c.y);
    vec3 e = vec3(abs(p.x) - c.x, p.yz - c.yz);
    float gap = dot(e.yz, e.yz) / (r * r);
    if (gap < best) {
      best = gap;
      d = e;
      radius = r;
    }
  }
  return archOpen(sqrt(best), d / radius, vec3(p.x < 0.0 ? -n.x : n.x, n.yz)) * floorOpen(p, down);
}
float tyreOpen(float up, float outboard, float rubber) {
  float covered = smoothstep(0.1, 0.95, up) * (1.0 - 0.6 * smoothstep(0.12, 0.3, outboard));
  float inner = 1.0 - smoothstep(-0.3, 0.0, outboard);
  return max(0.12, 1.0 - (${TYRE_TOP} * covered + ${TYRE_INNER} * inner) * (${RIM_SHARE} + ${1 - RIM_SHARE} * rubber));
}
`;
