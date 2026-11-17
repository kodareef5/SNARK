// A client predicts its body only on ground it holds as the map's own (client/core/session.ts PREDICTED_REACH): a page's
// ground comes a sector at a time, and a sample it does not hold yet stands in for the map's. The server is told nothing.

import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { PREDICTED_REACH, type ClientSession } from "../../client/core/session.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_JUMP, BTN_SPRINT } from "../../shared/sim/character.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { parseMap, readHead, readPart, setGround, writeMap, type GroundPiece, type MapData, type NodeScatter } from "../../shared/world/mapfile.ts";
import { PROVING_DIMS, buildProvingHeightfield, populateProving } from "../../shared/world/proving.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { simHash } from "../../tools/simhash.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

/** Hills of 32 by 32 chunks, two sectors a side, a wood and walls round the middle of the first sector, where survivors arrive. */
function hills(): MapData {
  const n = 32 * 32 + 1;
  const [minY, stepY] = [-32, 1 / 256];
  const ground = (x: number, z: number): number => 6 + 3 * Math.sin(x / 41) * Math.cos(z / 37) + 0.8 * Math.sin((x - z) / 9);
  const heights = Uint16Array.from({ length: n * n }, (_, k) => Math.round((ground((k % n) * TERRAIN_CELL, Math.floor(k / n) * TERRAIN_CELL) - minY) / stepY));
  const wood: NodeScatter = { seed: 12, perChunk: 60, kinds: [["core:tree", 3], ["core:rock", 1]], allowCell: 0, allow: null };
  const statics = Array.from({ length: 40 }, (_, i) => {
    const [x, z] = [470 + (i % 8) * 11, 470 + Math.floor(i / 8) * 19];
    return { kind: i % 3 === 0 ? "core:crate" : "core:wall", x, y: ground(x, z), z, yaw: i * 5000 };
  });
  return { id: "test:hills", dims: { chunksX: 32, chunksZ: 32 }, minY, stepY, seaLevel: -Infinity, heights, tint: new Uint8Array(n * n).fill(3), statics, nodes: [wood], spawns: [{ name: "Middle", x: 512, z: 512, yaw: 0 }] };
}

const file = writeMap(hills());
const map = parseMap(file);
const head = readHead(file);
const grounds = head.parts.filter((p) => p.kind === "ground").map((p) => readPart(head, p, file.subarray(p.at, p.at + p.length)) as GroundPiece);
/** The sector the body walks in. */
const first = grounds.find((g) => g.sq.cx0 === 0 && g.sq.cz0 === 0)!;

/** The map's ground as a page holds it with only `held` of its sectors come, every other sample poisoned. */
function poisoned(held: readonly GroundPiece[]): Heightfield {
  const hf = new Heightfield(map.dims, TERRAIN_CELL, map.minY, map.stepY);
  hf.heights.fill(65535);
  hf.holdNone();
  for (const g of held) land(hf, g);
  return hf;
}

function land(hf: Heightfield, g: GroundPiece): void {
  setGround(hf.dims, hf.heights, hf.tint, g);
  hf.hold(g.sq.cx0, g.sq.cz0, g.sq.cx1, g.sq.cz1);
}

/**
 * A survivor walking, sprinting and jumping among the trees and walls by seeded inputs for `seconds`, then driving a car
 * for as long, its client holding `ground`: the predicted body each frame, its corrections and its ticks not predicted.
 * `each` is called each frame with the session.
 */
function walk(ground: Heightfield | undefined, seconds: number, each?: (s: ClientSession, frame: number) => void) {
  const h = new Harness({}, 3, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: file });
  try {
    const s = h.join("walker", { latencyMs: 50, jitterMs: 10 }, ground ? { ground } : {});
    const pilot = h.pilots[0]!;
    const rng = new Rng(77);
    const bodies: number[] = [];
    let frame = 0;
    const record = (): void => {
      if (s.state === "active") bodies.push(s.own.x, s.own.y, s.own.z, s.own.vx, s.own.vy, s.own.vz);
      each?.(s, frame++);
    };
    h.run(800, record);
    for (let k = 0; k < seconds * 2; k++) {
      // Back towards the middle when it strays, so it stays well inside the first sector.
      const home = Math.atan2(512 - s.own.x, 512 - s.own.z);
      pilot.yaw = Math.hypot(s.own.x - 512, s.own.z - 512) > 60 ? home : rng.range(-Math.PI, Math.PI);
      pilot.moveZ = rng.range(0.3, 1);
      pilot.moveX = rng.range(-0.5, 0.5);
      pilot.buttons = (rng.int(4) === 0 ? BTN_JUMP : 0) | (rng.int(2) === 0 ? BTN_SPRINT : 0);
      h.run(500, record);
    }
    pilot.moveX = pilot.moveZ = pilot.buttons = 0;
    h.run(800, record);
    const car = h.host.spawnVehicle("core:compact", s.own.x + 1.6, s.own.z - 0.12, 0, Math.PI);
    h.host.urban.mount(h.client(s)!, car);
    h.run(800, record);
    expect(s.driving).toBe(car);
    // Round and round, faster and slower, braking now and then.
    for (let k = 0; k < seconds * 2; k++) {
      pilot.moveZ = rng.range(-0.2, 0.7);
      pilot.moveX = rng.range(0.4, 1);
      pilot.buttons = rng.int(5) === 0 ? BTN_JUMP : 0;
      h.run(500, record);
    }
    return { bodies, corrections: s.stats.corrections + s.stats.stateCorrections, unheld: s.stats.unheld, furthest: Math.max(...Array.from({ length: bodies.length / 6 }, (_, k) => Math.hypot(bodies[k * 6]! - 512, bodies[k * 6 + 2]! - 512))) };
  } finally {
    h.host.shutdown();
  }
}

test("a client holding only the sectors within reach of its body, every other sample poisoned, predicts the body and its car as one holding the whole map does", () => {
  const whole = walk(undefined, 12);
  const held = walk(poisoned([first]), 12);
  // It never left the sector, nor came within reach of its edge.
  expect(whole.furthest + PREDICTED_REACH).toBeLessThan(first.sq.cx1 * CHUNK_SIZE - 512);
  expect([held.unheld, whole.unheld]).toEqual([0, 0]);
  expect(held.corrections).toBe(whole.corrections);
  expect(held.bodies).toEqual(whole.bodies);
});

test("a client whose body's sector has not come predicts nothing there and draws its body from the snapshots, and predicts again from them once it comes", () => {
  const whole = walk(undefined, 6);
  const hf = poisoned(grounds.filter((g) => g !== first));
  let [moved, still, came] = [0, 0, -1];
  let last = { x: 0, tick: 0 };
  const late = walk(hf, 6, (s, frame) => {
    // Until its sector comes, its body moves only when a snapshot comes: it is the server's.
    if (came < 0 && last.tick > 0 && s.own.x !== last.x) (s.latestSnapshot !== last.tick ? moved++ : still++);
    last = { x: s.own.x, tick: s.latestSnapshot };
    if (frame === 600) {
      expect([s.predicting, s.stats.unheld > 250, s.nodeField!.store.held.length]).toEqual([false, true, 0]);
      land(hf, first);
      came = s.stats.unheld;
    }
  });
  expect([moved > 50, still]).toEqual([true, 0]);
  // From the frame its sector came on, every tick was predicted, and the body went as the whole map's client has it.
  expect(late.unheld).toBe(came);
  expect([late.bodies.length, late.bodies.slice(-6 * 240)]).toEqual([whole.bodies.length, whole.bodies.slice(-6 * 240)]);
  expect(late.bodies.slice(-6 * 300)).not.toEqual(whole.bodies.slice(-6 * 300));
});

test("the seeded simulation on the proving ground set in the first of four sectors gives the same hash with the other three poisoned and not held", () => {
  const proving = buildProvingHeightfield();
  const reg = coreRegistry();
  const ground = (poison: boolean): { hf: Heightfield; structs: StructureStore } => {
    const hf = new Heightfield({ chunksX: 32, chunksZ: 32 }, TERRAIN_CELL, proving.minY, proving.stepY);
    hf.seaLevel = proving.seaLevel;
    hf.heights.fill(poison ? 65535 : proving.heights[0]!);
    for (let j = 0; j < proving.nz; j++) hf.heights.set(proving.heights.subarray(j * proving.nx, (j + 1) * proving.nx), j * hf.nx);
    if (poison) {
      hf.holdNone();
      // The first sector is the map's own beyond the proving ground too.
      for (let j = 0; j <= 512; j++) for (let i = 0; i <= 512; i++) if (i >= proving.nx || j >= proving.nz) hf.heights[j * hf.nx + i] = proving.heights[0]!;
      hf.hold(0, 0, 16, 16);
    }
    const structs = new StructureStore(hf.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
    populateProving(structs, hf, reg);
    return { hf, structs };
  };
  expect(PROVING_DIMS.chunksX * CHUNK_SIZE + PREDICTED_REACH).toBeLessThan(16 * CHUNK_SIZE);
  expect(simHash(1500, reg, ground(true))).toBe(simHash(1500, reg, ground(false)));
});
