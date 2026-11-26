// Paints the maps of the people's materials from the base colours their packs came with, which are all Quaternius
// shipped: a base colour that is each region's own colour over its mean, so a lip or a cheek keeps its hue under the
// look's palette colour; a gentle normal from the colour's lightness; occlusion and roughness; and the masks that say
// which region each texel dyes. Run it with Bun from the repository; it writes beside itself.
//
//   bun assets/source/core/humans/human-bodies/skin/paint.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { encodePng, readPicture, unpack, type Picture } from "../../../../../../tools/pack/image.ts";
import { readAccessor, readGltf } from "../../../../../../tools/pack/gltf.ts";

const HERE = import.meta.dir;
const RAW = resolve(HERE, "../../../../../raw/quaternius");

/** Regions as the masks number them: skin, what is worn under, iris, hair, an outfit's second colour, its trim. -1 is never dyed. */
type Region = -1 | 0 | 1 | 2 | 3 | 4 | 5;
/** What a texel of a source colour is, from its linear colour and how its used texels part best into three by lightness. */
type Classify = (r: number, g: number, b: number, tones: Tones) => Region;

/** The two lightnesses that part a picture's used texels into three, and the region each of the three dyes. */
interface Tones { cuts: readonly [number, number]; regions: readonly [Region, Region, Region] }

interface Spec {
  name: string;
  base: string;
  /** The models and materials whose triangles lie on the picture, to know which texels are used. */
  models: readonly { file: string; material: string }[];
  classify: Classify;
  /** Roughness by region, -1 for what is never dyed. */
  roughness: Readonly<Partial<Record<Region, number>>>;
  /** Sides of the base colour and normal, the packed map and the masks. */
  sides: readonly [number, number, number];
  /** Texels of a 2,048 picture over which the colour is blurred before it is read for its region, and the regions then evened, so a region is a block and not a speckle. */
  smooth?: number;
}

const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const srgb = (l: number): number => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
const fromLinear = (l: number): number => Math.round(srgb(Math.min(1, Math.max(0, l))) * 255);
const saturation = (r: number, g: number, b: number): number => {
  const [lo, hi] = [Math.min(r, g, b), Math.max(r, g, b)];
  return hi > 0 ? (hi - lo) / hi : 0;
};
/** The cook's rule before it: a grey texel is what is worn under, any other skin. Read in sRGB as that rule was. */
const skinOrCloth: Classify = (r, g, b) => (saturation(srgb(r), srgb(g), srgb(b)) < 0.22 ? 1 : 0);
const eye: Classify = (r, g, b) => {
  const [sr, sg, sb] = [srgb(r), srgb(g), srgb(b)];
  const light = ((sr + sg + sb) / 3) * 255;
  if (light > 150 && saturation(sr, sg, sb) < 0.3) return -1;
  return light < 40 ? -1 : 2;
};
const hair: Classify = () => 3;
/** An outfit in three colours by lightness: its largest block the main colour, of the other two the darker the second and the lighter the trim. */
const threeTones: Classify = (r, g, b, { cuts, regions }) => {
  const l = luma(r, g, b);
  return regions[l < cuts[0] ? 0 : l < cuts[1] ? 1 : 2];
};

/** The two lightnesses that part `lights` into three with the least spread within each (Otsu's), by 256 steps of their range. */
function threeWays(lights: Float32Array): [number, number] {
  const [lo, hi] = [lights[0] ?? 0, lights[lights.length - 1] ?? 1];
  const step = (hi - lo) / 256 || 1;
  const count = new Float64Array(256);
  const sum = new Float64Array(256);
  for (const l of lights) {
    const k = Math.min(255, Math.floor((l - lo) / step));
    count[k]!++;
    sum[k]! += l;
  }
  const [cn, cs] = [new Float64Array(257), new Float64Array(257)];
  for (let k = 0; k < 256; k++) [cn[k + 1], cs[k + 1]] = [cn[k]! + count[k]!, cs[k]! + sum[k]!];
  const between = (a: number, b: number): number => (cn[b]! - cn[a]! > 0 ? (cs[b]! - cs[a]!) ** 2 / (cn[b]! - cn[a]!) : 0);
  let best = [-1, 85, 170];
  for (let a = 1; a < 255; a++) for (let b = a + 1; b < 256; b++) {
    const v = between(0, a) + between(a, b) + between(b, 256);
    if (v > best[0]!) best = [v, a, b];
  }
  return [lo + best[1]! * step, lo + best[2]! * step];
}

const BODY = "base-characters";
const HAIR = `${BODY}/hair`;
const OUT = "outfits-fantasy";
const hairs = (material: string, files: readonly string[]) => files.map((f) => ({ file: `${HAIR}/${f}.gltf`, material }));
const outfit = (material: string, files: readonly string[]) => ["Male", "Female"].flatMap((sex) => files.map((f) => ({ file: `${OUT}/${sex}_${f}.gltf`, material })));
const SKIN_ROUGH = { 0: 0.56, 1: 0.82 } as const;

const SPECS: readonly Spec[] = [
  { name: "skin-m", base: `${BODY}/T_Superhero_Male_Ligh.png`, models: [{ file: `${BODY}/Superhero_Male_FullBody.gltf`, material: "MI_Superhero_Male" }], classify: skinOrCloth, roughness: SKIN_ROUGH, sides: [2048, 1024, 512] },
  { name: "skin-f", base: `${BODY}/T_Superhero_Female_Light_BaseColor.png`, models: [{ file: `${BODY}/Superhero_Female_FullBody.gltf`, material: "MI_Superhero_Female" }], classify: skinOrCloth, roughness: SKIN_ROUGH, sides: [2048, 1024, 512] },
  { name: "eyes", base: `${BODY}/T_Eye_Brown.png`, models: [{ file: `${BODY}/Superhero_Male_FullBody.gltf`, material: "MI_Eyes" }], classify: eye, roughness: { 2: 0.12, [-1]: 0.16 }, sides: [256, 128, 128] },
  {
    name: "hair-1", base: `${BODY}/T_Hair_1_BaseColor.png`, classify: hair, roughness: { 3: 0.48 }, sides: [2048, 1024, 512],
    models: [{ file: `${BODY}/Superhero_Male_FullBody.gltf`, material: "MI_Hair_1" }, ...hairs("MI_Hair_1", ["Hair_Buzzed", "Hair_BuzzedFemale", "Hair_SimpleParted", "Hair_Beard", "Eyebrows_Regular"])],
  },
  {
    name: "hair-2", base: `${BODY}/T_Hair_2_BaseColor.png`, classify: hair, roughness: { 3: 0.48 }, sides: [2048, 1024, 512],
    models: [{ file: `${BODY}/Superhero_Female_FullBody.gltf`, material: "MI_Hair_2" }, ...hairs("MI_Hair_2", ["Hair_Long", "Hair_Buns", "Eyebrows_Female"])],
  },
  { name: "cloth", base: `${OUT}/T_Peasant_BaseColor.png`, models: outfit("MI_Peasant", ["Peasant_Arms", "Peasant_Body", "Peasant_Feet", "Peasant_Legs"]), classify: threeTones, roughness: { 1: 0.86, 4: 0.8, 5: 0.7 }, sides: [2048, 1024, 512], smooth: 8 },
  {
    name: "hide", base: `${OUT}/T_Ranger_BaseColor.png`, classify: threeTones, roughness: { 1: 0.62, 4: 0.7, 5: 0.5 }, sides: [2048, 1024, 512], smooth: 8,
    models: [...outfit("MI_Ranger", ["Ranger_Arms", "Ranger_Body", "Ranger_Legs", "Ranger_Head_Hood"]), { file: `${OUT}/Male_Ranger_Feet_Boots.gltf`, material: "MI_Ranger" }, { file: `${OUT}/Female_Ranger_Feet.gltf`, material: "MI_Ranger" }],
  },
  { name: "regular-m", base: `${OUT}/T_Regular_Male_Dark_BaseColor.png`, models: [{ file: `${OUT}/Male_Peasant_Arms.gltf`, material: "MI_Regular_Male" }, { file: `${OUT}/Male_Ranger_Arms.gltf`, material: "MI_Regular_Male" }], classify: skinOrCloth, roughness: SKIN_ROUGH, sides: [2048, 1024, 512] },
  { name: "regular-f", base: `${OUT}/T_Regular_Female_Dark_BaseColor.png`, models: [{ file: `${OUT}/Female_Peasant_Arms.gltf`, material: "MI_Regular_Female" }, { file: `${OUT}/Female_Ranger_Arms.gltf`, material: "MI_Regular_Female" }], classify: skinOrCloth, roughness: SKIN_ROUGH, sides: [2048, 1024, 512] },
];

/** How much darker than its mean a texel's colour may make a region and still be kept: the ratio's floor and ceiling. */
const RATIO = [0.2, 1.9] as const;
/** The base colour's mean where a region dyes it, as light: the material's grey. The ratio scales from it. */
const MEAN = 0.5;
/** How high, in texels of a 2,048 picture, a step of one in the square root of lightness stands; and how wide its surroundings are. */
const DEPTH = 4;
const SURROUND = 24;
/** Texels from the edge of a used island over which the normal fades to flat, so the two sides of a seam light alike. */
const FADE = 6;

/** A square picture's texels, `channels` floats each. */
interface Field { side: number; channels: number; data: Float32Array }

const field = (side: number, channels: number): Field => ({ side, channels, data: new Float32Array(side * side * channels) });

/** `f` at half the side, each texel the mean of four, or where `weight` says, the weighted mean. */
function halve(f: Field): Field {
  const out = field(f.side / 2, f.channels);
  for (let y = 0; y < out.side; y++) for (let x = 0; x < out.side; x++) for (let c = 0; c < f.channels; c++) {
    const at = (dx: number, dy: number): number => f.data[((y * 2 + dy) * f.side + x * 2 + dx) * f.channels + c]!;
    out.data[(y * out.side + x) * f.channels + c] = (at(0, 0) + at(1, 0) + at(0, 1) + at(1, 1)) / 4;
  }
  return out;
}

function shrink(f: Field, side: number): Field {
  while (f.side > side) f = halve(f);
  if (f.side !== side) throw new Error(`a picture of ${f.side} cannot be made ${side} across`);
  return f;
}

/** The texels the models' triangles cover, at `side`, one past their edges. */
function coverage(spec: Spec, side: number): Uint8Array {
  const out = new Uint8Array(side * side);
  for (const m of spec.models) {
    const g = readGltf(join(RAW, m.file));
    for (const mesh of g.json.meshes ?? []) for (const prim of mesh.primitives) {
      if (g.json.materials?.[prim.material ?? -1]?.name !== m.material || prim.attributes.TEXCOORD_0 === undefined) continue;
      const uv = readAccessor(g, prim.attributes.TEXCOORD_0).data;
      const index = readAccessor(g, prim.indices!).data;
      for (let t = 0; t + 2 < index.length; t += 3) {
        const p = [0, 1, 2].map((k) => [uv[index[t + k]! * 2]! * side - 0.5, uv[index[t + k]! * 2 + 1]! * side - 0.5] as const);
        const [x0, x1] = [Math.floor(Math.min(...p.map((q) => q[0]))) - 1, Math.ceil(Math.max(...p.map((q) => q[0]))) + 1];
        const [y0, y1] = [Math.floor(Math.min(...p.map((q) => q[1]))) - 1, Math.ceil(Math.max(...p.map((q) => q[1]))) + 1];
        const area = (p[1]![0] - p[0]![0]) * (p[2]![1] - p[0]![1]) - (p[2]![0] - p[0]![0]) * (p[1]![1] - p[0]![1]);
        for (let y = Math.max(0, y0); y <= Math.min(side - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(side - 1, x1); x++) {
          // Inside, or within a texel of an edge.
          let inside = true;
          for (let k = 0; k < 3 && inside; k++) {
            const [a, b] = [p[k]!, p[(k + 1) % 3]!];
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            const d = ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) / len;
            inside = (area >= 0 ? d : -d) >= -1.1;
          }
          if (inside) out[y * side + x] = 1;
        }
      }
    }
  }
  return out;
}

/** Fills every texel `known` does not mark from the known ones near it, coarse to fine, so nothing bleeds in from unused texels. */
function fill(f: Field, known: Uint8Array): void {
  const levels: { f: Field; w: Float32Array }[] = [{ f, w: Float32Array.from(known) }];
  while (levels[levels.length - 1]!.f.side > 1) {
    const { f: top, w } = levels[levels.length - 1]!;
    const side = top.side / 2;
    const next = field(side, top.channels);
    const weight = new Float32Array(side * side);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      let sum = 0;
      for (let d = 0; d < 4; d++) {
        const at = (y * 2 + (d >> 1)) * top.side + x * 2 + (d & 1);
        sum += w[at]!;
        for (let c = 0; c < top.channels; c++) next.data[(y * side + x) * top.channels + c]! += top.data[at * top.channels + c]! * w[at]!;
      }
      if (sum > 0) for (let c = 0; c < top.channels; c++) next.data[(y * side + x) * top.channels + c]! /= sum;
      weight[y * side + x] = Math.min(1, sum);
    }
    levels.push({ f: next, w: weight });
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const { f: at, w } = levels[l]!;
    const up = levels[l + 1]!.f;
    for (let y = 0; y < at.side; y++) for (let x = 0; x < at.side; x++) {
      const i = y * at.side + x;
      const k = w[i]!;
      if (k >= 1) continue;
      const j = (y >> 1) * up.side + (x >> 1);
      for (let c = 0; c < at.channels; c++) at.data[i * at.channels + c] = at.data[i * at.channels + c]! * k + up.data[j * at.channels + c]! * (1 - k);
      w[i] = 1;
    }
  }
}

/** A blur of one channel by a box `r` texels each way, twice, which is near a Gaussian. */
function blurred(src: Float32Array, side: number, r: number): Float32Array {
  let a = Float32Array.from(src);
  for (let pass = 0; pass < 2; pass++) {
    for (const across of [true, false]) {
      const b = new Float32Array(a.length);
      for (let line = 0; line < side; line++) {
        let sum = 0;
        const at = (k: number): number => a[across ? line * side + Math.min(side - 1, Math.max(0, k)) : Math.min(side - 1, Math.max(0, k)) * side + line]!;
        for (let k = -r; k <= r; k++) sum += at(k);
        for (let k = 0; k < side; k++) {
          b[across ? line * side + k : k * side + line] = sum / (2 * r + 1);
          sum += at(k + r + 1) - at(k - r);
        }
      }
      a = b;
    }
  }
  return a;
}

function picture(f: Field, encode: (v: number, c: number) => number): Picture {
  const data = new Uint8Array(f.side * f.side * f.channels);
  for (let i = 0; i < data.length; i++) data[i] = Math.max(0, Math.min(255, encode(f.data[i]!, i % f.channels)));
  return { width: f.side, height: f.side, channels: f.channels, depth: 8, data };
}

function paint(spec: Spec, dir: string): string {
  const [side, packedSide, maskSide] = spec.sides;
  const source = readPicture(join(RAW, spec.base));
  let colour: Field = { side: source.width, channels: 3, data: new Float32Array(source.width * source.width * 3) };
  const rgba = unpack(source, (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  for (let i = 0; i < source.width * source.width; i++) for (let c = 0; c < 3; c++) colour.data[i * 3 + c] = rgba[i * 4 + c]!;
  colour = shrink(colour, side);
  const used = coverage(spec, side);
  fill(colour, used);
  const n = side * side;

  // Regions by texel, then each region's mean colour, over the used texels.
  const reach = spec.smooth ? Math.max(1, Math.round((spec.smooth * side) / 2048)) : 0;
  const read = reach > 0 ? [0, 1, 2].map((c) => blurred(Float32Array.from({ length: n }, (_, i) => colour.data[i * 3 + c]!), side, reach)) : [0, 1, 2].map((c) => Float32Array.from({ length: n }, (_, i) => colour.data[i * 3 + c]!));
  const lights = Float32Array.from({ length: n }, (_, i) => luma(read[0]![i]!, read[1]![i]!, read[2]![i]!)).filter((_, i) => used[i]);
  lights.sort();
  const cuts = threeWays(lights);
  const sizes = [lights.filter((l) => l < cuts[0]).length, lights.filter((l) => l >= cuts[0] && l < cuts[1]).length, lights.filter((l) => l >= cuts[1]).length];
  const largest = sizes.indexOf(Math.max(...sizes));
  const others = [0, 1, 2].filter((k) => k !== largest);
  const regions = [0, 0, 0] as [Region, Region, Region];
  regions[largest] = 1;
  regions[others[0]!] = 4;
  regions[others[1]!] = 5;
  const tones: Tones = { cuts, regions };
  const region = new Int8Array(n);
  const means = Array.from({ length: 6 }, () => [0, 0, 0, 0]);
  for (let i = 0; i < n; i++) region[i] = spec.classify(read[0]![i]!, read[1]![i]!, read[2]![i]!, tones);
  if (reach > 0) {
    // Each texel takes the region most of the texels around it have.
    const kinds = [...new Set(region)];
    const share = kinds.map((k) => blurred(Float32Array.from(region, (r) => (r === k ? 1 : 0)), side, reach));
    for (let i = 0; i < n; i++) region[i] = kinds[share.reduce((best, s, j) => (s[i]! > share[best]![i]! ? j : best), 0)]!;
  }
  for (let i = 0; i < n; i++) {
    const [r, g, b] = [colour.data[i * 3]!, colour.data[i * 3 + 1]!, colour.data[i * 3 + 2]!];
    if (!used[i] || region[i]! < 0) continue;
    const m = means[region[i]!]!;
    m[0]! += r; m[1]! += g; m[2]! += b; m[3]!++;
  }
  for (const m of means) if (m[3]! > 0) for (let c = 0; c < 3; c++) m[c]! /= m[3]!;

  const base = field(side, 3);
  const masks = field(side, 6);
  const rough = field(side, 1);
  for (let i = 0; i < n; i++) {
    const k = region[i]!;
    for (let c = 0; c < 3; c++) {
      const own = colour.data[i * 3 + c]!;
      // A dyed texel is its region's colour times this, through the palette over the material's grey.
      base.data[i * 3 + c] = k < 0 ? own : MEAN * Math.min(RATIO[1], Math.max(RATIO[0], own / Math.max(means[k]![c]!, 1e-4)));
    }
    if (k >= 0) masks.data[i * 6 + k] = 1;
    rough.data[i] = spec.roughness[k as Region] ?? spec.roughness[-1] ?? 0.6;
  }

  // Height is lightness against its surroundings; the normal leans with it, less near an island's edge.
  const light = Float32Array.from({ length: n }, (_, i) => Math.sqrt(luma(colour.data[i * 3]!, colour.data[i * 3 + 1]!, colour.data[i * 3 + 2]!)));
  const scale = side / 2048;
  const height = blurred(light, side, Math.max(1, Math.round(scale)));
  const around = blurred(light, side, Math.max(2, Math.round(SURROUND * scale)));
  // How far each texel is inside its island, by erosion, as a share of FADE.
  const inner = new Float32Array(n);
  let left = Float32Array.from(used);
  for (let pass = 0; pass < FADE; pass++) {
    const next = new Float32Array(n);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const i = y * side + x;
      next[i] = Math.min(left[i]!, left[y * side + Math.max(0, x - 1)]!, left[y * side + Math.min(side - 1, x + 1)]!, left[Math.max(0, y - 1) * side + x]!, left[Math.min(side - 1, y + 1) * side + x]!);
      inner[i]! += next[i]! / FADE;
    }
    left = next;
  }
  const normal = field(side, 3);
  const occlusion = field(side, 1);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const i = y * side + x;
    const h = (dx: number, dy: number): number => height[Math.min(side - 1, Math.max(0, y + dy)) * side + Math.min(side - 1, Math.max(0, x + dx))]! - around[i]!;
    const lean = DEPTH * inner[i]! * scale;
    // Green points up the picture, and rows run down it.
    const nx = -(h(1, 0) - h(-1, 0)) * 0.5 * lean;
    const ny = (h(0, 1) - h(0, -1)) * 0.5 * lean;
    const len = Math.hypot(nx, ny, 1);
    normal.data[i * 3] = nx / len;
    normal.data[i * 3 + 1] = ny / len;
    normal.data[i * 3 + 2] = 1 / len;
    occlusion.data[i] = 1 - Math.min(0.35, Math.max(0, around[i]! - height[i]!) * 1.5);
  }
  const packed = field(side, 3);
  for (let i = 0; i < n; i++) {
    packed.data[i * 3] = occlusion.data[i]!;
    packed.data[i * 3 + 1] = rough.data[i]!;
  }
  for (const f of [base, normal, packed]) fill(f, used);
  fill(masks, used);

  const small = shrink(masks, maskSide);
  const mask = field(maskSide, 3);
  const mask2 = field(maskSide, 3);
  for (let i = 0; i < maskSide * maskSide; i++) {
    // The six may sum past 1 by rounding; the largest gives way.
    const w = Array.from({ length: 6 }, (_, k) => Math.round(small.data[i * 6 + k]! * 255));
    for (let over = w.reduce((t, v) => t + v, 0) - 255; over > 0; over--) w[w.indexOf(Math.max(...w))]!--;
    for (let k = 0; k < 3; k++) {
      mask.data[i * 3 + k] = w[k]!;
      mask2.data[i * 3 + k] = w[k + 3]!;
    }
  }
  const write = (role: string, p: Picture): void => writeFileSync(join(dir, `${spec.name}-${role}.png`), encodePng(p));
  write("base", picture(base, (v) => fromLinear(v)));
  write("normal", picture(normal, (v) => Math.round((v * 0.5 + 0.5) * 255)));
  write("orm", picture(shrink(packed, packedSide), (v) => Math.round(v * 255)));
  write("mask", picture(mask, (v) => v));
  write("mask2", picture(mask2, (v) => v));
  const share = (k: number): string => `${((means[k]![3]! / Math.max(1, lights.length)) * 100).toFixed(1)}%`;
  return `${spec.name}: ${lights.length} used texels of ${n}; regions ${[0, 1, 2, 3, 4, 5].filter((k) => means[k]![3]! > 0).map((k) => `${k} ${share(k)}`).join(", ")}`;
}

if (import.meta.main) {
  const dir = process.argv[2] ? resolve(process.argv[2]) : HERE;
  mkdirSync(dir, { recursive: true });
  const only = process.argv[3];
  for (const spec of SPECS) if (!only || spec.name === only) console.log(paint(spec, dir));
}
