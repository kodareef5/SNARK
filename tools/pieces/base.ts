// Counts what a box base of a tier's pieces costs a frame from 60 m off on medium, as the bench's row does
// (tools/bench.ts, "standing 60 m from a 2,000-piece base"), on flat ground with nothing else in the world:
//
//   bun tools/pieces/base.ts                          thatch and wood as their installed packs have them
//   bun tools/pieces/base.ts thatch --pack PACK       thatch from a pack kept elsewhere, as one built and not installed
//   bun tools/pieces/base.ts thatch --rows 1080       on a screen of that many rows, where the bench's is 720
//   bun tools/pieces/base.ts thatch --pack PACK --pitched   the same base with a pitched roof for the top ceiling of every cell
//
// A line a tier: the frame's draws and triangles, and those of the base alone, by the level each piece is drawn at.

import { readFileSync } from "node:fs";
import { Camera } from "../../client/core/render/camera.ts";
import { DRAW_TEXTURED } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { FORMS, PLANNED_FORMS } from "../../content/building/forms.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { asTextured, boxBase } from "../bench/base.ts";
import { unpackMeshes } from "../pack/write.ts";
import { piecesPack, registry, tierMeshes } from "./joints.ts";

export interface BaseCost {
  draws: number;
  triangles: number;
  /** Of those, the base's own. */
  own: { draws: number; triangles: number };
  /** The base's instances and triangles by the level drawn. */
  levels: { instances: number; triangles: number }[];
}

/**
 * The registry with a roof of `tier` among its kinds. Where content has none yet it is a ceiling's row under the roof's
 * name, so it goes where a ceiling goes and is drawn with the roof's mesh, which is what is counted.
 */
function roofed(tier: string): Registry {
  const id = `core:roof_${tier}`;
  if (registry().index.has(id)) return registry();
  const flat = CORE_CONTENT.find((d) => d.type === "structure" && d.id === `core:ceiling_${tier}`)!;
  const made = compileContent([...CORE_CONTENT, { ...flat, id }]);
  if (!made.registry) throw new Error(made.errors.join("\n"));
  return made.registry;
}

/**
 * A 2,000-piece base of `tier` drawn from 60 m off its middle on medium, `rows` pixels high, with `art` for its pieces.
 * With `pitched`, the highest ceiling of every cell is a roof's slope, row by row to a ridge, which `art` must hold.
 */
export function baseCost(tier: string, art = tierMeshes(), rows = 720, pieces = 2000, pitched = false): BaseCost {
  const reg = pitched ? roofed(tier) : registry();
  const pack = piecesPack(art);
  const dims = { chunksX: 16, chunksZ: 16 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 64);
  hf.heights.fill(32 * 64);
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const [cx, cz] = [64 * 8 + 21, 64 * 8 + 21];
  const laid = boxBase(reg, tier, cx - 21, 0, cz - 21, 14, 3, pieces);
  const [flat, roof] = [reg.index.get(`core:ceiling_${tier}`)!, reg.index.get(`core:roof_${tier}`)];
  // The highest ceiling over each cell, which a pitched base roofs.
  const top = new Map<string, number>();
  if (pitched) laid.forEach(([kind, x, y, z], k) => {
    const had = top.get(`${x},${z}`);
    if (kind === flat && (had === undefined || y > laid[had]![2])) top.set(`${x},${z}`, k);
  });
  const roofs = new Set(top.values());
  // A roof's origin stands half its rise over a ceiling's, and every other row is turned to face the row before it.
  const lift = PLANNED_FORMS.roof.at[1] - FORMS.ceiling.at[1];
  laid.forEach(([kind, x, y, z, yaw], k) => {
    if (roofs.has(k)) structs.add(roof!, x, y + lift, z, Math.round((z - cz + 21) / 3) % 2 === 0 ? 0 : 32768, 1, 1000);
    else structs.add(kind, x, y, z, yaw, 1, 1000);
  });
  const scene = new Scene({ dims, hf, structs }, reg, pack);
  asTextured(scene);
  scene.viewHeight = rows;
  scene.structureDistance = 256;
  const cam = new Camera();
  // As the bench stands off a base: 60 m east of its middle, 8 m up, facing it, then turning a third of a radian.
  [cam.x, cam.y, cam.z, cam.yaw] = [cx + 60, 8, cz, Math.PI / 2 + Math.PI];
  let p = scene.build(cam, null);
  for (let i = 0; i < 300; i++) {
    cam.yaw += 0.002;
    p = scene.build(cam, null);
  }
  const own = new Set(pack.header.meshes.flatMap((m, i) => (m.id.endsWith(`_${tier}`) ? [i] : [])));
  const out: BaseCost = { draws: p.drawCount, triangles: p.triangles, own: { draws: 0, triangles: 0 }, levels: [] };
  const { tris } = scene.assets.table;
  for (let d = 0; d < p.drawCount; d++) {
    const mesh = p.drawMesh[d]!;
    if (!own.has(mesh)) continue;
    const level = p.drawLod[d]!;
    const n = ((p.drawFlags[d]! & DRAW_TEXTURED) !== 0 ? p.drawIndexCount[d]! / 3 : tris[mesh]![level]!) * p.drawInstances[d]!;
    out.own.draws++;
    out.own.triangles += n;
    const at = (out.levels[level] ??= { instances: 0, triangles: 0 });
    // A level drawn with materials is a draw for each: its instances are counted with the first.
    if ((p.drawFlags[d]! & DRAW_TEXTURED) === 0 || p.drawFirstIndex[d] === 0) at.instances += p.drawInstances[d]!;
    at.triangles += n;
  }
  return out;
}

export function main(args: readonly string[], say: (line: string) => void = console.log): void {
  const value = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
  const named = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
  const tiers = named.length > 0 ? named : ["thatch", "wood"];
  const rows = Number(value("rows") ?? 720);
  const from = value("pack");
  const pitched = args.includes("--pitched");
  for (const tier of tiers) {
    const art = from ? [...tierMeshes(["thatch", "wood", "stone"].filter((t) => t !== tier)), ...unpackMeshes(parsePack(new Uint8Array(readFileSync(from))))] : tierMeshes();
    const c = baseCost(tier, art, rows, 2000, pitched);
    const levels = c.levels.map((l, k) => (l ? `level ${k}: ${l.instances} pieces, ${l.triangles}` : "")).filter((l) => l !== "").join("; ");
    say(`${tier.padEnd(7)}${pitched ? " pitched" : ""} ${rows} rows: frame ${c.draws} draws, ${c.triangles} triangles; the base ${c.own.draws} draws, ${c.own.triangles} triangles (${levels})`);
  }
}

if (import.meta.main) main(process.argv.slice(2));
