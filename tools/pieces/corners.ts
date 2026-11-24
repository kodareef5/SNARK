// Draws a tier's corners with its joints as the client lays and fits them, with their pictures, under var/pieces/:
//
//   bun tools/pieces/corners.ts              corners-thatch.png: walls with no posts of their own, and thatch's joints
//   bun tools/pieces/corners.ts --posts      the same with each wall's own post left on
//   bun tools/pieces/corners.ts --only "walls 90,two storeys"   those alone, large
//
// Every piece is drawn where the near store puts its vertices (client/core/render/piece-fit.ts): a wall's end pulled
// back to its ring where a joint stands, a ceiling's side where a wall comes up under it, a joint cut to its wall.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FORMS } from "../../content/building/forms.ts";
import { FOUNDATION_THICK, baseAt, drawn, layJunction, round } from "../../tests/fixtures/trims.ts";
import { SOURCE } from "../art/source.ts";
import { THATCH_FORMS } from "../pack/pieces/thatch.ts";
import type { SourceMesh } from "../pack/write.ts";
import { JointBench, SIDE, piecesPack, tierMeshes } from "./joints.ts";
import type { Junction, Placed, WallEnd } from "./layout.ts";
import { Canvas, Studio } from "./sheet.ts";

const SMOOTH = 2;
const TIER = "thatch";
/** Corners by the ways their walls leave them: a way, whether the wall's outside is on its left, and its storey. */
const CORNERS: readonly (readonly [name: string, ways: readonly (readonly [number, boolean, number?])[]])[] = [
  ["walls 90", [[0, false], [90, true]]],
  ["tee", [[0, false], [180, true], [90, true]]],
  ["cross", [[0, false], [90, true], [180, true], [270, false]]],
  ["two storeys", [[0, false], [90, true], [0, false, 1], [90, true, 1]]],
  ["walls 180", [[0, false], [180, true]]],
  ["walls 60", [[0, false], [60, true]]],
  ["walls 120", [[0, false], [120, true]]],
];

/** A mesh's finest level with its vertices where an instance of it is drawn, about (ox, oz): its own piece, standing unturned. */
function standing(mesh: SourceMesh, points: Float64Array, ox: number, oz: number, id: string): SourceMesh {
  const lod = mesh.lods[0]!;
  // The turn it was drawn with, from two vertices no clamp moved: the pair furthest apart whose distance is kept.
  let [c, s, most] = [1, 0, 0];
  const n = lod.positions.length / 3;
  for (let a = 0; a < n; a += 7) for (let b = a + 1; b < n; b += 13) {
    const [lx, lz] = [lod.positions[b * 3]! - lod.positions[a * 3]!, lod.positions[b * 3 + 2]! - lod.positions[a * 3 + 2]!];
    const [wx, wz] = [points[b * 3]! - points[a * 3]!, points[b * 3 + 2]! - points[a * 3 + 2]!];
    const l = Math.hypot(lx, lz);
    if (l <= most || Math.abs(l - Math.hypot(wx, wz)) > 1e-4) continue;
    [c, s, most] = [(lx * wx + lz * wz) / (l * l), (lz * wx - lx * wz) / (l * l), l];
  }
  const turned = (from: Float32Array | undefined, size: number): Float32Array | undefined => from && Float32Array.from(from, (_, i) => (i % size === 0 ? c * from[i]! + s * from[i + 2]! : i % size === 2 ? -s * from[i - 2]! + c * from[i]! : from[i]!));
  const positions = Float32Array.from(points, (v, i) => (i % 3 === 0 ? v - ox : i % 3 === 2 ? v - oz : v));
  const normals = turned(lod.normals, 3), tangents = turned(lod.tangents, 4);
  return { ...mesh, id, flat: 1, lods: [{ ...lod, positions, ...(normals ? { normals } : {}), ...(tangents ? { tangents } : {}) }, { ...mesh.lods.at(-1)!, positions: mesh.lods.at(-1)!.positions }] };
}

export async function main(args: readonly string[], say: (line: string) => void = console.log): Promise<void> {
  const out = resolve(args.includes("--out") ? args[args.indexOf("--out") + 1]! : "var/pieces");
  mkdirSync(out, { recursive: true });
  const posts = args.includes("--posts");
  const source = await import(join(SOURCE, "core/structures", TIER, "asset.ts"));
  const forms = Object.fromEntries(THATCH_FORMS.map((name) => [name, FORMS[name]]));
  const baked: SourceMesh[] = source.bakeThatch(forms, true, posts);
  const mine = new Set(baked.map((m) => m.id));
  const others = tierMeshes().filter((m) => !mine.has(m.id));
  const pack = piecesPack([...others, ...baked]);
  const made = new Map(baked.map((m) => [m.id, m] as const));
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1]!.split(",") : null;
  const corners = CORNERS.filter(([name]) => !only || only.includes(name));
  const laid: Junction[] = [];
  const bench = new JointBench(pack, [], SIDE, (structs, reg) => {
    corners.forEach(([name, ways], k) => {
      const storeys = name === "two storeys";
      const [vx, vz] = [64 + (k % 4) * 32, 64 + Math.floor(k / 4) * 32];
      const ends = ways.map(([way, left, storey]): WallEnd => ({ form: "wall", tier: TIER, way, left, storey: storey ?? 0 }));
      laid.push(layJunction(structs, reg, baseAt(structs, vx, storeys ? FOUNDATION_THICK : 0, vz, 0), name, vx, vz, 0, ends, storeys ? TIER : null));
    });
  });
  bench.draw({ vertex: [64, 64] }, 1.5, 30, 20);
  const got = drawn(bench.scene, { chunksX: 8, chunksZ: 8 }, pack, new Map([...others, ...baked].map((m) => [m.id, m] as const)));
  // Each drawn piece as a mesh of its own, its vertices where the fit put them.
  const shown: SourceMesh[] = [];
  const places = laid.map((j, k): Placed[] => round(got, j.vertex[0], j.vertex[1], 4.7).flatMap((d, i) => {
    const mesh = made.get(d.id);
    if (!mesh || !mesh.materials) return [];
    const id = `core:shown_${k}_${i}`;
    shown.push(standing(mesh, d.points, j.vertex[0], j.vertex[1], id));
    return [{ id, x: 0, y: 0, z: 0, yaw: 0 }];
  }));
  const studio = await Studio.of(piecesPack([...others, ...baked, ...shown]));
  const [cw, ch, gap, head] = only ? [560, 640, 4, 34] : [250, 300, 4, 34];
  const shots: readonly (readonly [string, number, number])[] = [["outside", 225, 12], ["above", 225, 58], ["inside", 45, 20]];
  const canvas = new Canvas(8 + laid.length * (cw + gap), head + shots.length * (ch + gap) + 4);
  canvas.text(`${TIER}: corners with its joints, as the client lays and fits them${posts ? ", each wall's own post left on" : ""}`, 8, 6, undefined, 2);
  laid.forEach((j, col) => {
    const tall = j.looks.length * 3;
    const centre = [0, j.looks.reduce((a, b) => a + b, 0) / j.looks.length, 0] as const;
    shots.forEach(([, around, above], row) => {
      canvas.shrink(studio.shoot(places[col]!, cw * SMOOTH, ch * SMOOTH, centre, only ? tall * 0.5 + 0.2 : tall * 0.62 + 0.4, around, above, 0, null), cw * SMOOTH, ch * SMOOTH, SMOOTH, 8 + col * (cw + gap), head + row * (ch + gap));
    });
    canvas.text(j.name, 12 + col * (cw + gap), head + 4);
  });
  shots.forEach(([name], row) => canvas.text(name, 12, head + row * (ch + gap) + ch - 14));
  const file = join(out, `corners-${TIER}${posts ? "-posts" : ""}${only ? "-close" : ""}.png`);
  writeFileSync(file, canvas.png());
  say(file);
}

if (import.meta.main) await main(process.argv.slice(2));
