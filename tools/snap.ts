// Draws the proving ground to a PNG without a browser.
//
//   bun run snap                              from the spawn point, looking north
//   bun run snap -- --pos 240,6,250 --yaw 30 --pitch -15 --size 1280x720 --out artifacts/house.png
//   bun run snap -- --ui --console "help"     with the interface drawn over it
//   bun run snap -- --ui --inventory          with the inventory screen open
//
// Yaw and pitch are in degrees. Yaw 0 faces +Z (north); positive yaw turns toward +X.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Camera } from "../client/core/render/camera.ts";
import type { FramePacket } from "../client/core/render/packet.ts";
import { Scene } from "../client/core/render/scene.ts";
import { RemoteSample, type ClientSession } from "../client/core/session.ts";
import { Inventory } from "../shared/sim/items.ts";
import { CORE_CONTENT } from "../content/core.ts";
import { compileContent, type Registry } from "../shared/content/registry.ts";
import { parsePack, type Pack } from "../shared/pack/pack.ts";
import type { Heightfield } from "../shared/world/heightfield.ts";
import { NodeField } from "../shared/world/nodes.ts";
import { PROVING_DIMS, PROVING_SPAWN, buildProvingHeightfield, populateProving, provingNodes } from "../shared/world/proving.ts";
import { StructureStore } from "../shared/world/structures.ts";
import { buildCorePack } from "./pack/build.ts";
import { HudModel, mapU, mapV } from "../client/core/hud.ts";
import { IMAGE_MINIMAP, MINIMAP_SIZE } from "../client/core/ui/hud.ts";
import { Ui } from "../client/core/ui/ui.ts";
import { minimapImage, headingOf } from "../client/core/hud.ts";
import { encodePng } from "./snap/png.ts";
import { Rasterizer } from "./snap/raster.ts";
import { drawUi } from "./snap/ui.ts";

export interface ProvingView {
  reg: Registry;
  hf: Heightfield;
  structs: StructureStore;
  nodes: NodeField;
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
  // Every chunk's nodes, as a client standing anywhere would have them filled in around it.
  const nodes = new NodeField(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, reg.soft, reg.nodeHits, provingNodes(hf, reg));
  nodes.retain(0, 64, 1, () => false);
  const scene = new Scene({ dims: PROVING_DIMS, hf, structs, nodes: nodes.store }, reg, pack);
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
    reg, hf, structs, nodes, pack, scene, cam, remote, raster,
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
  if (args.includes("--ui")) {
    // The interface as a client standing at the camera would see it, with stand-in numbers.
    const ui = new Ui();
    const hud = new HudModel();
    const cam = view.cam;
    hud.x = cam.x;
    hud.y = cam.y - 1.62;
    hud.z = cam.z;
    hud.lon = mapU(view.hf, cam.x) * 100;
    hud.lat = mapV(view.hf, cam.z) * 100;
    hud.heading = headingOf(cam.yaw);
    hud.compass = "N";
    hud.fps = 60;
    hud.nearby = view.remote.count;
    hud.clock = "06:30";
    hud.formatReadout();
    [1, 0.6, 0.8, 0.45].forEach((v, i) => (hud.vitals[i]!.fraction = v));
    hud.markers.push({ kind: "creature", u: mapU(view.hf, 259), v: mapV(view.hf, 254) }, { kind: "self", u: mapU(view.hf, cam.x), v: mapV(view.hf, cam.z) });
    ui.frame.images[IMAGE_MINIMAP] = { width: MINIMAP_SIZE, height: MINIMAP_SIZE, data: minimapImage(view.hf, view.pack.palette, MINIMAP_SIZE), version: 1 };
    const typed = arg("console");
    if (typed !== undefined) {
      ui.console.open = true;
      for (const line of ["> help", "enablecheats <password>", "help [command]", "pos", "spectate", "time", "who"]) ui.console.print(line);
      ui.console.edit(typed);
    }
    let session: ClientSession | null = null;
    if (args.includes("--inventory")) {
      // A stand-in inventory, to look at the screen without a server.
      const inv = new Inventory(40);
      const item = (id: string): number => view.reg.index.get(id)!;
      inv.set(0, item("core:stone"), 100, 0, 0, 0);
      inv.set(1, item("core:stone"), 37, 0, 0, 0);
      inv.set(2, item("core:berry"), 24, 0, 0, 9000);
      inv.set(3, item("core:fiber"), 180, 0, 0, 0);
      inv.set(12, item("core:meat"), 3, 0, 0, 4000);
      inv.set(13, item("core:waterskin"), 1, 0, 0, 0);
      session = { inventory: inv, serverTick: 1000, logVersion: 0, log: [] } as unknown as ClientSession;
      ui.registry = view.reg;
      ui.palette = view.pack.palette;
      ui.inventory.open = true;
      ui.inventory.held = 1;
      ui.inventory.hover = 2;
    }
    ui.build(w! / h!, hud, session);
    drawUi(view.raster.color, w!, h!, ui.frame);
  }
  const out = resolve(arg("out") ?? "artifacts/snap.png");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, encodePng(w!, h!, view.raster.color));
  console.log(`${out}\n${w}x${h}  tiles ${packet.tileCount}  draws ${packet.drawCount}  triangles ${packet.triangles}  uploads ${packet.uploads.length}  ${ms.toFixed(0)} ms`);
}
