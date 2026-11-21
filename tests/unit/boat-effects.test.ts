import { expect, test } from "bun:test";
import { Details } from "../../client/core/details/details.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { wakeFoam } from "../../client/core/render/detailtext.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { DETAIL_WAKE, FramePacket } from "../../client/core/render/packet.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { AnimState, LAYER_FLINCH } from "../../shared/anim/pose.ts";
import { CreatureAnim } from "../../shared/anim/creature.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { effectOf, type PackDetails } from "../../shared/pack/details.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { parseMap, writeMap } from "../../shared/world/mapfile.ts";
import { createMapWorld } from "../../server/world.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { flatMap } from "../fixtures/map.ts";

const reg = coreRegistry(), boat = reg.index.get("core:boat")!;
const rig = buildRig({ id: "core:boat", skeleton: "core:boat", names: ["chassis", "outboard"], parent: [-1, 0], rest: [0, 0, 0, 0, .98, -3.48], sockets: [
  { name: "wake_left", bone: 0, x: .84, y: .6, z: -3.05 }, { name: "wake_right", bone: 0, x: -.84, y: .6, z: -3.05 },
  { name: "spray_left", bone: 0, x: 1.04, y: .6, z: .95 }, { name: "spray_right", bone: 0, x: -1.04, y: .6, z: .95 },
  { name: "engine", bone: 1, x: 0, y: .38, z: -.22 },
] }, NO_CLIPS)!;
const art: PackDetails = {
  atlas: { offset: 0, side: 128 }, inputs: "test", pictures: [{ id: "test:particle", cell: 0, regions: [-1, -1], grey: 1, flat: 1 }],
  effects: ["wake", "spray", "smoke"].map(name => effectOf(`test:${name}`, { pictures: ["particle"], count: 1, shape: "point", life: 1, size: .2, colour: [240, 240, 240], speed: 0, gravity: 0, reach: 90 }, () => 0)),
  sheets: [{ owner: "core:boat", cues: {
    boat_wake: { effects: ["wake_left", "wake_right"].map(from => ({ effect: 0, from, at: "now", on: [3] })) },
    boat_spray: { effects: ["spray_left", "spray_right"].map(from => ({ effect: 1, from, at: "now", on: [3] })) },
    engine_smoke: { effects: [{ effect: 2, from: "engine", at: "now" }] },
  } }],
};
function fixture(sheet = art) {
  const world = createMapWorld(reg, parseMap(writeMap(flatMap(2, { seaLevel: 3 }))));
  const details = new Details(reg, sheet, defaultPalette(), kind => kind === boat ? new CreatureAnim(rig, .01, 0) : null), remote = new RemoteSample();
  remote.count = 1; remote.id[0] = 9; remote.gen[0] = 1; remote.kind[0] = boat;
  remote.x[0] = remote.z[0] = 64; remote.y[0] = 2.65; remote.vehicleQw[0] = 1; remote.vehicleEngineCondition[0] = 1;
  const cam = new Camera(); cam.x = 64; cam.y = 6; cam.z = 54; cam.aspect = 16 / 9; cam.update();
  const packet = new FramePacket(), tier = tierOf("medium");
  const frame = (tick: number) => { remote.tick = tick; packet.detailCount = 0; details.frame(packet, cam, remote, [], [], null, world.hf, tier, tick * 1000 / 30, world); };
  return { details, remote, frame, world };
}

test("moving boat wakes resolve both native sockets onto visible water, never duplicate a cue at each socket", () => {
  const { details, remote, frame } = fixture(); frame(0); expect(details.pool.count).toBe(0);
  remote.z[0] = 65; frame(4); expect(details.pool.count).toBe(4);
  expect(Array.from(details.pool.effect.subarray(0, 4))).toEqual([0, 0, 1, 1]);
  for (let i = 0; i < 4; i++) expect(details.pool.y[i]).toBeCloseTo(3.025, 4);
  expect(details.pool.x[0]).toBeCloseTo(64.84, 4); expect(details.pool.x[1]).toBeCloseTo(63.16, 4);
  frame(4); expect(details.pool.count).toBe(4);
  for (let tick = 5; tick < 45; tick++) frame(tick);
  expect(details.pool.count).toBe(0);
});

test("marine emitters reject land, airborne and sunken hulls, inverted frames and teleport trails", () => {
  for (const mode of ["land", "air", "sunk", "inverted", "teleport"] as const) {
    const { details, remote, frame, world } = fixture(); frame(0);
    if (mode === "land") world.hf.seaLevel = -Infinity;
    if (mode === "air") remote.y[0] = 5;
    if (mode === "sunk") remote.y[0] = 1;
    if (mode === "inverted") { remote.vehicleQw[0] = 0; remote.vehicleQz[0] = 1; }
    remote.z[0] = mode === "teleport" ? 100 : 65;
    frame(4); expect(details.pool.count).toBe(0);
  }
});

test("damaged outboard smoke follows its steering joint, stops underwater, and bounded wakes do not catch up after a stall", () => {
  const { details, remote, frame } = fixture();
  remote.vehicleEngineCondition[0] = .4; remote.vehicleEngineOn[0] = 1; remote.steering[0] = .55;
  frame(0); expect(details.pool.count).toBe(1);
  expect(details.pool.x[0]).toBeCloseTo(64 + Math.sin(.55) * .22, 4);
  expect(details.pool.y[0]).toBeCloseTo(4.01, 4);
  remote.vehicleEngineOn[0] = 0;
  for (let tick = 1; tick <= 300; tick++) { remote.z[0] = 64 + tick / 5; frame(tick); }
  expect(details.pool.count).toBeLessThanOrEqual(36);
  const before = details.pool.count; remote.z[0] = 127; frame(600); expect(details.pool.count).toBeLessThanOrEqual(before);
  for (let tick = 601; tick < 645; tick++) frame(tick); expect(details.pool.count).toBe(0);
  remote.y[0] = 0; remote.vehicleEngineOn[0] = 1; frame(650); expect(details.pool.count).toBe(0);
});


test("a floating hull surface cue starts on visible water rather than its submerged keel", () => {
  const sheet: PackDetails = { ...art, sheets: [{ owner: "core:boat", cues: { struck: { effects: [{ effect: 0, from: "ground", at: "now", on: [3] }] } } }] };
  const { details, remote, frame } = fixture(sheet); frame(0);
  const state = new AnimState(); state.layer = LAYER_FLINCH; state.layerStart = 1;
  remote.anim[0] = state.pack(); remote.cue[0] = state.packCue(); frame(1);
  expect(details.pool.count).toBe(1); expect(details.pool.y[0]).toBeCloseTo(3.025, 4);
});

test("stern foam is seeded and flows out of the hull, with the outside wake and bow spray stronger through a turn", () => {
  const effects = [...art.effects];
  effects[0] = { ...effects[0]!, face: "flat", pass: "blend", speed: [0.2,0.2] };
  effects[1] = { ...effects[1]!, speed: [2,2], up: .6 };
  const { details, remote, frame } = fixture({...art, effects});
  frame(0);
  let count = 0;
  for (let i=1;i<=5;i++) {
    const a=i*.13;
    remote.x[0]=64+8*(1-Math.cos(a)); remote.z[0]=64+8*Math.sin(a);
    remote.yaw[0]=a;remote.vehicleQy[0]=Math.sin(a/2);remote.vehicleQw[0]=Math.cos(a/2);
    count = details.pool.count; frame(i*4);
  }
  const pool = details.pool;
  expect(pool.count-count).toBe(4);
  for(let i=count;i<count+2;i++) {
    expect(pool.flags[i]).toBe(DETAIL_WAKE);
    expect(pool.widthScale[i]).toBeLessThan(.7);
  }
  const outward=(i:number)=>pool.vx[i]!*Math.cos(.65)-pool.vz[i]!*Math.sin(.65);
  expect(outward(count)).toBeGreaterThan(0);
  expect(outward(count+1)).toBeLessThan(-outward(count));
  expect(pool.vy[count+3]).toBeGreaterThan(pool.vy[count+2]!);
  const a=[0,0,0],b=[0,0,0];
  wakeFoam(0,.4,.2,a);wakeFoam(0,.4,.82,b);
  expect(Math.abs(a[0]!-b[0]!)).toBeGreaterThan(.01);
  wakeFoam(0,1,.2,a);expect(a[0]).toBe(0);
});
