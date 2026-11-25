// Photographs the game's own creatures as cutouts for the ads: a clip's frame from the side, on clear ground.
//   bun tools/screens/ads/creatures.ts            every cut in CUTS (facts.ts), into tools/screens/ads/art/
//   bun tools/screens/ads/creatures.ts --list     each built creature's clips, with their frame counts
// It needs the art installed (bun run media art). The cutouts are made again rather than kept in git.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildRig } from "../../../shared/anim/rigs.ts";
import { parsePack, type Pack } from "../../../shared/pack/pack.ts";
import { findAssets, type Asset } from "../../art/assets.ts";
import { Poser } from "../../art/check.ts";
import { materialsOf } from "../../art/materials.ts";
import { unpackMeshes } from "../../pack/write.ts";
import { ModelView } from "../../snap.ts";
import { rgbaOf } from "../../snap/files.ts";
import { encodePng } from "../../snap/png.ts";
import { PICK_SKY } from "../../snap/raster.ts";
import { CUTS } from "./facts.ts";

const OUT = join(import.meta.dir, "art");
/** Each picture is drawn this many times larger and shrunk, which smooths its edges. */
const SMOOTH = 3;

interface Subject {
  pack: Pack;
  index: number;
  poser: Poser;
  colours: readonly number[];
  positions: Float32Array | number[];
  bones: Uint8Array | Uint16Array | number[];
}

function subjectOf(asset: Asset): Subject {
  const pack = parsePack(new Uint8Array(readFileSync(asset.file)));
  const index = pack.meshIndex.get(asset.id)!;
  const header = pack.header.meshes[index]!;
  const rig = buildRig(pack.header.rigs[header.rig!]!, pack.clips)!;
  const lod = unpackMeshes(pack).find((m) => m.id === asset.id)!.lods[0]!;
  const spec = asset.spec;
  const colours = spec.kind === "creature" ? spec.regions.map((r) => r.sample) : [];
  return { pack, index, poser: new Poser(rig), colours, positions: lod.positions, bones: lod.bones! };
}

/** The middle and half size of the posed body. */
function boundsOf(s: Subject): { centre: [number, number, number]; half: [number, number, number] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const p = [0, 0, 0];
  for (let v = 0; v < s.positions.length / 3; v++) {
    s.poser.skin(s.bones[v]!, s.positions[v * 3]!, s.positions[v * 3 + 1]!, s.positions[v * 3 + 2]!, p);
    for (let k = 0; k < 3; k++) [min[k], max[k]] = [Math.min(min[k]!, p[k]!), Math.max(max[k]!, p[k]!)];
  }
  return { centre: min.map((lo, k) => (lo + max[k]!) / 2) as [number, number, number], half: min.map((lo, k) => (max[k]! - lo) / 2) as [number, number, number] };
}

/** The radius whose ball, seen from `around` and `above`, fits the box in a picture `shape` wide over tall. */
function fit(half: readonly number[], around: number, above: number, shape: number): number {
  const [a, e] = [(around * Math.PI) / 180, (above * Math.PI) / 180];
  const right = Math.abs(Math.cos(a)) * half[0]! + Math.abs(Math.sin(a)) * half[2]!;
  const up = Math.abs(Math.sin(a) * Math.sin(e)) * half[0]! + Math.abs(Math.cos(e)) * half[1]! + Math.abs(Math.cos(a) * Math.sin(e)) * half[2]!;
  return Math.max(up, right / shape) * 1.06;
}

/** Shrinks the big picture SMOOTH times, with clear where nothing was drawn. */
function cutout(view: ModelView, width: number, height: number): Uint8Array {
  const { color, pickKind, width: W } = view.raster;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let [r, g, b, a] = [0, 0, 0, 0];
      for (let j = 0; j < SMOOTH; j++) {
        for (let i = 0; i < SMOOTH; i++) {
          const at = (y * SMOOTH + j) * W + x * SMOOTH + i;
          if (pickKind[at] === PICK_SKY) continue;
          [r, g, b, a] = [r + color[at * 4]!, g + color[at * 4 + 1]!, b + color[at * 4 + 2]!, a + 1];
        }
      }
      if (a === 0) continue;
      out.set([Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((255 * a) / (SMOOTH * SMOOTH))], (y * width + x) * 4);
    }
  }
  return out;
}

const assets = await findAssets();
if (process.argv.includes("--list")) {
  for (const a of assets.filter((a) => a.spec.kind === "creature" && a.dir.includes("/creatures/"))) {
    try {
      const pack = parsePack(new Uint8Array(readFileSync(a.file)));
      console.log(a.id, [...pack.clips.index.keys()].filter((k) => k.startsWith(`${a.id}/`)).map((k) => `${k.split("/")[1]}:${pack.clips.clips[pack.clips.index.get(k)!]!.frames}`).join(" "));
    } catch {
      console.log(a.id, "not built");
    }
  }
  process.exit(0);
}
mkdirSync(OUT, { recursive: true });
const subjects = new Map<string, Subject>();
for (const cut of CUTS) {
  const asset = assets.find((a) => a.id === cut.id);
  if (!asset) throw new Error(`no asset ${cut.id}`);
  const s = subjects.get(cut.id) ?? subjectOf(asset);
  subjects.set(cut.id, s);
  const clip = s.pack.clips.clips[s.pack.clips.index.get(`${cut.id}/${cut.clip}`) ?? -1];
  if (!clip) throw new Error(`${cut.id} has no clip ${cut.clip}`);
  const frames = cut.frame === "all" ? [...Array(clip.frames).keys()] : [Math.min(cut.frame, clip.frames - 1)];
  // One camera for every frame of a cut, so a run cycle stays in place: the box holds the body in all of them.
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const f of frames) {
    s.poser.set(clip, f);
    const b = boundsOf(s);
    for (let k = 0; k < 3; k++) [lo[k], hi[k]] = [Math.min(lo[k]!, b.centre[k]! - b.half[k]!), Math.max(hi[k]!, b.centre[k]! + b.half[k]!)];
  }
  const centre = lo.map((v, k) => (v + hi[k]!) / 2) as [number, number, number];
  const radius = fit(lo.map((v, k) => (hi[k]! - v) / 2), cut.around, cut.above, cut.width / cut.height);
  const view = new ModelView(s.pack, cut.width * SMOOTH, cut.height * SMOOTH, [0, 0, 0]);
  const materials = materialsOf(asset);
  for (const [slot, t] of (s.pack.header.textures ?? []).entries()) {
    const m = materials.find((m) => t.id === `${m.id}/${t.role}`)!;
    const rgba = rgbaOf(m, t.role, t.top);
    view.texture(slot, rgba.role, rgba.pictures);
  }
  for (const f of frames) {
    s.poser.set(clip, f);
    view.draw({ mesh: s.index, level: 0, rig: s.poser.rig, colors: s.colours, centre, radius, around: cut.around, above: cut.above, textured: true, studio: { exposure: 1.05 } });
    const file = join(OUT, cut.frame === "all" ? `${cut.name}-${String(f).padStart(2, "0")}.png` : `${cut.name}.png`);
    writeFileSync(file, encodePng(cut.width, cut.height, cutout(view, cut.width, cut.height), 9));
  }
  console.log(`${cut.name}: ${frames.length} ${frames.length === 1 ? "frame" : "frames"}`);
}
process.exit(0);
