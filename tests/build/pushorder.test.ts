// A client predicts its body with the structures it was sent, a server steps it with the structures as they were built. The two hold
// the same pieces in a different order, and the body must come out the same to the last bit.

import { expect, test } from "bun:test";
import { FOUNDATION_THICK } from "../../content/building.ts";
import { STRUCT_UNITS, TICK_DT } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_CROUCH, BTN_JUMP, BTN_SPRINT, Body, stepBody } from "../../shared/sim/character.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { HALF_SIDE, frameAxes, poseAt, type Pose } from "../../shared/world/snap.ts";
import { flatWorld, type TestWorld } from "../fixtures/world.ts";

const U = STRUCT_UNITS;
const YAW = 3000;

test("a body pushed out of two pieces at once ends in the same place whatever order the pieces were stored in", () => {
  const built = flatWorld(4);
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const join = (target: number, piece: string, k: number): number => {
    expect(poseAt(built.structs, built.reg, target, built.kind(`core:${piece}`), k, 0, pose)).toBe(true);
    return built.structs.add(built.kind(`core:${piece}`), pose.x / U, pose.y / U, pose.z / U, pose.yaw, 7, 1);
  };
  // Pieces that stood in this chunk before and are gone leave their slots to the next ones built, last freed first. So the
  // room below is built into slots in falling order, as a base rebuilt on a server is.
  const before: number[] = [];
  for (let k = 0; k < 8; k++) before.push(built.structs.add(built.kind("core:pillar_stone"), 70 + k * 2, 1.5, 70, 0, 7, 1));
  for (const ref of before) built.structs.remove(ref);
  // A room on one foundation: a doorway, three walls, a pillar in the middle and a ceiling, with a second foundation outside the door.
  const floor = built.structs.add(built.kind("core:foundation_stone"), 100, FOUNDATION_THICK / 2, 100, YAW, 7, 1);
  join(floor, "doorframe_stone", 0);
  const side = join(floor, "wall_stone", 1);
  join(floor, "wall_stone", 2);
  join(floor, "wall_stone", 3);
  join(floor, "pillar_stone", 0);
  join(side, "ceiling_stone", 1);
  expect(join(floor, "foundation_stone", 0) & 0xffff).toBe(0);

  // The same rows as a client holds them: applied slot by slot.
  const sent = flatWorld(4);
  const from = built.structs.chunks;
  for (let chunk = 0; chunk < from.length; chunk++) {
    const t = from[chunk];
    if (!t) continue;
    for (let slot = 0; slot < t.high; slot++) sent.structs.put(chunk, slot, t.kind[slot]!, t.x[slot]!, t.y[slot]!, t.z[slot]!, t.yaw[slot]!, t.owner[slot]!, t.hp[slot]!, t.mod[slot]!);
    sent.structs.setVersion(chunk, t.version);
  }

  const p = built.reg.move[built.kind("core:survivor")]!;
  const axes = new Int32Array(4);
  frameAxes(YAW, axes);
  let tries = 0;
  const walk = (w: TestWorld, seed: number): string => {
    const rng = new Rng(seed);
    const b = new Body();
    // In one of the room's four quarters, clear of the pillar and the walls.
    const i = rng.int(2) === 0 ? -0.8 : 0.8;
    const j = rng.int(2) === 0 ? -0.8 : 0.8;
    b.x = 100 + (i * axes[0]! + j * axes[2]!) / HALF_SIDE;
    b.z = 100 + (i * axes[1]! + j * axes[3]!) / HALF_SIDE;
    b.y = FOUNDATION_THICK;
    b.grounded = true;
    if (tries++ === 0) expect(capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)).toBe(true);
    let moveX = 0;
    let moveZ = 0;
    let yaw = 0;
    let buttons = 0;
    const trail: number[] = [];
    for (let tick = 0; tick < 120; tick++) {
      if (tick % 8 === 0) {
        moveX = rng.int(255) - 127;
        moveZ = rng.int(255) - 127;
        yaw = rng.int(65536);
        buttons = (rng.int(3) === 0 ? BTN_SPRINT : 0) | (rng.int(6) === 0 ? BTN_JUMP : 0) | (rng.int(8) === 0 ? BTN_CROUCH : 0);
      }
      stepBody(w, b, moveX, moveZ, yaw, 0, buttons, p, TICK_DT);
      trail.push(b.x, b.y, b.z, b.vx, b.vy, b.vz);
    }
    return trail.join(" ");
  };
  let apart = 0;
  for (let seed = 1; seed <= 60; seed++) if (walk(built, seed) !== walk(sent, seed)) apart++;
  expect(apart).toBe(0);
});
