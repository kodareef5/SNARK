import { expect, test } from "bun:test";
import { layHuman } from "../../shared/anim/human-fall.ts";
import { layCorpse } from "../../shared/anim/corpse.ts";
import { Solved } from "../../shared/anim/skeleton.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { CORPSE_CHECKPOINT_MAX, decodeCorpseCheckpoint, encodeCorpseCheckpoint, newerCorpseMotion, packCorpseCheckpoint, readCorpseMotion, writeCorpseMotion } from "../../shared/net/corpse.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { birdAnim } from "../fixtures/bird.ts";

const anim = birdAnim(), reg = compileContent(CORE_CONTENT).registry!;
function world() {
  const dims = { chunksX: 2, chunksZ: 2 }, hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let z = 0; z < hf.nz; z++) for (let x = 0; x < hf.nx; x++) hf.setSample(x, z, 0);
  return { hf, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) };
}
function doll(x = 40, y = 4, z = 40) { return layCorpse(anim, false, false, x, y, z, 0, 1, new Solved(anim.rig.bones))!; }

test("a launched corpse resumes exactly from a bounded whole-tick checkpoint", () => {
  const w = world(), first = doll(), origin = new Float64Array(3);
  first.launch(8, 3, 1, 0, 2, 4);
  for (let i = 0; i < 11; i++) first.step(w, 1 / 30);
  first.rootPosition(origin);
  const data = encodeCorpseCheckpoint({ x: origin[0]!, y: origin[1]!, z: origin[2]!, yaw: 0, size: 1, out: false, air: false, awake: first.awake, ticks: 11, state: first.checkpoint() });
  const saved = decodeCorpseCheckpoint(data)!;
  expect(saved).not.toBeNull(); expect(data.length).toBeLessThan(45 + (22 * first.n + 13) * 8);
  expect(data.length).toBeLessThan(CORPSE_CHECKPOINT_MAX);
  const resumed = doll(saved.x, saved.y, saved.z);
  expect(resumed.restore(saved.state, saved.awake)).toBe(true);
  for (let i = 0; i < 90; i++) {
    first.step(w, 1 / 30); resumed.step(w, 1 / 30);
    expect(resumed.checkpoint()).toEqual(first.checkpoint());
    expect(resumed.awake).toBe(first.awake);
  }
  expect(origin[0]!).toBeGreaterThan(41);
});

test("sparse envelope preserves exact state and orders fresh same-revision retries", () => {
  const d = doll(), data = encodeCorpseCheckpoint({ x: 40, y: 4, z: 40, yaw: 0, size: 1, out: false, air: false, awake: true, ticks: 0, state: d.checkpoint() });
  const w = new BitWriter(1200); writeCorpseMotion(w, 0x10005, { revision: 2, tick: 50, data });
  const got = readCorpseMotion(new BitReader(w.bytes()))!;
  expect(got).toEqual({ id: 0x10005, revision: 2, tick: 50, data });
  expect(w.bytes().length).toBe(data.length + 14);
  expect(newerCorpseMotion({ ...got, tick: 51 }, got)).toBe(true);
  expect(newerCorpseMotion({ ...got, revision: 1, tick: 100 }, got)).toBe(false);
  expect(newerCorpseMotion(got, got)).toBe(false);
  for (const index of [0, 1, 2]) { const bad = data.slice(); bad[index] = 255; expect(decodeCorpseCheckpoint(bad)).toBeNull(); }
  expect(decodeCorpseCheckpoint(data.subarray(0, data.length - 1))).toBeNull();
  const bad = data.slice(); new DataView(bad.buffer).setFloat64(5, Number.NaN, true);
  expect(decodeCorpseCheckpoint(bad)).toBeNull();
  expect(decodeCorpseCheckpoint(new Uint8Array(CORPSE_CHECKPOINT_MAX + 1))).toBeNull();
});

test("rebasing a moving corpse changes its draw origin without changing its world motion", () => {
  const d = doll(), before = d.checkpoint(), first = new Solved(anim.rig.bones), second = new Solved(anim.rig.bones);
  d.pose(first); d.rebase(44, 6, 39); d.pose(second);
  expect(d.checkpoint()).toEqual(before);
  expect(second.pos[0]! + 44).toBeCloseTo(first.pos[0]! + 40, 6);
  expect(second.pos[1]! + 6).toBeCloseTo(first.pos[1]! + 4, 6);
  expect(second.pos[2]! + 39).toBeCloseTo(first.pos[2]! + 40, 6);
});

test("compact fall states preserve subsequent whole ticks for humans and birds", () => {
  for (const make of [() => layHuman(40, 4, 40, 0), () => doll()]) {
    const w = world(), first = make(), resumed = make(), origin = new Float64Array(3);
    first.launch(8, 3, 1, 0, 2, 4);
    for (let tick = 0; tick <= 120; tick++) {
      if (tick === 0 || tick === 10 || tick === 80) {
        first.rootPosition(origin);
        const state = first.checkpoint(), before = state.slice();
        const data = packCorpseCheckpoint({ x: origin[0]!, y: origin[1]!, z: origin[2]!, yaw: 0, size: 1,
          out: false, air: false, awake: first.awake, ticks: tick, state });
        expect(data.length).toBeLessThan((45 + 8 * before.length) / 3);
        const decoded = decodeCorpseCheckpoint(data)!;
        expect(decoded.state).toEqual(state);
        for (let i = 0; i < 3 * first.n; i++) expect(Math.abs(state[i]! - before[i]!)).toBeLessThanOrEqual(1 / 4096);
        first.restore(state, first.awake);
        resumed.restore(decoded.state, decoded.awake);
        expect(decodeCorpseCheckpoint(data.subarray(0, data.length - 1))).toBeNull();
        const longer = new Uint8Array(data.length + 1); longer.set(data);
        expect(decodeCorpseCheckpoint(longer)).toBeNull();
      }
      first.step(w, 1 / 30); resumed.step(w, 1 / 30);
      expect(resumed.checkpoint()).toEqual(first.checkpoint());
      expect(resumed.awake).toBe(first.awake);
    }
  }
});

test("checkpoints retain old saves and fall back exactly outside the short range", () => {
  const d = doll(), state = d.checkpoint(), w = new BitWriter(45 + state.length * 8);
  state[3 * d.n] = 200;
  const cp = { x: 40, y: 4, z: 40, yaw: 0, size: 1, out: false, air: false, awake: true, ticks: 0, state };
  w.u8(1); w.u8(d.n); w.u8(4); w.u16(0);
  for (const v of [40, 4, 40, 0, 1, ...state]) w.f64(v);
  const before = state.slice();
  expect(decodeCorpseCheckpoint(w.bytes())?.state).toEqual(before);
  expect(decodeCorpseCheckpoint(packCorpseCheckpoint(cp))?.state).toEqual(before);
  expect(state).toEqual(before);
  const bad = w.bytes().slice(); bad[2] = 32;
  expect(decodeCorpseCheckpoint(bad)).toBeNull();
});

test("both checkpoint encodings round-trip a carrier and reject damaged frames", () => {
  const carrier = { handle: 65542, pose: { x: 40, y: 4, z: 40, qx: 0, qy: 0, qz: 0, qw: 1 },
    vx: 5, vy: 0, vz: -3, wx: 0, wy: .25, wz: 0 };
  const cp = { x: 40, y: 4, z: 40, yaw: 0, size: 1, out: false, air: false, awake: true, ticks: 0, state: doll().checkpoint(), carrier };
  for (const encode of [packCorpseCheckpoint, encodeCorpseCheckpoint]) {
    const data = encode(cp);
    expect(decodeCorpseCheckpoint(data)?.carrier).toEqual(carrier);
    for (const offset of [45, 97, 105]) {
      const bad = data.slice(), view = new DataView(bad.buffer);
      if (offset === 45) view.setUint32(45, 0, true);
      else if (offset === 97) view.setFloat64(97, 2, true);
      else view.setFloat32(105, NaN, true);
      expect(decodeCorpseCheckpoint(bad)).toBeNull();
    }
  }
});
