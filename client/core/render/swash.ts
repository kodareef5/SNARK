// A shore wave follows the depth contours. The nominal surface is high water; the drained strip still has a thin wet film.
import { WATER_PHASE } from "./packet.ts";

const smooth = (lo: number, hi: number, v: number) => {
  const x = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return x * x * (3 - 2 * x);
};
export function swashFrame(f: Float32Array, x: number, z: number, seconds: number): void {
  const turn = Math.PI * 2;
  f[WATER_PHASE] = (x * 0.069 + z * 0.031 + seconds * 1.09) % turn;
  f[WATER_PHASE + 1] = (z * 0.053 - x * 0.024 + seconds * 0.57) % turn;
}

export interface Wash {
  depth: number;
  film: number;
  slopeX: number;
  slopeZ: number;
  lace: number;
}
/** gx/gz are the bed-depth gradient in metres per metre. A flat shelf, coarse map cell or vertical quay cannot make surf. */
export function beachWash(
  f: Float32Array,
  x: number,
  z: number,
  depth: number,
  fine: number,
  gx: number,
  gz: number,
  dist: number,
): Wash {
  const out = { depth, film: 0, slopeX: 0, slopeZ: 0, lace: 1 };
  if (depth <= 0 || depth >= 1.1 || fine <= 0 || dist >= 110) return out;
  const grade = Math.hypot(gx, gz);
  const gain =
    fine *
    smooth(0.008, 0.035, grade) *
    (1 - smooth(0.35, 0.72, grade)) *
    (1 - smooth(55, 110, dist)) *
    (1 - smooth(0.5, 1.1, depth));
  if (gain === 0) return out;
  const a = f[WATER_PHASE]! + x * 0.069 + z * 0.031;
  const b = f[WATER_PHASE + 1]! + z * 0.053 - x * 0.024;
  const beat = Math.sin(b);
  // A slowly travelling scallop, about seven metres across. Integer harmonics stay continuous when the phases wrap.
  const scallop = Math.sin(7 * a - 13 * b + 0.9 * beat);
  const phase = a + depth * 5.3 + beat * 0.58 + scallop * 0.45;
  const crest = 0.5 + 0.5 * Math.sin(phase);
  const retreat = gain * (0.1 + 0.035 * beat) * (1 - crest) * 1.65 * (0.85 + 0.15 * scallop);
  out.depth = Math.max(0, depth - retreat);
  out.film = gain * smooth(0, 0.045, depth) * (1 - smooth(0.008, 0.09, out.depth)) * (0.12 + 0.035 * scallop);
  // The front steepens then spills along the shore normal; a gentle beach still catches the sky on its face.
  const slope = gain * (0.045 + 0.14 * crest * crest) * Math.cos(phase) / Math.max(grade, 0.045);
  out.slopeX = slope * gx;
  out.slopeZ = slope * gz;
  out.lace = 1 - gain * (0.52 - 0.39 * crest - 0.06 * scallop);
  return out;
}

export const SWASH_GLSL = `
void beachWash(vec2 p, vec2 grad, float fine, float dist, inout float depth, out vec2 slope, out float film, out float lace) {
  float grade = length(grad);
  float gain = fine * smoothstep(.008,.035,grade) * (1.0-smoothstep(.35,.72,grade)) * (1.0-smoothstep(55.,110.,dist)) * (1.0-smoothstep(.5,1.1,depth));
  float a = fEffects.y + dot(p,vec2(.069,.031)), b = fEffects.z + dot(p,vec2(-.024,.053));
  float beat = sin(b), scallop = sin(7.*a-13.*b+.9*beat);
  float phase = a + depth*5.3 + beat*.58 + scallop*.45;
  float crest = .5+.5*sin(phase);
  float d = max(0.,depth-gain*(.10+.035*beat)*(1.-crest)*1.65*(.85+.15*scallop));
  film = gain*smoothstep(0.,.045,depth)*(1.-smoothstep(.008,.09,d))*(.12+.035*scallop);
  slope = gain*(.045+.14*crest*crest)*cos(phase)*grad/max(grade,.045);
  lace = 1.-gain*(.52-.39*crest-.06*scallop);
  depth = d;
}`;
