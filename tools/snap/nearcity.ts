// Pictures of the near city on the Miami slice (tests/fixtures/cityslice.ts) by the software rasterizer, a busy chunk
// drawn as an instance a piece and as its near mesh (client/core/render/nearcity.ts), with the pixels that differ:
// along its border with a neighbour drawn as instances, and where a player's wall is set against a wall of the mesh.
//
//   bun tools/snap/nearcity.ts <out folder> [--tier high] [--size 960x540]

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FarStore } from "../../client/core/farcells.ts";
import { Camera, FAR_FROM } from "../../client/core/render/camera.ts";
import { NearMaking } from "../../client/core/render/nearcity.ts";
import { PASS_NEAR } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { CHUNK_SIZE, YAW_UNITS, chunkCount, chunkCx, chunkCz } from "../../shared/coords.ts";
import { CityStatics } from "../../shared/world/city.ts";
import { mapHeightfield } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { miamiSlice } from "../../tests/fixtures/cityslice.ts";
import { farPack } from "../../tests/fixtures/farworld.ts";
import { coreRegistry } from "../../tests/fixtures/world.ts";
import { encodePng } from "./png.ts";
import { PICK_FAR, PICK_STRUCTURE, Rasterizer } from "./raster.ts";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { tier: { type: "string", default: "high" }, size: { type: "string", default: "960x540" } } });
const folder = positionals[0];
if (!folder) {
  console.error("bun tools/snap/nearcity.ts <out folder> [--tier high] [--size 960x540]");
  process.exit(2);
}
const [W, H] = values.size!.split("x").map(Number) as [number, number];
mkdirSync(folder, { recursive: true });

const slice = miamiSlice();
const reg = coreRegistry();
const pack = farPack();
const dims = slice.map.dims;
const hf = mapHeightfield(slice.map);
const city = new CityStatics(dims, slice.map.statics, reg);
const box = Uint8Array.from(reg.defs, (d) => (d?.type === "structure" && d.mesh === "box" && d.shape === undefined ? 1 : 0));
/** The window round the slice's chunk (3, 3) is held whole, so the busy chunk (1, 3) and its neighbours are all near. */
const CENTRE = [3, 3] as const;
const CHUNK = 3 * dims.chunksX + 1;

interface Shot {
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** A player's piece set down for the shot: its kind, middle and turn. */
  piece?: { kind: string; x: number; y: number; z: number; yaw: number };
}

/** Whether (x, y, z) is in open air: no piece of the chunk or round it reaches within `r` metres. */
function open(x: number, y: number, z: number, r: number): boolean {
  for (let c = 0; c < chunkCount(dims); c++) {
    for (let i = city.first[c]!; i < city.first[c + 1]!; i++) {
      const k = city.kind[i]!;
      const a = (city.yaw[i]! / YAW_UNITS) * Math.PI * 2;
      const dx = x - city.x[i]!, dz = z - city.z[i]!;
      const u = Math.cos(a) * dx - Math.sin(a) * dz, v = Math.sin(a) * dx + Math.cos(a) * dz;
      if (Math.abs(u) < city.halfX[k]! + r && Math.abs(v) < city.halfZ[k]! + r && Math.abs(y - city.y[i]!) < city.halfY[k]! + r) return false;
    }
  }
  return true;
}

/** The busy chunk's east border, seen along it and across it from open air at eye height and from over it. */
function borderShots(): Shot[] {
  const out: Shot[] = [];
  const bx = (chunkCx(dims, CHUNK) + 1) * CHUNK_SIZE;
  const z0 = chunkCz(dims, CHUNK) * CHUNK_SIZE;
  for (let z = z0 + 2; z < z0 + CHUNK_SIZE - 2 && out.length < 4; z += 1) {
    for (const side of [-3, 3]) {
      const x = bx + side;
      const y = hf.heightAt(x, z) + 1.7;
      if (!open(x, y, z, 1)) continue;
      out.push({ name: `border-along-${out.length}`, x, y, z, yaw: 0, pitch: -0.15 });
      out.push({ name: `border-across-${out.length}`, x, y, z, yaw: side < 0 ? Math.PI / 2 : -Math.PI / 2, pitch: 0.1 });
      z += 16;
      break;
    }
  }
  const [mx, mz] = [bx, z0 + CHUNK_SIZE / 2];
  out.push({ name: "border-over", x: mx - 30, y: hf.heightAt(mx, mz) + 60, z: mz - 30, yaw: Math.PI / 4, pitch: -0.7 });
  return out;
}

/** A wall of the mesh, the face of a box piece of the busy chunk with open air in front of it, a player's wall set flat against it. */
function wallShot(): Shot | null {
  const from = city.first[CHUNK]!;
  const kind = reg.index.get("core:wall_wood")!;
  for (let i = from; i < city.first[CHUNK + 1]!; i++) {
    const k = city.kind[i]!;
    if (box[k] !== 1 || city.halfY[k]! < 1.3 || Math.max(city.halfX[k]!, city.halfZ[k]!) < 1.9) continue;
    const a = (city.yaw[i]! / YAW_UNITS) * Math.PI * 2;
    // The piece's long face, out along its own z or x, which a turn takes to (s, c) or (c, -s) in the world.
    const wide = city.halfX[k]! >= city.halfZ[k]!;
    const [nx, nz] = wide ? [Math.sin(a), Math.cos(a)] : [Math.cos(a), -Math.sin(a)];
    const depth = wide ? city.halfZ[k]! : city.halfX[k]!;
    for (const sign of [1, -1]) {
      const fx = city.x[i]! + sign * nx * depth, fz = city.z[i]! + sign * nz * depth;
      const y = city.y[i]!;
      const [ex, ez] = [fx + sign * nx * 3 - sign * nz * 1.2, fz + sign * nz * 3 + sign * nx * 1.2];
      if (y - city.halfY[k]! > hf.heightAt(fx, fz) + 0.5 || !open(fx + sign * nx * 0.4, y, fz + sign * nz * 0.4, 0.2) || !open(ex, y + 0.2, ez, 0.5)) continue;
      // The player's wall is 0.2 m thick: its middle 0.1 m off the face, turned to lie along it.
      const wx = fx + sign * nx * reg.halfZ[kind]!, wz = fz + sign * nz * reg.halfZ[kind]!;
      const yaw = Math.round((Math.atan2(sign * nx, sign * nz) / (Math.PI * 2)) * YAW_UNITS + YAW_UNITS) % YAW_UNITS;
      return { name: "player-wall", x: ex, y: y + 0.2, z: ez, yaw: Math.atan2(wx - ex, wz - ez), pitch: -0.05, piece: { kind: "core:wall_wood", x: wx, y: y - city.halfY[k]! + reg.halfY[kind]!, z: wz, yaw } };
    }
  }
  return null;
}

/** A floor of the mesh with open air over it, a player's foundation set down on it, seen from beside it. */
function floorShot(): Shot | null {
  const from = city.first[CHUNK]!;
  const kind = reg.index.get("core:foundation_wood")!;
  for (let i = from; i < city.first[CHUNK + 1]!; i++) {
    const k = city.kind[i]!;
    if (box[k] !== 1 || city.halfY[k]! > 0.3 || Math.min(city.halfX[k]!, city.halfZ[k]!) < 3.9) continue;
    const top = city.y[i]! + city.halfY[k]!;
    const [x, z] = [city.x[i]!, city.z[i]!];
    if (!open(x, top + 1.2, z, 1) || !open(x - 3, top + 1.7, z - 3, 0.5)) continue;
    const y = top + reg.halfY[kind]!;
    return { name: "player-floor", x: x - 3, y: top + 1.7, z: z - 3, yaw: Math.PI / 4, pitch: -0.45, piece: { kind: "core:foundation_wood", x, y, z, yaw: city.yaw[i]! } };
  }
  return null;
}

/** The near store holding the window whole, and in it the busy chunk's pieces of `kept`, and a player's piece. */
function storeOf(kept: (i: number) => boolean, piece: Shot["piece"]): StructureStore {
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  for (let cz = CENTRE[1] - 3; cz <= CENTRE[1] + 3; cz++) {
    for (let cx = CENTRE[0] - 3; cx <= CENTRE[0] + 3; cx++) {
      const c = cz * dims.chunksX + cx;
      const first = city.first[c]!;
      for (let i = first; i < city.first[c + 1]!; i++) if (c !== CHUNK || kept(i)) structs.put(c, i - first, city.kind[i]!, city.x[i]!, city.y[i]!, city.z[i]!, city.yaw[i]!, 0, reg.maxHp[city.kind[i]!]!, 1);
      structs.setVersion(c, 1);
    }
  }
  if (piece) {
    const k = reg.index.get(piece.kind)!;
    const c = Math.floor(piece.z / CHUNK_SIZE) * dims.chunksX + Math.floor(piece.x / CHUNK_SIZE);
    structs.put(c, city.in(c) + 1, k, piece.x, piece.y, piece.z, piece.yaw, 1, reg.maxHp[k]!, 2);
  }
  return structs;
}

const complete = (c: number): boolean => Math.abs(chunkCx(dims, c) - CENTRE[0]) <= 3 && Math.abs(chunkCz(dims, c) - CENTRE[1]) <= 3;
const mine = Uint8Array.from({ length: city.in(CHUNK) }, (_, i) => box[city.kind[city.first[CHUNK]! + i]!]!);
const holds = (c: number): Uint8Array => Uint8Array.from({ length: city.in(c) }, (_, i) => box[city.kind[city.first[c]! + i]!]!);
const making = new NearMaking(city, CHUNK, hf, mine, holds, 4);
while (!making.done) making.step();
const mesh = making.finish();
console.log(`chunk ${CHUNK}: ${city.in(CHUNK)} pieces, ${mine.reduce((n, v) => n + v, 0)} in the mesh in ${making.bands} bands, ${mesh.faces} faces, steps ${mesh.bounds.half.map((h) => (h / 32767) * 1000).map((s) => s.toFixed(3)).join(", ")} mm`);
const SLOT = 2 ** 32 - 16;

/** The shot drawn with the busy chunk as instances, or with its boxes as its mesh. */
function picture(shot: Shot, meshed: boolean): Rasterizer {
  const structs = storeOf((i) => !meshed || mine[i - city.first[CHUNK]!] !== 1, shot.piece);
  const scene = new Scene({ mapId: slice.map.id, dims, hf, structs, far: { cells: new FarStore(), complete }, city: { statics: city, complete } }, reg, pack);
  scene.assets.tier = tierOf(values.tier!);
  scene.viewHeight = H;
  scene.city!.makeMs = Infinity;
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.yaw, cam.pitch, cam.aspect] = [shot.x, shot.y, shot.z, shot.yaw, shot.pitch, W / H];
  const raster = new Rasterizer(W, H, pack, hf);
  raster.depthBits = 24;
  const s = scene as unknown as { structures: (...a: unknown[]) => void; drawCity: (slot: number, first: number, count: number, ox: number, oy: number, oz: number, passes: number, fade: number) => void };
  const structures = s.structures.bind(scene);
  let sent = false;
  s.structures = (...a: unknown[]) => {
    structures(...a);
    if (!meshed || a[2] !== 0) return;
    const p = scene.packet;
    if (!sent) p.assetUploads.push({ slot: SLOT, mesh: scene.city!.mesh, level: 0, data: mesh.data, indexCount: mesh.faces * 6, indexBytes: mesh.indexBytes, quads: true, bounds: mesh.bounds });
    sent = true;
    s.drawCity(SLOT, 0, mesh.faces * 6, chunkCx(dims, CHUNK) * CHUNK_SIZE - cam.x, -cam.y, chunkCz(dims, CHUNK) * CHUNK_SIZE - cam.z, 1 << PASS_NEAR, 0);
  };
  for (let f = 0; f < 60; f++) {
    scene.now += 1000 / 60;
    const p = scene.build(cam, null);
    p.tileCount = 0;
    raster.render(p);
    if (f > 3 && p.uploads.length + p.assetUploads.length === 0 && scene.city!.stats.behind === 0) break;
  }
  return raster;
}

/** Metres from the eye along the view to what a pixel holds, from the depth it keeps as 24 bits, or Infinity for none. */
function distance(r: Rasterizer, cam: Camera, split: number, i: number): number {
  if (r.depth[i] === Infinity) return Infinity;
  const d = r.depth[i]! / ((2 ** 24 - 1) / 2) - 1;
  const nearRange = split <= 0 || d <= 0;
  const z = split <= 0 ? d : nearRange ? (d + 0.5) / 0.5 : (d - 0.5) / 0.5;
  const [n, f] = split <= 0 ? [cam.near, cam.far] : nearRange ? [cam.near, split] : [split * FAR_FROM, cam.far];
  return (2 * f * n) / (f + n - z * (f - n));
}

/** How far apart two pictures' surfaces may be and still be the same place: a step of the mesh's lattice, and a step of the depth buffer's 24 bits there. */
const same = (cam: Camera, split: number, w: number): number => 0.0025 + (w * w) / (cam.near * 2 ** 23) * (split > 0 ? 2 : 1);

const shots = [...borderShots(), wallShot(), floorShot()].filter((s): s is Shot => s !== null);
const rows: string[] = [];
for (const shot of shots) {
  const a = picture(shot, false), b = picture(shot, true);
  const cam = new Camera();
  const split = tierOf(values.tier!).split;
  const diff = new Uint8ClampedArray(W * H * 4);
  // Pixels that differ in colour: the same surface's place with another face of two in it shown, the mesh's surface
  // farther than the instances' (a face missing), or nearer (a face more).
  const counts = { same: 0, farther: 0, nearer: 0 };
  const shows = new Map<string, number>();
  const name = (r: Rasterizer, i: number): string => {
    const id = r.pickId[i]!, k = r.pickKind[i]!;
    const chunk = Math.floor(id / 65536), slot = id % 65536;
    return k === PICK_STRUCTURE ? `${chunk}:${slot}:${reg.defs[city.kind[city.first[chunk]! + slot] ?? 0]?.id ?? "player"}` : k === PICK_FAR ? "mesh" : `pick ${k}`;
  };
  for (let i = 0; i < W * H; i++) {
    const d = Math.abs(a.color[i * 4]! - b.color[i * 4]!) + Math.abs(a.color[i * 4 + 1]! - b.color[i * 4 + 1]!) + Math.abs(a.color[i * 4 + 2]! - b.color[i * 4 + 2]!);
    const g = (a.color[i * 4]! + a.color[i * 4 + 1]! + a.color[i * 4 + 2]!) / 6;
    if (d <= 6) {
      diff.set([g, g, g, 255], i * 4);
      continue;
    }
    const wa = distance(a, cam, split, i), wb = distance(b, cam, split, i);
    const kind = Math.abs(wa - wb) <= same(cam, split, wa) ? "same" : wb > wa ? "farther" : "nearer";
    counts[kind]++;
    diff.set(kind === "same" ? [255, 200, 0, 255] : kind === "farther" ? [255, 0, 0, 255] : [0, 120, 255, 255], i * 4);
    const key = `${kind}: ${name(a, i)} / ${name(b, i)}`;
    shows.set(key, (shows.get(key) ?? 0) + 1);
  }
  writeFileSync(join(folder, `${shot.name}-instances.png`), encodePng(W, H, a.color));
  writeFileSync(join(folder, `${shot.name}-mesh.png`), encodePng(W, H, b.color));
  writeFileSync(join(folder, `${shot.name}-differ.png`), encodePng(W, H, diff));
  const row = `${shot.name}: eye (${shot.x.toFixed(1)}, ${shot.y.toFixed(1)}, ${shot.z.toFixed(1)}) yaw ${shot.yaw.toFixed(2)}${shot.piece ? `, ${shot.piece.kind} at (${shot.piece.x.toFixed(2)}, ${shot.piece.y.toFixed(2)}, ${shot.piece.z.toFixed(2)})` : ""}: ${counts.same} pixels the same place another face, ${counts.farther} the mesh farther, ${counts.nearer} the mesh nearer`;
  rows.push(row, ...[...shows].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `  ${v} ${k}`));
  console.log(rows.slice(-1 - Math.min(8, shows.size)).join("\n"));
}
writeFileSync(join(folder, "nearcity.txt"), `${rows.join("\n")}\n`);
