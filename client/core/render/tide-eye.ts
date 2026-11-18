// World-space sky optics. Each ray samples three high-altitude sheets; their broken rims separate spectrally
// as they twist. Positions are relative to the actual observer, including a rider above the crown.
import { EYE_COLORS, type TideEyeSite } from "../../../shared/world/tide-eye.ts";
import { FRAME, FRAME_BLOCK } from "./packet.ts";

export const EYE_PERIOD = 120;
export const EYE_SLOTS = 3;

const pigments = { blue: [0.055, 0.40, 1], red: [1, 0.095, 0.055], green: [0.05, 0.90, 0.34] } as const;
const clamp = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (v: number): number => { const a = clamp(v); return a * a * (3 - 2 * a); };

/** Seconds within one site's cycle. Off, align, ignite, hold and wind down; every observer reads the server clock. */
export function eyePhase(seconds: number, site: TideEyeSite): number {
  return ((seconds + EYE_COLORS.indexOf(site.color) * 40) % EYE_PERIOD + EYE_PERIOD) % EYE_PERIOD;
}
export function aperture(phase: number): number {
  return smooth((phase - 6) / 4) * smooth((120 - phase) / 4);
}
export function eyePower(phase: number): number {
  return smooth((phase - 9) / 4) * smooth((25 - phase) / 8);
}

export function writeEyeSky(frame: Float32Array, sites: readonly TideEyeSite[], seconds: number, x: number, y: number, z: number): void {
  frame.fill(0, FRAME.eyes, FRAME.eyes + 8 * EYE_SLOTS);
  let count = 0;
  for (const site of sites) {
    const phase = eyePhase(seconds, site), power = eyePower(phase), open = aperture(phase);
    if (!open || count === EYE_SLOTS) continue;
    const at = FRAME.eyes + 8 * count++;
    // The phase column's second period identifies the Sextant without a larger uniform block.
    const sextant = site.form === "sextant";
    const yaw = site.yaw * Math.PI / 32768;
    frame[at] = site.x - x + (sextant ? 19 * Math.cos(yaw) : 0);
    frame[at + 1] = 3450 - y;
    frame[at + 2] = site.z - z - (sextant ? 19 * Math.sin(yaw) : 0);
    frame[at + 3] = phase + (sextant ? EYE_PERIOD : 0);
    frame.set(pigments[site.color], at + 4); frame[at + 7] = power;
  }
}

// Called only on unobstructed sky pixels. The broad caustic has a dark pupil. Two narrower upper sheets turn
// in the opposite direction, giving the rim depth and parallax. The vertical pilot line survives the steady state.
export function eyeRadiance(frame: Float32Array, ray: ArrayLike<number>, out: Float64Array): number {
  let transmission = 1;
  const dx = ray[0]!, dy = ray[1]!, dz = ray[2]!;
  for (let i = 0; i < EYE_SLOTS; i++) {
    const at = FRAME.eyes + i * 8, stamp = frame[at + 3]!;
    const sextant = stamp >= EYE_PERIOD, phase = sextant ? stamp - EYE_PERIOD : stamp;
    if (!phase || dy <= 0.002) continue;
    const x = frame[at]!, sky = frame[at + 1]!, z = frame[at + 2]!, power = frame[at + 7]!;
    const den = Math.max(0.00001, dx*dx + dz*dz);
    const t = (dx*x + dz*z) / den, h = t*dy - sky;
    let glow = 0, white = 0;
    if (t > 0 && h > -2800 && h < 0) {
      const r = Math.hypot(dx*t-x, dz*t-z), w = 1.6 + power*4 + t*.00022;
      glow += Math.exp(-r/w) * (.25 + .9*power) * aperture(phase);
    }
    if (power > .001) for (let layer = 0; layer < 3; layer++) {
      const dist = (sky + layer*185) / dy;
      if (dist <= 0) continue;
      const u = (dx*dist-x)/1000, v = (dz*dist-z)/1000;
      if (Math.abs(u)>2.8 || Math.abs(v)>2.8) continue;
      if (sextant) {
        const px = u - 0.10 * layer, pz = (v + 0.07 * layer) * 1.16;
        const theta = Math.atan2(pz, px), head = 0.54 * (phase - 9) - layer * 0.68;
        const lag = ((head - theta) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        const radius = 0.43 + power * 0.66 + layer * 0.23 + 0.055 * Math.sin(2 * theta + layer);
        const edge = Math.hypot(px, pz) - radius + 0.014 * Math.sin(9 * theta - phase * 0.64);
        const trail = (1 - smooth((lag - 2.1) / 1.45)) * smooth(lag / 0.075);
        const ticks = Math.pow(Math.max(0, Math.cos(24 * theta - layer * 0.62)), 12);
        const core = Math.exp(-Math.abs(edge) / 0.023);
        glow += power * trail * (1.55 * Math.exp(-Math.abs(edge) / 0.092) + core + 1.58 * ticks * Math.exp(-Math.abs(edge + 0.082) / 0.076));
        const tip = Math.min(lag, 2 * Math.PI - lag);
        white += power * (3.4 * Math.exp(-Math.hypot(tip * radius, edge) / 0.077) + 0.45 * core * trail);
        continue;
      }
      const theta = Math.atan2(v, u);
      const turn = theta + phase * (layer === 1 ? -0.18 : 0.13) + layer * 1.23;
      const radius = (0.18 + 0.94 * power) * (1 + 0.13 * layer + 0.08 * Math.sin(2 * turn) + 0.035 * Math.sin(3 * turn + layer));
      const edge = Math.hypot(u, v) - radius;
      if (layer === 0) transmission *= 1 - 0.78 * power * (1 - smooth((edge + 0.26) / 0.32));
      if (Math.abs(edge) > 0.77) continue;
      const warp = edge + 0.026 * Math.sin(9 * turn + 7 * edge - phase * 0.34) + 0.012 * Math.sin(19 * turn + phase * 0.71);
      const fold = 0.36 + 0.64 * (0.5 + 0.5 * Math.cos(3 * turn + 4 * warp - layer));
      const veil = Math.exp(-Math.abs(warp) / (0.06 + 0.115 * fold));
      const stream = 0.5 + 0.5 * Math.cos(38 * warp + 3 * turn + 1.45 * Math.sin(5 * turn + 11 * warp));
      glow += power * fold * veil * (0.60 + 2.65 * stream * stream);
      const bolt = warp + 0.015 * Math.sin(21 * turn + phase) + 0.006 * Math.sin(47 * turn - phase * 1.8);
      white += power * fold * (1.85 * Math.exp(-Math.abs(bolt) / 0.009) + 0.17 * veil * stream);
    }
    for (let c=0;c<3;c++) out[c]! += frame[at+4+c]!*glow + white;
  }
  return transmission;
}

export const EYE_SKY_GLSL = `
vec4 eyeOptics(vec3 d) {
  vec3 light = vec3(0.);
  float transmission = 1.;
  if (d.y <= .002) return vec4(light, transmission);
  for (int i=0; i<3; i++) {
    vec4 s = fEyes[i*2], tint = fEyes[i*2+1];
    if (s.w <= 0.) continue;
    bool sextant = s.w >= 120.;
    if (sextant) s.w -= 120.;
    float power = tint.w, glow=0., white=0.;
    float t=dot(d.xz,s.xz)/max(.00001,dot(d.xz,d.xz)), h=t*d.y-s.y;
    if (t>0. && h> -2800. && h<0.) {
      float r=length(d.xz*t-s.xz), w=1.6+power*4.+t*.00022;
      glow += exp(-r/w)*(.25+.9*power)*smoothstep(6.,10.,s.w)*(1.-smoothstep(116.,120.,s.w));
    }
    if (power>.001) for (int j=0;j<3;j++) {
      float k=float(j), dist=(s.y+k*185.)/d.y;
      vec2 p=(d.xz*dist-s.xz)*.001;
      if (dist<=0. || max(abs(p.x),abs(p.y))>2.8) continue;
      if (sextant) {
        vec2 q=vec2(p.x-.10*k,(p.y+.07*k)*1.16);
        float theta=atan(q.y,q.x+1.e-10), head=.54*(s.w-9.)-k*.68;
        float lag=mod(head-theta,6.2831853);
        float radius=.43+power*.66+k*.23+.055*sin(2.*theta+k);
        float edge=length(q)-radius+.014*sin(9.*theta-s.w*.64);
        float trail=(1.-smoothstep(2.1,3.55,lag))*smoothstep(0.,.075,lag);
        float ticks=pow(max(0.,cos(24.*theta-k*.62)),12.);
        float core=exp(-abs(edge)/.023);
        glow+=power*trail*(1.55*exp(-abs(edge)/.092)+core+1.58*ticks*exp(-abs(edge+.082)/.076));
        float tip=min(lag,6.2831853-lag);
        white+=power*(3.4*exp(-length(vec2(tip*radius,edge))/.077)+.45*core*trail);
        continue;
      }
      float turn=atan(p.y,p.x+1.e-10)+s.w*(j==1 ? -.18:.13)+k*1.23;
      float radius=(.18+.94*power)*(1.+.13*k+.08*sin(2.*turn)+.035*sin(3.*turn+k));
      float edge=length(p)-radius;
      if (j==0) transmission *= 1.-.78*power*(1.-smoothstep(-.26,.06,edge));
      if (abs(edge)>.77) continue;
      float warp=edge+.026*sin(9.*turn+7.*edge-s.w*.34)+.012*sin(19.*turn+s.w*.71);
      float fold=.36+.64*(.5+.5*cos(3.*turn+4.*warp-k));
      float veil=exp(-abs(warp)/(.06+.115*fold));
      float stream=.5+.5*cos(38.*warp+3.*turn+1.45*sin(5.*turn+11.*warp));
      glow+=power*fold*veil*(.60+2.65*stream*stream);
      float bolt=warp+.015*sin(21.*turn+s.w)+.006*sin(47.*turn-s.w*1.8);
      white+=power*fold*(1.85*exp(-abs(bolt)/.009)+.17*veil*stream);
    }
    light += tint.rgb*glow+white;
  }
  return vec4(light, transmission);
}`;


// The lowest tier has a flat sky and no sky table or cloud textures.
export const EYE_DOME_VERTEX = `#version 300 es
uniform mat4 uViewProj;
out vec3 vRay;
void main() {
  vec2 at = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vRay = inverse(mat3(uViewProj[0].xyw, uViewProj[1].xyw, uViewProj[2].xyw)) * vec3(at, 1.);
  gl_Position = vec4(at, 1., 1.);
}`;

export const EYE_DOME_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vRay;
uniform vec3 uSky;
out vec4 o;
${FRAME_BLOCK}${EYE_SKY_GLSL}
void main() {
  vec4 lens = fHaze.z < 0. ? vec4(0., 0., 0., 1.) : eyeOptics(normalize(vRay));
  o = vec4(mix(uSky * lens.a, vec3(1.), 1. - exp(-lens.rgb)), 1.);
}`;
