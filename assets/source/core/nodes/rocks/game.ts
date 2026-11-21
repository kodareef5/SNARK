// Draws this folder's rocks as a client on a graphics tier draws them, with the software rasterizer the tests hold to
// the game's shader: stood on the proving ground at their origins, turned and sized as nodes are.
//   bun assets/source/core/nodes/rocks/game.ts --rocks rock_1,rock_2 --graphics medium --view near --out artifacts/rocks/game.png
// --view near puts the camera a few metres off, mid about 25 m, far about 80 m, field 200 m over a scatter of them;
// --far says how far in metres, --from from which side, --hour the time of day.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CORE_CONTENT } from "../../../../../content/core.ts";
import { Camera } from "../../../../../client/core/render/camera.ts";
import { Scene } from "../../../../../client/core/render/scene.ts";
import { RemoteSample } from "../../../../../client/core/session.ts";
import { TIERS, tierOf } from "../../../../../client/core/assets/tiers.ts";
import { compileContent } from "../../../../../shared/content/registry.ts";
import type { Def } from "../../../../../shared/content/defs.ts";
import { parsePack } from "../../../../../shared/pack/pack.ts";
import { NodeField } from "../../../../../shared/world/nodes.ts";
import { PROVING_DIMS, PROVING_SPAWN, buildProvingHeightfield, provingNodes } from "../../../../../shared/world/proving.ts";
import { StructureStore } from "../../../../../shared/world/structures.ts";
import { settle, type ProvingView } from "../../../../../tools/snap.ts";
import { gameFiles } from "../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";
import { Rasterizer } from "../../../../../tools/snap/raster.ts";
import { FakeNet } from "../../../../../tests/fixtures/assetnet.ts";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const rocks = (arg("rocks") ?? "rock_1").split(",");
const tiers = (arg("graphics") ?? "medium").split(",");
const look = arg("view") ?? "near";
const [w, h] = (arg("size") ?? "1280x720").split("x").map(Number) as [number, number];
const out = resolve(arg("out") ?? "artifacts/rocks/game.png");

/** A kind for each rock, drawn as its mesh, standing on its origin: half height 0 puts the origin on the ground. */
const kinds: Def[] = rocks.map((name) => ({ type: "node", id: `rocks:${name}`, mesh: `core:${name}`, color: 15, half: [1, 0.001, 1], hits: 10, respawnHours: 2, yields: [], xp: 0 }));
// The proving ground's own rocks grow as this folder's variants, chosen, turned and sized by the engine's rule.
const FAMILIES: Record<string, string[]> = {
  "core:rock": [1, 2, 3, 4, 5, 6].map((k) => `core:rock_${k}`),
  "core:metal_rock": [1, 2, 3].map((k) => `core:metal_rock_${k}`),
  "core:rubble": [1, 2, 3, 4, 5, 6, 7, 8].map((k) => `core:rubble_${k}`),
};
const content = CORE_CONTENT.map((d) => (d.type === "node" && FAMILIES[d.id] ? ({ ...d, variants: FAMILIES[d.id]!.map((mesh) => ({ mesh })) } as Def) : d));
const compiled = compileContent([...content, ...kinds]);
if (!compiled.registry) throw new Error(String((compiled as { errors?: string[] }).errors));
const reg = compiled.registry;

const files = await gameFiles();
const W = w * Math.min(tiers.length, 2);
const H = h * Math.ceil(tiers.length / 2);
const pixels = new Uint8ClampedArray(W * H * 4);
for (const [t, tier] of tiers.entries()) {
  if (!TIERS.some((x) => x.name === tier)) throw new Error(`--graphics takes ${TIERS.map((x) => x.name).join(", ")}`);
  const hf = buildProvingHeightfield();
  const structs = new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const nodes = new NodeField(PROVING_DIMS, reg, provingNodes(hf, reg));
  nodes.retain(0, 64, 1, () => false);
  const port = new FakeNet(files.files, {});
  const pack = parsePack(files.files[0]!);
  const scene = new Scene({ dims: PROVING_DIMS, hf, structs, nodes: nodes.store }, reg, pack, { manifest: files.manifest, port });
  const cam = new Camera();
  cam.aspect = w / h;
  const raster = new Rasterizer(w, h, pack, hf, files.manifest);
  const remote = new RemoteSample();
  const view = { reg, hf, structs, nodes, pack, scene, cam, remote, raster, port, render: () => scene.build(cam, remote) } as unknown as ProvingView;
  scene.assets.tier = tierOf(tier);
  scene.viewHeight = h;

  // The rocks in a row across the camera's view, 4.5 m apart, each its own turn.
  const [x0, z0] = [PROVING_SPAWN.x - 10, PROVING_SPAWN.z + 14];
  const gap = Number(arg("gap") ?? 4.5);
  rocks.forEach((name, i) => {
    const x = x0 + (i - (rocks.length - 1) / 2) * gap;
    structs.add(reg.index.get(`rocks:${name}`)!, x, hf.heightAt(x, z0), z0, (Number(arg("turn") ?? 0) * 65536) / 360, 0, 1);
  });
  const far = Number(arg("far") ?? ({ near: 4 + rocks.length * 1.6, mid: 25, far: 80, field: 200 }[look] ?? 10));
  // --from is degrees round from the south toward the east; the sun is in the north, so 194 has it behind the camera.
  const from = (Number(arg("from") ?? 14) * Math.PI) / 180;
  scene.hour = Number(arg("hour") ?? 12);
  cam.x = x0 + far * Math.sin(from);
  cam.z = z0 - far * Math.cos(from);
  cam.y = hf.heightAt(cam.x, cam.z) + (look === "field" ? 30 : 1.62);
  cam.yaw = Math.atan2(x0 - cam.x, z0 - cam.z);
  cam.pitch = look === "field" ? -0.16 : look === "near" ? -0.12 : -0.03;
  const frames = settle(view);
  const [ox, oy] = [(t % 2) * w, Math.floor(t / 2) * h];
  for (let y = 0; y < h; y++) pixels.set(raster.color.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * W + ox) * 4);
  console.log(`${tier}: ${frames} frames, ${scene.packet.drawCount} draws, ${scene.packet.triangles} triangles`);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encodePng(W, H, pixels));
console.log(out);
