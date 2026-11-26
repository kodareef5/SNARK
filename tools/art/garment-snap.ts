// Pictures of the garment cuts on both bodies before the game draws garments: each body posed by the game's own bones
// (characters.ts writeBones) through rest, a walk and a crouch, the skin zones a cut hides left out, the cut drawn over
// it with its sheet's weave, its masks dyed in three sample colours and a test print where its print goes. A small
// depth-buffered rasterizer of its own, lit from the front and above; it draws shape and fit, not the game's lighting.
//
//   bun tools/art/garment-snap.ts [--pack FILE] [--cut tee,jeans] [--level N] [--out DIR] [--outfit tee+jeans+trainers] [--frame X,Y,HIGH]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeBones } from "../../client/core/render/characters.ts";
import { BONE_FLOATS } from "../../client/core/render/packet.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { HUMAN_BONES, SLOT_NAMES } from "../../shared/anim/human.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import { CUTS, cutMesh } from "../../shared/people/cuts.ts";
import { encodePng, readPicture, type Picture } from "../pack/image.ts";
import { unpackMeshes, type SourceLod, type SourceMesh } from "../pack/write.ts";
import { humanAnim, motionSet } from "./cloth-fit.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const BODIES = join(ROOT, "assets/source/core/humans/human-bodies/human-bodies.snpk");
const MAPS = join(ROOT, "assets/source/core/humans/human-bodies/garments");

/** The three sample colours a cut is dyed in for its picture: main, accent and trim, linear. */
const DYE: readonly (readonly [number, number, number])[] = [[0.08, 0.22, 0.32], [0.75, 0.32, 0.06], [0.85, 0.85, 0.82]];
const SKIN: readonly [number, number, number] = [0.62, 0.42, 0.31];
const POSES = ["rest", "walk @16", "crouch @0"];

interface Texture { pic: Picture; side: number }
const linear = (s: number): number => (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
const textures = new Map<string, Texture>();
function texture(file: string): Texture {
  let t = textures.get(file);
  if (!t) textures.set(file, (t = { pic: readPicture(file), side: 0 }));
  t.side = t.pic.width;
  return t;
}
function sample(t: Texture, u: number, v: number, c: number): number {
  const s = t.side, x = Math.min(s - 1, Math.max(0, Math.floor(u * s))), y = Math.min(s - 1, Math.max(0, Math.floor(v * s)));
  return t.pic.data[(y * s + x) * t.pic.channels + c]! / 255;
}

/** A skinned level posed by a frame's bone rows: positions and normals. */
function pose(lod: SourceLod, m: Float32Array): { p: Float64Array; n: Float64Array } {
  const count = lod.positions.length / 3;
  const p = new Float64Array(count * 3), n = new Float64Array(count * 3);
  for (let v = 0; v < count; v++) {
    const x = lod.positions[v * 3]!, y = lod.positions[v * 3 + 1]!, z = lod.positions[v * 3 + 2]!;
    const nx = lod.normals?.[v * 3] ?? 0, ny = lod.normals?.[v * 3 + 1] ?? 0, nz = lod.normals?.[v * 3 + 2] ?? 1;
    const four = lod.joints && lod.weights ? 4 : 1;
    for (let k = 0; k < four; k++) {
      const w = four === 4 ? lod.weights![v * 4 + k]! : 1;
      if (w === 0) continue;
      const b = (four === 4 ? lod.joints![v * 4 + k]! : lod.bones![v]!) * BONE_FLOATS;
      for (let a = 0; a < 3; a++) {
        p[v * 3 + a]! += w * (m[b + a * 4]! * x + m[b + a * 4 + 1]! * y + m[b + a * 4 + 2]! * z + m[b + a * 4 + 3]!);
        n[v * 3 + a]! += w * (m[b + a * 4]! * nx + m[b + a * 4 + 1]! * ny + m[b + a * 4 + 2]! * nz);
      }
    }
  }
  return { p, n };
}

interface Frame { width: number; height: number; rgb: Float32Array; depth: Float32Array }

/** Draws posed triangles into a frame, seen along -z (front) or +z (back), with a colour for each pixel's surface point. */
function draw(f: Frame, p: Float64Array, n: Float64Array, idx: ArrayLike<number>, keep: (t: number) => boolean, back: boolean, centre: number[], scale: number, colour: (t: number, b: number[], out: number[]) => void): void {
  const sx = (x: number): number => f.width / 2 + (back ? -1 : 1) * (x - centre[0]!) * scale;
  const sy = (y: number): number => f.height / 2 - (y - centre[1]!) * scale;
  const out = [0, 0, 0];
  const light = [-0.35, 0.55, back ? -0.75 : 0.75];
  const ll = Math.hypot(...light);
  for (let t = 0; t * 3 + 2 < idx.length; t++) {
    if (!keep(t)) continue;
    const c = [idx[t * 3]!, idx[t * 3 + 1]!, idx[t * 3 + 2]!];
    const X = c.map((v) => sx(p[v * 3]!)), Y = c.map((v) => sy(p[v * 3 + 1]!)), Z = c.map((v) => (back ? -1 : 1) * p[v * 3 + 2]!);
    const area = (X[1]! - X[0]!) * (Y[2]! - Y[0]!) - (Y[1]! - Y[0]!) * (X[2]! - X[0]!);
    // Seen from outside a triangle runs counter-clockwise; on the screen, with y down, that is a negative area.
    if (area >= 0) continue;
    const x0 = Math.max(0, Math.floor(Math.min(...X))), x1 = Math.min(f.width - 1, Math.ceil(Math.max(...X)));
    const y0 = Math.max(0, Math.floor(Math.min(...Y))), y1 = Math.min(f.height - 1, Math.ceil(Math.max(...Y)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((X[1]! - px) * (Y[2]! - py) - (Y[1]! - py) * (X[2]! - px)) / area;
      const w1 = ((X[2]! - px) * (Y[0]! - py) - (Y[2]! - py) * (X[0]! - px)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * Z[0]! + w1 * Z[1]! + w2 * Z[2]!;
      const i = y * f.width + x;
      if (z <= f.depth[i]!) continue;
      f.depth[i] = z;
      const b = [w0, w1, w2];
      const nn = [0, 1, 2].map((a) => b.reduce((s, w, k) => s + w * n[c[k]! * 3 + a]!, 0));
      const l = Math.max(0, (nn[0]! * light[0]! + nn[1]! * light[1]! + nn[2]! * light[2]!) / (Math.hypot(nn[0]!, nn[1]!, nn[2]!) * ll || 1));
      colour(t, b, out);
      for (let a = 0; a < 3; a++) f.rgb[i * 3 + a] = out[a]! * (0.28 + 0.8 * l);
    }
  }
}

export interface SnapOptions {
  pack?: Uint8Array;
  cuts?: readonly string[];
  level?: number;
  out?: string;
  /** Cuts worn together in one picture, each list one picture: "tee+jeans+trainers". */
  outfits?: readonly (readonly string[])[];
  /** Where the picture is centred, x and y in metres, and how many metres high it shows. */
  frame?: readonly [number, number, number];
}

export function snapGarments(o: SnapOptions = {}): string[] {
  const pack = parsePack(o.pack ?? new Uint8Array(readFileSync(BODIES)));
  const meshes = unpackMeshes(pack);
  const reg = compileContent(CORE_CONTENT).registry!;
  const coversOf = new Map<string, number>();
  for (let i = 0; i < reg.defs.length; i++) {
    const d = reg.defs[i] as { garment?: { cut?: string } } | null;
    if (d?.garment?.cut) coversOf.set(d.garment.cut, (coversOf.get(d.garment.cut) ?? 0) | reg.garmentZones[i]!);
  }
  const level = o.level ?? 0;
  const out = o.out ?? join(ROOT, "artifacts/people/cuts");
  mkdirSync(out, { recursive: true });
  const anim = humanAnim();
  const W = 300, H = 440;
  const sets = o.outfits ?? (o.cuts ?? Object.keys(CUTS)).map((c) => [c]);
  const written: string[] = [];
  const bones = new Float32Array(HUMAN_BONES * BONE_FLOATS);
  for (const set of sets) {
    const cols = POSES.length * 2, rows = 2;
    const sheet = new Uint8Array(W * cols * H * rows * 3);
    ["m", "f"].forEach((sex, row) => {
      const id = `core:human_${sex}`;
      const rig = pack.header.rigs.find((r) => r.id === `human_${sex}`)!;
      const rest = Float32Array.from(rig.rest);
      const motion = motionSet(anim, rest);
      const hidden = set.reduce((m, c) => m | (coversOf.get(c) ?? 0), 0);
      const parts = SLOT_NAMES.map((name) => meshes.find((m) => m.id === `${id}/${name}`)).filter((m): m is SourceMesh => !!m);
      const worn = set.map((c) => ({ cut: c, mesh: meshes.find((m) => m.id === cutMesh(id, c)) })).filter((w) => w.mesh);
      POSES.forEach((poseName, k) => {
        const solved = motion.find((m) => m.name === poseName)!.solved;
        writeBones(bones, 0, solved, rest, null, 0, 0, 0, 0);
        for (const back of [false, true]) {
          const f: Frame = { width: W, height: H, rgb: new Float32Array(W * H * 3).fill(0.93), depth: new Float32Array(W * H).fill(-Infinity) };
          const [cx, cy, tall] = o.frame ?? [0, 0.86, 2];
          const centre = [cx, cy], scale = H / tall;
          for (const mesh of parts) {
            const lod = mesh.lods[Math.min(level, mesh.lods.length - 1)]!;
            const { p, n } = pose(lod, bones);
            const skin = (t: number): boolean => /skin/.test(mesh.materials?.[lod.sections?.[t] ?? 0]?.id ?? "skin");
            draw(f, p, n, lod.indices, (t) => !((hidden >>> (lod.zones?.[t] ?? 0)) & 1), back, centre, scale, (t, _, c) => {
              const s = skin(t) ? SKIN : [0.12, 0.1, 0.09];
              c[0] = s[0]; c[1] = s[1]; c[2] = s[2];
            });
          }
          for (const { cut, mesh } of worn) {
            const lod = mesh!.lods[Math.min(level, mesh!.lods.length - 1)]!;
            const { p, n } = pose(lod, bones);
            const sheetName = CUTS[cut]!.sheet;
            const base = texture(join(MAPS, `${sheetName}-base.png`)), m1 = texture(join(MAPS, `${cut}-${sex}-mask.png`)), m2 = texture(join(MAPS, `${cut}-${sex}-mask2.png`));
            const print = CUTS[cut]!.print;
            draw(f, p, n, lod.indices, () => true, back, centre, scale, (t, b, c) => {
              if (!lod.uvs) {
                // A flat level: its region's colour.
                const r = lod.colors[lod.indices[t * 3]!]! - REGION_BASE;
                const d = DYE[r === 5 ? 2 : r === 4 ? 1 : 0]!;
                c[0] = d[0]; c[1] = d[1]; c[2] = d[2];
                return;
              }
              const u = [0, 1, 2].reduce((s, k) => s + b[k]! * lod.uvs![lod.indices[t * 3 + k]! * 2]!, 0), v = [0, 1, 2].reduce((s, k) => s + b[k]! * lod.uvs![lod.indices[t * 3 + k]! * 2 + 1]!, 0);
              const g = linear(sample(base, u, v, 0)) / 0.5;
              const w = [sample(m1, u, v, 1), sample(m2, u, v, 1), sample(m2, u, v, 2)];
              for (let a = 0; a < 3; a++) c[a] = g * (w[0]! * DYE[0]![a]! + w[1]! * DYE[1]![a]! + w[2]! * DYE[2]![a]! + (1 - w[0]! - w[1]! - w[2]!) * 0.5);
              // The test print: a frame and a cross in the print's place.
              const pu = (u - print[0]) / print[2], pv = (v - print[1]) / print[3];
              if (pu >= 0 && pu <= 1 && pv >= 0 && pv <= 1 && (Math.min(pu, 1 - pu, pv, 1 - pv) < 0.06 || Math.abs(pu - pv) < 0.04 || (pv < 0.5 && Math.abs(pu - 0.5) < 0.04))) {
                c[0] = 0.9; c[1] = 0.85; c[2] = 0.1;
              }
            });
          }
          const col = k * 2 + (back ? 1 : 0);
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let a = 0; a < 3; a++) {
            const l = f.rgb[(y * W + x) * 3 + a]!;
            sheet[((row * H + y) * W * cols + col * W + x) * 3 + a] = Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(Math.min(1, l), 1 / 2.4) - 0.055));
          }
        }
      });
    });
    const file = join(out, `${set.join("+")}${level ? `-level${level}` : ""}${o.frame ? "-near" : ""}.png`);
    writeFileSync(file, encodePng({ width: W * cols, height: H * rows, channels: 3, depth: 8, data: sheet }));
    written.push(file);
  }
  return written;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
  const files = snapGarments({
    pack: arg("pack") ? new Uint8Array(readFileSync(arg("pack")!)) : undefined,
    cuts: arg("cut")?.split(","),
    level: Number(arg("level") ?? 0),
    out: arg("out"),
    outfits: arg("outfit")?.split(",").map((s) => s.split("+")),
    frame: arg("frame")?.split(",").map(Number) as [number, number, number] | undefined,
  });
  for (const f of files) console.log(f);
}
