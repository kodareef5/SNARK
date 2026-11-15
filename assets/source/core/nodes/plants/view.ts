// Draws the plants as the game draws them, with the software rasterizer the tests hold to the game's shaders: a patch of
// undergrowth on flat ground from where a player stands, or one plant close up, at the level each tier would choose or
// at one level, with textures or flat. It also counts what the patch costs: triangles, draws, and how many fragments
// the cards rasterize for each pixel of the screen, which is what cut-out leaves cost a graphics card.
//
//   bun assets/source/core/nodes/plants/view.ts --scene patch|one|row|far [--level N] [--flat] [--tier medium]
//     [--size 960x540] [--out file.png] [--only bush] [--berry 46] [--seed 1] [--hour 12]
//
// The lit tiers draw it lit as the game does, by the sky table at that hour; low poly draws it flat.
//
// Nothing here is part of the game or its build.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tierOf } from "../../../../../client/core/assets/tiers.ts";
import { Camera } from "../../../../../client/core/render/camera.ts";
import { DRAW_CUTOUT, DRAW_PLAIN, DRAW_TEXTURED, DRAW_TWO_SIDED, FRAME, FramePacket, InstanceWriter, PASS_NEAR, TRANSIENT_BUFFER } from "../../../../../client/core/render/packet.ts";
import { flatLight, skyFrame, theSky } from "../../../../../client/core/render/sky.ts";
import { MATERIAL_CUTOUT, MATERIAL_TWO_SIDED, parsePack, type Pack } from "../../../../../shared/pack/pack.ts";
import { SKY_COLOR } from "../../../../../shared/pack/palette.ts";
import { Heightfield } from "../../../../../shared/world/heightfield.ts";
import { findAssets } from "../../../../../tools/art/assets.ts";
import { materialsOf } from "../../../../../tools/art/materials.ts";
import { SOURCE } from "../../../../../tools/art/source.ts";
import { rgbaOf } from "../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";
import { Rasterizer } from "../../../../../tools/snap/raster.ts";
import { TILE_QUADS } from "../../../../../client/core/render/packet.ts";
import { unpackMeshes } from "../../../../../tools/pack/write.ts";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string): string => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1]! : fallback);
const [W, H] = arg("size", "960x540").split("x").map(Number) as [number, number];
const scene = arg("scene", "patch");
const fixed = args.includes("--level") ? Number(arg("level", "0")) : -1;
const flat = args.includes("--flat");
const tier = tierOf(arg("tier", "medium"));
const only = arg("only", "");
const berry = Number(arg("berry", "46"));
const seed = Number(arg("seed", "1"));
const hour = Number(arg("hour", "12"));
const out = resolve(arg("out", `artifacts/art/core/plants/view-${scene}.png`));

const asset = (await findAssets(SOURCE)).find((a) => a.id === "core:plants")!;
const pack: Pack = parsePack(new Uint8Array(readFileSync(asset.file)));
const textures = (pack.header.textures ?? []).map((t) => {
  const m = materialsOf(asset).find((m) => t.id === `${m.id}/${t.role}`)!;
  return rgbaOf(m, t.role, t.top);
});

/** The meshes of each kind, by their place in the pack: its individuals, and what is left when one is used up. */
const kinds = new Map<string, { full: number[]; depleted: number[] }>();
pack.header.meshes.forEach((m, i) => {
  const id = m.id.slice(5);
  const kind = id.replace(/_\d+.*$/, "").replace(/_depleted$/, "");
  const k = kinds.get(kind) ?? { full: [], depleted: [] };
  (id.endsWith("depleted") ? k.depleted : k.full).push(i);
  kinds.set(kind, k);
});

interface Spot {
  mesh: number;
  x: number;
  z: number;
  yaw: number;
  /** The berry colour, where it is not --berry. */
  dye?: number;
}

/** A small generator of our own, so a scene is the same each time. */
function rng(s: number): () => number {
  let x = (s * 2654435761) >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

/** How often each kind grows in dense undergrowth, and how far apart its plants stand. */
const MIX: Record<string, { weight: number; spacing: number }> = {
  bush: { weight: 2, spacing: 2.2 },
  palmetto: { weight: 3, spacing: 2.6 },
  fern: { weight: 4, spacing: 1.6 },
  seagrape: { weight: 1, spacing: 3.2 },
  creeper: { weight: 1, spacing: 3.0 },
};

/** Dense undergrowth over a square `side` metres across, centred on the origin: no two plants closer than their spacing. */
function undergrowth(side: number, spare = 0.0): Spot[] {
  const r = rng(seed);
  const names = [...kinds.keys()].filter((k) => kinds.get(k)!.full.length > 0 && (only === "" || only.split(",").includes(k)));
  const bag = names.flatMap((n) => Array(MIX[n]?.weight ?? 1).fill(n) as string[]);
  const spots: (Spot & { gap: number })[] = [];
  for (let tries = 0; tries < 6000; tries++) {
    const x = (r() - 0.5) * side;
    const z = (r() - 0.5) * side;
    if (Math.hypot(x, z) < spare) continue;
    const kind = bag[Math.floor(r() * bag.length)]!;
    const gap = MIX[kind]?.spacing ?? 2;
    if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < (s.gap + gap) / 2)) continue;
    const k = kinds.get(kind)!;
    spots.push({ mesh: k.full[Math.floor(r() * k.full.length)]!, x, z, yaw: Math.floor(r() * 65536), gap });
  }
  return spots;
}

const cam = new Camera();
cam.aspect = W / H;
let spots: Spot[] = [];
if (scene === "patch") {
  // A survivor standing at the edge of a 20 m square of undergrowth, looking across it.
  spots = undergrowth(20, 1.2).map((s) => ({ ...s, z: s.z + 9.5 }));
  Object.assign(cam, { x: 0, y: 1.7, z: 0, yaw: 0, pitch: -0.2 });
} else if (scene === "inside") {
  // Standing in the middle of it, looking down a little, as a player picking.
  spots = undergrowth(20, 0.6);
  Object.assign(cam, { x: 0, y: 1.7, z: 0, yaw: 0.4, pitch: -0.35 });
} else if (scene === "far") {
  spots = undergrowth(40);
  const d = Number(arg("distance", "60"));
  Object.assign(cam, { x: 0, y: 1.7 + d * 0.05, z: -d, yaw: 0, pitch: -0.06, fovY: Math.min(1.2217, (2 * Math.atan(26 / d)) / 1) });
} else if (scene === "one" || scene === "picked") {
  const k = kinds.get(only || "bush")!;
  const n = Number(arg("variant", "1")) - 1;
  spots = [{ mesh: (scene === "picked" ? k.depleted : k.full)[n]!, x: 0, z: 0, yaw: Number(arg("yaw", "0")) * 182.04 }];
  const d = Number(arg("distance", "2.6"));
  Object.assign(cam, { x: 0, y: 1.7, z: -d, yaw: 0, pitch: -Math.atan2(1.7 - 0.55, d), fovY: 2 * Math.atan(1.0 / d) });
} else if (scene === "colours") {
  // A berry bush of each kind of berry, each dyed as the content's colour for it would dye it.
  const k = kinds.get("bush")!;
  const dyes = arg("dyes", "34,42,43,47,82,10").split(",").map(Number);
  spots = dyes.map((dye, i) => ({ mesh: k.full[i % k.full.length]!, x: (i - (dyes.length - 1) / 2) * 1.9, z: 0, yaw: i * 9000, dye }));
  Object.assign(cam, { x: 0, y: 2.4, z: -7.2, yaw: 0, pitch: -0.22, fovY: 0.72 });
} else if (scene === "row") {
  // Every individual of the kinds asked for, and what is left of each, in two rows.
  const list = [...kinds.entries()].filter(([n]) => only === "" || only.split(",").includes(n));
  const full = list.flatMap(([, k]) => k.full);
  const gone = list.flatMap(([, k]) => k.depleted);
  const step = Number(arg("step", "2.4"));
  spots = [
    ...full.map((mesh, i) => ({ mesh, x: (i - (full.length - 1) / 2) * step, z: 0, yaw: 0 })),
    ...gone.map((mesh, i) => ({ mesh, x: (i - (gone.length - 1) / 2) * step, z: step * 1.3, yaw: 0 })),
  ];
  const d = Math.max(4, Math.max(full.length, gone.length) * step * 0.62);
  Object.assign(cam, { x: 0, y: 1.7 + d * 0.22, z: -d, yaw: 0, pitch: -0.3, fovY: 0.75 });
}
cam.near = 0.1;
cam.far = 3000;
cam.update();

// Flat ground of sandy grass under it all.
const hf = new Heightfield({ chunksX: 2, chunksZ: 2 }, 1, 0, 1);
hf.tint.fill(arg("ground", "167") === "" ? 167 : Number(arg("ground", "167")));
const SHIFT = 64;
const raster = new Rasterizer(W, H, pack, hf);
const p = new FramePacket();
p.beginFrame();
p.tier = tier;
p.lit = tier.lit;
p.split = 0;
p.viewProj.set(cam.viewProj);
p.camX = cam.x + SHIFT;
p.camY = cam.y;
p.camZ = cam.z + SHIFT;
p.light = flatLight(hour, p.sun);
if (p.lit) {
  skyFrame(hour, theSky(), p.frame);
  p.frame[FRAME.eyeHeight] = cam.y;
}
for (let k = 0; k < 3; k++) p.sky[k] = (pack.palette[SKY_COLOR * 4 + k]! / 255) * p.light;
p.fogStart = 600;
p.fogEnd = 2000;
// The ground: tiles of the heightfield, as the terrain is drawn.
for (let tz = 0; tz * TILE_QUADS < hf.nz - 1; tz++) {
  for (let tx = 0; tx * TILE_QUADS < hf.nx - 1; tx++) {
    const n = p.tileCount++;
    p.tiles[n * 4] = tx * TILE_QUADS - p.camX;
    p.tiles[n * 4 + 1] = tz * TILE_QUADS - p.camZ;
    p.tiles[n * 4 + 2] = 1;
    p.tiles[n * 4 + 3] = 1;
    p.tileOrigin[n * 2] = tx * TILE_QUADS;
    p.tileOrigin[n * 2 + 1] = tz * TILE_QUADS;
    p.tilePass[n] = 1 << PASS_NEAR;
  }
}
textures.forEach((t, slot) => {
  const top = 1 << (t.pictures.length - 1);
  t.pictures.forEach((data, k) => p.texUploads.push({ slot, role: t.role, format: "rgba", top, size: 1 << k, row: 0, rows: 1 << k, data, last: k === t.pictures.length - 1 }));
});

/** The level the tier draws a mesh at: the whole patch is one chunk, so it is the level for the nearest point of it. */
const scale = H / (2 * Math.tan(cam.fovY / 2));
function levelFor(mesh: number, distance: number): number {
  if (fixed >= 0) return Math.min(fixed, pack.header.meshes[mesh]!.lods.length - 1);
  const lods = pack.header.meshes[mesh]!.lods;
  const allowed = (tier.threshold * distance) / scale;
  let level = lods.length - 1;
  while (level > Math.min(tier.finest, lods.length - 1) && lods[level]!.error > allowed) level--;
  return level;
}

// Instances by mesh and level, as the scene batches them: one draw for each.
const unpacked = unpackMeshes(pack);
const writer = new InstanceWriter(p.transient);
const groups = new Map<string, Spot[]>();
const nearest = scene === "patch" || scene === "inside" ? 0 : Math.min(...spots.map((s) => Math.hypot(s.x - cam.x, s.z - cam.z)));
for (const s of spots) {
  const level = levelFor(s.mesh, scene === "far" ? Math.hypot(s.x - cam.x, s.z - cam.z) : nearest);
  const key = `${s.mesh}:${level}`;
  groups.set(key, [...(groups.get(key) ?? []), s]);
}
let triangles = 0;
const counted: { mesh: number; level: number; spot: Spot }[] = [];
for (const [key, list] of groups) {
  const [mesh, level] = key.split(":").map(Number) as [number, number];
  const first = p.transientCount;
  for (const s of list) {
    writer.set(p.transientCount, s.x + SHIFT - p.camX, -p.camY, s.z + SHIFT - p.camZ, s.yaw, s.dye ?? berry);
    p.transientIds[p.transientCount++] = 0;
    counted.push({ mesh, level, spot: s });
  }
  const lod = pack.header.meshes[mesh]!.lods[level]!;
  const textured = !flat && tier.texture > 0 && lod.sections !== undefined && lod.sections.length > 0;
  const runs = textured ? lod.sections! : [-1, 0, 0];
  for (let r = 0; r < runs.length; r += 3) {
    const d = p.drawCount++;
    p.drawMesh[d] = mesh;
    p.drawLod[d] = level;
    p.drawBuffer[d] = TRANSIENT_BUFFER;
    p.drawFirst[d] = first;
    p.drawInstances[d] = list.length;
    p.drawOffset.fill(0, d * 3, d * 3 + 3);
    p.drawFlags[d] = DRAW_PLAIN;
    const material = pack.header.materials?.[runs[r]!];
    if (!material) continue;
    p.drawFlags[d]! |= DRAW_TEXTURED | ((material.flags & MATERIAL_TWO_SIDED) !== 0 ? DRAW_TWO_SIDED : 0) | ((material.flags & MATERIAL_CUTOUT) !== 0 ? DRAW_CUTOUT : 0);
    p.drawMaterial[d] = runs[r]!;
    p.drawFirstIndex[d] = runs[r + 1]!;
    p.drawIndexCount[d] = runs[r + 2]!;
  }
  triangles += (unpacked[mesh]!.lods[level]!.indices.length / 3) * list.length;
}
raster.render(p);

// Overdraw: every fragment each front-facing triangle of the plants covers, drawn or discarded, per pixel.
const over = new Float32Array(W * H);
const vp = cam.viewProj;
const meshes = unpacked;
for (const { mesh, level, spot } of counted) {
  const lod = meshes[mesh]!.lods[level]!;
  const c = Math.cos((spot.yaw / 65536) * 2 * Math.PI);
  const sn = Math.sin((spot.yaw / 65536) * 2 * Math.PI);
  const pos = lod.positions;
  const sx = new Float32Array(pos.length / 3);
  const sy = new Float32Array(pos.length / 3);
  const sw = new Float32Array(pos.length / 3);
  for (let v = 0; v < pos.length / 3; v++) {
    const lx = pos[v * 3]!, ly = pos[v * 3 + 1]!, lz = pos[v * 3 + 2]!;
    // The instance turns about +Y as the shader does.
    const x = lx * c + lz * sn + spot.x - cam.x;
    const y = ly - cam.y;
    const z = -lx * sn + lz * c + spot.z - cam.z;
    const w = vp[3]! * x + vp[7]! * y + vp[11]! * z;
    sw[v] = w;
    sx[v] = ((vp[0]! * x + vp[4]! * y + vp[8]! * z) / w * 0.5 + 0.5) * W;
    sy[v] = (0.5 - (vp[1]! * x + vp[5]! * y + vp[9]! * z) / w * 0.5) * H;
  }
  const idx = lod.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!, b = idx[t + 1]!, d = idx[t + 2]!;
    if (sw[a]! < cam.near || sw[b]! < cam.near || sw[d]! < cam.near) continue;
    const area = (sx[b]! - sx[a]!) * (sy[d]! - sy[a]!) - (sx[d]! - sx[a]!) * (sy[b]! - sy[a]!);
    // Screen y runs down, so a face toward the camera winds clockwise here.
    if (area >= 0) continue;
    const x0 = Math.max(0, Math.floor(Math.min(sx[a]!, sx[b]!, sx[d]!)));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(sx[a]!, sx[b]!, sx[d]!)));
    const y0 = Math.max(0, Math.floor(Math.min(sy[a]!, sy[b]!, sy[d]!)));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(sy[a]!, sy[b]!, sy[d]!)));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const e0 = (sx[b]! - sx[a]!) * (py - sy[a]!) - (sy[b]! - sy[a]!) * (px - sx[a]!);
        const e1 = (sx[d]! - sx[b]!) * (py - sy[b]!) - (sy[d]! - sy[b]!) * (px - sx[b]!);
        const e2 = (sx[a]! - sx[d]!) * (py - sy[d]!) - (sy[a]! - sy[d]!) * (px - sx[d]!);
        if (e0 <= 0 && e1 <= 0 && e2 <= 0) over[y * W + x]!++;
      }
    }
  }
}
let sum = 0;
let covered = 0;
let most = 0;
for (const o of over) {
  sum += o;
  if (o > 0) covered++;
  if (o > most) most = o;
}
const sorted = Float32Array.from(over).sort();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encodePng(W, H, raster.color));
const levels = [...groups.keys()].map((k) => Number(k.split(":")[1]));
console.log(`${out}`);
console.log(`${spots.length} plants, ${p.drawCount} draws, ${triangles} triangles (${levels.filter((l) => l === 0).length} of ${groups.size} groups at level 0), tier ${tier.name}${flat ? ", flat" : ""}`);
console.log(`fragments of plants: ${(sum / (W * H)).toFixed(2)} a pixel of the screen, ${(sum / Math.max(covered, 1)).toFixed(2)} a pixel they touch; they touch ${((100 * covered) / (W * H)).toFixed(0)}% of it; 99th percentile ${sorted[Math.floor(sorted.length * 0.99)]}, most ${most}`);
if (args.includes("--heat")) {
  const heat = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = Math.min(1, over[i]! / 8);
    heat.set([255 * Math.min(1, v * 2), 255 * Math.min(1, Math.max(0, v * 2 - 0.5)), 255 * Math.max(0, v * 2 - 1), 255], i * 4);
  }
  writeFileSync(out.replace(/\.png$/, "-heat.png"), encodePng(W, H, heat));
}
