// A supply drop's cast in the sky (planning/workstreams/supply.md): the streak that leaves the sender's knot of storm
// and crosses to where the drop will land, and the strike of lightning the knot makes as it leaves. Both are drawn by
// the sky dome, where the obelisk's beam and storm are, so a streak has no far limit and meets its storm in one text.
//
// The scene writes the frame's lanes (packet.ts fDrops) from the drops' poses, and the dome reads them; the software
// renderer runs the same arithmetic. A streak is a line in the sky from where its tail ends to its head: white at the
// head, the tier's colour behind it, thinning to nothing. It only ever moves along its path.

import type { SupplyList } from "../../../shared/sim/supply.ts";
import { POSE_FLYING, newPose, supplyPose } from "../../../shared/sim/supply.ts";
import { EYE_COLORS, type TideEyeSite } from "../../../shared/world/tide-eye.ts";
import { DROPS_AT, DROP_STREAKS } from "./packet.ts";
import { DROP_TINT_GLSL, dropTint } from "./supply-light.ts";

/** Seconds of its flight a streak's tail is long. */
export const TRAIL_SECONDS = 4;
/** Seconds after its cast leaves over which a streak comes up, and the share of its flight over which it goes as it nears its shaft. */
export const STREAK_RISE = 0.5;
export const STREAK_ENDS = 0.07;
/** The least a streak is wide, as an angle in radians, and how many pixels it is never under. */
export const STREAK_WIDTH = 0.0016;
export const STREAK_PIXELS = 1.3;
/** Seconds before a cast leaves that the knot flickers, and the seconds its flash takes to fall to a third. */
export const CAST_FLICKER = 1.4;
export const CAST_FALL = 0.5;
/** How many times a storm's own strike the cast's is: the knot lights through, and its bolt is the brightest the storm makes. */
export const CAST_STRIKE = 1.6;
/** How many of its own widths a streak's head glows out to, faintly: a falling star is seen coming straight at the eye too. */
export const STREAK_HALO = 7;

const smooth = (v: number): number => {
  const a = v < 0 ? 0 : v > 1 ? 1 : v;
  return a * a * (3 - 2 * a);
};

/**
 * How strongly a sender's knot flashes `seconds` after its cast left (negative before): a few flickers as it gathers,
 * each stronger than the last, the strike as it leaves, and a fall after it. 0 to 1.
 */
export function castFlash(seconds: number): number {
  if (seconds >= 0) return Math.exp(-seconds / CAST_FALL);
  if (seconds < -CAST_FLICKER) return 0;
  // Three flickers, a third of the gathering each: on for the first third of its own time.
  const u = (seconds + CAST_FLICKER) / CAST_FLICKER;
  const k = Math.floor(u * 3);
  const within = u * 3 - k;
  return within < 0.35 ? 0.12 + 0.1 * k : 0;
}

/** Which place of fEyes a site has this frame (tide-eye.ts writeEyeSky): the sites whose mechanism is open take them in order. -1 for none. */
export function eyeSlot(sites: readonly TideEyeSite[], eye: number, seconds: number, slots: number): number {
  let count = 0;
  for (let i = 0; i < sites.length; i++) {
    const phase = (((seconds + EYE_COLORS.indexOf(sites[i]!.color) * 40) % 120) + 120) % 120;
    // As `aperture` has it: shut for the first six seconds of a cycle.
    const open = phase > 6 && phase < 120;
    if (!open) continue;
    if (i === eye) return count < slots ? count : -1;
    if (++count === slots) return -1;
  }
  return -1;
}

const pose = newPose();
const head = [0, 0, 0];

/**
 * The frame's lanes for the drops' casts: a streak for each of the first four drops in flight whose head is over the
 * horizon from the eye at (x, y, z), and for each obelisk that is sending one, its strike. `seconds` is the obelisks'
 * clock, by which their places in fEyes are known.
 */
export function writeDropSky(frame: Float32Array, list: SupplyList | null, tick: number, rate: number, x: number, y: number, z: number, sites: readonly TideEyeSite[], seconds: number): void {
  frame.fill(0, DROPS_AT, DROPS_AT + (DROP_STREAKS * 2 + 3) * 4);
  if (!list) return;
  let streaks = 0;
  for (const row of list.rows) {
    const since = (tick - row.release) / rate;
    // The sender's strike, about the moment its cast leaves.
    if (row.eye < sites.length && since > -CAST_FLICKER && since < 6 * CAST_FALL) {
      const slot = eyeSlot(sites, row.eye, seconds, 3);
      const flash = castFlash(since);
      const at = DROPS_AT + (DROP_STREAKS * 2 + slot) * 4;
      if (slot >= 0 && flash * CAST_STRIKE > frame[at + 2]!) {
        const far = Math.hypot(row.x - row.ox, row.z - row.oz) || 1;
        frame[at] = (row.x - row.ox) / far;
        frame[at + 1] = (row.z - row.oz) / far;
        frame[at + 2] = flash * CAST_STRIKE;
        frame[at + 3] = 4096 + row.id;
      }
    }
    if (streaks === DROP_STREAKS) continue;
    supplyPose(row, tick, rate, pose);
    if (pose.state !== POSE_FLYING) continue;
    head[0] = pose.x - x;
    head[1] = pose.y - y;
    head[2] = pose.z - z;
    const along = pose.along;
    const far = Math.hypot(head[0]!, head[1]!, head[2]!);
    // Under the horizon the dome is not seen there: the scene draws its trail as a piece of light instead.
    if (far < 1 || head[1]! / far < -0.01) continue;
    supplyPose(row, Math.max(row.release, tick - TRAIL_SECONDS * rate), rate, pose);
    const tx = pose.x - x, ty = pose.y - y, tz = pose.z - z, tail = Math.hypot(tx, ty, tz) || 1;
    const at = DROPS_AT + streaks++ * 8;
    frame[at] = head[0]! / far;
    frame[at + 1] = head[1]! / far;
    frame[at + 2] = head[2]! / far;
    frame[at + 3] = smooth(since / STREAK_RISE) * (1 - smooth((along - (1 - STREAK_ENDS)) / STREAK_ENDS));
    frame[at + 4] = tx / tail;
    frame[at + 5] = ty / tail;
    frame[at + 6] = tz / tail;
    frame[at + 7] = list.tiers[row.tier]?.rgb ?? 0xffffff;
  }
}

const tint = [0, 0, 0];

/** The light the streaks add along a ray from the eye, into `out`: `px` is the angle a pixel spans. */
export function dropStreaks(frame: Float32Array, dx: number, dy: number, dz: number, px: number, out: Float64Array | number[]): void {
  out[0] = out[1] = out[2] = 0;
  for (let k = 0; k < DROP_STREAKS; k++) {
    const at = DROPS_AT + k * 8, power = frame[at + 3]!;
    if (power <= 0) continue;
    const hx = frame[at]!, hy = frame[at + 1]!, hz = frame[at + 2]!;
    const tx = frame[at + 4]!, ty = frame[at + 5]!, tz = frame[at + 6]!;
    const ax = hx - tx, ay = hy - ty, az = hz - tz;
    const s = Math.max(0, Math.min(1, ((dx - tx) * ax + (dy - ty) * ay + (dz - tz) * az) / Math.max(1e-9, ax * ax + ay * ay + az * az)));
    // The nearest point of its arc: the chord's, brought out to the sky, since a long tail is an arc and not a line.
    const cx = tx + s * ax, cy = ty + s * ay, cz = tz + s * az, cl = Math.hypot(cx, cy, cz) || 1;
    const off = Math.hypot(dx - cx / cl, dy - cy / cl, dz - cz / cl);
    const w = Math.max(STREAK_WIDTH, STREAK_PIXELS * px);
    const trail = Math.exp(-(off * off) / (w * w)) * s * s;
    const gap = (dx - hx) ** 2 + (dy - hy) ** 2 + (dz - hz) ** 2;
    const tip = Math.exp(-gap / (4 * w * w));
    const halo = Math.exp(-Math.sqrt(gap) / (STREAK_HALO * w));
    dropTint(frame[at + 7]!, tint);
    for (let c = 0; c < 3; c++) out[c]! += power * (tint[c]! * (2.4 * trail + 1.2 * tip + 0.5 * halo) + 3.2 * tip + 0.5 * trail * s * s);
  }
}

const f = (v: number): string => (Number.isInteger(v) ? `${v}.0` : String(v));

/** The same in GLSL, for a dome text that has the frame block. */
export const DROP_SKY_GLSL = `${DROP_TINT_GLSL}
vec3 dropStreaks(vec3 d, float px) {
  vec3 light = vec3(0.0);
  for (int k = 0; k < ${DROP_STREAKS}; k++) {
    vec4 h = fDrops[k*2], t = fDrops[k*2+1];
    if (h.w <= 0.0) continue;
    vec3 ab = h.xyz - t.xyz;
    float s = clamp(dot(d - t.xyz, ab)/max(1.0e-9, dot(ab, ab)), 0.0, 1.0);
    float off = length(d - normalize(t.xyz + s*ab)), w = max(${f(STREAK_WIDTH)}, ${f(STREAK_PIXELS)}*px);
    float trail = exp(-off*off/(w*w))*s*s;
    float gap = dot(d - h.xyz, d - h.xyz);
    float tip = exp(-gap/(4.0*w*w)), halo = exp(-sqrt(gap)/(${f(STREAK_HALO)}*w));
    light += h.w*(dropTint(t.w)*(2.4*trail + 1.2*tip + 0.5*halo) + 3.2*tip + 0.5*trail*s*s);
  }
  return light;
}
`;
