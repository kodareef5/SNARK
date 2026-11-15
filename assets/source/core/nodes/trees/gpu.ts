// Pictures of the trees as a GPU draws them on a lit tier: the shell's renderer in headless Chrome, with the sun's
// shadows and the air, which the software rasterizer leaves out (D203, D264), through the lit probe's page
// (tools/probe-lit.ts). Each view is one tree, or a row of them, on flat ground. Not part of the build.
//
//   bun assets/source/core/nodes/trees/gpu.ts --out artifacts/trees/gpu [--tier medium] [--size 1280x720]
//     [--hours 10,17] [--views oak] [--front]   (views: the keys of VIEWS below, comma separated)

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tierOf } from "../../../../../client/core/assets/tiers.ts";
import { Camera } from "../../../../../client/core/render/camera.ts";
import { Scene } from "../../../../../client/core/render/scene.ts";
import { RemoteSample } from "../../../../../client/core/session.ts";
import { CORE_CONTENT } from "../../../../../content/core.ts";
import { type MapDims } from "../../../../../shared/coords.ts";
import { compileContent } from "../../../../../shared/content/registry.ts";
import { parsePack } from "../../../../../shared/pack/pack.ts";
import { Heightfield } from "../../../../../shared/world/heightfield.ts";
import { NodeField, formOf, nodeForms, type NodeSource } from "../../../../../shared/world/nodes.ts";
import { StructureStore } from "../../../../../shared/world/structures.ts";
import { FakeNet } from "../../../../../tests/fixtures/assetnet.ts";
import { SOURCE } from "../../../../../tools/art/source.ts";
import { litProbe } from "../../../../../tools/probe-lit.ts";
import { Shot, type LitCheck } from "../../../../../tools/probe-lit/shot.ts";
import { gameFiles } from "../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string): string => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1]! : fallback);
const [W, H] = arg("size", "1280x720").split("x").map(Number) as [number, number];
const tier = tierOf(arg("tier", "medium"));
const hours = arg("hours", "10,17").split(",").map(Number);
const outDir = resolve(arg("out", "artifacts/trees/gpu"));
// --front stands the camera with the sun behind it, looking south at the trees set south of it.
const facing = args.includes("--front") ? -1 : 1;

/** A view: the trees by mesh, each (metres east and north of the camera, degrees turned), the camera's height and pitch. */
interface View {
  trees: [string, number, number, number][];
  up: number;
  pitch: number;
}
const row = (ids: string[], gap: number): View["trees"] => ids.map((id, i) => [id, (i - (ids.length - 1) / 2) * gap, gap * 1.9, [300, 30, 120, 210][i % 4]!] as [string, number, number, number]);
const VIEWS: Record<string, View> = {
  oak: { trees: [["core:oak_2", 0, 25, 40]], up: 1.7, pitch: 15 },
  oaks: { trees: row(["core:oak_1", "core:oak_2", "core:oak_3"], 24), up: 1.7, pitch: 9 },
  fig: { trees: [["core:fig_2", 0, 30, 40]], up: 1.7, pitch: 15 },
  figs: { trees: row(["core:fig_1", "core:fig_2", "core:fig_3"], 26), up: 1.7, pitch: 9 },
  banyan: { trees: [["core:banyan_1", 0, 30, 0]], up: 1.7, pitch: 10 },
  banyans: { trees: row(["core:banyan_1", "core:banyan_2", "core:banyan_3"], 32), up: 1.7, pitch: 8 },
  mangroves: { trees: row(["core:mangrove_1", "core:mangrove_2", "core:mangrove_3", "core:mangrove_4"], 11), up: 1.7, pitch: 6 },
  young: { trees: row(["core:tree_1", "core:tree_2", "core:tree_3", "core:tree_4"], 13), up: 1.7, pitch: 8 },
  sapling: { trees: [["core:tree_3", 0, 16, 40]], up: 1.7, pitch: 14 },
  under: { trees: [["core:oak_2", 1.2, 6.5, 40]], up: 1.7, pitch: 25 },
  o2: { trees: [["core:oak_2", 0, 36, 40]], up: 1.7, pitch: 13 },
  f2: { trees: [["core:fig_2", 0, 40, 40]], up: 1.7, pitch: 14 },
  b1: { trees: [["core:banyan_1", 0, 46, 10]], up: 1.7, pitch: 10 },
  y2: { trees: [["core:tree_2", 0, 22, 40]], up: 1.7, pitch: 15 },
};
const chosen = arg("views", Object.keys(VIEWS).join(",")).split(",");

const DIMS: MapDims = { chunksX: 8, chunksZ: 8 };
const hf = new Heightfield(DIMS, 2, -32, 1 / 256);
for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 10 + 0.3 * Math.sin(i / 7) * Math.sin(j / 9));
hf.tint.fill(131);
const CAM = { x: 256, z: 150 };

const files = await gameFiles(SOURCE);
const base = CORE_CONTENT.find((d) => d.type === "node" && d.id === "core:tree")!;
const ids = [...new Set(chosen.flatMap((v) => VIEWS[v]!.trees.map((t) => t[0])))];
const reg = compileContent([...CORE_CONTENT, ...(ids.map((id) => ({ ...base, id, variants: [{ mesh: id }], size: [1, 1] })) as typeof CORE_CONTENT)]).registry!;
const forms = nodeForms(reg);

/** Builds a view's frames, from nothing until the card holds all it wants, into a shot whose last frame is read. */
function shoot(name: string, v: View, hour: number): Shot {
  const source: NodeSource = {
    perChunk: v.trees.length,
    at(chunk, index, out) {
      out.kind = 0;
      const [id, dx, dz, turn] = v.trees[index]!;
      const [x, z] = [CAM.x + dx * facing, CAM.z + dz * facing];
      if (Math.floor(z / 64) * DIMS.chunksX + Math.floor(x / 64) !== chunk) return;
      out.kind = reg.index.get(id)!;
      out.form = formOf(forms, out.kind, 0);
      [out.x, out.y, out.z] = [x, hf.heightAt(x, z), z];
      out.yaw = Math.round((turn / 360) * 65536) & 0xffff;
    },
  };
  const port = new FakeNet(files.files, {});
  const pack = parsePack(files.files[0]!);
  const structs = new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const nodes = new NodeField(DIMS, reg, source);
  nodes.retain(4 * DIMS.chunksX + 4, 8, 1, () => false);
  const scene = new Scene({ dims: DIMS, hf, structs, nodes: nodes.store }, reg, pack, { manifest: files.manifest, port });
  scene.assets.tier = tier;
  scene.viewHeight = H;
  scene.hour = hour;
  const cam = new Camera();
  cam.aspect = W / H;
  [cam.x, cam.y, cam.z] = [CAM.x, hf.heightAt(CAM.x, CAM.z) + v.up, CAM.z];
  cam.pitch = (v.pitch * Math.PI) / 180;
  cam.yaw = facing > 0 ? 0 : Math.PI;
  const shot = new Shot(`${name}-${hour}`, W, H, hf, files.files[0]!);
  shot.manifest = files.manifest;
  shot.shadows = true;
  const remote = new RemoteSample();
  const r = scene.assets.residency;
  for (let frame = 1; frame <= 20000; frame++) {
    scene.now += 1000 / 60;
    port.advance(scene.now);
    const p = scene.build(cam, remote);
    const moved = p.uploads.length + p.drops.length + p.assetUploads.length + p.assetDrops.length + p.texUploads.length + p.texDrops.length;
    const done = moved === 0 && r.flying === 0 && r.waiting === 0;
    shot.add(p, done);
    if (done) break;
  }
  return shot;
}

const shots: Shot[] = [];
const check: LitCheck = {
  name: "trees on a GPU",
  shots() {
    for (const name of chosen) for (const hour of hours) shots.push(shoot(name, VIEWS[name]!, hour));
    return shots;
  },
  judge(back) {
    mkdirSync(outDir, { recursive: true });
    const lines: string[] = [];
    for (const s of shots) {
      const px = back.pixels(s.key, s.read[0]!);
      if (!px) {
        lines.push(`${s.key}: nothing came back`);
        continue;
      }
      const file = join(outDir, `${s.key}.png`);
      writeFileSync(file, encodePng(W, H, px));
      lines.push(file);
    }
    return { ok: true, lines };
  },
};

const CANDIDATES = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"];
const chrome = CANDIDATES.find((p) => p && existsSync(p));
if (!chrome) throw new Error("no Chrome found: set CHROME to its path");
await litProbe(chrome, [check]);
// The probe can leave its browser's pipes open; the pictures are written by now.
process.exit(0);
