import { expect, test } from "bun:test";
import { TICK_DT } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_BRAKE, BTN_JUMP, BTN_ROLL, BTN_SPRINT, Body, MF_OUT, MODE_FLYER, MODE_SWIM, MODE_WALK, STAMINA_UNITS, stepBody, stepOut, type MoveParams } from "../../shared/sim/character.ts";
import { capsuleFree, groundUnder } from "../../shared/world/collide.ts";
import { mapHeightfield, mapNodes, parseMap, writeMap } from "../../shared/world/mapfile.ts";
import { nodeForms, scatterNodes } from "../../shared/world/nodes.ts";
import { GROUND_FREE, GROUND_WATER, groundAt } from "../../shared/world/path.ts";
import { MapWater, bodyAlong, seaHere } from "../../shared/world/water.ts";
import { LAKES, lakesMap, lakesWater } from "../fixtures/lakes.ts";
import { busyMap, flatMap } from "../fixtures/map.ts";
import { flatWorld, sealedRoom, wrap, type TestWorld } from "../fixtures/world.ts";

const FWD = 127;
const NORTH = 0;
const SOUTH = 32768;
const WEST = 16384; // facing +X
const DOWN = -12000;
const UP = 12000;

function lakesWorld(): TestWorld {
  const map = parseMap(writeMap(lakesMap()));
  return wrap(map.dims, mapHeightfield(map));
}

const survivor = (w: TestWorld): MoveParams => w.reg.move[w.kind("core:survivor")]!;

function bodyAt(w: TestWorld, x: number, z: number): Body {
  const b = new Body();
  [b.x, b.z, b.y, b.grounded] = [x, z, w.hf.heightAt(x, z), true];
  return b;
}

test("a map's bodies of water are written at version 3 and read back whole; a map without them is the same bytes at version 2 as before", () => {
  const map = lakesMap();
  const file = writeMap(map);
  expect(new DataView(file.buffer).getUint16(4, true)).toBe(3);
  const back = parseMap(file);
  const w = back.water!;
  expect(w.bodies).toEqual(map.water!.bodies);
  expect([w.cell, [...w.chunks()], w.squares]).toEqual([2, [...map.water!.chunks()], map.water!.squares]);
  expect(writeMap(back)).toEqual(file);
  // Ten chunks of the sixteen hold water, 2 KB of squares each before the wire's compression.
  expect(w.chunks().length).toBe(10);
  // Written as they were before water stood apart from the sea (main at 075c7daa): the same bytes, so the same hash.
  const dry = writeMap(busyMap());
  expect([new DataView(dry.buffer).getUint16(4, true), parseMap(dry).hash, parseMap(writeMap(flatMap(4))).hash]).toEqual([2, 3858853969, 3013362243]);
  expect(parseMap(dry).water).toBeUndefined();

  const grid = (b: number): Uint16Array => new Uint16Array(128 * 128).fill(b, 0, 64);
  const refused = (water: MapWater): (() => void) => () => void writeMap({ ...flatMap(4), water });
  expect(refused(MapWater.fromGrid({ chunksX: 4, chunksZ: 4 }, -32, 1 / 256, 2, [{ name: "One", level: 8192 }], grid(2)))).toThrow("map: a square of its water is in a body it does not list");
  expect(refused(MapWater.fromGrid({ chunksX: 4, chunksZ: 4 }, -32, 1 / 256, 2, [], grid(0)))).toThrow("map: it has 0 bodies of water");
  expect(refused(MapWater.fromGrid({ chunksX: 4, chunksZ: 4 }, -32, 1 / 256, 2, [{ name: "One", level: 70000 }], grid(1)))).toThrow("map: it has 1 bodies of water");
  expect(refused(MapWater.fromGrid({ chunksX: 3, chunksZ: 4 }, -32, 1 / 256, 2, [{ name: "One", level: 8192 }], new Uint16Array(96 * 128)))).toThrow("map: its water is not in squares");
});

test("the water at a place is the surface of the body whose square holds it, else the sea's", () => {
  const { hf } = lakesWorld();
  const { high, low, river } = LAKES;
  expect([hf.waterAt(high.x, high.z), hf.waterAt(low.x, low.z), hf.waterAt(40, river.z), hf.waterAt(100, river.z), hf.waterAt(LAKES.spawn.x, LAKES.spawn.z), hf.waterAt(128, 10)]).toEqual([20, 1.5, 1.75, 1.25, 0, 0]);
  // The low pond's bed is under the sea's level, and it is the pond's water there.
  expect(hf.heightAt(low.x, low.z)).toBeLessThan(0);
  // The body's names and boxes.
  const w = hf.water!;
  expect(w.bodies.map((b) => b.name)).toEqual(["High Pond", "Low Pond", "Channel", "Channel"]);
  expect([...w.box.subarray(4, 8)]).toEqual([158, 158, 222, 222]);
  // A map with no bodies answers with the sea, which may be none.
  expect(flatWorld().hf.waterAt(10, 10)).toBe(-Infinity);
});

test("a ray goes into a body where it meets its surface over its squares, and the sea is the sea where no body's square is", () => {
  const w = lakesWater();
  const { high } = LAKES;
  expect(bodyAlong(w, high.x, 30, high.z, 0, -1, 0, 100)).toBe(10);
  expect(bodyAlong(w, high.x, 30, high.z, 0, -1, 0, 9)).toBe(Infinity);
  // Down at 45 degrees from 60 m over the pond's middle, it meets the surface's plane 40 m off, past the pond.
  expect(bodyAlong(w, high.x, 60, high.z, Math.SQRT1_2, -Math.SQRT1_2, 0, 100)).toBe(Infinity);
  // From under the surface, and going up, it meets nothing.
  expect([bodyAlong(w, high.x, 19, high.z, 0, -1, 0, 100), bodyAlong(w, high.x, 10, high.z, 0, 1, 0, 100)]).toEqual([Infinity, Infinity]);
  expect([seaHere(w, 128, 10), seaHere(w, high.x, high.z), seaHere(null, high.x, high.z)]).toEqual([true, false, true]);
});

test("a survivor walks into the pond 20 m up, floats at its surface, dives, comes up and walks out", () => {
  const w = lakesWorld();
  const p = survivor(w);
  const { high } = LAKES;
  const floatY = high.surface - p.height * 0.75;
  const b = bodyAt(w, high.x, high.z + high.r + 8);
  expect(b.y).toBe(20.5);
  const step = (moveZ: number, yaw: number, pitch: number, buttons = 0): void => {
    stepBody(w, b, 0, moveZ, yaw, pitch, buttons, p, TICK_DT);
    if (!capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)) throw new Error(`in solid at ${b.x}, ${b.y}, ${b.z}`);
    if (b.mode === MODE_SWIM) expect(b.y).toBeLessThanOrEqual(Math.max(floatY, w.hf.heightAt(b.x, b.z) + 0.03) + 1e-4);
  };
  let ticks = 0;
  while (b.mode === MODE_WALK && ticks++ < 600) step(FWD, SOUTH, 0);
  expect(b.mode).toBe(MODE_SWIM);
  expect(high.surface - b.y).toBeGreaterThan(p.height * 0.7);
  expect(high.surface - b.y).toBeLessThan(p.height * 0.7 + 0.15);
  for (let i = 0; i < 120; i++) step(FWD, SOUTH, 0);
  expect(b.y).toBeCloseTo(floatY, 3);
  for (let i = 0; i < 120; i++) step(FWD, SOUTH, DOWN);
  expect(b.y).toBeLessThan(17.5);
  for (let i = 0; i < 300; i++) step(0, SOUTH, 0, BTN_JUMP);
  expect(b.y).toBeCloseTo(floatY, 3);
  ticks = 0;
  while (b.mode === MODE_SWIM && ticks++ < 900) step(FWD, NORTH, 0);
  expect([b.mode, b.grounded]).toEqual([MODE_WALK, true]);
  for (let i = 0; i < 60; i++) step(FWD, NORTH, 0);
  expect(b.y).toBe(20.5);
});

test("from the upper reach into the lower a swimmer drops to the lower water, and back it swims on in the deeper upper one up to its surface", () => {
  const w = lakesWorld();
  const p = survivor(w);
  const { river } = LAKES;
  const b = bodyAt(w, 40, river.z);
  for (let i = 0; i < 90; i++) stepBody(w, b, 0, 0, WEST, 0, BTN_JUMP, p, TICK_DT);
  expect([b.mode, b.y]).toEqual([MODE_SWIM, expect.closeTo(river.upper - p.height * 0.75, 3)]);
  const modes: number[] = [];
  for (let i = 0; i < 900 && b.x < 100; i++) {
    stepBody(w, b, 0, FWD, WEST, 0, 0, p, TICK_DT);
    if (modes.at(-1) !== b.mode) modes.push(b.mode);
    if (!capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)) throw new Error(`in solid at ${b.x}, ${b.y}, ${b.z}`);
  }
  // Over the step it is above the lower water for a moment and falls into it.
  expect(modes).toEqual([MODE_SWIM, MODE_WALK, MODE_SWIM]);
  // It went in falling and stays as deep as it came to rest, as in the sea, till the jump brings it up.
  for (let i = 0; i < 90; i++) stepBody(w, b, 0, 0, WEST, 0, BTN_JUMP, p, TICK_DT);
  expect(b.y).toBeCloseTo(river.lower - p.height * 0.75, 3);
  // Back west the upper water is half a metre deeper where it goes in; it swims on, and the jump takes it up to the surface.
  modes.length = 0;
  for (let i = 0; i < 900 && b.x > 40; i++) {
    stepBody(w, b, 0, FWD, WEST + 32768, 0, BTN_JUMP, p, TICK_DT);
    if (modes.at(-1) !== b.mode) modes.push(b.mode);
  }
  expect(modes).toEqual([MODE_SWIM]);
  expect(b.y).toBeCloseTo(river.upper - p.height * 0.75, 3);
});

test("fuzz: no input swims a body out of a sealed room holding water at two heights, into solid space, or over the water it is in", () => {
  const w = flatWorld(4);
  // West of x = 100 the room holds 2.5 m of water, under its ceiling at 3; east of it 1 m, which a survivor wades.
  const side = 128;
  const grid = new Uint16Array(side * side);
  for (let j = 45; j < 56; j++) for (let i = 45; i < 56; i++) grid[j * side + i] = i < 50 ? 1 : 2;
  w.hf.water = MapWater.fromGrid(w.dims, -32, 1 / 256, 2, [{ name: "Deep", level: (2.5 + 32) * 256 }, { name: "Wading", level: (1 + 32) * 256 }], grid);
  expect([w.hf.waterAt(98, 100), w.hf.waterAt(101, 100)]).toEqual([2.5, 1]);
  const p = survivor(w);
  const room = sealedRoom(w, 100, 100);
  let swam = 0;
  let crossings = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const rng = new Rng(seed);
    const b = bodyAt(w, 100 + rng.range(-2, 2), 100 + rng.range(-2, 2));
    let [moveX, moveZ, yaw, pitch, buttons] = [0, 0, 0, 0, 0];
    for (let i = 0; i < 3000; i++) {
      if (rng.int(12) === 0) {
        moveX = rng.int(255) - 127;
        moveZ = rng.int(255) - 127;
        yaw = rng.int(65536);
        pitch = rng.int(32769) - 16384;
        buttons = rng.int(4);
      }
      const west = b.x < 100;
      stepBody(w, b, moveX, moveZ, yaw, pitch, buttons, p, TICK_DT);
      if (west !== b.x < 100) crossings++;
      if (b.mode === MODE_SWIM) swam++;
      if (b.x < room.minX - 0.5 || b.x > room.maxX + 0.5 || b.z < room.minZ - 0.5 || b.z > room.maxZ + 0.5) throw new Error(`seed ${seed} escaped at tick ${i}: ${b.x}, ${b.y}, ${b.z}`);
      if (!capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)) throw new Error(`seed ${seed} in solid at tick ${i}: ${b.x}, ${b.y}, ${b.z}`);
      // A swimmer is no higher than its float line in the water it is in, unless the bottom holds it up.
      if (b.mode === MODE_SWIM) expect(b.y).toBeLessThanOrEqual(Math.max(w.hf.waterAt(b.x, b.z) - p.height * 0.75, groundUnder(w.hf, b.x, b.z, p.radius) + 0.03) + 1e-4);
      expect(b.y).toBeGreaterThanOrEqual(-0.002);
    }
  }
  expect([swam > 3000, swam < 15000, crossings > 100]).toEqual([true, true, true]);
});

test("fuzz: pteranodons over the ponds and the channel never go under a body's surface while they fly", () => {
  const w = lakesWorld();
  const ptera = w.kind("core:pteranodon");
  const did = { aloft: 0, setDown: 0, swam: 0 };
  for (const seed of [41, 42, 43]) {
    const p = w.reg.move[ptera]!;
    const rng = new Rng(seed);
    for (const [sx, sz] of [[LAKES.high.x, LAKES.high.z + 36], [LAKES.low.x + 30, LAKES.low.z], [60, 96], [100, 64]] as const) {
      const b = bodyAt(w, sx, sz);
      [b.kind, b.staminaMax, b.stamina] = [ptera, 150, 150 * STAMINA_UNITS];
      let [moveZ, yaw, pitch, buttons] = [FWD, rng.int(65536), 0, BTN_JUMP];
      for (let i = 0; i < 2000; i++) {
        if (rng.int(20) === 0) {
          moveZ = rng.int(255) - 127;
          // Mostly toward the water it started by.
          yaw = rng.int(3) === 0 ? rng.int(65536) : Math.round((Math.atan2(sx - 10 - b.x, sz - 30 - b.z) / (2 * Math.PI)) * 65536) & 0xffff;
          pitch = rng.int(2 * UP + 1) - UP;
          buttons = (rng.int(4) === 0 ? 0 : BTN_JUMP) | (rng.int(2) === 0 ? BTN_SPRINT : 0) | (rng.int(8) === 0 ? BTN_BRAKE : 0) | (rng.int(8) === 0 ? BTN_ROLL : 0);
          b.mflags = rng.int(60) === 0 ? MF_OUT : 0;
          if (rng.int(30) === 0) b.stamina = 150 * STAMINA_UNITS;
        }
        const py = b.y;
        stepBody(w, b, 0, moveZ, yaw, pitch, buttons, p, TICK_DT);
        if (!capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)) throw new Error(`in solid at tick ${i}, seed ${seed}: ${b.x}, ${b.y}, ${b.z}`);
        const afloat = w.hf.waterAt(b.x, b.z) - p.height * 0.75;
        if (b.mode === MODE_FLYER && py >= afloat && b.y < afloat - 1e-4 && w.hf.waterAt(b.x, b.z) - w.hf.heightAt(b.x, b.z) > p.height) throw new Error(`under water at tick ${i}, seed ${seed}: ${b.x}, ${b.y}, ${b.z}`);
        if (b.mode === MODE_FLYER) did.aloft++;
        if (stepOut.setDown) did.setDown++;
        if (b.mode === MODE_SWIM && w.hf.water!.bodyAt(b.x, b.z) !== 0) did.swam++;
      }
    }
  }
  expect([did.aloft > 10000, did.setDown > 50, did.swam > 0]).toEqual([true, true, true]);
});

test("the path finder takes a pond's water as water, and no node grows in one", () => {
  const w = lakesWorld();
  const p = survivor(w);
  expect([groundAt(w, p, LAKES.high.x, LAKES.high.z), groundAt(w, p, LAKES.low.x, LAKES.low.z), groundAt(w, p, 40, LAKES.river.z), groundAt(w, p, LAKES.spawn.x, LAKES.spawn.z)]).toEqual([GROUND_WATER, GROUND_WATER, GROUND_WATER, GROUND_FREE]);
  const forms = nodeForms(w.reg);
  const tree = w.reg.index.get("core:tree")!;
  const nodes = scatterNodes(w.dims, w.hf, 9, 200, forms, () => [tree]);
  const spot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  let placed = 0;
  let wet = 0;
  for (let c = 0; c < 16; c++) {
    for (let s = 0; s < nodes.perChunk; s++) {
      nodes.at(c, s, spot);
      if (spot.kind === 0) continue;
      placed++;
      if (spot.y < w.hf.waterAt(spot.x, spot.z) + 0.3) wet++;
    }
  }
  expect([placed > 1000, wet]).toEqual([true, 0]);
  expect(mapNodes(lakesMap(), w.hf, w.reg)).toBeNull();
});
