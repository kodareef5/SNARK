import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { BTN_USE, MODE_SWIM, stanceEye } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { RESULT_FAR, RESULT_OK } from "../../shared/net/protocol.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { boatCourse } from "../../tools/boat/course.ts";
import { Harness } from "../fixtures/net.ts";

function setup() {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(boatCourse()) });
  const s = h.join("dock-pilot"); h.run(400);
  const c = h.client(s)!, ents = h.world.ents, actor = h.host.records.byPid.get(c.pid)!;
  const boat = h.host.spawnVehicle("core:boat", 128, 94, actor.team);
  ents.setPosition(c.ent, 130.25, .55, 89.1); c.ownDirty = true; h.run(300);
  return { h, c, ents, boat };
}
function use(h: Harness, e: number, boat: number): void {
  const ents = h.world.ents, pilot = h.pilots[0]!, move = h.reg.move[ents.kind[e]!]!;
  const dx = ents.x[boat]! + 1.03 - ents.x[e]!, dz = ents.z[boat]! - 3.4 - ents.z[e]!;
  const dy = ents.y[boat]! + .73 - (ents.y[e]! + stanceEye(move, ents.stance[e]!));
  pilot.yaw = Math.atan2(dx, dz); pilot.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  pilot.buttons = BTN_USE; h.run(100); pilot.buttons = 0; h.run(1200);
}

test("a grounded player boards the native preview dock's stern ladder with E without first entering the water", () => {
  const { h, c, ents, boat } = setup();
  try {
    expect(ents.flags[c.ent]! & F_GROUNDED).not.toBe(0); expect(ents.mode[c.ent]).not.toBe(MODE_SWIM);
    expect(ents.y[c.ent]!).toBeCloseTo(.55, 2);
    use(h, c.ent, boat);
    expect(c.drive).toBe(boat); expect(ents.seatSlot[c.ent]).toBe(1);
  } finally { h.host.shutdown(); }
});

test("a dry ladder approach rechecks its corridor when a wall appears during boarding", () => {
  const { h, c, ents, boat } = setup();
  try {
    expect(h.host.urban.mount(c, boat)).toBe(RESULT_OK);
    const wall = h.reg.index.get("core:wall")!;
    h.world.structs.add(wall, 129.6, 1.5, 89.85, 0, 0, h.reg.maxHp[wall]!);
    h.run(1200);
    expect(c.drive).toBe(-1); expect(ents.seat[c.ent]).toBe(0);
    expect(ents.flags[c.ent]! & F_GROUNDED).not.toBe(0);
  } finally { h.host.shutdown(); }
});

test("dry boarding does not extend horizontal reach or treat unsupported feet as a dock", () => {
  const { h, c, ents, boat } = setup();
  try {
    // Still on the real dock, but beyond the same two-metre ladder approach used by swimmers.
    ents.setPosition(c.ent, 130.25, .55, 87.5);
    expect(h.host.urban.mount(c, boat)).toBe(RESULT_FAR);
    // Just off the dock with a stale grounded bit: actual support must be checked again at the action boundary.
    ents.setPosition(c.ent, 129.3, .55, 89.1);
    expect(ents.flags[c.ent]! & F_GROUNDED).not.toBe(0);
    expect(h.host.urban.mount(c, boat)).toBe(RESULT_FAR);
    expect(ents.seat[c.ent]).toBe(0);
  } finally { h.host.shutdown(); }
});
