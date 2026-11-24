// Receiver labels are optical properties. Gameplay material, impact sounds and salvage stay independent.
import { linearToSrgb, srgbToLinear } from "./color-space.ts";
import { orbMirror } from "./orb-light.ts";
import { FRAME, type FramePacket } from "./packet.ts";
import { SURFACE_NAMES } from "../../../content/surfaces.ts";
// Normal-incidence and grazing values of a coated, tinted faceplate.
export const visor = { cover: 0.73, edgeCover: 0.97, coat: 0.63, edgeCoat: 0.94 } as const;
export const STEEL = SURFACE_NAMES.indexOf("steel"), RUST = SURFACE_NAMES.indexOf("rust"), GLASS = SURFACE_NAMES.indexOf("glass");
export function worldReceiver(surface: number, rough: number, metal: number): number {
  if (surface === GLASS) return Math.max(0, Math.min(1, (0.8 - rough) * 2.5));
  return surface === STEEL || surface === RUST ? Math.max(0, Math.min(1, (0.85 - rough) * 3)) * metal : 0;
}
export const STREET_WIDTH = 64, FINE_STREET_WIDTH = 128;
export const captureWidth = (hz: number): number => hz >= 4 ? FINE_STREET_WIDTH : hz > 0 ? STREET_WIDTH : 0;
export function streetTextureBytes(hz: number): number {
  const width = captureWidth(hz);
  // Both RGBA layers, including the final 1 x 1 level of a 2:1 texture.
  return width ? (2 * width * width + 1) / 3 * 8 : 0;
}
export function streetWidth(image: StreetImage): number {
  return image.pixels.length === FINE_STREET_WIDTH * FINE_STREET_WIDTH * 2 ? FINE_STREET_WIDTH : STREET_WIDTH;
}
// Store RGB in display space to preserve dark tones. Alpha remains linear coverage.
const encoded = Uint8Array.from({ length: 8193 }, (_, i) => Math.round(255*linearToSrgb(i/8192)));
const decoded = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i/255));
export const captureByte = (linear: number): number => encoded[Math.round(linear*8192)]!;
export interface StreetImage {
  pixels: Uint8Array;
  revision: number;
}

export { PAINT, FITTINGS, BURNT_SHEET, FIXTURE_IRON, FIXTURE_PAINT, SIGN_ENAMEL, fixtureKind, streetPriority, streetMaterial, vehicleWeather } from "../../../content/street-finishes.ts";
import { PAINT, BURNT_SHEET, fixtureFaces, axleEnvelope, streetMaterial, vehicleWeather } from "../../../content/street-finishes.ts";

export function fixtureFace(kind: number, palette: number, y = 0, z = 0): number {
  for (const rule of fixtureFaces[kind] ?? []) {
    if (rule.palette.length && !rule.palette.includes(palette)) continue;
    if (rule.wheel !== undefined && y < axleEnvelope.top && axleEnvelope.z.some(axle => Math.abs(z - axle) < axleEnvelope.reach)) return rule.wheel;
    return rule.face;
  }
  return 0;
}

/** Compile the same content rules for a flat mesh vertex. */
export function fixtureShader(): string {
  const axle = axleEnvelope.z.map(z => `abs(p.z - ${z}) < ${axleEnvelope.reach}`).join(" || ");
  const rows = fixtureFaces.map((rules, kind) => {
    if (!rules.length) return "";
    const faces = rules.map(rule => {
      const condition = rule.palette.map(color => `i == ${color}u`).join(" || ");
      const result = rule.wheel === undefined ? rule.face : `axle ? ${rule.wheel} : ${rule.face}`;
      return `${condition ? "if (" + condition + ") " : ""}return ${result};`;
    });
    return `if (kind == ${kind}) { ${faces.join(" ")} }`;
  });
  return `int fixtureFace(int kind, uint i, vec3 p) { bool axle = p.y < ${axleEnvelope.top} && (${axle}); ${rows.join("\n")} return 0; }`;
}

/** Material pages fill in independently of mesh pages. Cache only a resolved material ID. */
export class StreetMaterials {
  private readonly byMaterial: [Uint8Array, Uint8Array];
  private readonly wear: Float32Array;

  constructor(count: number, meshes: readonly { id: string }[]) {
    this.byMaterial = [new Uint8Array(count).fill(255), new Uint8Array(count).fill(255)];
    this.wear = Float32Array.from(meshes, mesh => vehicleWeather(mesh.id));
  }

  code(index: number, id: string, mesh: number, wheels: boolean): number {
    if (!id) return 0;
    const labels = this.byMaterial[wheels ? 1 : 0];
    if (labels[index] === 255) labels[index] = streetMaterial(id, wheels);
    const label = labels[index] ?? 0;
    return label ? label + this.wear[mesh]!*0.25 : 0;
  }
}

const clamp = (x: number): number => Math.max(0, Math.min(1, x));
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export function finishSeed(id: number, x = 0, y = 0, z = 0): number {
  let h = id ^ Math.imul(Math.round(x * 4), 1597334677) ^ Math.imul(Math.round(y * 4), 3812015801) ^ Math.imul(Math.round(z * 4), 2798796415);
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  return ((h ^ (h >>> 13)) >>> 8) / 16777216;
}

export function coatWear(u: number, v: number, seed: number, footprint: number): number {
  const wipe = Math.sin(18 * u + 5 * v + 6 * seed + 2 * Math.sin(7 * v + 4 * seed));
  const grit = Math.sin(310 * u + 23 * v + 19 * seed) * Math.sin(191 * v + 13 * seed);
  return 0.035 + 0.075 * seed + 0.06 * wipe * wipe + 0.025 * grit * clamp(1 - footprint * 320);
}

export function receiver(label: number, paintMask: number, rough: number, metal: number): number {
  if (!label) return 0;
  const paint = label === PAINT || label === BURNT_SHEET ? paintMask * clamp((0.72 - rough) * 3.5) : 0;
  return Math.max(paint, clamp(metal * 1.5) * clamp((0.85 - rough) * 3), clamp((0.34 - rough) * 5));
}

/** Broken patches in metres, attached to the prop. Oxide replaces a fraction of the exposed conductor. */
export function weatherVehicle(albedo: Float64Array, orm: Float64Array, x: number, y: number, z: number, seed: number, age: number, burntSheet = false): void {
  const field = 0.48*Math.sin(4.1*x+2.7*z+13*seed) + 0.32*Math.sin(6.7*y-3.2*z+8*seed) + 0.2*Math.sin(15*x+11*z+3*y);
  // The burnt compact atlas bakes metalness to zero. Small breaks in the scale reveal the sheet beneath it.
  if (burntSheet) {
    const edge = clamp((-field-0.39)*4);
    const scrape = edge*edge*(3-2*edge)*clamp((orm[0]!-0.25)*2.5);
    orm[2]! += (0.76-orm[2]!)*scrape;
    orm[1]! += (0.35-orm[1]!)*scrape;
  }
  const patch = clamp((field+0.8*age-0.44)*2.3);
  const oxide = patch*patch*(3-2*patch)*clamp(orm[2]!*2.3)*age;
  const dust = age*(0.08+0.12*patch);
  for (let c=0; c<3; c++) {
    const dry = albedo[c]!*(1-0.3*dust) + (c===0 ? 0.11 : c===1 ? 0.085 : 0.055)*dust;
    albedo[c] = dry + ((c===0 ? 0.115 : c===1 ? 0.044 : 0.018)-dry)*oxide;
  }
  const exposed = clamp((orm[2]!-0.4)*3)*clamp((0.76-orm[1]!)*4)*(1-age*0.45);
  orm[1]! += (Math.max(0.18,orm[1]!*0.57)-orm[1]!)*exposed;
  orm[1]! += (0.92-orm[1]!)*clamp(dust+0.88*oxide);
  orm[2]! *= 1-0.94*oxide;
}

/** The slider changes only the fraction of a texel carrying a reflective finish. */
export function glossRoughness(rough: number, mask: number, offset: number): number {
  return Math.max(0.07, Math.min(1, rough * (1 - 0.38 * mask * offset)));
}

/** Only wheel bones carry tire and hub finishes. Door hinges and the steering wheel share trim atlases. */
export function wheelBoneMask(names?: readonly string[]): number {
  return (names?.reduce((bits, name, i) => i < 32 && name.startsWith("wheel_") ? bits | (1 << i) : bits, 0) ?? 0) >>> 0;
}

/** How much of the shoulder `tireMould` last looked at is groove, which the tread's roughness reads. */
let lastGroove = 0;

/** The bead and shoulder moulding in wheel-local radii. A metre of motion carries the pattern with the tire. */
export function tireMould(x: number, y: number, z: number, footprint: number): number {
  const radius = Math.hypot(y,z), phase = Math.atan2(y,z);
  const ridge = (r: number) => clamp(1 - Math.abs(radius-r)/0.012);
  const shoulder = clamp((radius-0.86)*14);
  const block = Math.cos(42*phase + 13*Math.abs(x));
  const fine = clamp(1-45*footprint);
  const groove = clamp((block-0.32)*3) * shoulder;
  const ribs = ridge(0.77) + ridge(0.845) + 0.65*ridge(0.885);
  lastGroove = groove*fine;
  return (0.25*ribs - 0.32*groove + 0.09*shoulder*(1-groove)) * fine;
}

/** The mould's ribs stand this high and its grooves run this deep, in the wheel's radii: about 1 and 2 mm on the compact. */
export const RIB_HEIGHT = 0.003, GROOVE_DEPTH = 0.0065;

/**
 * The slope of the mould's relief at a wheel-local point into `out`, along the wheel's own x, y and z, the relief's
 * height and the point both in the wheel's radii. The ribs stand up from the sidewall and the shoulder's grooves sink
 * into it; the normal is tilted down the slope, and the relief fades as the mould does with the pixel's footprint.
 */
export function tireRelief(out: Float64Array, x: number, y: number, z: number, footprint: number): void {
  const radius = Math.hypot(y,z), phase = 42*Math.atan2(y,z) + 13*Math.abs(x);
  const fine = clamp(1-45*footprint);
  const slope = (r: number) => Math.abs(radius-r) < 0.012 ? -Math.sign(radius-r)/0.012 : 0;
  const shoulder = clamp((radius-0.86)*14);
  const block = (Math.cos(phase)-0.32)*3;
  // Down the groove's wall as the angle turns, and across it as the axle's offset does.
  const wall = block > 0 && block < 1 ? 3*Math.sin(phase)*shoulder*GROOVE_DEPTH*fine : 0;
  const outward = RIB_HEIGHT*fine*(slope(0.77) + slope(0.845) + 0.65*slope(0.885)), turning = wall*42/Math.max(radius, 0.1);
  out[0] = wall*13*Math.sign(x);
  out[1] = (outward*y + turning*z)/Math.max(radius, 1e-6);
  out[2] = (outward*z - turning*y)/Math.max(radius, 1e-6);
}

/** Rubber is two to four per cent: linear albedo at the authored shade of a 1.8% tyre. */
export const RUBBER = [0.026, 0.026, 0.025] as const;

/** How much of a wheel joint's texel is tyre, by its authored metal and roughness and how far out from the hub it lies. */
export function rubberShare(metal: number, rough: number, radial: number): number {
  return clamp((0.30-metal)*5)*clamp((rough-0.45)*5)*clamp((radial-0.45)*9);
}

/**
 * A wheel joint's finish, as WHEEL_FINISH_GLSL has it: `rubber` is `rubberShare` faded with distance, `x`, `y` and `z`
 * the wheel-local point in radii. Rubber takes its own colour, keeping the authored shade and the mould within it, and
 * its own roughness: dressed sidewalls by the seed, a tread worn a little smoother down its middle, rougher shoulders
 * and grooves, and never so smooth that it takes the rim's sharp reflection. Bright metal becomes plated.
 */
export function wheelFinish(albedo: Float64Array, orm: Float64Array, wheelMask: number, rubber: number, near: number, x: number, y: number, z: number, seed: number, footprint: number, outboard = 0): number {
  const metal = orm[2]!, rough = orm[1]!;
  const radial = Math.hypot(y, z);
  // A painted centre and an iron rotor can share a wheel joint with the rubber and the exposed rim.
  const outerMetal = clamp((outboard-0.16)*10)*clamp((0.83-radial)*12)*clamp((0.70-rough)*6);
  const chrome = clamp((metal-0.45)*3.4)*Math.max(clamp(wheelMask*1.8),clamp((0.35-rough)*6),outerMetal)*clamp((0.85-rough)*5)*near;
  lastGroove = 0;
  const mould = rubber > 0 && footprint < 0.023 ? tireMould(x, y, z, footprint) : 0;
  const groove = lastGroove;
  const luma = albedo[0]!*0.2126 + albedo[1]!*0.7152 + albedo[2]!*0.0722;
  const shade = Math.min(Math.max(Math.sqrt(luma/0.018), 0.8), 1.25)*Math.min(Math.max(1+1.2*mould, 0.6), 1.2);
  for (let c=0; c<3; c++) albedo[c]! += (RUBBER[c]!*shade-albedo[c]!)*rubber;
  const tread = smoothstep(0.92, 0.97, radial), worn = tread*(1-smoothstep(0.12, 0.24, Math.abs(x)));
  const dressed = 0.66+0.08*seed, face = dressed + (0.78-dressed)*tread;
  const rubbed = face + (0.62-face)*worn;
  orm[1]! += (Math.max(0.5, rubbed + (0.92-rubbed)*groove)-rough)*rubber;
  if (chrome > 0) {
    const wipe = Math.sin(19*z+7*y+9*seed);
    const grit = Math.sin(151*y)*Math.sin(123*z+13*seed)*clamp(1-70*footprint);
    const t = clamp((seed-0.30)/0.53), marks = t*t*(3-2*t)*(0.035+0.065*wipe*wipe+0.022*grit);
    for (let c=0; c<3; c++) albedo[c]! += ((c===0 ? 0.86 : c===1 ? 0.89 : 0.94)-albedo[c]!)*0.96*chrome;
    orm[1]! += (0.076+marks-orm[1]!)*chrome;
    orm[2]! += (1-metal)*chrome;
  }
  return chrome;
}

export const WHEEL_FINISH_GLSL = `
float rubberShare(vec3 mro, float radial) {
  return clamp((0.30-mro.b)*5.0,0.0,1.0)*clamp((mro.g-0.45)*5.0,0.0,1.0)*clamp((radial-0.45)*9.0,0.0,1.0);
}
vec3 tireRelief(vec3 point, float width) {
  float radius = length(point.yz), phase = 42.0*atan(point.y,point.z)+13.0*abs(point.x);
  float fine = clamp(1.0-45.0*width,0.0,1.0);
  vec3 d = vec3(radius)-vec3(0.77,0.845,0.885);
  vec3 slope = mix(vec3(0.0),-sign(d)/0.012,lessThan(abs(d),vec3(0.012)));
  float shoulder = clamp((radius-0.86)*14.0,0.0,1.0);
  float block = (cos(phase)-0.32)*3.0;
  float wall = block > 0.0 && block < 1.0 ? 3.0*sin(phase)*shoulder*${GROOVE_DEPTH}*fine : 0.0;
  float outward = ${RIB_HEIGHT}*fine*dot(slope,vec3(1.0,1.0,0.65)), turning = wall*42.0/max(radius,0.1);
  return vec3(wall*13.0*sign(point.x),outward*point.y+turning*point.z,outward*point.z-turning*point.y)/vec3(1.0,max(radius,0.000001),max(radius,0.000001));
}
float wheelFinish(inout vec3 albedo, inout vec3 mro, float mask, float rubber, float near, vec3 point, float seed, float width, float outboard) {
  float radial = length(point.yz);
  float outerMetal = clamp((outboard-0.16)*10.0,0.0,1.0)*clamp((0.83-radial)*12.0,0.0,1.0)*clamp((0.70-mro.g)*6.0,0.0,1.0);
  float chrome = clamp((mro.b-0.45)*3.4,0.0,1.0)*max(outerMetal,max(clamp(mask*1.8,0.0,1.0),clamp((0.35-mro.g)*6.0,0.0,1.0)))*clamp((0.85-mro.g)*5.0,0.0,1.0)*near;
  float mould = 0.0, groove = 0.0;
  if (rubber > 0.0 && width < 0.023) {
    float r = radial;
    vec3 ribs = clamp(1.0-abs(vec3(r)-vec3(0.77,0.845,0.885))/0.012,0.0,1.0);
    float shoulder = clamp((r-0.86)*14.0,0.0,1.0);
    float angle = atan(point.y,point.z);
    float fine = clamp(1.0-45.0*width,0.0,1.0);
    groove = clamp((cos(42.0*angle+13.0*abs(point.x))-0.32)*3.0,0.0,1.0)*shoulder;
    mould = (0.25*dot(ribs,vec3(1.0,1.0,0.65))-0.32*groove+0.09*shoulder*(1.0-groove))*fine;
    groove *= fine;
  }
  float shade = clamp(sqrt(dot(albedo,vec3(0.2126,0.7152,0.0722))/0.018),0.8,1.25)*clamp(1.0+1.2*mould,0.6,1.2);
  albedo = mix(albedo,vec3(${RUBBER.join(",")})*shade,rubber);
  float tread = smoothstep(0.92,0.97,radial), worn = tread*(1.0-smoothstep(0.12,0.24,abs(point.x)));
  float rubbed = mix(mix(0.66+0.08*seed,0.78,tread),0.62,worn);
  mro.g = mix(mro.g,max(0.5,mix(rubbed,0.92,groove)),rubber);
  if (chrome > 0.0) {
    float wipe = sin(19.0*point.z + 7.0*point.y + 9.0*seed);
    float grit = sin(151.0*point.y)*sin(123.0*point.z+13.0*seed)*clamp(1.0-70.0*width,0.0,1.0);
    float marks = smoothstep(0.30,0.83,seed)*(0.035+0.065*wipe*wipe+0.022*grit);
    albedo = mix(albedo,vec3(0.86,0.89,0.94),0.96*chrome);
    mro.g = mix(mro.g,0.076+marks,chrome);
    mro.b = mix(mro.b,1.0,chrome);
  }
  return chrome;
}`;

export const SEED_GLSL = `
float finishSeed(uint id, vec3 place) {
  uvec3 p = uvec3(ivec3(floor(place*4.0+0.5)));
  uint h = id ^ p.x*1597334677u ^ p.y*3812015801u ^ p.z*2798796415u;
  h = (h ^ (h >> 16u))*2246822519u;
  return float((h ^ (h >> 13u)) >> 8u)/16777216.0;
}`;
export const STREET_GLSL = `
#ifdef STREET
uniform highp sampler2DArray uStreetEnv;
#endif
void weatherVehicle(inout vec3 albedo, inout vec3 orm, vec3 p, float seed, float age, bool burntSheet) {
  float field = 0.48*sin(4.1*p.x+2.7*p.z+13.0*seed)+0.32*sin(6.7*p.y-3.2*p.z+8.0*seed)+0.20*sin(15.0*p.x+11.0*p.z+3.0*p.y);
  if (burntSheet) {
    float scrape = smoothstep(0.39,0.64,-field)*clamp((orm.r-0.25)*2.5,0.0,1.0);
    orm.b = mix(orm.b,0.76,scrape);
    orm.g = mix(orm.g,0.35,scrape);
  }
  float coverage = clamp((field+0.8*age-0.44)*2.3,0.0,1.0);
  float oxide = coverage*coverage*(3.0-2.0*coverage)*clamp(orm.b*2.3,0.0,1.0)*age;
  float dust = age*(0.08+0.12*coverage);
  albedo = mix(albedo*(1.0-0.3*dust)+vec3(0.11,0.085,0.055)*dust,vec3(0.115,0.044,0.018),oxide);
  float exposed = clamp((orm.b-0.4)*3.0,0.0,1.0)*clamp((0.76-orm.g)*4.0,0.0,1.0)*(1.0-age*0.45);
  orm.g = mix(orm.g,max(0.18,orm.g*0.57),exposed);
  orm.g = mix(orm.g,0.92,clamp(dust+0.88*oxide,0.0,1.0));
  orm.b *= 1.0-0.94*oxide;
}
float glossRoughness(float rough, float mask) {
  return clamp(rough*(1.0-0.38*mask*fStreetLook.x),0.07,1.0);
}
float coatWear(vec2 uv, float seed, float footprint) {
  float wipe = sin(18.0*uv.x+5.0*uv.y+6.0*seed+2.0*sin(7.0*uv.y+4.0*seed));
  float grit = sin(310.0*uv.x+23.0*uv.y+19.0*seed)*sin(191.0*uv.y+13.0*seed);
  return 0.035+0.075*seed+0.06*wipe*wipe+0.025*grit*clamp(1.0-footprint*320.0,0.0,1.0);
}
#ifdef STREET
vec4 streetSample(vec3 ray, vec3 offset, float rough, float layer) {
  float near = clamp((19.0-length(offset))/9.0,0.0,1.0);
  if (near <= 0.0) return vec4(0.0);
  vec3 localRay = ray*16.0+offset;
  vec3 dir = dot(localRay,localRay) > 1e-8 ? normalize(localRay) : ray;
  vec2 uv = vec2(atan(dir.x,dir.z)/6.283185307+0.5,asin(clamp(dir.y,-1.0,1.0))/3.141592654+0.5);
  float extraMip = textureSize(uStreetEnv,0).x == ${FINE_STREET_WIDTH} ? clamp((rough-0.09)/0.16,0.0,1.0) : 0.0;
  return near*textureLod(uStreetEnv,vec3(uv,layer),max(0.0,rough*5.0-0.4+extraMip));
}
#endif
vec3 streetMirror(vec3 original, vec3 ray, vec3 rel, float rough, float mask) {
  original = orbMirror(original, ray, rel, rough, mask);
#ifdef STREET
  float strength = mask*fReflection.w;
  float gain = 1.0+mask*fStreetLook.x;
  if (strength <= 0.001) return original*gain;
  vec4 local = streetSample(ray,rel-fReflection.xyz,rough,fStreetLook.y);
  if (fPreviousReflection.w > 0.0) {
    vec4 previous = streetSample(ray,rel-fPreviousReflection.xyz,rough,1.0-fStreetLook.y);
    local = mix(local,previous,fPreviousReflection.w);
  }
  return (original*(1.0-strength*local.a)+local.rgb*fSkyAbove.rgb*strength)*gain;
#else
  return original*(1.0+mask*fStreetLook.x);
#endif
}
`;

const mipCache = new WeakMap<StreetImage, { revision: number; levels: Uint8Array[] }>();
function filtered(image: StreetImage): Uint8Array[] {
  let cache = mipCache.get(image);
  if (cache?.revision === image.revision) return cache.levels;
  if (!cache) {
    const width = streetWidth(image), levels = [image.pixels];
    for (let w = width >> 1; w >= 2; w >>= 1) levels.push(new Uint8Array(w * w * 2));
    mipCache.set(image, cache = { revision: 0, levels });
  }
  cache.levels[0] = image.pixels;
  const width = streetWidth(image);
  for (let k = 1; k < cache.levels.length; k++) {
    const w = width >> k, h = w >> 1, src = cache.levels[k - 1]!, dst = cache.levels[k]!;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 4; c++) {
          const i = (y * 4 * w + x * 2) * 4 + c;
          const a = src[i]!, b = src[i + 4]!, d = src[i + w * 8]!, e = src[i + w * 8 + 4]!;
          dst[(y * w + x) * 4 + c] = c === 3 ? Math.round((a+b+d+e)/4) : captureByte((decoded[a]!+decoded[b]!+decoded[d]!+decoded[e]!)/4);
        }
      }
    }
  }
  cache.revision = image.revision;
  return cache.levels;
}

const sample = new Float64Array(4);
export function streetMirror(
  out: Float64Array,
  p: FramePacket,
  ray: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  rough: number,
  mask: number,
): void {
  const f = FRAME.reflection;
  if (!mask) return;
  // The ball where the ray meets it (orb-light.ts), under what the street's picture holds nearer.
  orbMirror(out, p.frame, ray, x, y, z, rough, mask);
  const gain = 1 + mask * p.frame[FRAME.streetLook]!;
  if (!p.street || !p.frame[f + 3]) {
    for (let c = 0; c < 3; c++) out[c]! *= gain;
    return;
  }
  const history = FRAME.previousReflection, old = p.previousStreet ? p.frame[history + 3]! : 0;
  sample.fill(0);
  if (old < 1) sampleStreet(p.street, ray, x - p.frame[f]!, y - p.frame[f+1]!, z - p.frame[f+2]!, rough, 1 - old);
  if (old > 0 && p.previousStreet) sampleStreet(p.previousStreet, ray, x - p.frame[history]!, y - p.frame[history+1]!, z - p.frame[history+2]!, rough, old);
  const strength = mask * p.frame[f + 3]!;
  for (let c = 0; c < 3; c++) out[c] = (out[c]! * (1 - strength * sample[3]!) + sample[c]! * p.frame[FRAME.skyAbove + c]! * strength) * gain;
}
function sampleStreet(image: StreetImage, ray: ArrayLike<number>, x: number, y: number, z: number, rough: number, weight: number): void {
  const near = clamp((19 - Math.hypot(x, y, z)) / 9);
  if (!near) return;
  x += 16 * ray[0]!;
  y += 16 * ray[1]!;
  z += 16 * ray[2]!;
  if (x * x + y * y + z * z < 1e-8) {
    x = ray[0]!;
    y = ray[1]!;
    z = ray[2]!;
  }
  const u = Math.atan2(x, z) / (2 * Math.PI) + 0.5, v = Math.asin(y / Math.hypot(x, y, z)) / Math.PI + 0.5;
  const width = streetWidth(image), extraMip = width === FINE_STREET_WIDTH ? clamp((rough-0.09)/0.16) : 0;
  const levels = filtered(image);
  const lod = Math.min(levels.length-1, Math.max(0, rough * 5 - 0.4 + extraMip)), low = Math.floor(lod);
  for (let k = low; k <= Math.ceil(lod); k++) {
    const w = width >> k, h = w >> 1, src = levels[k]!;
    const a = u * w - 0.5, b = Math.max(0, Math.min(h - 1, v * h - 0.5)), i = Math.floor(a), j = Math.floor(b);
    const mip = near * weight * (1 - Math.abs(lod - k));
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const at = (Math.min(h - 1, j + dy) * w + ((i + dx) & (w - 1))) * 4;
        const wt = (dx ? a - i : 1 - a + i) * (dy ? b - j : 1 - b + j) * mip;
        for (let c = 0; c < 3; c++) sample[c]! += decoded[src[at+c]!]! * wt;
        sample[3]! += src[at+3]! * wt / 255;
      }
    }
  }
}
