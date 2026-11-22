// A base's interior is drawn and cast only from inside it (client/core/render/rooms.ts), and nothing seen is ever missing:
// each frame is drawn again by a scene that draws every piece, and the two pictures are held equal pixel for pixel.

import { expect, test } from "bun:test";
import { forTouch, tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { Rasterizer } from "../../tools/snap/raster.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const DIMS = { chunksX: 16, chunksZ: 16 };
const [X0, Z0] = [400, 400];
const CHUNK = 6 * 16 + 6;

/**
 * A wooden house four rooms by three on two storeys. Below, a wall splits it into two halls: the west one has the door,
 * shut, and a box; the east one has a window. Above is one hall, shut in, with a box. So the floor over the west hall
 * and both boxes are seen only from inside, and nothing else.
 */
function house(structs: StructureStore): { door: number; split: number } {
  const reg = coreRegistry();
  const k = (id: string): number => reg.index.get(`core:${id}`)!;
  const [F, W, C, DF, D, WF, BOX] = [k("foundation_wood"), k("wall_wood"), k("ceiling_wood"), k("doorframe_wood"), k("door_wood"), k("windowframe_wood"), k("storage_box")];
  const floor = (s: number): number => 2 * reg.halfY[F]! + s * 3;
  let door = -1, split = -1;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) structs.add(F, X0 + 1.5 + 3 * i, reg.halfY[F]!, Z0 + 1.5 + 3 * j, 0, 1, 1000);
  for (let s = 0; s < 2; s++) {
    const y = floor(s) + reg.halfY[W]!;
    for (let i = 0; i < 4; i++) {
      const doorway = s === 0 && i === 0;
      structs.add(doorway ? DF : W, X0 + 1.5 + 3 * i, y, Z0, 0, 1, 1000);
      if (doorway) door = structs.add(D, X0 + 1.5, floor(0) + reg.halfY[D]!, Z0, 0, 1, 1000);
      structs.add(W, X0 + 1.5 + 3 * i, y, Z0 + 9, 0, 1, 1000);
    }
    for (let j = 0; j < 3; j++) {
      structs.add(W, X0, y, Z0 + 1.5 + 3 * j, 16384, 1, 1000);
      structs.add(s === 0 && j === 1 ? WF : W, X0 + 12, y, Z0 + 1.5 + 3 * j, 16384, 1, 1000);
      if (s === 0) {
        const ref = structs.add(W, X0 + 6, y, Z0 + 1.5 + 3 * j, 16384, 1, 1000);
        if (j === 1) split = ref;
      }
    }
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) structs.add(C, X0 + 1.5 + 3 * i, floor(s) + 3 - reg.halfY[C]!, Z0 + 1.5 + 3 * j, 0, 1, 1000);
    structs.add(BOX, X0 + 3 + 1.5 * s, floor(s) + reg.halfY[BOX]!, Z0 + 4.5, 0, 1, 1000);
  }
  return { door, split };
}

/** The house, a scene drawing it as the game does and one drawing every piece, each with a rasterizer that takes its every packet. */
function world(tier: Tier) {
  const reg = coreRegistry();
  const hf = new Heightfield(DIMS, TERRAIN_CELL, -32, 1 / 64);
  hf.heights.fill(32 * 64);
  const structs = new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const refs = house(structs);
  const scenes = [0, 1].map(() => {
    const scene = new Scene({ dims: DIMS, hf, structs }, reg, corePack());
    scene.assets.tier = tier;
    return { scene, raster: new Rasterizer(96, 64, corePack(), hf) };
  });
  (scenes[1]!.scene as unknown as { finder: { find: () => boolean } }).finder.find = () => false;
  const cam = new Camera();
  cam.aspect = 1.5;
  /** Draws a frame from (x, y, z) facing `yaw` in both scenes: its triangles and cast triangles in each, and whether the pictures are one. */
  const look = (x: number, y: number, z: number, yaw: number) => {
    [cam.x, cam.y, cam.z, cam.yaw] = [x, y, z, yaw];
    const counts = scenes.map(({ scene, raster }) => {
      const p = scene.build(cam, null);
      raster.render(p);
      return [p.triangles, p.castTriangles];
    });
    let same = true;
    for (let i = 0; i < scenes[0]!.raster.color.length && same; i++) same = scenes[0]!.raster.color[i] === scenes[1]!.raster.color[i];
    return { tris: counts[0]![0]!, all: counts[1]![0]!, cast: counts[0]![1]!, allCast: counts[1]![1]!, same };
  };
  const batch = (): unknown => (scenes[0]!.scene as unknown as { batches: Map<number, unknown> }).batches.get(CHUNK);
  return { structs, refs, look, batch, reg };
}

const EYE = 2 * 0.1875 + 1.6;
const NORTH = 0, WEST = 1.5 * Math.PI;

test("from outside a house its hidden floor and boxes are neither drawn nor cast, and its picture is that of every piece drawn", () => {
  const w = world(forTouch(tierOf("medium"), true));
  for (let f = 0; f < 3; f++) w.look(X0 + 6, 1.7, Z0 - 12, NORTH);
  const out = w.look(X0 + 6, 1.7, Z0 - 12, NORTH);
  expect(out.tris).toBeLessThan(out.all);
  expect(out.cast).toBeLessThan(out.allCast);
  // Standing in the west hall, the house is drawn and cast whole.
  const inside = w.look(X0 + 1.5, EYE, Z0 + 2, NORTH);
  expect([inside.tris, inside.cast]).toEqual([inside.all, inside.allCast]);
});

test("a door opened shows what is behind it in that frame without laying the chunk out again, and shut hides it again", () => {
  const w = world(tierOf("lowpoly"));
  const outside = () => w.look(X0 + 1.5, 1.7, Z0 - 8, NORTH);
  for (let f = 0; f < 3; f++) outside();
  const shut = outside();
  expect(shut.same).toBe(true);
  expect(shut.tris).toBeLessThan(shut.all);
  const laid = w.batch();
  const t = w.structs.chunks[CHUNK]!, slot = w.refs.door & 0xffff;
  w.structs.swap(w.refs.door, w.reg.opens[t.kind[slot]!]!);
  const open = outside();
  expect([open.same, open.tris === open.all, w.batch() === laid]).toEqual([true, true, true]);
  // Walking in through it, every frame shows all there is to see.
  for (const z of [Z0 - 2, Z0 - 0.3, Z0, Z0 + 0.3, Z0 + 2]) expect(w.look(X0 + 1.5, EYE, z, NORTH).same).toBe(true);
  w.structs.swap(w.refs.door, w.reg.opens[t.kind[slot]!]!);
  const again = outside();
  expect([again.same, again.tris, w.batch() === laid]).toEqual([true, shut.tris, true]);
});

test("a wall broken open shows the hall behind it at once, and from in the window frame nothing seen is missing", () => {
  const w = world(tierOf("lowpoly"));
  const sill = 2 * 0.1875 + 1.55;
  const window = () => w.look(X0 + 14, sill, Z0 + 4.5, WEST);
  for (let f = 0; f < 3; f++) window();
  const before = window();
  expect(before.same).toBe(true);
  expect(before.tris).toBeLessThan(before.all);
  // Standing in the window, the east hall is open air and the west one shut in, so only the shell is drawn.
  for (const x of [X0 + 12.4, X0 + 12, X0 + 11.6]) {
    const inWindow = w.look(x, sill, Z0 + 4.5, WEST);
    expect([inWindow.same, inWindow.tris < inWindow.all]).toEqual([true, true]);
  }
  // With the wall between the halls gone, the west hall's floor overhead and its box are seen through the window.
  w.structs.remove(w.refs.split);
  const broken = window();
  expect(broken.same).toBe(true);
  expect(broken.tris).toBeGreaterThan(before.tris);
});
