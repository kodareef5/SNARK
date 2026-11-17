import { expect, test } from "bun:test";
import { mountCameraHeight } from "../../client/core/mount-camera.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Viewpoint } from "../../client/core/viewpoint.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { Body, BTN_CROUCH, BTN_PRONE, MF_OUT, STANCE_PRONE, STANCE_STAND, stepBody } from "../../shared/sim/character.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { flatWorld } from "../fixtures/world.ts";

test("creature ground stance ignores rider crouch/prone in shared simulation; unconsciousness and survivor stance still work", () => {
  const world = flatWorld();
  for (const species of ["raptor", "parasaur", "pteranodon"]) {
    const body = new Body(), params = world.reg.tamedMove[world.kind(`core:${species}`)]!;
    body.x = body.z = 60; body.grounded = true;
    for (const buttons of [BTN_CROUCH, BTN_PRONE, BTN_CROUCH | BTN_PRONE]) {
      stepBody(world, body, 0, 0, 0, 0, buttons, params, TICK_DT);
      expect(body.stance).toBe(STANCE_STAND);
    }
    body.mflags |= MF_OUT;
    stepBody(world, body, 0, 0, 0, 0, 0, params, TICK_DT);
    expect(body.stance).toBe(STANCE_PRONE);
  }
  const body = new Body(); body.x = body.z = 60; body.grounded = true;
  stepBody(world, body, 0, 0, 0, 0, BTN_PRONE, world.reg.move[world.kind("core:survivor")]!, TICK_DT);
  expect(body.stance).toBe(STANCE_PRONE);
});

test("a clipping mount camera starts below the roof for every look direction and regains its desired height outdoors", () => {
  const world = flatWorld(), ceiling = world.kind("core:ceiling"), view = new Viewpoint(), cam = new Camera();
  for (let x = 50; x <= 80; x += 3) for (let z = 50; z <= 80; z += 3) world.structs.add(ceiling, x, 3.1, z, 0, 0, 1);
  const pivot = mountCameraHeight(world, 65, 65, 1.1, 4);
  expect(pivot).toBeCloseTo(2.7, 3);
  for (let bearing = 0; bearing < 16; bearing++) for (const pitch of [-1.3, -.6, 0, .6, 1.1]) {
    view.placeVehicle(cam, world, 65, pivot, 65, bearing * Math.PI / 8, pitch, 0, 0, 16, false, { vx: 0, vy: 0, vz: 0, boom: 10 });
    expect(cam.y).toBeLessThan(3);
  }
  expect(mountCameraHeight(world, 90, 90, 1.1, 4)).toBe(4);
});

test("a rider's oxygen eye follows the current posed mount before pin, and post-contact pin preserves its occupied seat", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(2)) });
  try {
    const session = h.join("collision-rider"); h.run(400);
    const c = h.client(session)!, { ents, reg } = h.world, rider = h.host.records.byPid.get(c.pid)!;
    const e = h.host.spawnCreature("core:parasaur", 70, 65, 1), rec = h.host.records.byPid.get(ents.pid[e]!)!;
    rec.team = rider.team; rec.saddle = reg.index.get("core:saddle_parasaur")!;
    h.host.refreshBody(rec); h.host.creatures.claimed(e); h.host.creatures.mind.stay(e, 0xffffffff);
    ents.setPosition(c.ent, 68, 0, 65);
    expect(h.host.riding.mount(c, e)).toBe(RESULT_OK);
    h.run(180);
    expect(h.host.riding.riding(c)).toBe(true);
    const eye = new Float64Array(3);
    expect(h.host.riding.eye(c.ent, eye)).toBe(true);
    const oldEye = eye[1]!, oldFeet = ents.y[c.ent]!, oldX = ents.x[c.ent]!;
    ents.setPosition(e, ents.x[e]! + 3, ents.y[e]! + 2, ents.z[e]!);
    ents.vx[e] = 7;
    expect(h.host.riding.eye(c.ent, eye)).toBe(true);
    expect(eye[1]! - oldEye).toBeCloseTo(2, 5);
    expect(ents.y[c.ent]).toBe(oldFeet);
    h.host.riding.syncAfterContact(e);
    expect(ents.y[c.ent]! - oldFeet).toBeCloseTo(2, 5);
    expect(ents.x[c.ent]! - oldX).toBeCloseTo(3, 5);
    expect(ents.vx[c.ent]).toBe(7);
    expect(ents.seat[c.ent]).toBe(e + 1);
    expect(h.host.riding.occupancy.pending(c.pid)).toBeNull();
  } finally { h.host.shutdown(); }
});
