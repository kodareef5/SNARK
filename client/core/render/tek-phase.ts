// The packet's spare two Tek colour regions carry exposed edges and the short transition amount.
const TAU64 = Math.PI / 32;

/** The two fronts travel through chunk-local metres. Every X/Z frequency repeats at the 64 m chunk boundary. */
export function tekPhaseFront(x: number, y: number, z: number): number {
  const u = TAU64 * (5 * x + 3 * z), v = TAU64 * (2 * z - x);
  return .51 + .26 * Math.sin(u + 1.38 * y + .67 * Math.sin(v + .73 * y))
    + .12 * Math.sin(2 * u - 1.86 * y) + .043 * Math.sin(11 * v + 7 * y);
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Negative means the colour, depth and pick at this pixel have passed through the opening. */
export function tekPhaseRim(x: number, y: number, z: number, amount: number): number {
  if (!amount) return 0;
  const edge = tekPhaseFront(x, y, z) - amount;
  return edge < 0 ? -1 : (1 - smooth(.002, .053, edge)) * smooth(0, .04, amount);
}

const lip = [.09, .21, .31] as const, crest = [.15, .68, .79] as const;

/** A bounded optical edge in the reference raster's display colours. */
export function tekPhaseColour(rim: number, value: number, channel: number): number {
  if (rim <= 0) return value;
  const u = smooth(.38, .96, rim), target = lip[channel]! + (crest[channel]! - lip[channel]!) * u;
  return value + (target - value) * smooth(0, .53, rim);
}

export function tekSpanLight(out: Float64Array | Float32Array, x: number, y: number, z: number,
  localX: number, mask: number, facing: number, footprint: number, phase: number, exposure: number): void {
  const u = TAU64 * (11 * x + 7 * z), v = TAU64 * (-5 * x + 12 * z), rim = 1 - Math.max(0, Math.min(1, facing));
  const wave = u + 2.6 * y + .91 * Math.sin(v + .77 * y) - phase, crest = Math.sin(wave);
  const lens = Math.max(Math.abs(Math.sin(41 * u + 23 * y)), Math.abs(Math.sin(41 * u - 23 * y))) ** 12 * (1 - smooth(.012, .042, footprint));
  const rail = mask & (localX < 0 ? 1 : 2) ? 0 : 1 / (1 + 75 * (Math.abs(localX) - 1.30) ** 2);
  const glow = (.18 + .36 * rim) * smooth(.52, .99, crest) + (.21 + .58 * rim) * smooth(.9, 1, crest) * lens + .30 * rail * rail;
  const wake = .14 * smooth(.68, 1, Math.sin(wave - .51)) * (.30 + rim), fade = 1 - smooth(.04, .14, footprint);
  const brush = (.010 + .009 * Math.sin(6 * v + 17 * y + .82 * Math.sin(u + y))) * (1 - smooth(.024, .09, footprint));
  const scale = 1 / Math.max(exposure, .001);
  out[0]! += (.002 + fade * (.10 * glow + .32 * wake)) * scale;
  out[1]! += (.014 + brush + fade * (.68 * glow + .045 * wake)) * scale;
  out[2]! += (.017 + 1.3 * brush + fade * (.76 * glow + .43 * wake)) * scale;
}

export function tekPhaseVertex(text: string): string {
  return text.replace("void main() {", "out highp vec4 vTekCell;\nvoid main() {")
    .replace("  gl_Position = uViewProj * vec4(p, 1.0);",
      "  vTekCell = uPiece > 0.5 && (iRegA.w & 128u) != 0u ? vec4(p-uOffset, float(iRegA.y*256u+iRegA.z)) : vec4(0.0);\n  gl_Position = uViewProj * vec4(p, 1.0);");
}

const front = `float tekFront(vec3 p) {
  float u = 0.0981747704 * dot(p.xz,vec2(5,3)), v = 0.0981747704 * dot(p.xz,vec2(-1,2));
  return 0.51 + 0.26*sin(u+1.38*p.y+0.67*sin(v+0.73*p.y)) + 0.12*sin(2.0*u-1.86*p.y) + 0.043*sin(11.0*v+7.0*p.y);
}`;

/** The same world-space contour erases the color, picking depth, and the shadow of the casting. */
export function tekPhaseFragment(text: string, depth = false): string {
  const head = `in highp vec4 vTekCell;
${front}
void main() {
  highp float phaseAmount = mod(floor(vTekCell.w+0.5),256.0) / 255.0;
  float phaseEdge = 1.0;
  if (phaseAmount > 0.0) {
    phaseEdge = tekFront(vTekCell.xyz) - phaseAmount;
    ${depth ? "if (phaseEdge < 0.0) discard;" : ""}
  }`;
  const result = text.replace("void main() {", head);
  if (depth) return result;
  const end = result.lastIndexOf("}");
  // Finish sampling the plate before cutting it so normals and texture gradients span both sides of the contour.
  return result.slice(0, end) + `  if (phaseEdge < 0.053) {
    if (phaseEdge < 0.0) discard;
    float rim = (1.0-smoothstep(0.002,0.053,phaseEdge))*smoothstep(0.0,0.04,phaseAmount);
#ifdef LIGHT_TARGET
    vec3 lip = vec3(0.008,0.036,0.072), crest = vec3(0.019,0.49,0.71);
#else
    vec3 lip = vec3(${lip.join(",")}), crest = vec3(${crest.join(",")});
#endif
    vec3 target = mix(lip,crest,smoothstep(0.38,0.96,rim));
    o.rgb = mix(o.rgb,target,smoothstep(0.0,0.53,rim));
  }
` + result.slice(end);
}

/** Joined panels use one continuous interference carrier. Their rail light remains attached to actual hardware. */
export const TEK_SPAN_GLSL = `vec3 tekSpanLight(vec3 at, vec2 local, int seams, float facing, float footprint, float phase) {
  float u = 0.0981747704*dot(at.xz,vec2(11.0,7.0)), v = 0.0981747704*dot(at.xz,vec2(-5.0,12.0));
  float rim = 1.0-clamp(facing,0.0,1.0), wave = u+2.6*at.y+0.91*sin(v+0.77*at.y)-phase;
  float crest = smoothstep(0.52,0.99,sin(wave)), fire = smoothstep(0.90,1.0,sin(wave));
  float a = sin(41.0*u + 23.0*at.y), b = sin(41.0*u - 23.0*at.y);
  float lens = pow(max(abs(a),abs(b)),12.0)*(1.0-smoothstep(0.012,0.042,footprint));
  float rail = (seams & (local.x < 0.0 ? 1 : 2)) == 0 ? 1.0/(1.0+75.0*pow(abs(abs(local.x)-1.30),2.0)) : 0.0;
  float glow = (0.18+0.36*rim)*crest + (0.21+0.58*rim)*fire*lens + 0.30*rail*rail;
  float wake = 0.14*smoothstep(0.68,1.0,sin(wave-0.51))*(0.30+rim);
  float fade = 1.0-smoothstep(0.04,0.14,footprint);
  float brush = (0.010+0.009*sin(6.0*v+17.0*at.y+0.82*sin(u+at.y)))*(1.0-smoothstep(0.024,0.09,footprint));
  return (vec3(0.002,0.014+brush,0.017+1.3*brush) + fade*(glow*vec3(0.10,0.68,0.76) + wake*vec3(0.32,0.045,0.43))) / max(fSunColor.w,0.001);
}`;
