import { expect, test } from "bun:test";
import { ladder } from "../../client/core/governor.ts";
import type { OwnBody } from "../../client/core/render/scene.ts";
import { forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { WaterTrails } from "../../client/core/render/water-trails.ts";
import { beachWash, swashFrame } from "../../client/core/render/swash.ts";
import { FRAME_FLOATS, WATER_MARKS, WATER_MARK_COUNT, WATER_PATHS } from "../../client/core/render/packet.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { MODE_SWIM } from "../../shared/sim/character.ts";
import { flatWorld } from "../fixtures/world.ts";

function coast(boat = true) {
  const { reg, hf } = flatWorld(4);
  hf.seaLevel = 3;
  const r = new RemoteSample();
  r.count = 1;
  r.id[0] = 14;
  r.gen[0] = 2;
  r.kind[0] = reg.index.get(boat ? "core:boat" : "core:survivor")!;
  r.x[0] = 40;
  r.y[0] = boat ? 2.7 : 3.9;
  r.z[0] = 40;
  const f = new Float32Array(FRAME_FLOATS),
    trail = new WaterTrails(reg);
  const eye = { x: 40, y: 7, z: 42 };
  const step = (t: number, budget = 12) => {
    trail.frame(f, hf, eye, null, r, t, budget);
    return f[WATER_MARK_COUNT]!;
  };
  return { reg, hf, r, f, eye, step };
}

test("a turning hull leaves its old crease in world space, including after it leaves the view; its wake then expires", () => {
  const { r, f, eye, step } = coast();
  step(0);
  for (let i = 1; i <= 4; i++) {
    r.z[0]! += 1;
    step(i / 8);
  }
  expect(f[WATER_MARK_COUNT]).toBeGreaterThan(0);
  const oldX = f[WATER_MARKS]! + eye.x,
    oldZ = f[WATER_MARKS + 1]! + eye.z;
  for (let i = 5; i <= 8; i++) {
    r.x[0]! += 1;
    step(i / 8);
  }
  expect(f[WATER_MARKS + 2]).toBeGreaterThan(0);
  expect(f[WATER_MARKS + 3]).toBe(0);
  r.count = 0;
  eye.x += 3;
  step(1.25);
  expect(f[WATER_MARKS + 8]! + eye.x).toBeCloseTo(oldX);
  expect(f[WATER_MARKS + 9]! + eye.z).toBeCloseTo(oldZ);
  for (let t = 1.5; t < 5; t += 0.25) step(t);
  expect(f[WATER_MARK_COUNT]).toBe(0);
});

test("an impact leaves one widening ring; swimming and near-surface jet flight leave directional traces", () => {
  const { r, f, step } = coast(false);
  step(0);
  r.y[0] = 2.8;
  step(0.125);
  expect(f[WATER_MARK_COUNT]).toBe(1);
  expect(f[WATER_MARKS + 7]).toBeLessThan(0);
  const st = new AnimState();
  st.mode = MODE_SWIM;
  st.grounded = false;
  r.anim[0] = st.pack();
  for (let i = 2; i <= 8; i++) {
    r.z[0]! += 0.25;
    step(i / 8);
  }
  expect(f[WATER_MARKS + 7]).toBeGreaterThan(0);
  r.y[0] = 4;
  r.gen[0] = 3;
  st.mode = 0;
  st.jet = true;
  r.anim[0] = st.pack();
  r.cue[0] = st.packCue();
  step(1.125, 0);
  step(1.25);
  for (let i = 11; i <= 16; i++) {
    r.x[0]! += 0.625;
    step(i / 8);
  }
  expect(f[WATER_MARK_COUNT]).toBeGreaterThan(0);
  expect(f[WATER_MARKS + 6]).toBeCloseTo(0.32);
  r.y[0] = 6;
  step(2.125, 0);
  step(2.25);
  for (let i = 19; i <= 27; i++) {
    r.x[0]! += 0.625;
    step(i / 8);
  }
  expect(f[WATER_MARK_COUNT]).toBe(0);
});

test("teleports, reused IDs, tipped or beached hulls, a disabled tier and rewound clocks cannot draw a false trail", () => {
  const { r, f, step, hf } = coast();
  step(0);
  r.x[0] = 65;
  expect(step(0.125)).toBe(0);
  r.gen[0]++;
  r.x[0] = 68;
  expect(step(0.25)).toBe(0);
  r.vehicleRoll[0] = Math.PI;
  for (let i = 3; i < 12; i++) {
    r.x[0]! += 1;
    step(i / 8);
  }
  expect(f[WATER_MARK_COUNT]).toBe(0);
  r.vehicleRoll[0] = 0;
  hf.seaLevel = -1;
  r.y[0] = -1.2;
  for (let i = 12; i < 21; i++) {
    r.z[0]! += 1;
    step(i / 8);
  }
  expect(f[WATER_MARK_COUNT]).toBe(0);
  hf.seaLevel = 3;
  r.y[0] = 2.7;
  for (let i = 21; i < 47; i++) {
    r.z[0]! += 0.7;
    expect(step(i / 8, 2)).toBeLessThanOrEqual(2);
  }
  expect(f[WATER_MARK_COUNT]).toBe(2);
  expect(step(0)).toBe(0);
});

test("the wash moves along the same beach in world space, while deep water, flat shelves, cliffs and coarse depths stay quiet", () => {
  const f = new Float32Array(FRAME_FLOATS);
  const shore = (d: number, g: number, fine = 1) => beachWash(f, 3, 6, d, fine, g, 0, 8);
  const depths: number[] = [];
  for (let t = 0; t < 12; t += 0.25) {
    swashFrame(f, 12, 30, t);
    depths.push(shore(0.11, 0.05).depth);
  }
  expect(Math.min(...depths)).toBe(0);
  expect(Math.max(...depths)).toBeGreaterThan(0.105);
  for (const w of [shore(0.1, 0), shore(0.1, 1), shore(0.1, 0.05, 0), shore(5, 0.05)])
    expect([w.slopeX, w.film, w.lace]).toEqual([0, 0, 1]);
  swashFrame(f, 12, 30, 2);
  const before = shore(0.14, 0.05);
  swashFrame(f, 18, 32, 2);
  expect(beachWash(f, -3, 4, 0.14, 1, 0.05, 0, 8).depth).toBeCloseTo(before.depth, 6);
});

test("a locally predicted boat has priority and its network echo and seated rider cannot double the wake", () => {
  const { reg, hf } = flatWorld(4);
  hf.seaLevel = 3;
  const r = new RemoteSample(),
    frame = new Float32Array(FRAME_FLOATS);
  const local: OwnBody = {
    id: 3,
    generation: 1,
    kind: reg.index.get("core:boat")!,
    x: 40,
    y: 2.75,
    z: 40,
    yaw: 0,
    state: new AnimState(),
    tick: 0,
    firstPerson: false,
    colors: new Uint8Array(6),
    look: null,
    gear: new Uint16Array(0),
  };
  const eye = { x: 42, y: 5, z: 40 };
  const withEcho = new WaterTrails(reg),
    alone = new WaterTrails(reg);
  const reference = new Float32Array(FRAME_FLOATS);
  r.count = 3;
  r.id.set([3, 5, 6]);
  r.gen.fill(1, 0, 3);
  r.kind.set([local.kind, reg.index.get("core:survivor")!, local.kind]);
  r.seat[1] = 4;
  r.x.set([40, 40, 42]);
  r.y.set([2.75, 3, 2.75]);
  const cap = forTouch(tierOf("high"), true).waterMarks;
  expect(cap).toBe(4);
  expect(tierOf("lowpoly").waterMarks).toBe(0);
  for (let i = 0; i < 12; i++) {
    local.z = 40 + i;
    r.z.set([local.z, local.z, 40 + i * 0.25]);
    local.tick = i * 4;
    withEcho.frame(frame, hf, eye, local, r, i / 8, cap);
    alone.frame(reference, hf, eye, local, null, i / 8, cap);
    expect(frame).toEqual(reference);
  }
  expect(frame[WATER_MARK_COUNT]).toBeGreaterThan(0);
});

test("on touch a swimmer treading water or a pilot high overhead leaves the wake budget to a passing hull", () => {
  const { reg, hf, r, f, eye } = coast();
  const local: OwnBody = {
    id: 3,
    kind: reg.index.get("core:survivor")!,
    x: 41,
    y: 2.8,
    z: 41,
    yaw: 0,
    state: new AnimState(),
    tick: 0,
    firstPerson: false,
    colors: new Uint8Array(6),
    look: null,
    gear: new Uint16Array(0),
  };
  for (const altitude of [2.8, 6]) {
    const trails = new WaterTrails(reg);
    local.y = altitude;
    for (let i = 0; i < 9; i++) {
      r.z[0] = 40 + i;
      trails.frame(f, hf, eye, local, r, i / 8, 4);
    }
    expect(f[WATER_MARK_COUNT]).toBeGreaterThan(0);
    expect(f[WATER_MARKS + 6]).toBeGreaterThan(0.4);
  }
});

test("the governor gives back wake work without spending beyond the device's original budget", () => {
  for (const base of [tierOf("high"), forTouch(tierOf("high"), true), tierOf("lowpoly")]) {
    const budgets = ladder(base, 2).map((step) => step.tier.waterMarks);
    expect(budgets[0]).toBe(base.waterMarks);
    expect(budgets.at(-1)).toBe(0);
    for (let i = 1; i < budgets.length; i++) expect(budgets[i]!).toBeLessThanOrEqual(budgets[i - 1]!);
  }
});

test("a swimmer's live trail stays at the rendered body between samples and a skimming pilot has its own pressure profile", () => {
  for (const jet of [false, true]) {
    const { r, f, eye, step } = coast(false),
      state = new AnimState();
    state.mode = jet ? 0 : MODE_SWIM;
    state.jet = jet;
    state.grounded = false;
    state.setMotion(0, 4, 0, 0);
    r.anim[0] = state.pack();
    r.cue[0] = state.packCue();
    r.y[0] = jet ? 3.35 : 2.3;
    step(0);
    r.z[0] = 40.5;
    step(0.125);
    r.z[0] = 40.75;
    step(0.1875);
    expect(f[WATER_MARK_COUNT]).toBe(1);
    expect(f[WATER_MARKS + 1]! + f[WATER_MARKS + 3]! + eye.z).toBeCloseTo(40.75);
    expect(f[WATER_MARKS + 7]).toBeGreaterThan(0.45);
    expect(f[WATER_PATHS + 3]).toBe(jet ? 2 : 1);
  }
});

test("a hull section ends at the stern and consecutive sections carry the turn, including across the yaw wrap", () => {
  const { r, reg, f, eye, step } = coast();
  const spec = reg.vehicle[r.kind[0]!]!;
  if (spec.movement !== "boat") throw Error("expected hull");
  const radius = 8,
    stern = 0.9 * spec.spec.halfLength;
  for (let i = 0; i <= 20; i++) {
    const t = i / 8,
      yaw = 2.95 + t * 0.8;
    r.x[0] = 40 - radius * Math.cos(yaw);
    r.z[0] = 40 + radius * Math.sin(yaw);
    r.yaw[0] = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    step(t);
  }
  expect(f[WATER_MARK_COUNT]).toBeGreaterThan(3);
  const yaw = r.yaw[0]!;
  expect(f[WATER_MARKS]! + f[WATER_MARKS + 2]! + eye.x).toBeCloseTo(r.x[0]! - stern * Math.sin(yaw), 4);
  expect(f[WATER_MARKS + 1]! + f[WATER_MARKS + 3]! + eye.z).toBeCloseTo(r.z[0]! - stern * Math.cos(yaw), 4);
  expect(f[WATER_PATHS + 3]).toBe(3);
  expect(Math.abs(f[WATER_PATHS + 6]! - f[WATER_PATHS + 5]!)).toBeGreaterThan(0.1);
});
