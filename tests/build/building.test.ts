import { expect, test } from "bun:test";
import { BUILDING_CONTENT, DOOR_HEIGHT, DOOR_WIDTH, FLOOR_THICK, FOUNDATION_THICK, RISE, SPAN, WALL_HEIGHT } from "../../content/building.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { PIECE_ROLES, shapeHalf, type Def, type ShapeDef, type StructureDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_JUMP, BTN_SPRINT, Body, stanceHeight, stepBody, type MoveParams } from "../../shared/sim/character.ts";
import { SKIN, capsuleFree } from "../../shared/world/collide.ts";
import { HIT_NONE, HIT_STRUCTURE, castWorld, rayHit } from "../../shared/world/ray.ts";
import { grayboxMeshes } from "../../tools/pack/build.ts";
import { buildPack } from "../../tools/pack/write.ts";
import { flatWorld, type TestWorld } from "../fixtures/world.ts";

const FWD = 127;
const Q = 16384;
const TIERS = ["thatch", "wood", "stone", "metal"];

function survivor(w: TestWorld): MoveParams {
  return w.reg.move[w.kind("core:survivor")]!;
}

function bodyAt(w: TestWorld, x: number, z: number, y = w.hf.heightAt(x, z)): Body {
  const b = new Body();
  b.x = x;
  b.z = z;
  b.y = y;
  b.grounded = true;
  return b;
}

/** Throws if any tick leaves the body in something solid. */
function walk(w: TestWorld, b: Body, ticks: number, moveX: number, moveZ: number, yaw: number, buttons = 0): void {
  const p = survivor(w);
  for (let i = 0; i < ticks; i++) {
    stepBody(w, b, moveX, moveZ, yaw, 0, buttons, p, TICK_DT);
    if (!capsuleFree(w, b.x, b.y, b.z, p.radius, stanceHeight(p, b.stance))) throw new Error(`in solid at tick ${i}: ${b.x}, ${b.y}, ${b.z}`);
  }
}

test("the building set: every piece in every material it is made in, with the reference's sizes and health", () => {
  const w = flatWorld();
  const reg = w.reg;
  const def = (id: string): StructureDef => reg.defs[reg.index.get(`core:${id}`)!] as StructureDef;
  for (const tier of TIERS) {
    // The first nine forms. Those that came after are held by their own tests.
    const first = ["ceiling", "door", "door_open", "doorframe", "foundation", "pillar", "stairs", "wall", "windowframe"];
    const made = BUILDING_CONTENT.filter((d) => d.type === "structure" && d.id.endsWith(`_${tier}`)).map((d) => d.id.slice(5, -tier.length - 1)).filter((name) => first.includes(name));
    expect(made.sort()).toEqual(tier === "thatch" ? ["ceiling", "door", "door_open", "doorframe", "foundation", "wall"] : ["ceiling", "door", "door_open", "doorframe", "foundation", "pillar", "stairs", "wall", "windowframe"]);
  }
  for (const tier of ["wood", "stone", "metal"]) {
    expect(["foundation", "wall", "ceiling", "doorframe", "windowframe", "stairs", "door", "pillar"].map((p) => def(`${p}_${tier}`).hp)).toEqual([15000, 10000, 10000, 10000, 10000, 10000, 6250, 6250]);
    expect(def(`wall_${tier}`).material).toBe(`core:mat_${tier}`);
  }
  expect(["foundation", "wall", "ceiling", "doorframe", "door"].map((p) => def(`${p}_thatch`).hp)).toEqual([2400, 1600, 1600, 1600, 1000]);
  expect([SPAN, WALL_HEIGHT, RISE]).toEqual([3, 3, 3]);
  for (const v of [FOUNDATION_THICK, FLOOR_THICK, WALL_HEIGHT, DOOR_HEIGHT, RISE]) expect((v * 256) % 1).toBe(0);
  expect(def("foundation_stone").half).toEqual([1.5, FOUNDATION_THICK / 2, 1.5]);
  expect(def("wall_wood").half).toEqual([1.5, 1.5, 0.1]);
  expect(def("ceiling_wood").half).toEqual([1.5, 0.125, 1.5]);
  expect(def("pillar_wood").half).toEqual([0.25, 1.5, 0.25]);
  expect(def("stairs_wood").half.map((v) => Math.round(v * 1000) / 1000)).toEqual([1.5, 1.5, 1.5]);
  expect(def("doorframe_wood").half.map((v) => Math.round(v * 1000) / 1000)).toEqual([1.5, 1.5, 0.1]);
  expect(def("door_wood").half).toEqual([DOOR_WIDTH / 2, DOOR_HEIGHT / 2, 0.04]);

  const boxes = (id: string): number => reg.parts.start[reg.index.get(`core:${id}`)! + 1]! - reg.parts.start[reg.index.get(`core:${id}`)!]!;
  expect(["foundation_wood", "wall_wood", "doorframe_wood", "windowframe_wood", "ceiling_wood", "pillar_wood", "door_wood", "door_open_wood", "stairs_wood"].map(boxes)).toEqual([1, 1, 3, 4, 1, 1, 1, 1, 10]);
  expect(["foundation_wood", "doorframe_stone", "ceiling_metal", "pillar_wood", "door_thatch", "stairs_metal"].map((id) => PIECE_ROLES[reg.role[reg.index.get(`core:${id}`)!]!])).toEqual(["foundation", "wall", "ceiling", "pillar", "door", "stairs"]);
  // A plain box structure has one box and role -1. An item has no boxes.
  expect(boxes("block")).toBe(1);
  expect(reg.role[reg.index.get("core:block")!]).toBe(-1);
  expect(boxes("stone")).toBe(0);

  const stairs = BUILDING_CONTENT.find((d) => d.id === "core:shape_stairs") as ShapeDef;
  expect(shapeHalf(stairs.boxes).map((v) => Math.round(v * 1000) / 1000)).toEqual([1.5, 1.5, 1.5]);
  const broken = (change: (d: Def) => Def): string[] => compileContent(CORE_CONTENT.map(change)).errors;
  expect(broken((d) => (d.id === "core:wall_wood" ? { ...d, half: [1.5, 1.5, 0.3] } : d))[0]).toContain("core:wall_wood: half must be [1.5, 1.5, 0.1]");
  expect(broken((d) => (d.id === "core:wall_wood" ? { ...d, shape: "core:stone" } : d))[0]).toContain('"core:stone" is not a shape');
  expect(broken((d) => (d.id === "core:wall_wood" && d.type === "structure" ? { ...d, mesh: "box" } : d))[0]).toContain('a mesh of "box" is its half extents, and takes no shape');
  expect(broken((d) => (d.id === "core:shape_wall" ? { ...d, boxes: [] } : d))[0]).toContain("a shape has 1 to 16 boxes");
  expect(broken((d) => (d.id === "core:shape_wall" ? ({ ...d, role: "roof" } as unknown as Def) : d))[0]).toContain("role must be one of");
});

test("each piece is drawn as its boxes", () => {
  // The content's grey boxes alone: a tier's art takes their place in the core pack, which tests/assets/art.test.ts proves.
  const pack = parsePack(buildPack(grayboxMeshes(CORE_CONTENT), defaultPalette()));
  const tris = (id: string): number => pack.header.meshes[pack.meshIndex.get(id)!]!.lods[0]!.indexCount / 3;
  expect([tris("core:wall_wood"), tris("core:doorframe_wood"), tris("core:windowframe_stone"), tris("core:stairs_metal")]).toEqual([12, 36, 48, 120]);
  const m = pack.header.meshes[pack.meshIndex.get("core:stairs_wood")!]!;
  expect(m.half.map((v) => Math.round(v * 1000) / 1000)).toEqual([1.5, 1.5, 1.5]);
  expect(m.center.map((v) => Math.round(Math.abs(v) * 100) / 100)).toEqual([0, 0, 0]);
});

test("stairs are climbed a step at a time, from one floor to the next, and walked back down", () => {
  const w = flatWorld();
  const p = survivor(w);
  // The stairs rise toward +Z, with a floor above to step off onto.
  w.structs.add(w.kind("core:stairs_wood"), 64, RISE / 2, 64, 0, 0, 1);
  w.structs.add(w.kind("core:ceiling_wood"), 64, RISE - FLOOR_THICK / 2, 67, 0, 0, 1);
  const b = bodyAt(w, 64, 61.5);
  const heights: number[] = [];
  for (let i = 0; i < 300 && b.z < 66.5; i++) {
    walk(w, b, 1, 0, FWD, 0);
    heights.push(Math.round(b.y * 100) / 100);
  }
  // Never down, and no more than one step (RISE / 10) and a bit in a tick.
  for (let i = 1; i < heights.length; i++) {
    expect(heights[i]!).toBeGreaterThanOrEqual(heights[i - 1]! - 0.01);
    expect(heights[i]! - heights[i - 1]!).toBeLessThan(RISE / 10 + 0.1);
  }
  expect(new Set(heights).size).toBeGreaterThan(10);
  // About as long as walking the same distance on the flat, so stairs do not stop a body at each step.
  expect(heights.length).toBeLessThan(70);
  expect(b.y).toBeCloseTo(RISE, 2);
  expect(b.z).toBeGreaterThan(66);
  expect(b.grounded).toBe(true);
  walk(w, b, 120, 0, FWD, 32768, BTN_SPRINT);
  expect(b.y).toBeCloseTo(0, 2);
  expect(b.z).toBeLessThan(62);
  // The flank of the staircase is a wall, so there is no way up from the side.
  const side = bodyAt(w, 61.5, 65);
  walk(w, side, 60, 0, FWD, Q * 3);
  expect(side.x).toBeLessThan(64 - 1.5 - p.radius + SKIN * 2);
  expect(side.y).toBe(0);
  // The space under the top of the stairs is solid.
  expect(capsuleFree(w, 64, 0, 65.2, p.radius, p.height)).toBe(false);
  expect(capsuleFree(w, 64, RISE + 0.01, 65.2, p.radius, p.height)).toBe(true);
});

test("a doorway is walked through, a shut door is not, an open door is, and a window lets only a look through", () => {
  const w = flatWorld();
  const p = survivor(w);
  const y = WALL_HEIGHT / 2;
  w.structs.add(w.kind("core:wall_stone"), 61, y, 64, 0, 0, 1);
  w.structs.add(w.kind("core:doorframe_stone"), 64, y, 64, 0, 0, 1);
  w.structs.add(w.kind("core:windowframe_stone"), 67, y, 64, 0, 0, 1);
  const north = (x: number, ticks = 90, buttons = 0): Body => {
    const b = bodyAt(w, x, 62);
    walk(w, b, ticks, 0, FWD, 0, buttons);
    return b;
  };
  // The x values are the plain wall, both door posts and the window.
  expect(north(64).z).toBeGreaterThan(66);
  expect(north(64 + DOOR_WIDTH / 2 - p.radius - 0.02).z).toBeGreaterThan(66);
  for (const x of [61, 62.9, 65.2, 67, 67.3]) {
    expect(north(x).z).toBeLessThan(64 - p.radius + SKIN * 2);
    expect(north(x, 120, BTN_JUMP).z).toBeLessThan(64 - p.radius + SKIN * 2);
  }
  // A jump in the doorway hits the piece above and still goes through.
  expect(north(64, 120, BTN_JUMP).z).toBeGreaterThan(66);

  const doorY = DOOR_HEIGHT / 2;
  const shut = w.structs.add(w.kind("core:door_stone"), 64, doorY, 64, 0, 0, 1);
  expect(north(64).z).toBeLessThan(64 - p.radius + SKIN * 2);
  w.structs.remove(shut);
  w.structs.add(w.kind("core:door_open_stone"), 64, doorY, 64, 0, 0, 1);
  expect(north(64).z).toBeGreaterThan(66);
  // The open leaf blocks a body that walks at it.
  const leaf = bodyAt(w, 64 - DOOR_WIDTH / 2 - 0.5, 64.7);
  walk(w, leaf, 60, 0, FWD, Q * 3);
  expect(leaf.x).toBeLessThan(64 - DOOR_WIDTH / 2 + 0.04 - p.radius + 0.1);

  // A ray passes the window's opening and the doorway. It stops at the sill, the posts and the wall.
  const look = (x: number, height: number): number => castWorld(w, x, height, 62, 0, 0, 1, 6);
  expect(look(67, 1.5)).toBe(HIT_NONE);
  expect(look(67, 0.5)).toBe(HIT_STRUCTURE);
  expect(rayHit.t).toBeCloseTo(1.9, 3);
  expect([rayHit.nx, rayHit.ny, rayHit.nz].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, -1]);
  expect(look(67, 2.5)).toBe(HIT_STRUCTURE);
  expect(look(67 + 1, 1.5)).toBe(HIT_STRUCTURE);
  expect(look(61, 1.5)).toBe(HIT_STRUCTURE);
  expect(look(64.3, 1.5)).toBe(HIT_NONE);
  expect(look(64.3, 2.6)).toBe(HIT_STRUCTURE);
  // A piece's boxes turn with it. This is the same doorway facing east.
  const e = flatWorld();
  e.structs.add(e.kind("core:doorframe_wood"), 64, y, 64, Q, 0, 1);
  const through = bodyAt(e, 62, 64);
  walk(e, through, 90, 0, FWD, Q);
  expect(through.x).toBeGreaterThan(66);
  const stopped = bodyAt(e, 62, 65.1);
  walk(e, stopped, 90, 0, FWD, Q);
  expect(stopped.x).toBeLessThan(64 - p.radius + SKIN * 2);
});

test("fuzz: nothing gets out of a house of doorframes with shut doors, windows and a staircase, or into anything solid", () => {
  const w = flatWorld();
  const p = survivor(w);
  const fy = FOUNDATION_THICK / 2;
  const floor = FOUNDATION_THICK;
  const wy = floor + WALL_HEIGHT / 2;
  const [cx, cz] = [64, 64];
  for (const ox of [-1.5, 1.5]) for (const oz of [-1.5, 1.5]) {
    w.structs.add(w.kind("core:foundation_stone"), cx + ox, fy, cz + oz, 0, 0, 1);
    w.structs.add(w.kind("core:ceiling_stone"), cx + ox, floor + WALL_HEIGHT + FLOOR_THICK / 2, cz + oz, 0, 0, 1);
  }
  const side = (x: number, z: number, yaw: number, frame: string): void => {
    w.structs.add(w.kind(`core:${frame}_stone`), x, wy, z, yaw, 0, 1);
    if (frame === "doorframe") w.structs.add(w.kind("core:door_stone"), x, floor + DOOR_HEIGHT / 2, z, yaw, 0, 1);
  };
  side(cx - 1.5, cz - 3, 0, "windowframe");
  side(cx + 1.5, cz - 3, 0, "doorframe");
  side(cx - 1.5, cz + 3, 0, "doorframe");
  side(cx + 1.5, cz + 3, 0, "windowframe");
  side(cx - 3, cz - 1.5, Q, "doorframe");
  side(cx - 3, cz + 1.5, Q, "windowframe");
  side(cx + 3, cz - 1.5, Q, "windowframe");
  side(cx + 3, cz + 1.5, Q, "doorframe");
  w.structs.add(w.kind("core:stairs_stone"), cx - 1.5, floor + RISE / 2, cz + 1.4, 0, 0, 1);
  const rng = new Rng(404);
  const b = bodyAt(w, cx + 1, cz - 1, floor);
  let moveX = 0;
  let moveZ = 0;
  let yaw = 0;
  let buttons = 0;
  // The farthest a body's centre can be from the house's centre. Prone in a jump at a window it can lean into the opening,
  // which is 0.7 m high, too low for a body 0.8 m through to get past where it touches the sill and the piece above at once.
  const reach = 3 - 0.1 - 0.18;
  let highest = 0;
  for (let i = 0; i < 40000; i++) {
    if (rng.int(12) === 0) {
      moveX = rng.int(513) - 256;
      moveZ = rng.int(513) - 256;
      yaw = rng.int(65536);
      buttons = rng.int(1024);
    }
    stepBody(w, b, moveX, moveZ, yaw, 0, buttons, p, TICK_DT);
    const height = stanceHeight(p, b.stance);
    if (b.y > highest) highest = b.y;
    const inside = Math.abs(b.x - cx) < reach && Math.abs(b.z - cz) < reach && b.y >= floor - SKIN && b.y + height < floor + WALL_HEIGHT + SKIN;
    if (!inside || !capsuleFree(w, b.x, b.y, b.z, p.radius, height)) throw new Error(`escaped at tick ${i}: ${b.x}, ${b.y}, ${b.z} (stance ${b.stance})`);
  }
  // It climbed the stairs as far as the roof allows.
  expect(highest).toBeGreaterThan(floor + 0.9);
});
