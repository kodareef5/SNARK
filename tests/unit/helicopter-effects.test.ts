import { expect, test } from "bun:test";
import { Details } from "../../client/core/details/details.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { FramePacket } from "../../client/core/render/packet.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { CreatureAnim } from "../../shared/anim/creature.ts";
import { AnimState, LAYER_FLINCH } from "../../shared/anim/pose.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import type { Corpse } from "../../client/core/ragdoll.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { effectOf, type PackDetails } from "../../shared/pack/details.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { parseMap, writeMap } from "../../shared/world/mapfile.ts";
import { createMapWorld } from "../../server/world.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { flatMap } from "../fixtures/map.ts";
import { ACT_SWING, HOLD_TOOL } from "../../shared/sim/weapon.ts";

const reg = coreRegistry(), helicopter = reg.index.get("core:helicopter")!;
const rig = buildRig({ id: "core:helicopter", skeleton: "core:helicopter", names: ["chassis"], parent: [-1], rest: [0, 0, 0], sockets: [{ name: "rotor_main", bone: 0, x: 0, y: 3.15, z: -.3 }, { name: "exhaust", bone: 0, x: 0, y: 2.55, z: -1.65 }] }, NO_CLIPS)!;
const art: PackDetails = {
  atlas: { offset: 0, side: 128 }, inputs: "test", pictures: [{ id: "test:particle", cell: 0, regions: [-1, -1], grey: 1, flat: 1 }],
  effects: ["dust", "spray", "smoke"].map(name => effectOf(`test:${name}`, { pictures: ["particle"], count: 1, shape: "point", life: 1, size: .2, colour: [140, 140, 140], speed: 0, gravity: 0, reach: 90 }, () => 0)),
  sheets: [{ owner: "core:helicopter", cues: { rotor_wash: { effects: [{ effect: 0, from: "ground", at: "now", on: [0, 1, 2, 4] }, { effect: 1, from: "ground", at: "now", on: [3] }] }, engine_smoke: { effects: [{ effect: 2, from: "exhaust", at: "now" }] }, struck: { effects: [{ effect: 2, from: "exhaust", at: "now" }] }, death: { effects: [{ effect: 2, from: "exhaust", at: "now" }] } } }],
};
function fixture(water = false, roof = false, sheet = art) {
  const statics = [];
  if (roof) for (let x = -3; x <= 3; x += 3) for (let z = -3; z <= 3; z += 3) statics.push({ kind: "core:ceiling", x: 64 + x, y: 8, z: 64 + z, yaw: 0 });
  const world = createMapWorld(reg, parseMap(writeMap(flatMap(2, { statics, seaLevel: water ? 2 : -Infinity }))));
  const details = new Details(reg, sheet, defaultPalette(), kind => kind === helicopter ? new CreatureAnim(rig, .01, 0) : null), remote = new RemoteSample();
  remote.count = 1; remote.id[0] = 9; remote.gen[0] = 1; remote.kind[0] = helicopter; remote.x[0] = remote.z[0] = 64; remote.y[0] = roof ? 8.12 : water ? 2.5 : .1;
  remote.vehicleQw[0] = 1; remote.vehicleRotorRpm[0] = 410; remote.vehicleEngineCondition[0] = 1;
  const cam = new Camera(); cam.x = 64; cam.y = remote.y[0]! + 3; cam.z = 54; cam.aspect = 16 / 9; cam.update();
  const packet = new FramePacket(), tier = tierOf("medium");
  const frame = (tick: number, corpses: Corpse[] = []) => { remote.tick = tick; packet.detailCount = 0; details.frame(packet, cam, remote, corpses, [], null, world.hf, tier, tick * 1000 / 30, world); };
  return { details, remote, frame, world };
}

test("rotor wash chooses the actual roof or water surface and never makes dust over water", () => {
  for (const [water, roof] of [[false, false], [true, false], [false, true]] as const) {
    const { details, frame } = fixture(water, roof); frame(0);
    expect(details.pool.count).toBe(1); expect(details.pool.effect[0]).toBe(water ? 1 : 0);
    expect(details.pool.y[0]!).toBeCloseTo((roof ? 8 + reg.halfY[reg.index.get("core:ceiling")!]! : water ? 2 : 0) + .04, 3);
    frame(0); expect(details.pool.count).toBe(1);
  }
});

test("a strike sheds chips from the oriented cabin surface facing the attacker", () => {
  const sheet: PackDetails = { ...art, sheets: [{ owner: "core:helicopter", cues: { struck: { effects: [{ effect: 2, from: "hit", at: "now" }] } } }] };
  const { details, remote, frame } = fixture(false, false, sheet);
  remote.y[0] = 20; remote.vehicleQz[0] = 1; remote.vehicleQw[0] = 0; remote.vehicleRotorRpm[0] = 0; frame(0);
  const st = new AnimState(); st.layer = LAYER_FLINCH; st.layerStart = 1;
  remote.anim[0] = st.pack(); remote.cue[0] = st.packCue();
  const attack = new AnimState(); attack.setAction(ACT_SWING, HOLD_TOOL, 1);
  remote.count = 2; remote.id[1] = 20; remote.kind[1] = reg.index.get("core:survivor")!;
  remote.x[1] = 66; remote.y[1] = 17; remote.z[1] = 64; remote.anim[1] = attack.pack(); remote.cue[1] = attack.packCue();
  frame(1);
  expect(details.pool.count).toBe(1);
  expect(details.pool.x[0]).toBeCloseTo(65.25, 4); expect(details.pool.y[0]).toBeCloseTo(17.83875, 4);
});

test("impact and wreck socket effects follow the same inverted frame as the rendered aircraft", () => {
  const { details, remote, frame } = fixture();
  remote.y[0] = 20; remote.vehicleQz[0] = 1; remote.vehicleQw[0] = 0; remote.vehicleRotorRpm[0] = 0;
  frame(0);
  const st = new AnimState(); st.layer = LAYER_FLINCH; st.layerStart = 1;
  remote.anim[0] = st.pack(); remote.cue[0] = st.packCue(); frame(1);
  expect(details.pool.count).toBe(1);
  expect(details.pool.y[0]).toBeCloseTo(17.45, 4); expect(details.pool.z[0]).toBeCloseTo(62.35, 4);
  const solved = new Solved(rig.bones); solve(rig, rig.a, solved);
  const corpse: Corpse = { kind: helicopter, id: 99, x: 66, y: 22, z: 64, yaw: 0, rigid: true, qx: 0, qy: 0, qz: 1, qw: 0, size: 1, colors: new Uint8Array(6), born: 2, watched: true, lying: false, falling: true, landed: 0, decay: 0, alive: null, limp: true, fall: null, clock: 2, settling: false, solved, seen: 1 };
  frame(2, [corpse]);
  expect(details.pool.count).toBe(2);
  expect(details.pool.x[1]).toBeCloseTo(66, 4); expect(details.pool.y[1]).toBeCloseTo(19.45, 4); expect(details.pool.z[1]).toBeCloseTo(62.35, 4);
});

test("damaged engine smoke follows an inverted exhaust and continuous emitters stop and remain bounded", () => {
  const { details, remote, frame } = fixture();
  remote.y[0] = 20; remote.vehicleQz[0] = 1; remote.vehicleQw[0] = 0; remote.vehicleEngineCondition[0] = .4;
  frame(0); expect(details.pool.count).toBe(1); expect(details.pool.effect[0]).toBe(2);
  expect(details.pool.y[0]).toBeCloseTo(17.45, 4); expect(details.pool.z[0]).toBeCloseTo(62.35, 4);
  for (let tick = 1; tick <= 300; tick++) frame(tick);
  expect(details.pool.count).toBeLessThanOrEqual(4);
  remote.vehicleRotorRpm[0] = 0;
  for (let tick = 301; tick <= 360; tick++) frame(tick);
  expect(details.pool.count).toBe(0);
});
