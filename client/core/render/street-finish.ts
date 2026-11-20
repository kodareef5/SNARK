// Receiver labels are optical properties. Gameplay material, impact sounds and salvage stay independent.
import { FRAME, type FramePacket } from "./packet.ts";
import { SURFACE_NAMES } from "../../../content/surfaces.ts";
export const STEEL = SURFACE_NAMES.indexOf("steel"), RUST = SURFACE_NAMES.indexOf("rust"), GLASS = SURFACE_NAMES.indexOf("glass");
export function worldReceiver(surface: number, rough: number, metal: number): number {
  if (surface === GLASS) return Math.max(0, Math.min(1, (0.8 - rough) * 2.5));
  return surface === STEEL || surface === RUST ? Math.max(0, Math.min(1, (0.85 - rough) * 3)) * metal : 0;
}
export const STREET_WIDTH = 64, STREET_HEIGHT = 32;
export interface StreetImage {
  pixels: Uint8Array;
  revision: number;
}

export const PAINT = 1, FITTINGS = 2, FIXTURE_PAINT = 1, FIXTURE_IRON = 2, SIGN_ENAMEL = 3;
export function fixtureKind(mesh: string): number {
  if (mesh === "core:zruin_zutility_concrete") return FIXTURE_PAINT;
  if (mesh === "core:zruin_zdrain_concrete") return FIXTURE_IRON;
  if (/^core:zruin_zsign_(?:blue|clay|mint|rose)$/.test(mesh)) return SIGN_ENAMEL;
  return 0;
}
export function fixtureFace(kind: number, palette: number): number {
  if (kind === SIGN_ENAMEL) return SIGN_ENAMEL;
  return (kind === FIXTURE_PAINT && palette === 140) || (kind === FIXTURE_IRON && palette === 11) ? kind : 0;
}

/** Capture priority is separate from the per-pixel mask. A rough wheel, a poster or a missing pane can share a mesh with paint or glass. */
export function streetPriority(id: string): number {
  if (/^core:zruin_(?:zstore|zwin|zcurt)/.test(id)) return 0.85;
  if (/^core:zruin_(?:zshutter|zutility|zdrain)_/.test(id)) return 0.42;
  if (fixtureKind(id) === SIGN_ENAMEL) return 0.5;
  if (/^core:zzstreet_(?:hydrant|shelter|signal|lamp|meter|paystation|rail|fence|billboard|bollard|mailbox|newsbox)/.test(id)) return 0.4;
  return /^core:compact_abandoned(?:_|$)/.test(id) ? 0.85 : 0;
}

export function streetMaterial(id: string): number {
  const [asset, part] = id.split("/");
  if (asset === "core:street") return part === "street" || part === "street_cut" ? FITTINGS : 0;
  if (
    !/^core:(?:compact|fastback|patrol_sedan|patrol_jeep|taxi|road_van|muscle_car|semi|monster_truck|bus|veloce|berlinetta|tanker|box_trailer)(?:_abandoned)?$/
      .test(asset!)
  ) return 0;
  return /^(?:body|coach|coachwork|cruiser|patrol|enamel|paint|livery|shell|exterior|finish)$/.test(part!) ? PAINT : FITTINGS;
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

/** The slider changes only the fraction of a texel carrying a reflective finish. */
export function glossRoughness(rough: number, mask: number, offset: number): number {
  return Math.max(0.07, Math.min(1, rough * (1 - 0.38 * mask * offset)));
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
  return near*textureLod(uStreetEnv,vec3(uv,layer),clamp(rough*5.0-0.4,0.0,5.0));
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
    const levels = [image.pixels];
    for (let k = 1; k <= 5; k++) levels.push(new Uint8Array((STREET_WIDTH >> k) * (STREET_HEIGHT >> k) * 4));
    mipCache.set(image, cache = { revision: 0, levels });
  }
  cache.levels[0] = image.pixels;
  for (let k = 1; k <= 5; k++) {
    const w = STREET_WIDTH >> k, h = STREET_HEIGHT >> k, src = cache.levels[k - 1]!, dst = cache.levels[k]!;
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
  const lod = Math.max(0, Math.min(5, rough * 5 - 0.4)), low = Math.floor(lod);
  const levels = filtered(image);
  for (let k = low; k <= Math.ceil(lod); k++) {
    const w = STREET_WIDTH >> k, h = STREET_HEIGHT >> k, src = levels[k]!;
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
