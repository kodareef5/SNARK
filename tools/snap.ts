// Draws the proving ground to a PNG without a browser.
//
//   bun run snap                              from the spawn point, looking north
//   bun run snap -- --pos 240,6,250 --yaw 30 --pitch -15 --size 1280x720 --out artifacts/house.png
//   bun run snap -- --ui --console "help"     with the interface drawn over it
//   bun run snap -- --ui --inventory          with the inventory screen open
//   bun run snap -- --ui --chat               with the chat box open (--chat shut: only what was said)
//   bun run snap -- --poses 2 --face 90       a line-up of bodies in motion: kinds 2 and 3, seen from the side
//   bun run snap -- --creatures --face 60     the creatures that came as models: standing, walking, running, striking
//   bun run snap -- --creatures --young       each of them grown, newborn, a third and three quarters grown, and its egg
//   bun run snap -- --looks                   a line-up of looks: both sexes, every hair, every slider at its ends
//   bun run snap -- --creator 1               what a new survivor sees: the creator, on its first or second tab
//   bun run snap -- --gear                    a line-up of armor tiers and held weapons
//   bun run snap -- --house stone             a small house of building pieces, in thatch, wood, stone or metal
//   bun run snap -- --house wood --falling 450  that house 450 ms after its south-west foundation went and took the rest with it
//   bun run snap -- --build                   a survivor building: a foundation and a wall set down, a doorframe shown where it would go
//   bun run snap -- --build --menu            the same survivor asking what can be done to the wall
//
// Yaw and pitch are in degrees. Yaw 0 faces +Z (north); positive yaw turns toward +X.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { App } from "../client/core/app.ts";
import { Camera } from "../client/core/render/camera.ts";
import { Harness } from "../tests/fixtures/net.ts";
import type { FramePacket } from "../client/core/render/packet.ts";
import { Scene, bodySeed } from "../client/core/render/scene.ts";
import { Falling } from "../client/core/rubble.ts";
import { RemoteSample, type ClientSession, type Rubble } from "../client/core/session.ts";
import { HAIR_STYLES, LOOK_BEARD, LOOK_BYTES, LOOK_EYE_COLOR, LOOK_HAIR, LOOK_HAIR_COLOR, LOOK_SEX, LOOK_SKIN, REGION_COUNT, defaultLook, randomLook, setRegion } from "../shared/anim/look.ts";
import { AnimState } from "../shared/anim/pose.ts";
import { EYE_COLORS, HAIR_COLORS, SKIN_TONES } from "../shared/pack/palette.ts";
import { Rng } from "../shared/rng.ts";
import { GEAR_COUNT, GEAR_HELD } from "../shared/sim/entities.ts";
import { BOX_SELF, CMD_MOVE, CMD_SELECT } from "../shared/net/protocol.ts";
import { dress } from "../server/commands/combat.ts";
import { Inventory } from "../shared/sim/items.ts";
import { ACT_DRAW, ACT_HOLD, ACT_NONE, ACT_RELOAD, ACT_SWING, HOLD_BOW, HOLD_HANDS, HOLD_PISTOL, HOLD_RIFLE, HOLD_TOOL } from "../shared/sim/weapon.ts";
import { DOOR_HEIGHT, FLOOR_THICK, FOUNDATION_THICK, WALL_HEIGHT } from "../content/building.ts";
import { CORE_CONTENT } from "../content/core.ts";
import { compileContent, type Registry } from "../shared/content/registry.ts";
import { parsePack, type Pack } from "../shared/pack/pack.ts";
import type { Heightfield } from "../shared/world/heightfield.ts";
import { NodeField } from "../shared/world/nodes.ts";
import { PROVING_DIMS, PROVING_SPAWN, buildProvingHeightfield, populateProving, provingNodes } from "../shared/world/proving.ts";
import { GONE_FELL, StructureStore } from "../shared/world/structures.ts";
import { buildCorePack } from "./pack/build.ts";
import { HudModel, mapU, mapV } from "../client/core/hud.ts";
import { IMAGE_MINIMAP, MINIMAP_SIZE } from "../client/core/ui/hud.ts";
import { Ui } from "../client/core/ui/ui.ts";
import { TEXT_GLOBAL, TEXT_LOCAL, TEXT_NOTICE, TEXT_TRIBE } from "../shared/net/protocol.ts";
import { minimapImage, headingOf } from "../client/core/hud.ts";
import { encodePng } from "./snap/png.ts";
import { Rasterizer } from "./snap/raster.ts";
import { drawUi } from "./snap/ui.ts";

/**
 * A house two pieces square, set down in front of the spawn point and looked at
 * from its corner: a doorway with its door stood open, a window, stairs up to a
 * part of an upper floor, and a pillar under the corner of it.
 */
function houseScene(view: ProvingView, tier: string): void {
  const { reg, structs, hf } = view;
  const made = (piece: string): number => reg.index.get(`core:${piece}_${tier}`) ?? reg.index.get(`core:${piece}_wood`)!;
  const [cx, cz] = [PROVING_SPAWN.x - 24, PROVING_SPAWN.z - 2];
  const ground = hf.heightAt(cx, cz);
  const floor = ground + FOUNDATION_THICK;
  const add = (piece: string, x: number, y: number, z: number, yaw = 0): void => void structs.add(made(piece), cx + x, y, cz + z, yaw, 0, 1);
  const Q = 16384;
  for (const ox of [-1.5, 1.5]) for (const oz of [-1.5, 1.5]) add("foundation", ox, ground + FOUNDATION_THICK / 2, oz);
  const wy = floor + WALL_HEIGHT / 2;
  // The south side faces the camera: a doorway and a window. The others are walls.
  add("doorframe", -1.5, wy, -3);
  add("door_open", -1.5, floor + DOOR_HEIGHT / 2, -3);
  add("windowframe", 1.5, wy, -3);
  for (const o of [-1.5, 1.5]) {
    add("wall", o, wy, 3);
    add("wall", 3, wy, o, Q);
  }
  add("wall", -3, wy, 1.5, Q);
  add("windowframe", -3, wy, -1.5, Q);
  // Half a floor above, reached by stairs along the east wall.
  const up = floor + WALL_HEIGHT + FLOOR_THICK / 2;
  add("ceiling", -1.5, up, 1.5);
  add("ceiling", 1.5, up, 1.5);
  add("stairs", 1.5, floor + (WALL_HEIGHT + FLOOR_THICK) / 2, -1.5);
  add("pillar", -0.25, floor + WALL_HEIGHT / 2, 0.25);
  // Outside, by the door: a storage box, a large one, and a vault.
  const thing = (name: string, x: number, z: number): void => void structs.add(reg.index.get(`core:${name}`)!, cx + x, Math.ceil(hf.heightAt(cx + x, cz + z) * 512) / 512 + reg.halfY[reg.index.get(`core:${name}`)!]!, cz + z, 0, 0, 1);
  thing("storage_box", -4.2, -4.6);
  thing("storage_large", -5.8, -4.2);
  thing("vault", -7.6, -3.6);
  view.cam.x = cx - 5.5;
  view.cam.z = cz - 10;
  view.cam.y = ground + 4.6;
  view.cam.yaw = (27 * Math.PI) / 180;
  view.cam.pitch = (-17 * Math.PI) / 180;
}

/**
 * The house of `houseScene` on its way down: every piece of it gone from the
 * world and shown as a client would show it `ms` after being told, the
 * collapse having begun at its south-west foundation.
 */
function fallingScene(view: ProvingView, ms: number): void {
  const { reg, structs, hf } = view;
  const [cx, cz] = [PROVING_SPAWN.x - 24, PROVING_SPAWN.z - 2];
  const gone: Rubble[] = [];
  const refs: number[] = [];
  const origin = { x: cx - 1.5, y: hf.heightAt(cx, cz) + FOUNDATION_THICK / 2, z: cz - 1.5 };
  structs.chunks.forEach((t, chunk) => {
    for (let s = 0; t && s < t.high; s++) {
      if (t.kind[s] === 0 || reg.role[t.kind[s]!]! < 0 || Math.abs(t.x[s]! - cx) > 4 || Math.abs(t.z[s]! - cz) > 4) continue;
      refs.push(chunk * 65536 + s);
      gone.push({ kind: t.kind[s]!, x: t.x[s]!, y: t.y[s]!, z: t.z[s]!, yaw: t.yaw[s]!, cause: GONE_FELL, ox: origin.x, oy: origin.y, oz: origin.z, tick: 1 });
    }
  });
  for (const ref of refs) structs.remove(ref);
  const falling = new Falling(reg.halfY, (x, z) => hf.heightAt(x, z));
  falling.absorb(gone, 0, view.cam.x, view.cam.y, view.cam.z);
  falling.step(ms);
  view.scene.falling = falling;
}

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
  const structs = new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
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
/**
 * The creatures whose bodies came as models, each in a row: standing, walking,
 * running and striking, at four moments of each, with a survivor beside the
 * first of each row for size.
 */
export function creaturesScene(view: ProvingView, tick: number, facing: number): void {
  const r = view.remote;
  r.count = 0;
  r.tick = tick;
  const st = new AnimState();
  const kinds = ["core:parasaur", "core:raptor"].map((id) => view.reg.index.get(id)!);
  // speed (in steps of 0.6 m/s), and whether it is striking
  const rows: readonly (readonly [number, boolean])[] = [[0, false], [4, false], [12, false], [0, true]];
  const put = (kind: number, x: number, z: number, colors: readonly number[]): number => {
    const n = r.count++;
    r.id[n] = idWithSeed(0) + 1024 * (n + 1);
    r.kind[n] = kind;
    r.x[n] = x;
    r.z[n] = z;
    r.y[n] = view.hf.heightAt(x, z);
    r.yaw[n] = facing;
    r.flags[n] = 1;
    r.gear.fill(0, n * GEAR_COUNT, (n + 1) * GEAR_COUNT);
    for (let q = 0; q < 6; q++) r.colors[n * 6 + q] = colors[q] ?? 0;
    r.born[n] = r.grown[n] = r.seat[n] = 0;
    st.speed = 0;
    st.dir = 0;
    st.pitch = 0;
    st.mode = 1;
    st.stance = 0;
    st.grounded = true;
    st.setAction(ACT_NONE, HOLD_HANDS, 0);
    r.anim[n] = st.pack();
    return n;
  };
  kinds.forEach((kind, j) => {
    const z = 232 + j * 9;
    const gap = j === 0 ? 9 : 5;
    rows.forEach(([speed, strike], i) => {
      const n = put(kind, 256 + (1.5 - i) * gap, z, j === 0 ? [9, 16, 13, 8] : [5, 15, 11]);
      st.speed = speed;
      // Each a little further on in its clip, and a strike part way through.
      r.id[n] = idWithSeed(i * 5) + 1024 * (n + 1);
      if (strike) st.setAction(ACT_SWING, HOLD_HANDS, tick - 10);
      r.anim[n] = st.pack();
      st.setAction(ACT_NONE, HOLD_HANDS, 0);
    });
    put(view.reg.index.get("core:survivor")!, 256 + 1.5 * gap + (j === 0 ? 5.5 : 2.6), z, []);
    // And one sitting on the second of the row: tied to its seat, low, as a rider is.
    const mount = r.count - 4;
    const rider = put(view.reg.index.get("core:survivor")!, r.x[mount]!, z, []);
    r.seat[rider] = r.id[mount]! + 1;
    st.stance = 1;
    r.anim[rider] = st.pack();
    st.stance = 0;
  });
  const cam = view.cam;
  cam.x = 256;
  cam.z = 196;
  cam.y = view.hf.heightAt(cam.x, cam.z) + 9;
  cam.fovY = 0.6;
  cam.yaw = 0;
  cam.pitch = -0.19;
  // Or the young: each kind grown, then newborn, a third grown and three quarters grown, its egg, and a survivor for size.
  if (process.argv.includes("--young")) {
    r.count = 0;
    // Late enough that one three quarters grown was born after the world began.
    const now = tick + 1000;
    r.tick = now;
    kinds.forEach((kind, j) => {
      const z = 232 + j * 7;
      const gap = j === 0 ? 4.2 : 2.6;
      [1, 0, 0.3, 0.75].forEach((m, i) => {
        const n = put(kind, 250 + i * gap, z, j === 0 ? [9, 16, 13, 8] : [5, 15, 11]);
        r.born[n] = m < 1 ? now - m * 1000 : 0;
        r.grown[n] = m < 1 ? now - m * 1000 + 1000 : 0;
      });
      const egg = put(view.reg.index.get(j === 0 ? "core:egg_parasaur" : "core:egg_raptor")!, 250 + 4 * gap - 1, z, []);
      r.flags[egg] = 1 | 8;
      put(view.reg.index.get("core:survivor")!, 250 + 4 * gap + 0.2, z, []);
    });
    cam.x = 258.5;
    cam.z = 212;
    cam.y = view.hf.heightAt(cam.x, cam.z) + 5.5;
    cam.fovY = 0.7;
    cam.pitch = -0.2;
    return;
  }
  // Or close to the raptors' row, for a look at feet and jaws.
  if (process.argv.includes("--near")) {
    cam.x = 259;
    cam.z = 233;
    cam.y = view.hf.heightAt(cam.x, cam.z) + 2.2;
    cam.fovY = 0.9;
    cam.pitch = -0.12;
  }
}

export function posesScene(view: ProvingView, tick: number, first: number, facing: number): void {
  const r = view.remote;
  r.count = 0;
  r.tick = tick;
  const kind = view.reg.index.get("core:survivor")!;
  // speed, dir, pitch, mode, stance, grounded; then, for a body that is swinging, how it holds what it swings
  const rows: readonly (readonly [number, number, number, number, number, number, number?, number?, string?])[] = [
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
    [0, 0, 0, 1, 0, 1, HOLD_HANDS], // a punch, start to end
    [0, 0, 0, 1, 0, 1, HOLD_TOOL], // a swing of a hatchet
    [7, 0, 0, 1, 0, 1, HOLD_TOOL], // the same at a jog
    [0, 0, -14, 1, 1, 1, HOLD_HANDS], // a punch, crouched and looking down
    [0, 0, 0, 1, 0, 1, HOLD_BOW, ACT_DRAW, "bow"], // a bow coming up as it is drawn
    [3, 0, 10, 1, 0, 1, HOLD_BOW, ACT_HOLD, "bow"], // drawn, walking, looking up
    [0, 0, 0, 1, 0, 1, HOLD_RIFLE, ACT_NONE, "rifle"], // a rifle at the shoulder
    [7, 0, -12, 1, 0, 1, HOLD_RIFLE, ACT_NONE, "rifle"], // at a jog, looking down
    [0, 0, 0, 1, 0, 1, HOLD_RIFLE, ACT_RELOAD, "rifle"], // brought down to be loaded
    [0, 0, 14, 1, 1, 1, HOLD_PISTOL, ACT_NONE, "pistol"], // a pistol, crouched, looking up
    [0, 0, 0, 1, 0, 1, HOLD_PISTOL, ACT_RELOAD, "pistol"], // a pistol being loaded
    [0, 0, 0, 1, 0, 1, HOLD_RIFLE, ACT_NONE, "crossbow"], // a crossbow
  ];
  const hatchet = view.reg.index.get("core:hatchet")!;
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
      // A swing is shown from its first tick to its last, left to right, whatever the body's own clock says.
      if (row[6] === undefined) st.setAction(ACT_NONE, HOLD_HANDS, 0);
      else st.setAction(row[7] ?? ACT_SWING, row[6], tick - i * 2);
      r.gear.fill(0, n * GEAR_COUNT, (n + 1) * GEAR_COUNT);
      if (row[6] === HOLD_TOOL) r.gear[n * GEAR_COUNT + GEAR_HELD] = hatchet;
      if (row[8] !== undefined) r.gear[n * GEAR_COUNT + GEAR_HELD] = view.reg.index.get(`core:${row[8]}`)!;
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
export function clientPicture(width: number, height: number, look: Uint8Array | null, setup: (app: App, run: (ms: number) => void, h: Harness) => void): Uint8ClampedArray {
  const h = new Harness({}, 1, 60, { dev: true });
  const pack = parsePack(buildCorePack());
  const app = new App(h.join("ada", {}, { manual: true, look }), h.reg, pack);
  let packet = app.frame(0, width, height);
  const run = (ms: number): void => h.run(ms, (now) => (packet = app.frame(now, width, height)));
  run(500);
  setup(app, run, h);
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
  if (args.includes("--fight")) {
    // A survivor facing a dummy in flak, six metres off, caught in the middle of something:
    // "punch" (up close, as the blow lands), "bow" (at full draw), "loosed" (the arrow in the air), "rifle" (the round's line).
    const what = arg("fight") ?? "bow";
    const pixels = clientPicture(w!, h!, defaultLook(), (app, run, hh) => {
      const s = app.session;
      const ents = hh.world.ents;
      const e = hh.ent(s);
      const rec = hh.host.records.byPid.get(ents.pid[e]!)!;
      const far = what === "punch" ? 1.4 : 6;
      const d = hh.host.spawnCreature("core:dummy", ents.x[e]!, ents.z[e]! + far, 1);
      const drec = hh.host.records.byPid.get(ents.pid[d]!)!;
      ents.yaw[d] = drec.yaw = 32768;
      for (const part of ["hat", "shirt", "gloves", "pants", "boots"]) dress(hh.host, drec, hh.reg.index.get(`core:flak_${part}`)!);
      hh.host.refreshBody(drec);
      const k = (name: string): number => hh.reg.index.get(`core:${name}`)!;
      const weapon = what === "rifle" ? "rifle" : what === "punch" ? "" : "bow";
      if (weapon !== "") {
        hh.host.items.mint(rec, k(weapon), 1);
        hh.host.items.mint(rec, k(weapon === "rifle" ? "round_rifle" : "arrow_stone"), 20);
        run(200);
        const inv = s.inventory!;
        const from = inv.item.indexOf(k(weapon));
        s.command(CMD_MOVE, (wr) => (wr.bits(BOX_SELF, 1), wr.varint(from), wr.bits(BOX_SELF, 1), wr.varint(inv.hotbar), wr.u16(0), wr.u16(k(weapon))));
        run(150);
        s.command(CMD_SELECT, (wr) => wr.u8(0));
        run(weapon === "rifle" ? 5400 : 1500);
      }
      app.view.thirdPerson = args.includes("--third");
      app.controls.yaw = args.includes("--third") ? 0.5 : 0;
      app.controls.pitch = what === "punch" ? 0.02 : -0.02;
      run(200);
      app.controls.mouseButton(0, true);
      if (what === "punch") run(260);
      else if (what === "rifle") run(1000 / 60);
      else {
        run(1400);
        if (what === "loosed") {
          app.controls.mouseButton(0, false);
          run(1000 / 30);
        }
      }
    });
    const out = resolve(arg("out") ?? `artifacts/fight-${what}.png`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, encodePng(w!, h!, pixels));
    console.log(out);
    process.exit(0);
  }
  if (args.includes("--build")) {
    // A survivor who has set down a foundation and a wall, with a doorframe in hand, looking at where it would go.
    const pixels = clientPicture(w!, h!, defaultLook(), (app, run, hh) => {
      const s = app.session;
      const rec = hh.host.records.byPid.get(hh.world.ents.pid[hh.ent(s)]!)!;
      const k = (name: string): number => hh.reg.index.get(`core:${name}`)!;
      for (const [slot, piece] of ["piece_foundation_wood", "piece_wall_wood"].entries()) {
        hh.host.items.mint(rec, k(piece), 5);
        run(200);
        const inv = s.inventory!;
        const from = inv.item.indexOf(k(piece));
        s.command(CMD_MOVE, (wr) => (wr.bits(BOX_SELF, 1), wr.varint(from), wr.bits(BOX_SELF, 1), wr.varint(inv.hotbar + slot), wr.u16(0), wr.u16(k(piece))));
        run(150);
      }
      const click = (): void => {
        app.mouseButton(0, true);
        app.mouseButton(0, false);
        run(300);
      };
      s.command(CMD_SELECT, (wr) => wr.u8(0));
      app.controls.yaw = 0.25;
      app.controls.pitch = Math.atan2(-1.62, 5.5);
      run(300);
      click();
      // A wall on its far edge; then, looking a little to the left, the same piece as a doorframe on its west edge, not yet set down.
      s.command(CMD_SELECT, (wr) => wr.u8(1));
      app.controls.pitch = Math.atan2(-1.62, 6.6);
      run(300);
      click();
      app.key("KeyR", true);
      app.key("KeyR", false);
      app.controls.yaw = 0.5;
      app.controls.pitch = Math.atan2(-1.62, 5.4);
      run(300);
      if (args.includes("--menu")) {
        // Instead: the piece put away, a few steps toward the wall, and the use key held on it.
        s.command(CMD_SELECT, (wr) => wr.u8(255));
        app.controls.yaw = 0.25;
        app.controls.pitch = 0.05;
        app.key("KeyW", true);
        run(700);
        app.key("KeyW", false);
        run(200);
        app.key("KeyE", true);
        run(500);
        app.key("KeyE", false);
        run(50);
      }
      if (args.includes("--third")) app.view.thirdPerson = true;
    });
    const out = resolve(arg("out") ?? "artifacts/build.png");
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
  if (args.includes("--house")) houseScene(view, arg("house") ?? "wood");
  if (args.includes("--falling")) fallingScene(view, Number(arg("falling") ?? 450));
  if (args.includes("--gear")) gearScene(view, (Number(arg("face") ?? 150) * Math.PI) / 180);
  if (args.includes("--looks")) looksScene(view, (Number(arg("face") ?? 150) * Math.PI) / 180);
  if (args.includes("--creatures")) creaturesScene(view, Number(arg("tick") ?? 40), (Number(arg("face") ?? 90) * Math.PI) / 180);
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
      session = { inventory: inv, serverTick: 1000, logVersion: 0, log: [], globalChat: true, tribe: { name: "" } } as unknown as ClientSession;
      ui.registry = view.reg;
      ui.palette = view.pack.palette;
      ui.inventory.open = true;
      ui.inventory.held = 1;
      ui.inventory.hover = 2;
    }
    if (args.includes("--chat")) {
      // Things said on each channel, and the box open on the tribe's with a line being typed.
      session ??= { inventory: null, serverTick: 1000, logVersion: 0, log: [], globalChat: true, tribe: { name: "Night Shift" } } as unknown as ClientSession;
      const said: [number, string][] = [
        [TEXT_NOTICE, "bob joined Night Shift."],
        [TEXT_GLOBAL, "cy: anyone trading hide for narcotics? I am at the pool with far more than I can carry"],
        [TEXT_LOCAL, "bob: right behind you"],
        [TEXT_TRIBE, "bob: the wall is up"],
        [TEXT_GLOBAL, "ada: hello, island"],
      ];
      for (const [channel, text] of said) ui.chat.print(channel, text, 1000);
      if (arg("chat") !== "shut") {
        ui.chat.begin(TEXT_TRIBE, session);
        ui.chat.edit("on my way");
      }
    }
    ui.build(w! / h!, hud, session);
    drawUi(view.raster.color, w!, h!, ui.frame);
  }
  const out = resolve(arg("out") ?? "artifacts/snap.png");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, encodePng(w!, h!, view.raster.color));
  console.log(`${out}\n${w}x${h}  tiles ${packet.tileCount}  draws ${packet.drawCount}  triangles ${packet.triangles}  uploads ${packet.uploads.length}  ${ms.toFixed(0)} ms`);
}
