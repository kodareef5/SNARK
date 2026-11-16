// Metre-space materials for terrain and meshes without authored surfaces. CPU and GLSL deliberately use the same
// projection, integer hash, triangular blend, weather fields and mip footprint. There is no animation clock here.
import { SURFACE_CITIES, SURFACE_FINISHES, SURFACE_GROUPS, SURFACE_NAMES, surfaceIndex } from "../../../content/surfaces.ts";
import { srgbToLinear } from "./surface.ts";

type Out = Float64Array;
type Numbers = ArrayLike<number>;
export const WORLD_PAD = 1 / 32;
export const WORLD_CORE = 1 - 2 * WORLD_PAD;
/** The smallest mip sampled has eight texels per cell; smaller ones mix unrelated atlas cells. */
export const WORLD_MIN_MIP = 5;
export const WORLD_ASKED = 2048;
/**
 * Each finish's mean in the atlas's 4 x 4 mip, which a distant finish fades to without reading it: base red, green and
 * blue (sRGB), then the packed map's occlusion and roughness. The normal map's mean is flat in every finish.
 */
export const WORLD_MEANS = [
  96, 108, 42, 235, 232, 205, 182, 156, 247, 242, 128, 102, 77, 237, 233, 92, 73, 59, 234, 229,
  124, 124, 122, 239, 235, 147, 129, 110, 240, 236, 93, 93, 92, 236, 231, 130, 126, 120, 240, 235,
  137, 133, 125, 240, 236, 160, 112, 85, 239, 234, 163, 114, 83, 239, 234, 122, 78, 58, 235, 230,
  113, 111, 106, 238, 233, 195, 190, 180, 247, 242, 93, 86, 77, 235, 230, 116, 128, 128, 240, 235,
] as const;

export function surfaceCity(id: string): string {
  const key = id.split(":").pop()!;
  return key in SURFACE_CITIES ? key : "default";
}
/** Three vec4s: tint and scale; weather, wetness, growth, desert; bump and reserved. */
export function citySurface(out: Float32Array, id: string): void {
  const key = surfaceCity(id), d = SURFACE_CITIES[key]!;
  out.set(d.tint);
  out[3] = d.scale;
  out[4] = d.weather;
  out[5] = d.wetness;
  out[6] = d.growth;
  out[7] = key === "las-vegas" ? 1 : 0;
  out[8] = d.bump;
  out.fill(0, 9, 12);
}
const finishes = SURFACE_NAMES.map((name, i) => {
  const f = SURFACE_FINISHES[name], g = SURFACE_GROUPS[f.group];
  // Seven digits, as many as the GPU keeps, so the text stays short and both twins hold the same numbers.
  const mean = WORLD_MEANS.slice(i * 5, i * 5 + 5).map((b, c) => Number((c < 3 ? srgbToLinear(b / 255) : b / 255).toPrecision(7)));
  return { ...f, metres: f.metres * g.scale, bump: f.bump * g.bump, weather: f.weather * g.weather, tint: g.tint, wetness: g.wetness, growth: g.growth, mean };
});

export function surfaceHash(x: number, y: number): number {
  let h = (Math.imul(x, 1597334677) ^ Math.imul(y, 3812015801)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0;
  return ((h ^ (h >>> 13)) >>> 8) / 16777216;
}
const fract = (x: number): number => x - Math.floor(x);
const clamp = (x: number, a = 0, b = 1): number => Math.max(a, Math.min(b, x));
export function surfaceNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = fract(x), fy = fract(y);
  const a = fx * fx * (3 - 2 * fx), b = fy * fy * (3 - 2 * fy);
  return (surfaceHash(ix, iy) * (1 - a) + surfaceHash(ix + 1, iy) * a) * (1 - b) + (surfaceHash(ix, iy + 1) * (1 - a) + surfaceHash(ix + 1, iy + 1) * a) * b;
}

/** role 0 base (linear), 1 normal (xy), 2 occlusion/roughness. u/v are in the atlas; spread is log2 atlas pixels per screen pixel / atlas width. */
export type WorldSample = (role: number, u: number, v: number, spread: number, out: Out) => void;
const b = new Float64Array(4), n = new Float64Array(4), m = new Float64Array(4);
const sum = new Float64Array(7);
const weights = new Float64Array(3), corners = new Int32Array(6);

/** Writes linear albedo, ORM and the bumped normal. footprint is metres covered by one screen pixel on the projection. */
export function worldSurface(albedo: Out, orm: Out, normal: Out, palette: Numbers, index: number, x: number, y: number, z: number,
  nx: number, ny: number, nz: number, footprint: number, city: Numbers, sample: WorldSample): void {
  const f = finishes[index]!;
  const axis = Math.abs(ny) >= Math.max(Math.abs(nx), Math.abs(nz)) ? 1 : Math.abs(nx) > Math.abs(nz) ? 0 : 2;
  const metres = f.metres * city[3]!;
  const u = (axis === 0 ? z : x) / metres, v = (axis === 1 ? z : -y) / metres;
  const spread = Math.log2(Math.max(footprint / metres * WORLD_CORE / 4, 1e-9));
  const fade = clamp((spread + WORLD_MIN_MIP) / (WORLD_MIN_MIP - 2));
  const relief = Math.max(0, 1 - footprint / (metres * 0.4));
  // Base red, green and blue, occlusion and roughness, and the bump.
  for (let c = 0; c < 5; c++) sum[c] = f.mean[c]!;
  sum[5] = sum[6] = 0;
  if (fade < 1) {
    let taps = 1;
    corners[0] = corners[1] = 0; weights[0] = 1; weights[1] = weights[2] = 0;
    if (!f.directional) {
      taps = 3;
      const a = u * 0.35, c = v * 0.35, ix = Math.floor(a), iy = Math.floor(c), fx = fract(a), fy = fract(c), low = fx + fy < 1;
      corners[0] = low ? ix : ix + 1; corners[1] = low ? iy : iy + 1;
      corners[2] = low ? ix + 1 : ix; corners[3] = low ? iy : iy + 1;
      corners[4] = low ? ix : ix + 1; corners[5] = low ? iy + 1 : iy;
      weights[0] = low ? 1 - fx - fy : fx + fy - 1; weights[1] = low ? fx : 1 - fx; weights[2] = low ? fy : 1 - fy;
      let total = 0;
      for (let k = 0; k < 3; k++) { weights[k] = weights[k]! * weights[k]! * weights[k]!; total += weights[k]!; }
      for (let k = 0; k < 3; k++) weights[k]! /= total;
    }
    const heaviest = weights[2]! > Math.max(weights[0]!, weights[1]!) ? 2 : weights[1]! > weights[0]! ? 1 : 0;
    let hu = 0, hv = 0, turned = 0, r = 0, g = 0, bl = 0;
    for (let k = 0; k < taps; k++) {
      const h = f.directional ? 0 : surfaceHash(corners[k * 2]!, corners[k * 2 + 1]!);
      const rot = Math.floor(h * 4);
      const ru = rot === 0 ? u : rot === 1 ? -v : rot === 2 ? -u : v;
      const rv = rot === 0 ? v : rot === 1 ? u : rot === 2 ? -v : -u;
      const au = ((index % 4) + WORLD_PAD + fract(ru + h * 13) * WORLD_CORE) / 4;
      const av = (Math.floor(index / 4) + WORLD_PAD + fract(rv + h * 29) * WORLD_CORE) / 4;
      sample(0, au, av, spread, b);
      r += b[0]! * weights[k]!; g += b[1]! * weights[k]!; bl += b[2]! * weights[k]!;
      if (k === heaviest) { hu = au; hv = av; turned = rot; }
    }
    sum[0] = r * (1 - fade) + sum[0]! * fade; sum[1] = g * (1 - fade) + sum[1]! * fade; sum[2] = bl * (1 - fade) + sum[2]! * fade;
    // Normal and packed maps from the heaviest cell alone.
    sample(2, hu, hv, spread, m);
    sum[3] = m[0]! * (1 - fade) + sum[3]! * fade; sum[4] = m[1]! * (1 - fade) + sum[4]! * fade;
    if (relief > 0) {
      sample(1, hu, hv, spread, n);
      const bx = (n[0]! * 255 - 128) / 127, by = (n[1]! * 255 - 128) / 127;
      sum[5] = (turned === 0 ? bx : turned === 1 ? by : turned === 2 ? -bx : -by) * (1 - fade);
      sum[6] = (turned === 0 ? by : turned === 1 ? -bx : turned === 2 ? -by : bx) * (1 - fade);
    }
  }
  const macro = surfaceNoise(x / 37 + y / 53, z / 37);
  const stain = surfaceNoise(x / 8 + z / 19, y / 17 + z / 11);
  const weather = f.weather * city[4]!;
  const wet = clamp(f.wetness + city[5]!);
  const growth = clamp((f.growth + city[6]!) * clamp((macro - 0.42) * 3) * (ny > 0.2 ? 1 : 0.4));
  for (let c = 0; c < 3; c++) {
    const dye = 1 + (clamp(palette[c]! / 0.3, 0.18, 2.2) - 1) * f.palette;
    const green = c === 1 ? 0.75 : c === 0 ? 0.55 : 0.35;
    albedo[c] = sum[c]! * dye * f.tint[c]! * city[c]! * (1 + (macro - 0.5) * 0.5 - stain * weather * 0.5) * (1 - wet * 0.28) * (1 - growth + growth * green);
  }
  const bump = f.bump * city[8]! * relief;
  const bx = sum[5]! * bump, by = sum[6]! * bump;
  let ox = nx, oy = ny, oz = nz;
  if (axis === 1) { ox += bx; oz += by; } else if (axis === 0) { oz += bx; oy -= by; } else { ox += bx; oy -= by; }
  const length = Math.sqrt(ox * ox + oy * oy + oz * oz);
  normal[0] = ox / length;
  normal[1] = oy / length;
  normal[2] = oz / length;
  orm[0] = sum[3]!;
  orm[1] = clamp(f.rough * (0.8 + 0.2 * sum[4]!) - wet * 0.35, 0.12, 1);
  orm[2] = f.metal;
}

const fl = (n: number): string => Number.isInteger(n) ? n.toFixed(1) : String(n);
const vectors = (name: string, rows: readonly (readonly number[])[]): string => {
  const t = `vec${rows[0]!.length}`;
  return `const ${t} ${name}[16] = ${t}[16](${rows.map((a) => `${t}(${a.map(fl).join(",")})`).join(",")});\n`;
};
/** Adds a material index to FLAT's vertex texts, and gives the colour as light, keeping the low-poly texts byte-for-byte. */
export function worldVertex(vertex: string, ground: boolean): string {
  const table = Array.from({ length: 256 }, (_, i) => surfaceIndex(i, ground));
  const lookup = `flat out int vSurface;\n${ground ? "uniform vec4 uSurfaceCity[3];\n" : ""}const int SURFACE_IDS[256] = int[256](${table.join(",")});\n`;
  const colour = ground ? "int(texelFetch(uTint, at, 0).r)" : "int(i)";
  const desert = ground ? `  if (uSurfaceCity[1].w > 0.5 && (${[100, 101, 122, 123, 124, 158, 167].map((c) => `${colour} == ${c}`).join(" || ")})) vSurface = 5;\n` : "";
  const light = "  vColor = mix(vColor / 12.92, pow((vColor + 0.055) / 1.055, vec3(2.4)), step(0.04045, vColor));\n";
  return vertex.replace("out vec3 vRel;", lookup + "out vec3 vRel;").replace("  vRel = p;", `  vSurface = SURFACE_IDS[${colour}];\n${desert}${light}  vRel = p;`);
}

/** Same operations as worldSurface. All texture reads use explicit derivatives taken before wrapping or random rotation. */
export const WORLD_GLSL = `
flat in int vSurface;
uniform vec3 uWorldEye;
uniform vec4 uSurfaceCity[3];
uniform float uWorldReady;
uniform highp sampler2D uWorldBase, uWorldNormal, uWorldOrm;
${vectors("WF", finishes.map((f) => [f.metres, f.bump, f.rough, f.metal]))}
${vectors("WT", finishes.map((f) => [...f.tint, f.palette]))}
${vectors("WW", finishes.map((f) => [f.weather, f.wetness, f.growth, f.directional ? 1 : 0]))}
${vectors("WB", finishes.map((f) => f.mean.slice(0, 3)))}
${vectors("WO", finishes.map((f) => f.mean.slice(3)))}
float surfaceHash(ivec2 p) {
  uint h = uint(p.x) * 1597334677u ^ uint(p.y) * 3812015801u;
  h = (h ^ (h >> 16u)) * 2246822519u;
  return float((h ^ (h >> 13u)) >> 8u) / 16777216.0;
}
float surfaceNoise(vec2 p) {
  ivec2 i = ivec2(floor(p)); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(surfaceHash(i), surfaceHash(i + ivec2(1,0)), f.x), mix(surfaceHash(i + ivec2(0,1)), surfaceHash(i + ivec2(1,1)), f.x), f.y);
}
vec2 turn(vec2 p, int r) { return r == 0 ? p : r == 1 ? vec2(-p.y,p.x) : r == 2 ? -p : vec2(p.y,-p.x); }
// The level read, and half a texel of the next coarser level, which trilinear filtering also reads and which must stay in the cell.
vec2 worldLod(sampler2D tex, float spread) {
  float top = log2(float(textureSize(tex, 0).x));
  float lod = clamp(top + spread, 0.0, max(0.0, top - ${fl(WORLD_MIN_MIP)}));
  return vec2(lod, 0.5*exp2(ceil(lod)-top));
}
vec4 worldRead(sampler2D tex, vec2 lod, vec2 cell, vec2 uv) {
  return textureLod(tex,clamp(uv,cell+lod.y,cell+0.25-lod.y),lod.x);
}
void worldSurface(inout vec3 albedo, out vec3 orm, inout vec3 n) {
  int id = vSurface;
  vec4 f = WF[id], tint = WT[id], w = WW[id];
  vec3 p = vRel + uWorldEye;
  vec3 an = abs(n);
  int axis = an.y >= max(an.x,an.z) ? 1 : an.x > an.z ? 0 : 2;
  float metres = f.x * uSurfaceCity[0].w;
  vec2 q = (axis == 1 ? p.xz : axis == 0 ? vec2(p.z,-p.y) : vec2(p.x,-p.y)) / metres;
  float rho = max(length(dFdx(q)), length(dFdy(q)));
  float spread = log2(max(rho * ${fl(WORLD_CORE / 4)}, 1e-9));
  float fade = clamp((spread + ${fl(WORLD_MIN_MIP)}) / ${fl(WORLD_MIN_MIP - 2)},0.0,1.0);
  float relief = max(0.0,1.0-rho/0.4);
  vec3 base = WB[id]; vec2 finishMap = WO[id]; vec2 bump = vec2(0.0);
  if (fade < 1.0) {
    ivec2 cells[3]; vec3 weights = vec3(1.0,0.0,0.0); int taps = 1;
    if (w.w < 0.5) {
      vec2 grid = q * 0.35; ivec2 i = ivec2(floor(grid)); vec2 ff = fract(grid);
      if (ff.x + ff.y < 1.0) { cells[0]=i; cells[1]=i+ivec2(1,0); cells[2]=i+ivec2(0,1); weights=vec3(1.0-ff.x-ff.y,ff); }
      else { cells[0]=i+ivec2(1,1); cells[1]=i+ivec2(0,1); cells[2]=i+ivec2(1,0); weights=vec3(ff.x+ff.y-1.0,1.0-ff); }
      weights = weights * weights * weights; weights /= dot(weights,vec3(1.0));
      taps = 3;
    }
    int heaviest = weights.z > max(weights.x,weights.y) ? 2 : weights.y > weights.x ? 1 : 0;
    vec2 cell = vec2(id%4,id/4)/4.0, lod = worldLod(uWorldBase,spread), at = vec2(0.0);
    vec3 detail = vec3(0.0); int turned = 0;
    for (int k=0; k<3; k++) {
      if (k == taps) break;
      float h = w.w > 0.5 ? 0.0 : surfaceHash(cells[k]); int r = int(floor(h*4.0));
      vec2 uv = (vec2(id%4,id/4) + ${fl(WORLD_PAD)} + fract(turn(q,r)+h*vec2(13.0,29.0))*${fl(WORLD_CORE)})/4.0;
      detail += worldRead(uWorldBase,lod,cell,uv).rgb * weights[k];
      if (k == heaviest) { at = uv; turned = r; }
    }
    base = mix(detail,base,fade);
    // Normal and packed maps from the heaviest cell alone.
    finishMap = mix(worldRead(uWorldOrm,worldLod(uWorldOrm,spread),cell,at).rg,finishMap,fade);
    if (relief > 0.0) {
      vec4 nn = worldRead(uWorldNormal,worldLod(uWorldNormal,spread),cell,at);
      bump = turn((nn.WORLD_NORMAL * 255.0 - 128.0) / 127.0,(4-turned)%4)*(1.0-fade);
    }
  }
  float macro = surfaceNoise(vec2(p.x/37.0+p.y/53.0,p.z/37.0));
  float stain = surfaceNoise(vec2(p.x/8.0+p.z/19.0,p.y/17.0+p.z/11.0));
  float weather = w.x*uSurfaceCity[1].x;
  float wet = clamp(w.y+uSurfaceCity[1].y,0.0,1.0);
  float growth = clamp((w.z+uSurfaceCity[1].z)*clamp((macro-0.42)*3.0,0.0,1.0)*(n.y>0.2?1.0:0.4),0.0,1.0);
  albedo = base*mix(vec3(1.0),clamp(albedo/0.3,0.18,2.2),tint.w)*tint.rgb*uSurfaceCity[0].rgb;
  albedo *= (1.0+(macro-0.5)*0.5-stain*weather*0.5)*(1.0-wet*0.28)*mix(vec3(1.0),vec3(0.55,0.75,0.35),growth);
  bump *= f.y*uSurfaceCity[2].x*relief;
  n = normalize(n + (axis==1 ? vec3(bump.x,0.0,bump.y) : axis==0 ? vec3(0.0,-bump.y,bump.x) : vec3(bump.x,-bump.y,0.0)));
  orm = vec3(finishMap.x,clamp(f.z*(0.8+0.2*finishMap.y)-wet*0.35,0.12,1.0),f.w);
}
`;
