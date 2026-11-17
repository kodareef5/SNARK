// Pictures of a built map's city as a client draws it, from the software rasterizer: the near rows round the camera and
// the map's own buildings past them (client/core/render/farcity.ts).
//
//   bun tools/map/cityviews.ts <file.snmap> <views.json> <out folder> [--tier medium] [--touch] [--only name] [--levels box:800,cells:1600:2,cells:inf:4]
//                              [--blocks] [--near 3] [--moved 1]
//
// views.json is tools/mapworld/views.ts's list. --touch draws the tier as a touch-first device does (tiers.ts forTouch).
// --levels replaces the tier's far city levels, `box:<to>` or
// `cells:<to>:<size>[:<tall>]`, and `--levels box:inf` draws every box to the reach, the reference the coarser levels are
// held to. --blocks draws the city as far blocks, as before the far city. --near is the chunks round the camera's the near
// store holds whole. A map's landmarks are drawn from their files, their moving statics at rest at their first state, or
// with --moved 1 at their second (a yacht's sails set).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { FarStore } from "../../client/core/farcells.ts";
import { CITY_BUFFER, type CityLevel } from "../../client/core/render/farcity.ts";
import { NodeChanges } from "../../client/core/render/farnodes.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { chunkAt, chunkCx, chunkCz } from "../../shared/coords.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { CityStatics } from "../../shared/world/city.ts";
import { parseMap } from "../../shared/world/mapfile.ts";
import { Summary, bakeChunk, pieceShapes, writeFar } from "../../shared/world/tactical.ts";
import { SOURCE } from "../art/source.ts";
import { provingView, settle } from "../snap.ts";
import { gameFiles } from "../snap/files.ts";
import { encodePng } from "../snap/png.ts";

interface View {
  name: string;
  x?: number;
  z?: number;
  y?: number;
  up?: number;
  yaw?: number;
  pitch?: number;
  fov?: number;
  size?: [number, number];
  look?: [number, number, number?];
}

const { values, positionals } = parseArgs({ allowPositionals: true, options: { tier: { type: "string", default: "medium" }, touch: { type: "boolean", default: false }, only: { type: "string" }, levels: { type: "string" }, blocks: { type: "boolean", default: false }, near: { type: "string", default: "3" }, reach: { type: "string" }, moved: { type: "string", default: "0" } } });
const [path, list, folder] = positionals;
if (!path || !list || !folder) {
  console.error("bun tools/map/cityviews.ts <file.snmap> <views.json> <out folder> [--tier medium] [--only name] [--levels ...] [--blocks] [--near 3]");
  process.exit(2);
}

/**
 * Levels, comma separated, each `<form>:<to>` and `inf` for no end: `box` every box unmerged, `boxes` touching boxes
 * merged, `lattice`, `bare:<to>[:<thin>]` the lattice without pieces under `thin` metres across (1.3 if not given),
 * `mass:<to>:<size>` (cells 4 m tall), `merged:<to>:<gap>:<least>` or `cells:<to>:<size>:<tall>`.
 */
export function readLevels(text: string): CityLevel[] {
  return text.split(",").map((l) => {
    const [kind, to, a, b] = l.split(":");
    const end = to === "inf" ? Infinity : Number(to);
    if (kind === "box") return { to: end, gap: -1, least: 0, cell: 0, tall: 0 };
    if (kind === "boxes") return { to: end, gap: 0.01, least: 0, cell: 0, tall: 0 };
    if (kind === "lattice") return { to: end, gap: 0.5, least: 2.1, cell: 0, tall: 0 };
    if (kind === "bare") return { to: end, gap: 0.5, least: 2.1, cell: 0, tall: 0, thin: Number(a ?? 1.3) };
    if (kind === "mass") return { to: end, gap: -1, least: 0, cell: Number(a), tall: 4 };
    if (kind === "merged") return { to: end, gap: Number(a), least: Number(b ?? 0), cell: 0, tall: 0 };
    return { to: end, gap: -1, least: 0, cell: Number(a), tall: Number(b ?? a) };
  });
}

const started = performance.now();
const map = parseMap(new Uint8Array(readFileSync(path)));
const views = (JSON.parse(readFileSync(list, "utf8")) as View[]).filter((v) => values.only === undefined || v.name === values.only);
const files = await gameFiles(resolve(SOURCE), undefined, [], map.content?.landmarks);
mkdirSync(folder, { recursive: true });
const tier = forTouch(tierOf(values.tier!), values.touch!);
const near = Number(values.near);
const rendered: Record<string, unknown>[] = [];
let statics: CityStatics | null = null;
let blocks: FarStore | null = null;
for (const v of views) {
  Bun.gc(true);
  const t0 = performance.now();
  const [w, h] = v.size ?? [1280, 720];
  const view = provingView(w, h, {}, files, map, undefined, Number(values.moved));
  statics ??= new CityStatics(map.dims, map.statics, view.reg);
  // As before the far city, every static stands in the far feed's cells; with it, only what players built would.
  if (values.blocks && !blocks) {
    blocks = new FarStore();
    const shapes = pieceShapes(view.reg);
    const summary = new Summary();
    const bw = new BitWriter(2048);
    const br = new BitReader();
    view.structs.chunks.forEach((table, chunk) => {
      if (!table || table.live === 0) return;
      bakeChunk(table, chunkCx(map.dims, chunk) * 64, chunkCz(map.dims, chunk) * 64, shapes, view.hf, summary);
      bw.reset();
      writeFar(bw, chunk, summary.far);
      br.reset(bw.bytes());
      blocks!.read(br, map.dims);
    });
  }
  const cam = view.cam;
  cam.x = v.x ?? cam.x;
  cam.z = v.z ?? cam.z;
  cam.y = v.y ?? view.hf.heightAt(cam.x, cam.z) + (v.up ?? 1.62);
  cam.yaw = v.yaw !== undefined ? (v.yaw * Math.PI) / 180 : 0;
  cam.pitch = ((v.pitch ?? -4) * Math.PI) / 180;
  if (v.look) {
    const [lx, lz, up = 0] = v.look;
    cam.yaw = Math.atan2(lx - cam.x, lz - cam.z);
    cam.pitch = Math.atan2(view.hf.heightAt(lx, lz) + up - cam.y, Math.hypot(lx - cam.x, lz - cam.z)) + ((v.pitch ?? 0) * Math.PI) / 180;
  }
  if (v.fov !== undefined) cam.fovY = (v.fov * Math.PI) / 180;
  const [ccx, ccz] = [Math.floor(cam.x / 64), Math.floor(cam.z / 64)];
  const complete = (chunk: number): boolean => Math.abs(chunkCx(map.dims, chunk) - ccx) <= near && Math.abs(chunkCz(map.dims, chunk) - ccz) <= near;
  const scene = new Scene(
    {
      dims: map.dims, hf: view.hf, structs: view.structs, nodes: view.nodes.store,
      ...(values.blocks ? { far: { cells: blocks!, complete } } : { city: { statics, complete } }),
      farNodes: { nodes: view.nodes.source, held: (c) => view.nodes.isLoaded(c), gone: () => undefined, changes: new NodeChanges(map.dims) },
      ...(view.motion ? { motion: view.motion } : {}),
    },
    view.reg, view.pack, view.port ? { manifest: files.manifest, port: view.port } : undefined,
  );
  view.scene = scene;
  // A client standing there long enough has made every tile it wants.
  if (scene.city) scene.city.makeMs = Infinity;
  const levels = values.levels ? readLevels(values.levels) : tier.city.levels;
  const reach = values.reach ? Number(values.reach) : tier.reach.city;
  scene.assets.tier = { ...tier, city: { levels }, reach: { ...tier.reach, city: reach } };
  scene.viewHeight = h;
  view.nodes.retain(chunkAt(map.dims, cam.x, cam.z), 4, 1, () => false);
  const made = performance.now();
  const frames = settle(view);
  const settled = performance.now();
  const p = scene.packet;
  // One more frame, timed, as a client standing there builds it.
  const b0 = performance.now();
  const timed = scene.build(cam, view.remote);
  const buildMs = performance.now() - b0;
  view.raster.render(timed);
  const out = join(folder, `${v.name}.png`);
  writeFileSync(out, encodePng(w, h, view.raster.color));
  let cityDraws = 0;
  let cityTriangles = 0;
  for (let d = 0; d < p.drawCount; d++) {
    if (p.drawBuffer[d] !== CITY_BUFFER) continue;
    cityDraws++;
    cityTriangles += p.drawIndexCount[d]! / 3;
  }
  const byLevel = Array.from(scene.city?.drawn ?? [], (t) => Math.round(t)).slice(0, levels.length);
  const row = { name: v.name, frames, byLevel, settleMs: Math.round(settled - made), buildMs: Number(buildMs.toFixed(2)), draws: p.drawCount, cityDraws, cityTriangles, triangles: p.triangles, cityBytes: scene.city?.bytes ?? 0, dropped: p.dropped, eye: [Math.round(cam.x), Number(cam.y.toFixed(1)), Math.round(cam.z)] };
  rendered.push(row);
  console.log(`${out}  ${JSON.stringify(row)}  ${(performance.now() - t0).toFixed(0)} ms`);
}
writeFileSync(join(folder, values.only ? `rendering-${values.only}.json` : "rendering.json"), `${JSON.stringify({ map: map.id, mapHash: map.hash, tier: tier.name, levels: values.levels ?? null, blocks: values.blocks, seconds: Number(((performance.now() - started) / 1000).toFixed(2)), peakResidentMiB: Number((process.resourceUsage().maxRSS / 1024).toFixed(1)), views: rendered }, null, 2)}\n`);
