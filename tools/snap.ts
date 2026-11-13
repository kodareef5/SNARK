// Draws the proving ground to a PNG without a browser.
//
//   bun run snap                              from the spawn point, looking north
//   bun run snap -- --pos 240,6,250 --yaw 30 --pitch -15 --size 1280x720 --out artifacts/house.png
//
// Yaw and pitch are in degrees. Yaw 0 faces +Z (north); positive yaw turns toward +X.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Camera } from "../client/core/render/camera.ts";
import type { FramePacket } from "../client/core/render/packet.ts";
import { Scene } from "../client/core/render/scene.ts";
import { RemoteSample } from "../client/core/session.ts";
import { CORE_CONTENT } from "../content/core.ts";
import { compileContent, type Registry } from "../shared/content/registry.ts";
import { parsePack, type Pack } from "../shared/pack/pack.ts";
import type { Heightfield } from "../shared/world/heightfield.ts";
import { PROVING_DIMS, PROVING_SPAWN, buildProvingHeightfield, populateProving } from "../shared/world/proving.ts";
import { StructureStore } from "../shared/world/structures.ts";
import { buildCorePack } from "./pack/build.ts";
import { encodePng } from "./snap/png.ts";
import { Rasterizer } from "./snap/raster.ts";

export interface ProvingView {
  reg: Registry;
  hf: Heightfield;
  structs: StructureStore;
  pack: Pack;
  scene: Scene;
  cam: Camera;
  remote: RemoteSample;
  raster: Rasterizer;
  /** Build the packet for the current camera and draw it. */
  render(): FramePacket;
}

/** The proving ground with a camera at the spawn point and two bodies standing in view. */
export function provingView(width = 640, height = 360): ProvingView {
  const reg = compileContent(CORE_CONTENT).registry!;
  const hf = buildProvingHeightfield();
  const structs = new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ);
  populateProving(structs, hf, reg);
  const pack = parsePack(buildCorePack());
  const scene = new Scene({ dims: PROVING_DIMS, hf, structs }, reg, pack);
  const cam = new Camera();
  cam.x = PROVING_SPAWN.x;
  cam.z = PROVING_SPAWN.z;
  cam.y = hf.heightAt(cam.x, cam.z) + 1.62;
  cam.aspect = width / height;
  const remote = new RemoteSample();
  const place = (id: number, kind: string, x: number, z: number, yaw: number): void => {
    const n = remote.count++;
    remote.id[n] = id;
    remote.kind[n] = reg.index.get(kind)!;
    remote.x[n] = x;
    remote.y[n] = hf.heightAt(x, z);
    remote.z[n] = z;
    remote.yaw[n] = yaw;
  };
  place(101, "core:survivor", 254, 250, 2.6);
  place(102, "core:grazer", 259, 254, 0.7);
  const raster = new Rasterizer(width, height, pack, hf);
  return {
    reg, hf, structs, pack, scene, cam, remote, raster,
    render() {
      const packet = scene.build(cam, remote);
      raster.render(packet);
      return packet;
    },
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const i = args.indexOf("--" + name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const [w, h] = (arg("size") ?? "960x540").split("x").map(Number);
  const view = provingView(w, h);
  const pos = arg("pos")?.split(",").map(Number);
  if (pos) [view.cam.x, view.cam.y, view.cam.z] = pos as [number, number, number];
  view.cam.yaw = (Number(arg("yaw") ?? 0) * Math.PI) / 180;
  view.cam.pitch = (Number(arg("pitch") ?? -4) * Math.PI) / 180;
  const t0 = performance.now();
  const packet = view.render();
  const ms = performance.now() - t0;
  const out = resolve(arg("out") ?? "artifacts/snap.png");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, encodePng(w!, h!, view.raster.color));
  console.log(`${out}\n${w}x${h}  tiles ${packet.tileCount}  draws ${packet.drawCount}  triangles ${packet.triangles}  uploads ${packet.uploads.length}  ${ms.toFixed(0)} ms`);
}
