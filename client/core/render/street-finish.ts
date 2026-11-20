// Receiver labels are optical properties. Gameplay material, impact sounds and salvage stay independent.
import { FRAME, type FramePacket } from "./packet.ts";
import { SURFACE_NAMES } from "../../../content/surfaces.ts";
export const STEEL = SURFACE_NAMES.indexOf("steel"), RUST = SURFACE_NAMES.indexOf("rust"), GLASS = SURFACE_NAMES.indexOf("glass");
export function worldReceiver(surface: number, rough: number, metal: number): number {
  if (surface === GLASS) return Math.max(0, Math.min(1, (0.8 - rough) * 2.5));
  return surface === STEEL || surface === RUST ? Math.max(0, Math.min(1, (0.85 - rough) * 3)) * metal : 0;
}
export const STREET_WIDTH = 64, FINE_STREET_WIDTH = 128;
export function streetWidth(image: StreetImage): number {
  return image.pixels.length === FINE_STREET_WIDTH * FINE_STREET_WIDTH * 2 ? FINE_STREET_WIDTH : STREET_WIDTH;
}
export interface StreetImage {
  pixels: Uint8Array;
  revision: number;
}

export const PAINT = 1, FITTINGS = 2, FIXTURE_PAINT = 1, FIXTURE_IRON = 2, SIGN_ENAMEL = 3;
export function fixtureKind(mesh: string): number {
  if (mesh === "core:box_trailer") return 4;
  if (mesh === "core:zruin_zutility_concrete") return FIXTURE_PAINT;
  if (mesh === "core:zruin_zdrain_concrete") return FIXTURE_IRON;
  if (/^core:zruin_zsign_(?:blue|clay|mint|rose)$/.test(mesh)) return SIGN_ENAMEL;
  return 0;
}
export function fixtureFace(kind: number, palette: number, y = 0, z = 0): number {
  if (kind === 4) {
    const axle = y < 1.08 && Math.min(Math.abs(z+5.054), Math.abs(z+3.754)) < 0.55;
    if (axle && palette === 82) return 5;
    if (palette === 102 || palette === 86) return axle ? 4 : 6;
    return palette === 41 || palette === 214 ? 7 : 0;
  }
  if (kind === SIGN_ENAMEL) return SIGN_ENAMEL;
  return (kind === FIXTURE_PAINT && palette === 140) || (kind === FIXTURE_IRON && palette === 11) ? kind : 0;
}

/** Capture priority is separate from the per-pixel mask. A rough wheel, a poster or a missing pane can share a mesh with paint or glass. */
export function streetPriority(id: string): number {
  if (/^core:zruin_(?:zstore|zwin|zcurt)/.test(id)) return 0.85;
  if (/^core:zruin_(?:zshutter|zutility|zdrain)_/.test(id)) return 0.42;
  const exposure = vehicleWeather(id);
  if (exposure) return 0.85 - 0.5 * exposure;
  if (fixtureKind(id) === SIGN_ENAMEL) return 0.5;
  if (/^core:zzstreet_(?:hydrant|shelter|signal|lamp|meter|paystation|rail|fence|billboard|bollard|mailbox|newsbox)/.test(id)) return 0.4;
  return /^core:compact_abandoned(?:_|$)/.test(id) ? 0.85 : 0;
}

export function streetMaterial(id: string, wheeledRig = false): number {
  const [asset, part] = id.split("/");
  if (asset === "core:street") return part === "street" || part === "street_cut" ? FITTINGS : 0;
  if (
    !wheeledRig && asset !== "core:compact_wreck" && asset !== "core:tanker_wrecks" && !/^core:(?:compact|fastback|patrol_sedan|patrol_jeep|taxi|panel_van|caravan|road_van|muscle_car|semi|monster_truck|bus|veloce|berlinetta|tanker|box_trailer)(?:_abandoned)?$/
      .test(asset!)
  ) return 0;
  return /^(?:body|coach|coachwork|cruiser|patrol|enamel|paint|livery|shell|exterior|finish)$/.test(part!) ? PAINT : FITTINGS;
}

/** Exposure of the material left on each placed vehicle. The separate cistern shares the salvage atlas. */
export function vehicleWeather(mesh: string): number {
  if (mesh === "core:box_trailer") return 0.32;
  if (mesh.startsWith("core:compact_abandoned") || mesh === "core:tanker_abandoned") return 0.55;
  if (mesh.startsWith("core:compact_wreck") || mesh === "core:tanker_burnout") return 1;
  return /^core:tanker_(?:impact|rear_crush|rollover|separated|stripped|cistern)$/.test(mesh) ? 0.78 : 0;
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
  const paint = label === PAINT ? paintMask * clamp((0.72 - rough) * 3.5) : 0;
  return Math.max(paint, clamp(metal * 1.5) * clamp((0.85 - rough) * 3), clamp((0.34 - rough) * 5));
}

/** Broken patches in metres, attached to the prop. Oxide replaces a fraction of the exposed conductor. */
export function weatherVehicle(albedo: Float64Array, orm: Float64Array, x: number, y: number, z: number, seed: number, age: number): void {
  const field = 0.48*Math.sin(4.1*x+2.7*z+13*seed) + 0.32*Math.sin(6.7*y-3.2*z+8*seed) + 0.2*Math.sin(15*x+11*z+3*y);
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

/** The bead and shoulder moulding in wheel-local radii. A metre of motion carries the pattern with the tire. */
export function tireMould(x: number, y: number, z: number, footprint: number): number {
  const radius = Math.hypot(y,z), phase = Math.atan2(y,z);
  const ridge = (r: number) => clamp(1 - Math.abs(radius-r)/0.012);
  const shoulder = clamp((radius-0.86)*14);
  const block = Math.cos(42*phase + 13*Math.abs(x));
  const groove = clamp((block-0.32)*3) * shoulder;
  const ribs = ridge(0.77) + ridge(0.845) + 0.65*ridge(0.885);
  return (0.25*ribs - 0.32*groove + 0.09*shoulder*(1-groove)) * clamp(1-45*footprint);
}

export function wheelFinish(albedo: Float64Array, orm: Float64Array, wheelMask: number, near: number, mould: number, seed: number, y: number, z: number, footprint: number, outboard = 0): number {
  const metal = orm[2]!, rough = orm[1]!;
  const radial = Math.hypot(y, z);
  // A painted centre and an iron rotor can share a wheel joint with the rubber and the exposed rim.
  const rubber = clamp((0.30-metal)*5)*clamp((rough-0.45)*5)*near*clamp((radial-0.45)*9);
  const outerMetal = clamp((outboard-0.16)*10)*clamp((0.83-radial)*12)*clamp((0.70-rough)*6);
  const chrome = clamp((metal-0.45)*3.4)*Math.max(clamp(wheelMask*1.8),clamp((0.35-rough)*6),outerMetal)*clamp((0.85-rough)*5)*near;
  const tone = 1-rubber*(0.75-0.10*clamp((rough-0.24)*2)+0.08*(1-orm[0]!)-1.1*mould);
  for (let c=0; c<3; c++) albedo[c]! *= tone;
  orm[1]! += rubber*(Math.max(0,0.90-rough)-0.38*mould);
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
void weatherVehicle(inout vec3 albedo, inout vec3 orm, vec3 p, float seed, float age) {
  float field = 0.48*sin(4.1*p.x+2.7*p.z+13.0*seed)+0.32*sin(6.7*p.y-3.2*p.z+8.0*seed)+0.20*sin(15.0*p.x+11.0*p.z+3.0*p.y);
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
          dst[(y * w + x) * 4 + c] = Math.round((src[i]! + src[i + 4]! + src[i + w * 8]! + src[i + w * 8 + 4]!) / 4);
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
    const mip = near * weight * (1 - Math.abs(lod - k)) / 255;
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const at = (Math.min(h - 1, j + dy) * w + ((i + dx) & (w - 1))) * 4;
        const wt = (dx ? a - i : 1 - a + i) * (dy ? b - j : 1 - b + j) * mip;
        for (let c = 0; c < 4; c++) sample[c]! += src[at + c]! * wt;
      }
    }
  }
}
