// Draws the proving ground to a PNG without a browser. Yaw and pitch are in degrees. Yaw 0 faces +Z (north) and positive yaw turns toward +X.
// Scene flags: --poses N, --creatures, --looks, --gear, --creator TAB, --house TIER (--view VIEW), --falling MS, --ragdoll SECONDS, --build, --fight WHAT, --ui (--console TEXT, --inventory, --chat).
// --graphics TIER draws as a client on that graphics tier does, textures and all, and --source DIR reads another tree's asset folders.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { App } from "../client/core/app.ts";
import { Camera } from "../client/core/render/camera.ts";
import { FakeNet, type NetOptions } from "../tests/fixtures/assetnet.ts";
import { Harness } from "../tests/fixtures/net.ts";
import { writeBones } from "../client/core/render/characters.ts";
import { DRAW_CUTOUT, DRAW_PLAIN, DRAW_SKINNED, DRAW_TEXTURED, DRAW_TWO_SIDED, FramePacket, InstanceWriter, TRANSIENT_BUFFER, type TextureUpload } from "../client/core/render/packet.ts";
import { Scene, bodySeed } from "../client/core/render/scene.ts";
import { Falling } from "../client/core/rubble.ts";
import { RemoteSample, type ClientSession, type Rubble } from "../client/core/session.ts";
import { HAIR_STYLES, LOOK_BEARD, LOOK_BYTES, LOOK_EYE_COLOR, LOOK_HAIR, LOOK_HAIR_COLOR, LOOK_SEX, LOOK_SKIN, REGION_COUNT, defaultLook, randomLook, setRegion } from "../shared/anim/look.ts";
import { AnimState } from "../shared/anim/pose.ts";
import type { Rig } from "../shared/anim/rigs.ts";
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
import { MATERIAL_CUTOUT, MATERIAL_TWO_SIDED, parsePack, type Pack } from "../shared/pack/pack.ts";
import { SKY_COLOR } from "../shared/pack/palette.ts";
import type { TextureRole } from "../shared/pack/texture.ts";
import { Heightfield } from "../shared/world/heightfield.ts";
import { NodeField } from "../shared/world/nodes.ts";
import { PROVING_DIMS, PROVING_SPAWN, SLOPE_WIDTH, SLOPE_X0, SLOPE_Z0, buildProvingHeightfield, populateProving, provingNodes } from "../shared/world/proving.ts";
import { GONE_FELL, StructureStore } from "../shared/world/structures.ts";
import { findAssets } from "./art/assets.ts";
import { buildCorePack } from "./pack/build.ts";
import { splitPack } from "./pack/split.ts";
import { HudModel, mapU, mapV } from "../client/core/hud.ts";
import { IMAGE_MINIMAP, MINIMAP_SIZE } from "../client/core/ui/hud.ts";
import { Ui } from "../client/core/ui/ui.ts";
import { TEXT_GLOBAL, TEXT_LOCAL, TEXT_NOTICE, TEXT_TRIBE } from "../shared/net/protocol.ts";
import { minimapImage, headingOf } from "../client/core/hud.ts";
import { TIERS, tierOf } from "../client/core/assets/tiers.ts";
import { SOURCE } from "./art/source.ts";
import { gameFiles, type GameFiles } from "./snap/files.ts";
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphPixel } from "./snap/font.ts";
import { encodePng } from "./snap/png.ts";
import { PICK_SKY, Rasterizer } from "./snap/raster.ts";
import { drawUi } from "./snap/ui.ts";

/** A house two pieces square near the spawn point, seen from its corner, with an open door, windows, stairs to half an upper floor, and a pillar. */
export function houseScene(view: ProvingView, tier: string): void {
  const { reg, structs, hf } = view;
  const made = (piece: string): number => reg.index.get(`core:${piece}_${tier}`) ?? reg.index.get(`core:${piece}_wood`)!;
  const [cx, cz] = [PROVING_SPAWN.x - 24, PROVING_SPAWN.z - 2];
  const ground = hf.heightAt(cx, cz);
  const floor = ground + FOUNDATION_THICK;
  const add = (piece: string, x: number, y: number, z: number, yaw = 0): void => void structs.add(made(piece), cx + x, y, cz + z, yaw, 0, 1);
  const Q = 16384;
  for (const ox of [-1.5, 1.5]) for (const oz of [-1.5, 1.5]) add("foundation", ox, ground + FOUNDATION_THICK / 2, oz);
  const wy = floor + WALL_HEIGHT / 2;
  // The south side faces the camera and has a doorway and a window.
  add("doorframe", -1.5, wy, -3);
  add("door_open", -1.5, floor + DOOR_HEIGHT / 2, -3);
  add("windowframe", 1.5, wy, -3);
  for (const o of [-1.5, 1.5]) {
    add("wall", o, wy, 3);
    add("wall", 3, wy, o, Q);
  }
  add("wall", -3, wy, 1.5, Q);
  add("windowframe", -3, wy, -1.5, Q);
  // Half an upper floor, reached by stairs along the east wall.
  const up = floor + WALL_HEIGHT + FLOOR_THICK / 2;
  add("ceiling", -1.5, up, 1.5);
  add("ceiling", 1.5, up, 1.5);
  add("stairs", 1.5, floor + (WALL_HEIGHT + FLOOR_THICK) / 2, -1.5);
  add("pillar", -0.25, floor + WALL_HEIGHT / 2, 0.25);
  // Outside, by the door.
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

/** Where an artist looks at a building tier from: houseScene's corner, and those of houseView. */
export const HOUSE_VIEWS = ["corner", "close", "far", "wall", "floor"] as const;
export type HouseView = (typeof HOUSE_VIEWS)[number];

/**
 * houseScene's house seen another way. "close" stands two metres from its north wall, which the noon sun lights.
 * "far" stands 40 m off, where coarser levels are drawn. "wall" and "floor" build a yard beside it, ten foundations by
 * six with ten walls along its north edge facing in, and look along the wall and across the floor.
 */
export function houseView(view: ProvingView, tier: string, look: HouseView): void {
  const { reg, structs, hf, cam } = view;
  const made = (piece: string): number => reg.index.get(`core:${piece}_${tier}`) ?? reg.index.get(`core:${piece}_wood`)!;
  const [cx, cz] = [PROVING_SPAWN.x - 24, PROVING_SPAWN.z - 2];
  const floor = hf.heightAt(cx, cz) + FOUNDATION_THICK;
  const at = (x: number, y: number, z: number, yaw: number, pitch: number): void => {
    [cam.x, cam.y, cam.z] = [x, y, z];
    cam.yaw = (yaw * Math.PI) / 180;
    cam.pitch = (pitch * Math.PI) / 180;
  };
  if (look === "close") at(cx - 2.6, floor + 1.62, cz + 5.2, 152, -6);
  else if (look === "far") at(cx - 16, hf.heightAt(cx - 16, cz - 36) + 1.62, cz - 36, 24, -2);
  if (look !== "wall" && look !== "floor") return;
  const [x0, z0] = [cx - 33, cz - 38];
  const ground = hf.heightAt(x0 + 15, z0 + 9);
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 6; j++) structs.add(made("foundation"), x0 + 1.5 + 3 * i, ground + FOUNDATION_THICK / 2, z0 + 1.5 + 3 * j, 0, 0, 1);
    // A wall's outside is its +Z face, so turned about it faces the floor.
    structs.add(made("wall"), x0 + 1.5 + 3 * i, ground + FOUNDATION_THICK + WALL_HEIGHT / 2, z0 + 18, 32768, 0, 1);
  }
  if (look === "wall") at(x0 + 0.8, ground + FOUNDATION_THICK + 1.62, z0 + 15.2, 72, -4);
  else at(x0 - 3, ground + 4.5, z0 - 3, 42, -16);
}

/** Removes houseScene's house and shows it falling as a client would, `ms` after the removal, from the south-west foundation. */
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

/**
 * Creatures that died `seconds` ago, lying where they fell as a client draws them: on the proving ground's strips of 20
 * and 30 degrees, across the edge of a foundation, and a young one, with one of each kind standing alive beside them.
 */
function ragdollScene(view: ProvingView, seconds: number): void {
  const { reg, hf, structs, remote: r, cam } = view;
  const strip = (k: number): number => SLOPE_X0 + SLOPE_WIDTH * (k + 0.5);
  const [sx, sz] = [strip(1), SLOPE_Z0 + 8];
  const foundation = reg.index.get("core:foundation_wood")!;
  const [fx, fz] = [sx - 10, sz - 13];
  const fy = Math.max(...[-1.5, 1.5].flatMap((dx) => [-1.5, 1.5].map((dz) => hf.heightAt(fx + dx, fz + dz)))) + reg.halfY[foundation]!;
  structs.add(foundation, fx, fy, fz, 0, 0, 1);
  const st = new AnimState();
  const put = (id: number, kind: string, x: number, z: number, yaw: number, y = hf.heightAt(x, z), young = false): void => {
    const n = r.count++;
    [r.id[n], r.kind[n], r.x[n], r.y[n], r.z[n], r.yaw[n], r.flags[n]] = [id, reg.index.get(kind)!, x, y, z, yaw, 1];
    r.colors.fill(0, n * 6, n * 6 + 6);
    r.gear.fill(0, n * GEAR_COUNT, (n + 1) * GEAR_COUNT);
    [r.span[n], r.grown[n], r.seat[n], r.hasLook[n]] = [young ? 1000 : 0, young ? 1500 : 0, 0, 0];
    r.anim[n] = st.pack();
  };
  r.count = 0;
  // Sorted by id, as a view is. The first four die.
  put(1, "core:raptor", sx, sz, 0.4);
  put(2, "core:parasaur", strip(2) + 1, sz + 3, 2.2);
  put(3, "core:raptor", fx + 1.2, fz, 1.3, fy + reg.halfY[foundation]!);
  put(4, "core:parasaur", sx - 3, sz - 11, 4, undefined, true);
  put(5, "core:raptor", sx - 13, sz - 6, 0.9);
  put(6, "core:parasaur", sx + 6, sz - 9, 5.4);
  put(7, "core:survivor", sx - 6, sz - 12, 2.8);
  [cam.x, cam.z] = [sx - 3, sz - 24];
  cam.y = hf.heightAt(cam.x, cam.z) + 3.5;
  cam.yaw = 0.05;
  cam.pitch = 0;
  cam.fovY = 0.8;
  r.tick = 100;
  view.render();
  r.tick += 0.5;
  view.render();
  // They die: gone from the view, as the server takes a dead creature out of the world.
  const keep = [4, 5, 6];
  for (const k of ["id", "kind", "x", "y", "z", "yaw", "flags", "anim", "span", "grown", "seat", "hasLook"] as const) for (let j = 0; j < 3; j++) r[k][j] = r[k][keep[j]!]!;
  r.count = 3;
  for (let f = 0; f < seconds * 60; f++) {
    r.tick += 0.5;
    view.scene.build(cam, r);
  }
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
  /** The network the scene's levels come over, when they stream. */
  port: FakeNet | null;
  render(): FramePacket;
}

/**
 * The proving ground with a camera at the spawn point and two bodies standing in view. With `net`, the scene has only
 * the boot pack at start and fetches other levels over that network, and the rasterizer draws only what was uploaded.
 * With `files` as well (tools/snap/files.ts) those are fetched instead, textures among them.
 */
export function provingView(width = 640, height = 360, net?: NetOptions, files?: GameFiles): ProvingView {
  const reg = compileContent(CORE_CONTENT).registry!;
  const hf = buildProvingHeightfield();
  const structs = new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  populateProving(structs, hf, reg);
  const split = !net ? null : files ? { files: files.files.map((bytes) => ({ bytes })), manifest: files.manifest } : splitPack(buildCorePack(), "core");
  const port = split ? new FakeNet(split.files.map((f) => f.bytes), net) : null;
  const pack = parsePack(split ? split.files[0]!.bytes : buildCorePack());
  // Fills every chunk's nodes, as a client near each would have them.
  const nodes = new NodeField(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, reg.soft, reg.nodeHits, provingNodes(hf, reg));
  nodes.retain(0, 64, 1, () => false);
  const scene = new Scene({ dims: PROVING_DIMS, hf, structs, nodes: nodes.store }, reg, pack, split && port ? { manifest: split.manifest, port } : undefined);
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
  const raster = new Rasterizer(width, height, pack, hf, split?.manifest);
  return {
    reg, hf, structs, nodes, pack, scene, cam, remote, raster, port,
    render() {
      const packet = scene.build(cam, remote);
      raster.render(packet);
      return packet;
    },
  };
}

/**
 * Runs the frames a streaming view takes, a sixtieth of a second apart, until a frame has nothing to put on the card
 * and nothing is on its way: what a client standing there long enough would draw on its tier. Only that frame is
 * drawn. The ones before carry their uploads to the card and draw nothing, which leaves the card the same. Returns how
 * many frames it took.
 */
export function settle(view: ProvingView, most = 5000): number {
  const { scene, cam, remote, raster, port } = view;
  const r = scene.assets.residency;
  for (let frame = 1; frame <= most; frame++) {
    scene.now += 1000 / 60;
    port?.advance(scene.now);
    const p = scene.build(cam, remote);
    const moved = p.uploads.length + p.drops.length + p.assetUploads.length + p.assetDrops.length + p.texUploads.length + p.texDrops.length;
    const done = moved === 0 && r.flying === 0 && r.waiting === 0;
    if (!done) p.drawCount = p.tileCount = 0;
    raster.render(p);
    if (done) return frame;
  }
  throw new Error(`the card was still being filled after ${most} frames`);
}

/** Writes `text` into a picture `width` pixels wide at (x, y), each pixel of the font `scale` pixels square, on a dark band. */
function label(pixels: Uint8ClampedArray, width: number, text: string, x: number, y: number, scale = 2): void {
  const put = (px: number, py: number, rgb: readonly number[]): void => {
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) pixels.set(rgb, ((py + dy) * width + px + dx) * 4);
  };
  for (let py = y - scale; py < y + (GLYPH_HEIGHT + 1) * scale; py += scale) for (let px = x - scale; px < x + text.length * (GLYPH_WIDTH + 1) * scale; px += scale) put(px, py, [20, 22, 26]);
  [...text].forEach((ch, i) => {
    for (let col = 0; col < GLYPH_WIDTH; col++) for (let row = 0; row < GLYPH_HEIGHT; row++) if (glyphPixel(ch.charCodeAt(0), col, row)) put(x + (i * (GLYPH_WIDTH + 1) + col) * scale, y + row * scale, [240, 240, 240]);
  });
}

/** The smallest id whose body clock runs `seed` ticks ahead. */
function idWithSeed(seed: number): number {
  for (let id = 0; id < 1024; id++) if (bodySeed(id) === seed) return id;
  return 0;
}

/**
 * One row per modelled creature: standing, walking, running and striking, with a survivor beside it for size and a rider on the second.
 * `samples` gives each species the six region colours to be drawn in.
 */
export function creaturesScene(view: ProvingView, tick: number, facing: number, samples: ReadonlyMap<string, readonly number[]> = new Map()): void {
  const r = view.remote;
  r.count = 0;
  r.tick = tick;
  const st = new AnimState();
  // Every creature that is drawn on a skeleton of its own.
  const species = view.reg.defs.flatMap((d) => (d?.type === "species" && d.class === "creature" && d.skeleton !== undefined ? [d] : []));
  const kinds = species.map((d) => view.reg.index.get(d.id)!);
  const colours = species.map((d) => samples.get(d.id) ?? [d.color]);
  // Speed in steps of 0.6 m/s, and whether it is striking.
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
    r.span[n] = r.grown[n] = r.seat[n] = 0;
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
    // Wide enough apart for the creature's length.
    const gap = Math.round(species[j]!.radius * 8.2);
    rows.forEach(([speed, strike], i) => {
      const n = put(kind, 256 + (1.5 - i) * gap, z, colours[j]!);
      st.speed = speed;
      // Each body is a little further into its clip, and the strike is part way through.
      r.id[n] = idWithSeed(i * 5) + 1024 * (n + 1);
      if (strike) st.setAction(ACT_SWING, HOLD_HANDS, tick - 10);
      r.anim[n] = st.pack();
      st.setAction(ACT_NONE, HOLD_HANDS, 0);
    });
    put(view.reg.index.get("core:survivor")!, 256 + 1.5 * gap + species[j]!.radius * 5, z, []);
    // A rider sits on the second creature of the row, in the low stance a rider has.
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
  // With --young, each kind is shown grown, newborn, a third grown and three quarters grown, with its egg and a survivor for size.
  if (process.argv.includes("--young")) {
    r.count = 0;
    const now = tick + 1000;
    r.tick = now;
    kinds.forEach((kind, j) => {
      const z = 232 + j * 7;
      const gap = species[j]!.radius * 4;
      [1, 0, 0.3, 0.75].forEach((m, i) => {
        const n = put(kind, 250 + i * gap, z, colours[j]!);
        r.span[n] = m < 1 ? 1000 : 0;
        r.grown[n] = m < 1 ? now - m * 1000 + 1000 : 0;
      });
      const laid = view.reg.index.get(species[j]!.breeds?.egg ?? "");
      if (laid !== undefined) {
        const egg = put(laid, 250 + 4 * gap - 1, z, []);
        r.flags[egg] = 1 | 8;
      }
      put(view.reg.index.get("core:survivor")!, 250 + 4 * gap + 0.2, z, []);
    });
    cam.x = 258.5;
    cam.z = 212;
    cam.y = view.hf.heightAt(cam.x, cam.z) + 5.5;
    cam.fovY = 0.7;
    cam.pitch = -0.2;
    return;
  }
  // With --near, the camera is close to the raptors' row.
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
  // Speed, dir, pitch, mode, stance, grounded. Then, for a body in an action, its hold, the act (a swing by default) and the item held.
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
  // A picture shows two kinds of motion, one behind the other, with eight moments of each from left to right.
  const columns = 8;
  const st = new AnimState();
  const shown = rows.slice(first, first + 2);
  shown.forEach((row, j) => {
    for (let i = 0; i < columns; i++) {
      const n = r.count++;
      // A body's clock runs ahead of the world's by a seed made from its id. Ids are picked so each column is three ticks later.
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
      // Each column is two ticks further into the action, regardless of the body's own clock.
      if (row[6] === undefined) st.setAction(ACT_NONE, HOLD_HANDS, 0);
      else st.setAction(row[7] ?? ACT_SWING, row[6], tick - i * 2);
      r.gear.fill(0, n * GEAR_COUNT, (n + 1) * GEAR_COUNT);
      if (row[6] === HOLD_TOOL) r.gear[n * GEAR_COUNT + GEAR_HELD] = hatchet;
      if (row[8] !== undefined) r.gear[n * GEAR_COUNT + GEAR_HELD] = view.reg.index.get(`core:${row[8]}`)!;
      r.flags[n] = row[5];
      r.anim[n] = st.pack();
    }
  });
  // A distant camera with a narrow field of view keeps the bodies at the edges from stretching.
  const cam = view.cam;
  cam.x = 256;
  cam.z = 211;
  cam.y = view.hf.heightAt(cam.x, cam.z) + 4.4;
  cam.fovY = 0.25;
}

/** The front row wears each armor tier in full on each sex, weapon in hand. The back row holds each weapon in turn, plus one body in odd pieces. */
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

/** The front row is every hair style on each sex, some bearded. The back row is each sex with every slider at each end, then six random looks. */
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

/** A whole client against a whole server in this process, drawn with its interface. `setup` steers it before the picture is taken. */
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
  // The rasterizer saw none of the uploads earlier frames carried, so the scene sends them again.
  app.scene!.resetUploads();
  packet = app.frame(h.now + 1, width, height);
  raster.render(packet!);
  drawUi(raster.color, width, height, app.ui.frame);
  return raster.color;
}

export interface ModelShot {
  /** Index of the mesh in the pack, and the level of it to draw. */
  mesh: number;
  level: number;
  /** Degrees the camera stands around the model from its front, toward its left, and above its middle. */
  around: number;
  above: number;
  /** The point looked at, and the radius in metres of the ball about it that the picture holds. */
  centre: readonly [number, number, number];
  radius: number;
  /** The rig a skinned mesh follows, as it is posed (`rig.solved`). Null for a rigid mesh. */
  rig: Rig | null;
  /** Palette index of each colour region. */
  colors: readonly number[];
  /** Draws the level with its materials, a draw for each of its sections, where it has them. Their textures must be on the card. */
  textured?: boolean;
}

/**
 * One mesh of a pack on its own: no world and no content, so an asset can be looked at before anything uses it
 * (tools/art/sheet.ts). The light stays over the camera's left shoulder, so every side is lit alike. A picture with
 * materials is lit by the game's sky, as a mirror shows it, and the background is painted over the sky after.
 */
export class ModelView {
  readonly raster: Rasterizer;
  readonly cam = new Camera();
  private readonly packet = new FramePacket();
  private readonly writer = new InstanceWriter(this.packet.transient);
  private readonly pack: Pack;
  private readonly background: readonly [number, number, number];
  /** What the next picture puts on the card first. */
  private readonly sending: TextureUpload[] = [];

  constructor(pack: Pack, width: number, height: number, background: readonly [number, number, number]) {
    this.raster = new Rasterizer(width, height, pack, new Heightfield({ chunksX: 1, chunksZ: 1 }, 64, 0, 1));
    this.pack = pack;
    this.background = background;
    this.cam.aspect = width / height;
    // Narrow, so that near and far parts are drawn nearly the same size.
    this.cam.fovY = 0.2;
    this.packet.sky.set(background);
    this.packet.fogStart = 1e8;
    this.packet.fogEnd = 2e8;
  }

  /** Puts a texture in `slot`, its place in the pack's list, before the next picture: its pictures in the rgba variant, smallest first. */
  texture(slot: number, role: TextureRole, pictures: readonly Uint8Array[]): void {
    const top = 1 << (pictures.length - 1);
    pictures.forEach((data, k) => this.sending.push({ slot, role, format: "rgba", top, size: 1 << k, row: 0, rows: 1 << k, data, last: k === pictures.length - 1 }));
  }

  draw(shot: ModelShot): void {
    const { cam, packet: p } = this;
    const a = (shot.around * Math.PI) / 180;
    const e = (shot.above * Math.PI) / 180;
    // Far enough off that the ball fits the narrower way.
    const half = Math.min(cam.fovY / 2, Math.atan(Math.tan(cam.fovY / 2) * cam.aspect));
    const far = shot.radius / Math.sin(half);
    cam.x = shot.centre[0] + far * Math.sin(a) * Math.cos(e);
    cam.y = shot.centre[1] + far * Math.sin(e);
    cam.z = shot.centre[2] + far * Math.cos(a) * Math.cos(e);
    cam.yaw = a + Math.PI;
    cam.pitch = -e;
    cam.near = Math.max(0.05, far - shot.radius * 1.5);
    cam.far = far + shot.radius * 1.5;
    cam.update();
    p.beginFrame();
    p.viewProj.set(cam.viewProj);
    p.camX = cam.x;
    p.camY = cam.y;
    p.camZ = cam.z;
    // Toward the camera, up, and to the camera's left.
    const sun = [Math.sin(a) * 0.55 - Math.cos(a) * 0.4, 0.75, Math.cos(a) * 0.55 + Math.sin(a) * 0.4];
    const length = Math.hypot(sun[0]!, sun[1]!, sun[2]!);
    for (let k = 0; k < 3; k++) p.sun[k] = sun[k]! / length;
    if (shot.rig) {
      writeBones(p.bones, 0, shot.rig.solved, shot.rig.rest, null, -cam.x, -cam.y, -cam.z, 0);
      p.boneCount = shot.rig.bones;
      this.writer.setSkinned(0, 0, shot.colors[0] ?? 0);
    } else this.writer.set(0, -cam.x, -cam.y, -cam.z, 0, shot.colors[0] ?? 0);
    this.writer.regions(0, Uint8Array.from({ length: 6 }, (_, q) => shot.colors[q] ?? 0), 0);
    p.transientCount = 1;
    p.transientIds[0] = 1;
    const sections = shot.textured ? this.pack.header.meshes[shot.mesh]!.lods[shot.level]!.sections : undefined;
    const runs = sections ?? [-1, 0, 0];
    p.drawCount = runs.length / 3;
    for (let d = 0; d < p.drawCount; d++) {
      p.drawMesh[d] = shot.mesh;
      p.drawLod[d] = shot.level;
      p.drawBuffer[d] = TRANSIENT_BUFFER;
      p.drawFirst[d] = 0;
      p.drawInstances[d] = 1;
      p.drawOffset.fill(0, d * 3, d * 3 + 3);
      p.drawFlags[d] = DRAW_PLAIN | (shot.rig ? DRAW_SKINNED : 0);
      const material = this.pack.header.materials?.[runs[d * 3]!];
      if (!material) continue;
      p.drawFlags[d]! |= DRAW_TEXTURED | ((material.flags & MATERIAL_TWO_SIDED) !== 0 ? DRAW_TWO_SIDED : 0) | ((material.flags & MATERIAL_CUTOUT) !== 0 ? DRAW_CUTOUT : 0);
      p.drawMaterial[d] = runs[d * 3]!;
      p.drawFirstIndex[d] = runs[d * 3 + 1]!;
      p.drawIndexCount[d] = runs[d * 3 + 2]!;
    }
    p.texUploads.push(...this.sending);
    this.sending.length = 0;
    // The sky a material reflects is the game's. Where nothing is drawn, the background is put back.
    const sky = sections ? [0, 1, 2].map((k) => this.pack.palette[SKY_COLOR * 4 + k]! / 255) : this.background;
    p.sky.set(sky);
    this.raster.render(p);
    if (!sections) return;
    const { color, pickKind } = this.raster;
    const [red, green, blue] = this.background.map((c) => c * 255) as [number, number, number];
    for (let at = 0; at < pickKind.length; at++) {
      if (pickKind[at] !== PICK_SKY) continue;
      color[at * 4] = red;
      color[at * 4 + 1] = green;
      color[at * 4 + 2] = blue;
    }
  }

  /** Where a point of the model is in the last picture: x and y in pixels and the depth the rasterizer keeps. False behind the camera. */
  project(x: number, y: number, z: number, out: number[]): boolean {
    const m = this.cam.viewProj;
    const [rx, ry, rz] = [x - this.cam.x, y - this.cam.y, z - this.cam.z];
    const w = m[3]! * rx + m[7]! * ry + m[11]! * rz;
    if (w <= 0.05) return false;
    out[0] = (((m[0]! * rx + m[4]! * ry + m[8]! * rz) / w) * 0.5 + 0.5) * this.raster.width;
    out[1] = (0.5 - ((m[1]! * rx + m[5]! * ry + m[9]! * rz) / w) * 0.5) * this.raster.height;
    out[2] = (m[2]! * rx + m[6]! * ry + m[10]! * rz + m[14]!) / w;
    return true;
  }
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
      // A random look, so the controls show what they do.
      randomLook(new Rng(5), app.ui.creator.look);
    });
    const out = resolve(arg("out") ?? "artifacts/creator.png");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, encodePng(w!, h!, pixels));
    console.log(out);
    process.exit(0);
  }
  if (args.includes("--fight")) {
    // A survivor faces a dummy in flak six metres off. --fight takes "punch" (up close, as the blow lands), "bow" (at full draw),
    // "loosed" (the arrow in the air) or "rifle" (the round's tracer).
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
    // A survivor has placed a foundation and a wall, and holds a doorframe aimed at where it would go.
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
      // Places a wall on the far edge. Then, looking a little left, previews the same item as a doorframe on the west edge.
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
        // With --menu, the survivor puts the piece away, walks toward the wall and holds the use key on it.
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
  const source = resolve(arg("source") ?? SOURCE);
  const look = (arg("view") ?? "corner") as HouseView;
  if (!HOUSE_VIEWS.includes(look)) throw new Error(`--view takes ${HOUSE_VIEWS.join(", ")}, not "${look}"`);
  /** Puts what the flags ask for in front of the view's camera. */
  const setup = async (view: ProvingView): Promise<void> => {
    const pos = arg("pos")?.split(",").map(Number);
    if (pos) [view.cam.x, view.cam.y, view.cam.z] = pos as [number, number, number];
    view.cam.yaw = (Number(arg("yaw") ?? 0) * Math.PI) / 180;
    view.cam.pitch = (Number(arg("pitch") ?? -4) * Math.PI) / 180;
    if (args.includes("--house")) {
      houseScene(view, arg("house") ?? "wood");
      houseView(view, arg("house") ?? "wood", look);
    }
    if (args.includes("--falling")) fallingScene(view, Number(arg("falling") ?? 450));
    if (args.includes("--ragdoll")) ragdollScene(view, Number(arg("ragdoll") ?? 4));
    if (args.includes("--gear")) gearScene(view, (Number(arg("face") ?? 150) * Math.PI) / 180);
    if (args.includes("--looks")) looksScene(view, (Number(arg("face") ?? 150) * Math.PI) / 180);
    if (args.includes("--creatures")) {
      // Each creature in the colours its asset is reviewed in.
      const samples = new Map((await findAssets(source)).flatMap((a) => (a.spec.kind === "creature" ? [[a.id, a.spec.regions.map((region) => region.sample)] as const] : [])));
      creaturesScene(view, Number(arg("tick") ?? 40), (Number(arg("face") ?? 90) * Math.PI) / 180, samples);
    }
    if (args.includes("--poses")) posesScene(view, Number(arg("tick") ?? 0), Number(arg("poses") ?? 0) || 0, (Number(arg("face") ?? 90) * Math.PI) / 180);
  };
  const graphics = arg("graphics");
  if (graphics !== undefined) {
    // As a client on a graphics tier draws it, its assets read from disk where a client fetches them, once the card
    // holds all it wants. With "all", the four tiers side by side.
    const names = graphics === "all" ? TIERS.map((t) => t.name) : [graphics];
    for (const name of names) if (!TIERS.some((t) => t.name === name)) throw new Error(`--graphics takes ${TIERS.map((t) => t.name).join(", ")} or all, not "${name}"`);
    const t0 = performance.now();
    const files = await gameFiles(source);
    console.log(`asset files from ${relative(process.cwd(), source) || "."}: ${files.manifest.textures?.length ?? 0} textures, ${(files.files.reduce((n, f) => n + f.length, 0) / 1048576).toFixed(1)} MB, ${(performance.now() - t0).toFixed(0)} ms`);
    const across = names.length > 1 ? 2 : 1;
    const [W, H] = [w! * across, h! * Math.ceil(names.length / across)];
    const pixels = new Uint8ClampedArray(W * H * 4);
    for (const [i, name] of names.entries()) {
      const t1 = performance.now();
      const view = provingView(w, h, {}, files);
      view.scene.assets.tier = tierOf(name);
      view.scene.viewHeight = h!;
      await setup(view);
      const frames = settle(view);
      const [ox, oy] = [(i % across) * w!, Math.floor(i / across) * h!];
      for (let y = 0; y < h!; y++) pixels.set(view.raster.color.subarray(y * w! * 4, (y + 1) * w! * 4), ((oy + y) * W + ox) * 4);
      if (names.length > 1) label(pixels, W, name, ox + 10, oy + 10);
      const p = view.scene.packet;
      const r = view.scene.assets.residency;
      const textured = [...Array(p.drawCount).keys()].filter((d) => (p.drawFlags[d]! & DRAW_TEXTURED) !== 0).length;
      console.log(`${name.padEnd(8)} ${frames} frames to fill the card with ${(r.ledger / 1048576).toFixed(1)} MB, ${(r.texLedger / 1048576).toFixed(1)} MB of it textures; draws ${p.drawCount}, ${textured} with materials; triangles ${p.triangles}; ${(performance.now() - t1).toFixed(0)} ms`);
    }
    const out = resolve(arg("out") ?? "artifacts/snap.png");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, encodePng(W, H, pixels));
    console.log(`${out}\n${W}x${H}  ${(performance.now() - t0).toFixed(0)} ms`);
    process.exit(0);
  }
  const view = provingView(w, h);
  await setup(view);
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
      // Lines on each channel, and the chat box open on the tribe channel with a line being typed.
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
