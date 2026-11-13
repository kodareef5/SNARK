// Draws the proving ground to a PNG without a browser.
//
//   bun run snap                              from the spawn point, looking north
//   bun run snap -- --pos 240,6,250 --yaw 30 --pitch -15 --size 1280x720 --out artifacts/house.png
//   bun run snap -- --ui --console "help"     with the interface drawn over it
//   bun run snap -- --ui --inventory          with the inventory screen open
//   bun run snap -- --poses 2 --face 90       a line-up of bodies in motion: kinds 2 and 3, seen from the side
//   bun run snap -- --looks                   a line-up of looks: both sexes, every hair, every slider at its ends
//   bun run snap -- --creator 1               what a new survivor sees: the creator, on its first or second tab
//   bun run snap -- --gear                    a line-up of armor tiers and held weapons
//
// Yaw and pitch are in degrees. Yaw 0 faces +Z (north); positive yaw turns toward +X.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { App } from "../client/core/app.ts";
import { Camera } from "../client/core/render/camera.ts";
import { Harness } from "../tests/fixtures/net.ts";
import type { FramePacket } from "../client/core/render/packet.ts";
import { Scene, bodySeed } from "../client/core/render/scene.ts";
import { RemoteSample, type ClientSession } from "../client/core/session.ts";
import { HAIR_STYLES, LOOK_BEARD, LOOK_BYTES, LOOK_EYE_COLOR, LOOK_HAIR, LOOK_HAIR_COLOR, LOOK_SEX, LOOK_SKIN, REGION_COUNT, defaultLook, randomLook, setRegion } from "../shared/anim/look.ts";
import { AnimState } from "../shared/anim/pose.ts";
import { EYE_COLORS, HAIR_COLORS, SKIN_TONES } from "../shared/pack/palette.ts";
import { Rng } from "../shared/rng.ts";
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
    remote.flags[n] = 1; // standing on the ground
    remote.anim[n] = 0; // at rest, looking level
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

/** The smallest id whose body clock runs `seed` ticks ahead. */
function idWithSeed(seed: number): number {
  for (let id = 0; id < 1024; id++) if (bodySeed(id) === seed) return id;
  return 0;
}

/**
 * Replace the bodies in view with a line-up on the plaza: eight moments of one
 * kind of motion side by side, and of the next kind behind them. `first` picks
 * the kind; `facing` is the bodies' yaw (a quarter turn shows them from the side).
 */
export function posesScene(view: ProvingView, tick: number, first: number, facing: number): void {
  const r = view.remote;
  r.count = 0;
  r.tick = tick;
  const kind = view.reg.index.get("core:survivor")!;
  // speed, dir, pitch, mode, stance, grounded
  const rows: readonly (readonly [number, number, number, number, number, number])[] = [
    [0, 0, 0, 1, 0, 1], // idle
    [3, 0, 0, 1, 0, 1], // walk
    [7, 0, 0, 1, 0, 1], // jog
    [12, 0, 0, 1, 0, 1], // sprint
    [7, 4, 0, 1, 0, 1], // jog to its left
    [7, 8, 0, 1, 0, 1], // jog backward
    [0, 0, 20, 1, 0, 1], // looking up
    [0, 0, -20, 1, 0, 1], // looking down
    [0, 0, 0, 1, 0, 0], // in the air
    [0, 0, 0, 1, 1, 1], // crouched
    [3, 0, 0, 1, 1, 1], // crouched, moving
    [0, 0, 0, 2, 0, 0], // treading water
    [4, 0, 0, 2, 0, 0], // swimming
    [4, 0, 16, 2, 0, 0], // swimming upward
    [0, 0, 0, 1, 2, 1], // prone
    [1, 0, 0, 1, 2, 1], // crawling
  ];
  // Two kinds of motion to a picture, one behind the other; eight moments of each, left to right.
  const columns = 8;
  const st = new AnimState();
  const shown = rows.slice(first, first + 2);
  shown.forEach((row, j) => {
    for (let i = 0; i < columns; i++) {
      const n = r.count++;
      // A body's clock runs ahead of the world's by a seed made from its id.
      // Pick ids whose seed is the column, times three ticks: each column is a later moment.
      r.id[n] = idWithSeed(i * 3) + 1024 * (n + 1);
      r.kind[n] = kind;
      r.x[n] = 256 + (3.5 - i) * 1.3;
      r.z[n] = 228 + j * 2.4;
      r.y[n] = view.hf.heightAt(r.x[n]!, r.z[n]!) + (row[3] === 2 ? 1.2 : 0);
      r.yaw[n] = facing;
      st.speed = row[0];
      st.dir = row[1];
      st.pitch = row[2];
      st.mode = row[3];
      st.stance = row[4];
      st.grounded = row[5] === 1;
      r.flags[n] = row[5];
      r.anim[n] = st.pack();
    }
  });
  // From far off through a narrow lens, so that the bodies at the edges are not stretched.
  const cam = view.cam;
  cam.x = 256;
  cam.z = 211;
  cam.y = view.hf.heightAt(cam.x, cam.z) + 4.4;
  cam.fovY = 0.25;
}

/**
 * Replace the bodies in view with a line-up of equipment. Front row: each
 * armor tier in full on one sex, then the other, with a weapon in hand. Back
 * row: bare bodies holding each weapon in turn, and one wearing odd pieces.
 */
export function gearScene(view: ProvingView, facing: number): void {
  const r = view.remote;
  r.count = 0;
  r.tick = 0;
  const kind = view.reg.index.get("core:survivor")!;
  const item = (name: string): number => view.reg.index.get(`core:${name}`) ?? 0;
  const pieces = ["hat", "shirt", "gloves", "pants", "boots"];
  const tiers = ["cloth", "hide", "chitin", "flak"];
  const weapons = ["hatchet", "pick", "spear", "bow", "crossbow", "rifle", "pistol", "grenade"];
  const rows: { sex: number; held: string; worn: string[] }[][] = [[], []];
  tiers.forEach((tier, i) => {
    for (const sex of [0, 1]) rows[0]!.push({ sex, held: weapons[(i * 2 + sex + 3) % weapons.length]!, worn: pieces.map((p) => `${tier}_${p}`) });
  });
  weapons.forEach((w, i) => rows[1]!.push({ sex: i % 2, held: w, worn: [] }));
  rows[1]!.push({ sex: 0, held: "", worn: ["hide_hat", "", "", "flak_pants", "cloth_boots"] });
  rows.forEach((row, j) => {
    row.forEach((b, i) => {
      const n = r.count++;
      const look = defaultLook();
      look[LOOK_SEX] = b.sex;
      look[LOOK_HAIR] = 1 + ((i + j) % 4);
      look[LOOK_SKIN] = (i * 3 + j) % SKIN_TONES;
      r.id[n] = 1024 * (n + 1);
      r.kind[n] = kind;
      r.x[n] = 256 + (row.length / 2 - 0.5 - i) * 1.25;
      r.z[n] = 228 + j * 2.6;
      r.y[n] = view.hf.heightAt(r.x[n]!, r.z[n]!);
      r.yaw[n] = facing;
      r.flags[n] = 1;
      r.anim[n] = 0;
      r.hasLook[n] = 1;
      r.look.set(look, n * LOOK_BYTES);
      r.gear[n * 6] = b.held === "" ? 0 : item(b.held);
      for (let k = 0; k < 5; k++) r.gear[n * 6 + 1 + k] = b.worn[k] ? item(b.worn[k]!) : 0;
    });
  });
  const cam = view.cam;
  cam.x = 256;
  cam.z = 211;
  cam.y = view.hf.heightAt(cam.x, cam.z) + 4.6;
  cam.fovY = 0.27;
}

/**
 * Replace the bodies in view with a line-up of looks. Front row: each sex
 * plain, then with every hair style and a beard. Back row: each sex with every
 * slider at its low end and at its high end, and four made at random.
 */
export function looksScene(view: ProvingView, facing: number): void {
  const r = view.remote;
  r.count = 0;
  r.tick = 0;
  const kind = view.reg.index.get("core:survivor")!;
  const rng = new Rng(11);
  const looks: Uint8Array[][] = [[], []];
  for (let hair = 0; hair < HAIR_STYLES.length; hair++) {
    for (const sex of [0, 1]) {
      const look = defaultLook();
      look[LOOK_SEX] = sex;
      look[LOOK_HAIR] = hair;
      look[LOOK_SKIN] = (hair * 2 + sex * 3) % SKIN_TONES;
      look[LOOK_HAIR_COLOR] = (hair * 3 + sex) % HAIR_COLORS;
      look[LOOK_EYE_COLOR] = (hair + sex * 2) % EYE_COLORS;
      if (sex === 0 && hair % 2 === 1) look[LOOK_BEARD] = 1;
      looks[0]!.push(look);
    }
  }
  for (const sex of [0, 1]) {
    for (const end of [-1, 1]) {
      const look = defaultLook();
      look[LOOK_SEX] = sex;
      for (let region = 0; region < REGION_COUNT; region++) setRegion(look, region, end);
      looks[1]!.push(look);
    }
  }
  for (let i = 0; i < 6; i++) looks[1]!.push(randomLook(rng));
  looks.forEach((row, j) => {
    row.forEach((look, i) => {
      const n = r.count++;
      r.id[n] = 1024 * (n + 1);
      r.kind[n] = kind;
      r.x[n] = 256 + (row.length / 2 - 0.5 - i) * 1.15;
      r.z[n] = 228 + j * 2.6;
      r.y[n] = view.hf.heightAt(r.x[n]!, r.z[n]!);
      r.yaw[n] = facing;
      r.flags[n] = 1;
      r.anim[n] = 0;
      r.hasLook[n] = 1;
      r.look.set(look, n * LOOK_BYTES);
    });
  });
  const cam = view.cam;
  cam.x = 256;
  cam.z = 211;
  cam.y = view.hf.heightAt(cam.x, cam.z) + 4.6;
  cam.fovY = 0.27;
}

/**
 * A whole client against a whole server, in this process, drawn after `ms` of
 * play: the world as its scene has it and its interface over that. `setup`
 * may steer it before the picture is taken.
 */
export function clientPicture(width: number, height: number, look: Uint8Array | null, setup: (app: App, run: (ms: number) => void) => void): Uint8ClampedArray {
  const h = new Harness();
  const pack = parsePack(buildCorePack());
  const app = new App(h.join("ada", {}, { manual: true, look }), h.reg, pack);
  let packet = app.frame(0, width, height);
  const run = (ms: number): void => h.run(ms, (now) => (packet = app.frame(now, width, height)));
  run(500);
  setup(app, run);
  run(50);
  const raster = new Rasterizer(width, height, pack, app.session.world!.hf);
  // The rasterizer has seen none of the uploads earlier frames carried: have the scene send them again.
  app.scene!.resetUploads();
  packet = app.frame(h.now + 1, width, height);
  raster.render(packet!);
  drawUi(raster.color, width, height, app.ui.frame);
  return raster.color;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const i = args.indexOf("--" + name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const [w, h] = (arg("size") ?? "960x540").split("x").map(Number);
  if (args.includes("--creator")) {
    const tab = Number(arg("creator") ?? 0) || 0;
    const pixels = clientPicture(w!, h!, null, (app) => {
      app.ui.creator.tab = tab;
      // Something other than the plain look, so that the controls show what they do.
      randomLook(new Rng(5), app.ui.creator.look);
    });
    const out = resolve(arg("out") ?? "artifacts/creator.png");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, encodePng(w!, h!, pixels));
    console.log(out);
    process.exit(0);
  }
  const view = provingView(w, h);
  const pos = arg("pos")?.split(",").map(Number);
  if (pos) [view.cam.x, view.cam.y, view.cam.z] = pos as [number, number, number];
  view.cam.yaw = (Number(arg("yaw") ?? 0) * Math.PI) / 180;
  view.cam.pitch = (Number(arg("pitch") ?? -4) * Math.PI) / 180;
  if (args.includes("--gear")) gearScene(view, (Number(arg("face") ?? 150) * Math.PI) / 180);
  if (args.includes("--looks")) looksScene(view, (Number(arg("face") ?? 150) * Math.PI) / 180);
  if (args.includes("--poses")) posesScene(view, Number(arg("tick") ?? 0), Number(arg("poses") ?? 0) || 0, (Number(arg("face") ?? 90) * Math.PI) / 180);
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
