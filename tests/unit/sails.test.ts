import { expect, test } from "bun:test";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { Rng } from "../../shared/rng.ts";
import { MAX_SAIL_GROUPS, SAIL_TRAVEL_TICKS, decodeSailTransition, encodeSailTransition, readSails, sailTransition, sailsProgress, writeSails, type SailState } from "../../shared/sim/sails.ts";

test("sails take a full travel period, hold before a command and stop at each endpoint", () => {
  const up = sailTransition(0, 1, 100);
  expect(sailsProgress(up, 99.75)).toBe(0);
  expect(sailsProgress(up, 100)).toBe(0);
  expect(sailsProgress(up, 100 + SAIL_TRAVEL_TICKS / 4)).toBe(.25);
  expect(sailsProgress(up, 100 + SAIL_TRAVEL_TICKS / 2)).toBe(.5);
  expect(sailsProgress(up, 100 + SAIL_TRAVEL_TICKS)).toBe(1);
  expect(sailsProgress(up, 100 + 2 * SAIL_TRAVEL_TICKS)).toBe(1);
  const down = sailTransition(1, 0, 100);
  expect(sailsProgress(down, 100 + SAIL_TRAVEL_TICKS / 4)).toBe(.75);
  expect(sailsProgress(down, 100 + SAIL_TRAVEL_TICKS)).toBe(0);
  expect(sailsProgress(down, 100 + 2 * SAIL_TRAVEL_TICKS)).toBe(0);
});

test("repeated reversals retain the current position and the same travel speed across tick wrap", () => {
  const rng = new Rng(7951);
  let tick = 0xfffffe00, state = sailTransition(0, 1, tick);
  for (let i = 0; i < 300; i++) {
    tick += rng.int(SAIL_TRAVEL_TICKS);
    const before = sailsProgress(state, tick), target = state.target === 1 ? 0 : 1;
    state = sailTransition(before, target, tick);
    expect(Math.abs(sailsProgress(state, tick) - before)).toBeLessThanOrEqual(.5 / 65535 + 1e-12);
    const direction = target === 1 ? 1 : -1;
    for (const elapsed of [.25, 1, 13.5, SAIL_TRAVEL_TICKS]) {
      const expected = Math.max(0, Math.min(1, state.from + direction * elapsed / SAIL_TRAVEL_TICKS));
      expect(sailsProgress(state, tick + elapsed)).toBeCloseTo(expected, 12);
      expect(sailsProgress(state, ((tick + Math.floor(elapsed)) >>> 0) + elapsed % 1)).toBeCloseTo(expected, 12);
    }
  }
});

test("saved partial sails resume the same curve including a sliced component buffer", () => {
  const source = sailTransition(.3724, 0, 0xfffffff0), encoded = encodeSailTransition(source);
  const containing = new Uint8Array(encoded.length + 6); containing.set(encoded, 3);
  const restored = decodeSailTransition(containing.subarray(3, 3 + encoded.length));
  expect(restored).toEqual(source);
  for (const tick of [source.startedAt - .5, source.startedAt, 0, 82.75, 1000]) {
    expect(sailsProgress(restored!, tick)).toBe(sailsProgress(source, tick));
  }
  for (let length = 0; length < encoded.length; length++) expect(decodeSailTransition(encoded.subarray(0, length))).toBeNull();
  const unknown = encoded.slice(); unknown[0] = 255;
  const invalidTarget = encoded.slice(); invalidTarget[3] = 2;
  expect(decodeSailTransition(unknown)).toBeNull();
  expect(decodeSailTransition(invalidTarget)).toBeNull();
  expect(decodeSailTransition(new Uint8Array(encoded.length + 1))).toBeNull();
  expect(unknown[0]).toBe(255);
});

const frame = (ref = 3200): SailState => ({ ref, kind: 71, x: 1024, y: 0, z: 1000, yaw: 49152, ...sailTransition(.34, 1, 0xfffffff0) });
const packet = (states: readonly SailState[]) => {
  const w = new BitWriter(8192); writeSails(w, states);
  expect(w.overflow).toBe(false); return w.bytes().slice();
};
const valid = (kind: number, ref: number, x: number, y: number, z: number) => kind === 71 && ref < 10000 && x >= 0 && x < 2048 && y > -64 && y < 1024 && z >= 0 && z < 2048;
const decode = (bytes: Uint8Array) => readSails(new BitReader(bytes), valid);

test("scene replacement carries every independent rig and an explicit empty collection", () => {
  const states = Array.from({ length: MAX_SAIL_GROUPS }, (_, i) => ({ ...frame(3200 + i), x: 50 + i * 8, yaw: i * 512, ...sailTransition(i / MAX_SAIL_GROUPS, (i % 2) as 0 | 1, 1000 + i) }));
  const received = decode(packet(states));
  expect(received).toEqual(states);
  expect(Object.isFrozen(received)).toBe(true);
  expect(received!.every(Object.isFrozen)).toBe(true);
  expect(decode(packet([]))).toEqual([]);
});

test("malformed sail collections are rejected whole, including invalid later entries", () => {
  const bytes = packet([frame(), frame(3201)]);
  for (let length = 0; length < bytes.length; length++) expect(decode(bytes.subarray(0, length))).toBeNull();
  const trailing = new Uint8Array(bytes.length + 1); trailing.set(bytes);
  expect(decode(trailing)).toBeNull();
  const version = bytes.slice(); version[0] = 255;
  expect(decode(version)).toBeNull();
  const tooMany = bytes.slice(); tooMany[1] = MAX_SAIL_GROUPS + 1;
  expect(decode(tooMany)).toBeNull();
  expect(decode(packet([frame(), frame()]))).toBeNull();
  for (const override of [{ kind: 72 }, { ref: 10000 }, { x: -1 }, { z: 2048 }, { y: NaN }, { x: Infinity }, { z: -Infinity }, { target: 2 as 0 | 1 }]) {
    expect(decode(packet([frame(), { ...frame(3201), ...override }]))).toBeNull();
  }
});
