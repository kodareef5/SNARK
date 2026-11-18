// Where a thing that moves meets what it stands on, on a tier with a light target (Tier.post). The baked measure of the
// sky (skyopen.ts) knows the city and the foot of what stands; a car, a creature or a player gets the measure of the
// ground under it and none of its own, and the ground under it none of it. So each of the CONTACTS bodies nearest the
// camera is an upright ellipsoid in the frame block, and the sky's light on the ground, a piece or a static mesh near
// one is taken down by how much of the sky the ellipsoid hides from it, as a sphere hides it seen from a surface:
// the square of its radius over the square of its distance, times the cosine of its way off the surface's normal, the
// surface moved into the ellipsoid's own frame where it is a sphere of radius 1. A body's own surfaces take none, and
// nor does the sun's light. Any other tier, and the rasterizer, draw none.

import { CUE_DEAD } from "../../../shared/anim/pose.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import type { RemoteSample } from "../session.ts";
import { FRAME, MAX_CONTACTS } from "./packet.ts";

/** The most of the sky's light contact takes, where a body hides all of it. */
export const CONTACT_MOST = 0.8;
/** Metres from the camera past which a body is left out: its contact is under a pixel or two. */
const CONTACT_REACH = 60;

const near: number[] = [];
const at = new Float64Array(MAX_CONTACTS * 8);

/**
 * Fills the frame block's contact (packet.ts fContact) with the MAX_CONTACTS bodies of `remote` nearest the camera
 * at `cam`, and `own`, the viewer's own body, where it stands; none on a tier with no light target, or with `on` false.
 * Each is two slots: its middle, camera-relative, and the cosine of its yaw; then its half extents across, up and
 * along, and the sine of its yaw. A list shorter than the slots ends at a half extent of 0.
 */
export function contactFrame(frame: Float32Array, on: boolean, reg: Pick<Registry, "bodyRadius" | "bodyHeight" | "vehicle">, remote: RemoteSample | null, own: { kind: number; x: number; y: number; z: number; yaw: number } | null, cam: { x: number; y: number; z: number }): void {
  frame.fill(0, FRAME.contact, FRAME.contact + MAX_CONTACTS * 8);
  if (!on) return;
  near.length = 0;
  const n = remote?.count ?? 0;
  for (let i = 0; i <= n; i++) {
    const body = i < n ? { kind: remote!.kind[i]!, x: remote!.x[i]!, y: remote!.y[i]!, z: remote!.z[i]!, yaw: remote!.yaw[i]! } : own;
    if (!body || (i < n && (remote!.cue[i]! & CUE_DEAD) !== 0)) continue;
    const d = Math.hypot(body.x - cam.x, body.y - cam.y, body.z - cam.z);
    if (d > CONTACT_REACH || reg.bodyRadius[body.kind]! <= 0) continue;
    near.push(d, i);
  }
  // Nearest first, by insertion: the list is short.
  const count = near.length / 2;
  const order = Array.from({ length: count }, (_, k) => k).sort((a, b) => near[a * 2]! - near[b * 2]!);
  for (let k = 0; k < Math.min(count, MAX_CONTACTS); k++) {
    const i = near[order[k]! * 2 + 1]!;
    const body = i < n ? { kind: remote!.kind[i]!, x: remote!.x[i]!, y: remote!.y[i]!, z: remote!.z[i]!, yaw: remote!.yaw[i]! } : own!;
    // A vehicle is the box its driving numbers give, a creature or a player its upright body.
    const spec = reg.vehicle[body.kind]?.spec;
    const [across, up, along] = spec ? [spec.halfWidth, spec.height / 2, spec.halfLength] : [reg.bodyRadius[body.kind]!, reg.bodyHeight[body.kind]! / 2, reg.bodyRadius[body.kind]!];
    const o = k * 8;
    [at[o], at[o + 1], at[o + 2], at[o + 3]] = [body.x - cam.x, body.y + up - cam.y, body.z - cam.z, Math.cos(body.yaw)];
    [at[o + 4], at[o + 5], at[o + 6], at[o + 7]] = [across, up, along, Math.sin(body.yaw)];
  }
  frame.set(at.subarray(0, Math.min(count, MAX_CONTACTS) * 8), FRAME.contact);
}

/** The share of the sky's light left to a surface at `rel`, camera-relative, facing `n`, by the bodies in `frame`: the twin of the GLSL. */
export function contactShare(frame: ArrayLike<number>, rel: ArrayLike<number>, n: ArrayLike<number>): number {
  let keep = 1;
  for (let k = 0; k < MAX_CONTACTS; k++) {
    const o = FRAME.contact + k * 8;
    const [c, s, ax, ay, az, bx, by, bz] = [frame[o + 3]!, frame[o + 7]!, frame[o]!, frame[o + 1]!, frame[o + 2]!, frame[o + 4]!, frame[o + 5]!, frame[o + 6]!];
    if (bx <= 0) break;
    const [dx, dy, dz] = [rel[0]! - ax, rel[1]! - ay, rel[2]! - az];
    const [qx, qy, qz] = [(c * dx - s * dz) / bx, dy / by, (s * dx + c * dz) / bz];
    const l2 = qx * qx + qy * qy + qz * qz;
    if (l2 > 25) continue;
    const [mx, my, mz] = [(c * n[0]! - s * n[2]!) * bx, n[1]! * by, (s * n[0]! + c * n[2]!) * bz];
    const cos = -(mx * qx + my * qy + mz * qz) / (Math.hypot(mx, my, mz) * Math.sqrt(l2));
    keep *= 1 - (CONTACT_MOST * Math.min(Math.max(cos, 0), 1)) / Math.max(l2, 1);
  }
  return keep;
}

const g = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));

/**
 * `contact` as GLSL, after the frame block: the share of the sky's light left to a surface at `rel` facing `n` by the
 * bodies in fContact, 1 where `on` is 0 (a body's own surfaces) and on a tier that does not define CONTACT.
 */
export const CONTACT_GLSL = `float contact(vec3 rel, vec3 n, float on) {
#ifdef CONTACT
  float keep = 1.0;
  for (int k = 0; k < ${MAX_CONTACTS} && on > 0.5; k++) {
    vec4 a = fContact[k * 2], b = fContact[k * 2 + 1];
    if (b.x <= 0.0) break;
    vec3 d = rel - a.xyz;
    float c = a.w, s = b.w;
    vec3 q = vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z) / b.xyz;
    float l2 = dot(q, q);
    if (l2 > 25.0) continue;
    vec3 m = normalize(vec3(c * n.x - s * n.z, n.y, s * n.x + c * n.z) * b.xyz);
    keep *= 1.0 - ${g(CONTACT_MOST)} * clamp(-dot(m, q) * inversesqrt(l2), 0.0, 1.0) / max(l2, 1.0);
  }
  return keep;
#else
  return 1.0;
#endif
}
`;
