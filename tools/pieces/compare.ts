// Sets a tier's pieces as its recipe makes them beside the pack they replace: how far the two lie apart at the finest
// level, and pictures of both at every level's distance, under var/pieces/.
//
//   bun tools/pieces/compare.ts --old var/pieces/old/wood.snpk     against a pack kept from before the recipe
//   bun tools/pieces/compare.ts --old PACK --numbers               the distances and no pictures
//
// The new side is the tier's pack as `bun run art -- core:wood` last built it.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FORMS } from "../../content/building/forms.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { SOURCE } from "../art/source.ts";
import { levelsOf } from "../pack/pieces/lod.ts";
import { WOOD } from "../pack/pieces/wood.ts";
import { buildPack, unpackMeshes, type SourceLod } from "../pack/write.ts";
import { Canvas, Studio } from "./sheet.ts";

/** Pixels a metre stands on a 1,080-row screen from one metre off, and the error in pixels medium lets pass: what the art check counts levels by. */
const SCALE = 1080 / (2 * Math.tan(1.2217 / 2));
const THRESHOLD = tierOf("medium").threshold;

/** Metres from a point to a triangle of `p`. */
function toTriangle(x: number, y: number, z: number, p: Float32Array, a: number, b: number, c: number): number {
  const [ax, ay, az] = [p[a]!, p[a + 1]!, p[a + 2]!];
  const [ux, uy, uz, vx, vy, vz] = [p[b]! - ax, p[b + 1]! - ay, p[b + 2]! - az, p[c]! - ax, p[c + 1]! - ay, p[c + 2]! - az];
  const [wx, wy, wz] = [x - ax, y - ay, z - az];
  const [uu, uv, vv, wu, wv] = [ux * ux + uy * uy + uz * uz, ux * vx + uy * vy + uz * vz, vx * vx + vy * vy + vz * vz, wx * ux + wy * uy + wz * uz, wx * vx + wy * vy + wz * vz];
  const det = uu * vv - uv * uv;
  let [s, t] = det > 1e-18 ? [(vv * wu - uv * wv) / det, (uu * wv - uv * wu) / det] : [0, 0];
  if (s < 0 || t < 0 || s + t > 1 || det <= 1e-18) {
    // Outside: the nearest point is on one of the three edges.
    const edge = (px: number, py: number, pz: number, dx: number, dy: number, dz: number): number => {
      const l = dx * dx + dy * dy + dz * dz;
      const k = l > 0 ? Math.max(0, Math.min(1, ((x - px) * dx + (y - py) * dy + (z - pz) * dz) / l)) : 0;
      return Math.hypot(x - px - dx * k, y - py - dy * k, z - pz - dz * k);
    };
    return Math.min(edge(ax, ay, az, ux, uy, uz), edge(ax, ay, az, vx, vy, vz), edge(p[b]!, p[b + 1]!, p[b + 2]!, vx - ux, vy - uy, vz - uz));
  }
  [s, t] = [Math.max(0, s), Math.max(0, t)];
  return Math.hypot(wx - ux * s - vx * t, wy - uy * s - vy * t, wz - uz * s - vz * t);
}

/** Metres from each of `points` to the surface of `lod`, least first. */
function distances(points: ArrayLike<number>, lod: Pick<SourceLod, "positions" | "indices">): number[] {
  const out: number[] = [];
  for (let v = 0; v < points.length; v += 3) {
    let best = Infinity;
    for (let t = 0; t < lod.indices.length; t += 3) best = Math.min(best, toTriangle(points[v]!, points[v + 1]!, points[v + 2]!, lod.positions, lod.indices[t]! * 3, lod.indices[t + 1]! * 3, lod.indices[t + 2]! * 3));
    out.push(best);
  }
  return out.sort((a, b) => a - b);
}

/** A level's corners and the middles of its triangles. */
function samples(lod: Pick<SourceLod, "positions" | "indices">): number[] {
  const out = [...lod.positions];
  for (let t = 0; t < lod.indices.length; t += 3) for (let a = 0; a < 3; a++) out.push((lod.positions[lod.indices[t]! * 3 + a]! + lod.positions[lod.indices[t + 1]! * 3 + a]! + lod.positions[lod.indices[t + 2]! * 3 + a]!) / 3);
  return out;
}

const mm = (metres: number): string => (metres * 1000).toFixed(1);

/**
 * How far the recipe's finest level lies from the old pack's, a line a form: from the recipe's faces of each material
 * to the old surface, which holds its frame to the old frame, and from the old surface to the recipe's, which shows what
 * the recipe left out.
 */
export function distanceLines(old: Pack): string[] {
  const was = new Map(unpackMeshes(old).map((m) => [m.id, m.lods[0]!]));
  return Object.entries(FORMS).map(([name, form]) => {
    const before = was.get(`core:${name}_wood`)!;
    const shape = levelsOf(WOOD, name, form)[0]!;
    const mats = [...new Set(shape.faces.map((f) => f.mat))];
    const forward = mats.map((mat) => {
      const part = new (shape.constructor as new () => typeof shape)();
      part.faces.push(...shape.faces.filter((f) => f.mat === mat));
      const d = distances(samples(part.lod(null, () => 0)), before);
      return `${mat} ${mm(d[d.length - 1]!)}`;
    });
    const back = distances(samples(before), shape.lod(null, () => 0));
    return `${name.padEnd(12)} recipe to old, furthest mm: ${forward.join(", ").padEnd(52)} old to recipe: furthest ${mm(back[back.length - 1]!).padStart(6)}, 99 in 100 within ${mm(back[Math.floor(back.length * 0.99)]!).padStart(5)}, 95 in 100 within ${mm(back[Math.floor(back.length * 0.95)]!).padStart(5)}`;
  });
}

/** The level of a mesh medium draws from `metres` off. */
function levelAt(pack: Pack, id: string, metres: number): number {
  const lods = pack.header.meshes[pack.meshIndex.get(id)!]!.lods;
  let level = 0;
  lods.forEach((l, k) => {
    if (k > 0 && l.error > 0 && (l.error * SCALE) / THRESHOLD <= metres && !lods.slice(k + 1).some((far) => far.error <= l.error)) level = k;
  });
  return level;
}

/** Pages of old beside new: each form near, then as large as it stands on a 1,080-row screen from where each new level begins, enlarged. */
async function pages(old: Pack, made: Pack, out: string, say: (line: string) => void): Promise<void> {
  const [before, after] = [await Studio.of(old, ["wood"]), await Studio.of(made, ["wood"])];
  const names = Object.keys(FORMS);
  const [near, far, gap, head] = [300, 150, 4, 34];
  const row = near + 18;
  const perPage = 3;
  for (let page = 0; page * perPage < names.length; page++) {
    const forms = names.slice(page * perPage, (page + 1) * perPage);
    const canvas = new Canvas(8 + 2 * (near + gap) + 8 * (far + gap) + 8, head + forms.length * (row + gap) + 4);
    canvas.text("wood, old | recipe: near, then from where each of the recipe's levels begins on medium at 1080 rows", 8, 6, [28, 32, 38], 2);
    forms.forEach((name, r) => {
      const id = `core:${name}_wood`;
      const header = made.header.meshes[made.meshIndex.get(id)!]!;
      const centre = header.center as [number, number, number];
      const radius = Math.max(header.half[1], Math.hypot(header.half[0], header.half[2]) * 0.8) * 1.12 + 0.05;
      const y = head + r * (row + gap);
      const piece = [{ id, x: 0, y: 0, z: 0, yaw: 0 }];
      [before, after].forEach((studio, side) => {
        const px = studio.shoot(piece, near * 2, near * 2, centre, radius, 38, 14, 0, null);
        canvas.shrink(px, near * 2, near * 2, 2, 8 + side * (near + gap), y);
      });
      canvas.text(`${name}: ${old.header.meshes[old.meshIndex.get(id)!]!.lods.map((l) => l.indexCount / 3).join("/")} | ${header.lods.map((l) => l.indexCount / 3).join("/")}`, 12, y + near + 4);
      header.lods.slice(1).forEach((lod, k) => {
        const metres = Math.ceil((lod.error * SCALE) / THRESHOLD);
        // As many pixels as it has on the screen from there, each drawn as a square.
        const side = Math.max(4, Math.round((2 * radius * SCALE) / metres));
        const times = Math.max(1, Math.floor(far / side));
        const x = 8 + 2 * (near + gap) + k * 2 * (far + gap);
        [[before, old] as const, [after, made] as const].forEach(([studio, pack], s) => {
          const level = levelAt(pack, id, metres);
          const px = studio.shoot(piece, side, side, centre, radius, 38, 14, level, null).slice();
          canvas.enlarge(px, side, side, times, x + s * (far + gap), y);
          if (s === 0) canvas.text(`${metres} m: level ${level} | ${levelAt(made, id, metres)}`, x + 2, y + near + 4);
        });
      });
    });
    const file = join(out, `compare-wood-${page + 1}.png`);
    writeFileSync(file, canvas.png());
    say(file);
  }
  // Close to: a wall's corner and boards, a floor from standing height, a doorway's head.
  const close: readonly (readonly [string, readonly [number, number, number], number, number, number])[] = [
    ["wall", [1.05, 0.9, 0.1], 0.62, 30, 8], ["wall", [-0.7, -1.2, 0.1], 0.5, -20, 20], ["doorframe", [0.6, 0.85, 0.1], 0.6, 25, -10], ["windowframe", [0, 0.1, 0.1], 0.75, 20, 10],
    ["ceiling", [0.9, 0.12, 0.9], 0.75, 40, 35], ["ceiling", [0.6, -0.1, 0.6], 0.9, 30, -40], ["foundation", [1.2, 0, 1.2], 0.55, 40, 22], ["stairs", [0.9, 0.2, 0.4], 0.7, 40, 30], ["door", [0.3, 0, 0], 0.6, 20, 5], ["pillar", [0, 1.15, 0], 0.5, 35, 10],
  ];
  const side = 380;
  const canvas = new Canvas(8 + 4 * (side + gap) + 4, head + Math.ceil(close.length / 2) * (side + 16 + gap));
  canvas.text("wood close to, old | recipe", 8, 6, [28, 32, 38], 2);
  close.forEach(([name, centre, radius, around, above], k) => {
    const piece = [{ id: `core:${name}_wood`, x: 0, y: 0, z: 0, yaw: 0 }];
    const [x, y] = [8 + (k % 2) * 2 * (side + gap), head + Math.floor(k / 2) * (side + 16 + gap)];
    [before, after].forEach((studio, s) => canvas.shrink(studio.shoot(piece, side * 2, side * 2, centre, radius, around, above, 0, null), side * 2, side * 2, 2, x + s * (side + gap), y));
    canvas.text(name, x + 4, y + side + 3);
  });
  const file = join(out, "compare-wood-close.png");
  writeFileSync(file, canvas.png());
  say(file);
}

export async function main(args: readonly string[], say: (line: string) => void = console.log): Promise<void> {
  const value = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
  const from = value("old");
  if (!from) throw new Error("--old PACK: the pack to set the recipe beside");
  const old = parsePack(new Uint8Array(readFileSync(from)));
  for (const line of distanceLines(old)) say(line);
  if (args.includes("--numbers")) return;
  const out = resolve(value("out") ?? "var/pieces");
  mkdirSync(out, { recursive: true });
  const made = parsePack(new Uint8Array(readFileSync(join(SOURCE, "core/structures/wood/wood.snpk"))));
  // Both packs again in today's form, so one drawing serves them.
  const again = (pack: Pack): Pack => parsePack(buildPack(unpackMeshes(pack), defaultPalette()));
  await pages(again(old), again(made), out, say);
}

if (import.meta.main) await main(process.argv.slice(2));
