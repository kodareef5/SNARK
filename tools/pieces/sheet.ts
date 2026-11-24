// Draws the review sheets of player building with the software rasterizer, under var/pieces/:
//
//   bun tools/pieces/sheet.ts                 every tier's joints and forms
//   bun tools/pieces/sheet.ts wood stone      those tiers
//   bun tools/pieces/sheet.ts --out DIR       somewhere else
//   bun tools/pieces/sheet.ts --table         the joint test's counts and no pictures
//
// joints-<tier>.png is each junction from outside, from above and from inside with its materials, then as the joint
// test sees it, with the pixels it counts marked: red shows through, yellow is an unfilled outside corner.
// forms-<tier>.png is every form of the tier alone, and a small house of them.
// levels-<tier>.png is every form at each of its levels, with its triangles, and in the corner at the size it is on a
// 1,080-row screen where medium first draws that level.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Pack } from "../../shared/pack/pack.ts";
import type { Asset } from "../art/assets.ts";
import { materialsOf } from "../art/materials.ts";
import { SOURCE } from "../art/source.ts";
import { unpackMeshes, type SourceMesh } from "../pack/write.ts";
import { ModelView } from "../snap.ts";
import { rgbaOf } from "../snap/files.ts";
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphPixel } from "../snap/font.ts";
import { encodePng } from "../snap/png.ts";
import { COUNTS, JointBench, countsOf, fights, piecesPack, registry, tierMeshes } from "./joints.ts";
import { JUNCTIONS, TIERS, formRow, house, mixedWith, tierJunction, type Junction, type Placed, type TierName } from "./layout.ts";
import { BUILDING_CONTENT } from "../../content/building.ts";
import { FORMS } from "../../content/building/forms.ts";
import { bakeMetal } from "../pack/pieces/metal.ts";

/** A flat piece's faces in its own colours are drawn in its kind's: metal's steel greys, and dev orange for the rest. */
const OWN_COLOURS = new Map(BUILDING_CONTENT.flatMap((d) => (d.type === "structure" && d.made ? [[d.id, [d.color, ...(d.colors ?? [])]] as const] : [])));

/** The same by tier, for a form of it that has no kind yet. */
const TIER_COLOURS = new Map([...OWN_COLOURS].map(([id, colours]) => [id.slice(id.lastIndexOf("_") + 1), colours] as const));

type Rgb = readonly [number, number, number];
const PAPER: Rgb = [242, 243, 245];
const INK: Rgb = [28, 32, 38];
const BACK: Rgb = [206, 212, 222];
const LEAK: Rgb = [255, 0, 0];
const NOTCH: Rgb = [255, 220, 0];
/** Each picture is drawn this many times larger and shrunk, which smooths its edges. */
const SMOOTH = 2;

export class Canvas {
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    [this.width, this.height] = [width, height];
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.fill(0, 0, width, height, PAPER);
  }

  fill(x: number, y: number, w: number, h: number, rgb: Rgb): void {
    for (let py = Math.max(0, y); py < Math.min(this.height, y + h); py++) {
      for (let px = Math.max(0, x); px < Math.min(this.width, x + w); px++) this.pixels.set([rgb[0], rgb[1], rgb[2], 255], (py * this.width + px) * 4);
    }
  }

  text(s: string, x: number, y: number, rgb: Rgb = INK, scale = 1): void {
    for (const ch of s) {
      for (let col = 0; col < GLYPH_WIDTH; col++) {
        for (let row = 0; row < GLYPH_HEIGHT; row++) if (glyphPixel(ch.charCodeAt(0), col, row)) this.fill(x + col * scale, y + row * scale, scale, scale, rgb);
      }
      x += (GLYPH_WIDTH + 1) * scale;
    }
  }

  /** Puts a picture `times` larger than it is to be at (x, y), each pixel the mean of the block it stands for. */
  shrink(src: Uint8ClampedArray, sw: number, sh: number, times: number, x: number, y: number): void {
    for (let py = 0; py < sh / times; py++) {
      for (let px = 0; px < sw / times; px++) {
        const o = ((y + py) * this.width + x + px) * 4;
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let dy = 0; dy < times; dy++) for (let dx = 0; dx < times; dx++) sum += src[((py * times + dy) * sw + px * times + dx) * 4 + c]!;
          this.pixels[o + c] = sum / (times * times);
        }
      }
    }
  }

  /** Puts a picture at (x, y), each of its pixels a square `times` across. */
  enlarge(src: Uint8ClampedArray, sw: number, sh: number, times: number, x: number, y: number): void {
    for (let py = 0; py < sh; py++) {
      for (let px = 0; px < sw; px++) this.fill(x + px * times, y + py * times, times, times, [src[(py * sw + px) * 4]!, src[(py * sw + px) * 4 + 1]!, src[(py * sw + px) * 4 + 2]!]);
    }
  }

  png(): Uint8Array {
    return encodePng(this.width, this.height, this.pixels);
  }
}

/** A tier's asset as the art tool finds it, for its materials' pictures. */
async function tierAsset(tier: string): Promise<Asset> {
  const dir = join(SOURCE, "core/structures", tier);
  return { id: `core:${tier}`, name: tier, dir, file: join(dir, `${tier}.snpk`), spec: (await import(join(dir, "asset.ts"))).default };
}

/** Draws placed pieces of a pack with their materials, as the art sheet draws one piece. */
export class Studio {
  private readonly views = new Map<string, ModelView>();
  private readonly index: ReadonlyMap<string, number>;
  readonly pack: Pack;
  private readonly assets: readonly Asset[];

  constructor(pack: Pack, assets: readonly Asset[]) {
    [this.pack, this.assets] = [pack, assets];
    this.index = new Map(pack.header.meshes.map((m, i) => [m.id, i]));
  }

  static async of(pack: Pack, tiers: readonly string[] = ["thatch", "wood", "stone"]): Promise<Studio> {
    return new Studio(pack, await Promise.all(tiers.map(tierAsset)));
  }

  private view(width: number, height: number): ModelView {
    const key = `${width}x${height}`;
    let view = this.views.get(key);
    if (view) return view;
    // A view holds every picture of the pack: a sheet of many sizes keeps the last few, not one a size.
    if (this.views.size >= 4) this.views.delete(this.views.keys().next().value!);
    this.views.set(key, (view = new ModelView(this.pack, width, height, [BACK[0] / 255, BACK[1] / 255, BACK[2] / 255])));
    const materials = this.assets.flatMap(materialsOf);
    (this.pack.header.textures ?? []).forEach((t, slot) => {
      const m = materials.find((m) => t.id === `${m.id}/${t.role}`);
      if (!m) throw new Error(`the pack names the texture ${t.id}, and no tier's asset has its pictures`);
      view!.texture(slot, t.role, rgbaOf(m, t.role, t.top).pictures);
    });
    return view;
  }

  /**
   * The pieces from `around` degrees round `centre` and `above` degrees up, the ball of `radius` filling the picture,
   * at `level` of each or its coarsest. What lies under `floor` is hidden, as the ground hides it.
   */
  shoot(placed: readonly Placed[], width: number, height: number, centre: readonly [number, number, number], radius: number, around: number, above: number, level = 0, floor: number | null = 0): Uint8ClampedArray {
    const view = this.view(width, height);
    const header = this.pack.header.meshes;
    // One draw takes one level, so pieces are drawn by the level each has.
    const parts = placed.map((p) => [this.index.get(p.id)!, p.x, p.y, p.z, p.yaw] as const);
    const least = Math.min(...parts.map(([m]) => header[m]!.lods.length - 1));
    const at = Math.min(level, least);
    const surfaced = parts.every(([m]) => (header[m]!.lods[at]!.sections?.length ?? 0) > 0);
    const own = placed.map((p) => OWN_COLOURS.get(p.id) ?? TIER_COLOURS.get(/_([a-z]+)(_cut\d)?$/.exec(p.id)?.[1] ?? "")).find((c) => c !== undefined) ?? [];
    view.draw({ mesh: parts[0]![0], level: at, placed: parts, around, above, centre, radius, rig: null, colors: Array.from({ length: 6 }, (_, k) => own[k] ?? 3), textured: surfaced, ...(floor === null ? {} : { floor }) });
    return view.raster.color;
  }
}

const slug = (s: string): string => s.replaceAll(" ", "-");

/** One tier's junctions: three views with materials, and the joint test's own picture with its counts. */
function jointSheet(tier: TierName, studio: Studio, bench: JointBench, junctions: readonly Junction[], meshes: ReadonlyMap<string, SourceMesh>): Canvas {
  const [cw, ch, gap, head] = [216, 260, 4, 34];
  const shots: readonly (readonly [string, number, number])[] = [["outside", 225, 12], ["above", 225, 58], ["inside", 45, 20]];
  const marked = bench.raster.height + 30;
  const canvas = new Canvas(8 + junctions.length * (cw + gap), head + shots.length * (ch + gap) + marked + 8);
  canvas.text(`${tier}: joints. red shows through, yellow is an unfilled outside corner`, 8, 6, INK, 2);
  junctions.forEach((j, col) => {
    const x = 8 + col * (cw + gap);
    const tall = j.looks.length * 3;
    const centre = [j.vertex[0], j.looks.reduce((a, b) => a + b, 0) / j.looks.length, j.vertex[1]] as const;
    shots.forEach(([, around, above], row) => {
      const px = studio.shoot(j.pieces, cw * SMOOTH, ch * SMOOTH, centre, tall * 0.62 + 0.4, around, above);
      canvas.shrink(px, cw * SMOOTH, ch * SMOOTH, SMOOTH, x, head + row * (ch + gap));
    });
    canvas.text(j.name === "mixed 90" ? `mixed 90 with ${mixedWith(tier)}` : j.name, x + 4, head + 4);
    // The test's picture from outside the corner, level and from above, with what it counts.
    const y = head + shots.length * (ch + gap);
    const w = bench.raster.width;
    [[232, 5], [232, 50]].forEach(([around, above], k) => {
      bench.draw(j, j.looks[0]!, around!, above!);
      const px = bench.raster.color.slice();
      bench.count(j, (at, what) => px.set([...(what === "leak" ? LEAK : NOTCH), 255], at * 4));
      canvas.enlarge(px, w, bench.raster.height, 1, x + k * (w + 4), y);
    });
    const seen = bench.measure(j);
    const fought = fights(j.pieces, meshes);
    canvas.text(`leak ${seen.leak} notch ${seen.notch}`, x, y + bench.raster.height + 4);
    canvas.text(`fights ${fought.faces}, ${fought.area} cm2`, x, y + bench.raster.height + 16);
  });
  shots.forEach(([name], row) => canvas.text(name, 12, head + row * (ch + gap) + ch - 14));
  return canvas;
}

/** One tier's forms, each from its front left and its back right, and a house of them from two corners and above. */
function formSheet(tier: TierName, studio: Studio, has: (id: string) => boolean, half: (id: string) => readonly [number, number, number]): Canvas {
  const forms = formRow(tier, 0, 0, has, half);
  const [cw, ch, gap, head] = [170, 190, 4, 30];
  const [hw, hh] = [508, 380];
  const canvas = new Canvas(8 + Math.max(forms.length * (cw + gap), 3 * (hw + gap)), head + 2 * (ch + gap) + hh + 8);
  canvas.text(`${tier}: every form, and a house of them`, 8, 6, INK, 2);
  forms.forEach((p, col) => {
    const h = half(p.id);
    const radius = Math.max(h[1], Math.hypot(h[0], h[2]) * 0.8) * 1.15 + 0.1;
    [[40, 14], [220, 14]].forEach(([around, above], row) => {
      const px = studio.shoot([p], cw * SMOOTH, ch * SMOOTH, [p.x, p.y, p.z], radius, around!, above!);
      canvas.shrink(px, cw * SMOOTH, ch * SMOOTH, SMOOTH, 8 + col * (cw + gap), head + row * (ch + gap));
    });
    canvas.text(p.id.slice(5, -tier.length - 1), 12 + col * (cw + gap), head + 4);
  });
  const built = house(tier, 0, 0, has);
  [[215, 16], [35, 22], [215, 62]].forEach(([around, above], k) => {
    const px = studio.shoot(built, hw * SMOOTH, hh * SMOOTH, [3, 1.9, 3], 5.6, around!, above!);
    canvas.shrink(px, hw * SMOOTH, hh * SMOOTH, SMOOTH, 8 + k * (hw + gap), head + 2 * (ch + gap));
  });
  return canvas;
}

/** Metres on medium at which a made piece's levels begin (tools/pack/pieces/lod.ts LEVEL_ERRORS), and pixels a metre is a metre off at 1,080 rows. */
const LEVEL_FROM = [0, 19, 60, 147, 386] as const;
const PIXELS = 935;

/** One tier's forms at each level: large, and small at the size it is first drawn at. */
function levelSheet(tier: TierName, studio: Studio, has: (id: string) => boolean, half: (id: string) => readonly [number, number, number], meshes: ReadonlyMap<string, SourceMesh>): Canvas {
  const forms = formRow(tier, 0, 0, has, half);
  const [cw, ch, gap, head] = [168, 176, 4, 30];
  const canvas = new Canvas(8 + LEVEL_FROM.length * (cw + gap), head + forms.length * (ch + gap));
  canvas.text(`${tier}: each form's levels, from ${LEVEL_FROM.join(", ")} m on medium`, 8, 6, INK, 2);
  forms.forEach((p, row) => {
    const h = half(p.id), lods = meshes.get(p.id)!.lods;
    const radius = Math.max(h[1], Math.hypot(h[0], h[2]) * 0.8) * 1.15 + 0.1;
    lods.forEach((lod, level) => {
      const [x, y] = [8 + level * (cw + gap), head + row * (ch + gap)];
      canvas.shrink(studio.shoot([p], cw * SMOOTH, ch * SMOOTH, [p.x, p.y, p.z], radius, 40, 14, level), cw * SMOOTH, ch * SMOOTH, SMOOTH, x, y);
      canvas.text(`${p.id.slice(5, -tier.length - 1)} ${level}: ${lod.indices.length / 3}`, x + 4, y + 4);
      const small = Math.max(4, Math.round((PIXELS * 2 * radius) / Math.max(LEVEL_FROM[level]!, 6)));
      if (level > 0 && small < cw / 2) canvas.shrink(studio.shoot([p], small * SMOOTH, small * SMOOTH, [p.x, p.y, p.z], radius, 40, 14, level), small * SMOOTH, small * SMOOTH, SMOOTH, x + cw - small - 2, y + ch - small - 2);
    });
  });
  return canvas;
}

export async function main(args: readonly string[], say: (line: string) => void = console.log): Promise<void> {
  const out = resolve(args.includes("--out") ? args[args.indexOf("--out") + 1]! : "var/pieces");
  const named = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
  const tiers = TIERS.filter((t) => named.length === 0 || named.includes(t));
  mkdirSync(out, { recursive: true });
  const pack = piecesPack([...tierMeshes(), ...bakeMetal(FORMS)]);
  const meshes = new Map(unpackMeshes(pack).map((m) => [m.id, m] as const));
  const reg = registry();
  const has = (id: string): boolean => reg.index.has(id);
  const half = (id: string): readonly [number, number, number] => {
    const k = reg.index.get(id)!;
    return [reg.halfX[k]!, reg.halfY[k]!, reg.halfZ[k]!];
  };
  const laid = tiers.map((tier, t) => JUNCTIONS.map((name, k) => tierJunction(name, tier, 64 + k * 32, 64 + t * 32, has)));
  const bench = new JointBench(pack, laid.flat());
  if (args.includes("--table")) {
    say(`// ${COUNTS.join(", ")}`);
    tiers.forEach((tier, t) => say(`  ${tier}: { ${laid[t]!.map((j) => `"${j.name}": [${countsOf(bench, j, meshes).join(", ")}]`).join(", ")} },`));
    return;
  }
  const studio = await Studio.of(pack);
  tiers.forEach((tier, t) => {
    for (const [name, canvas] of [["joints", jointSheet(tier, studio, bench, laid[t]!, meshes)], ["forms", formSheet(tier, studio, has, half)], ["levels", levelSheet(tier, studio, has, half, meshes)]] as const) {
      const file = join(out, `${name}-${slug(tier)}.png`);
      writeFileSync(file, canvas.png());
      say(file);
    }
  });
}

if (import.meta.main) await main(process.argv.slice(2));
