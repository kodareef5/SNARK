import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { slopeShape, slopedSlab, staticOf } from "../../shared/content/slopes.ts";
import { RESULT_OBSTRUCTED, RESULT_OK } from "../../shared/net/protocol.ts";
import { capsuleFree, stepOnto } from "../../shared/world/collide.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

const slab = slopeShape("door:slope-shape", "thing", [slopedSlab(12, 12, 4, .4)]);
const made = compileContent([...CORE_CONTENT, slab, staticOf("door:slope", slab, { color: 1, hp: 16000 }),
  { type: "structure", class: "static", id: "door:wall", mesh: "box", color: 1, half: [.04, 1.5, 1], hp: 16000 },
  { type: "structure", class: "static", id: "door:ceiling", mesh: "box", color: 1, half: [.35, .05, .6], hp: 16000 },
]);
if (!made.registry) throw new Error(made.errors.join("\n"));
const registry = made.registry;

function camp(yaw: number, seat = 0) {
  const h = new Harness({}, 19, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(4)) }, registry);
  // The car is set down beside the survivor, which would knock it off its feet.
  h.host.setSetting("Knockdowns", "false");
  const session = h.join("graded-door"); h.run(400);
  const c = h.client(session)!, ents = h.world.ents, move = h.reg.move[ents.kind[c.ent]!]!;
  h.world.structs.add(h.reg.index.get("door:slope")!, 64, 2.8, 64, 0, 0, 16000);
  const car = h.host.spawnVehicle("core:compact", 64, 64, 0, yaw, { y: 3.2 });
  expect(car).toBeGreaterThanOrEqual(0); h.run(3000);
  const definition = h.reg.vehicle[ents.kind[car]!]!, point = [0, 0, 0];
  h.host.urban.door(car, definition.seats[seat]!, move.radius, point);
  const stand = (x: number, z: number) => {
    const top = 3 + (z - 64) / 3 + .5;
    expect(capsuleFree(h.world, x, top, z, move.radius, move.height)).toBe(true);
    const y = stepOnto(h.world, x, z, top - 1, top, move.radius, move.height, move.slopeCos);
    expect(Number.isFinite(y)).toBe(true); return y;
  };
  ents.setPosition(c.ent, point[0]!, stand(point[0]!, point[2]!), point[2]!); h.world.history.discontinuity(c.ent);
  return { h, c, car, ents, move, point, stand };
}

for (const yaw of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) for (const seat of [0, 1]) {
  test(`graded slab permits native seat ${seat} entry and exit at yaw ${yaw}`, () => {
    const { h, c, car, ents, move } = camp(yaw, seat);
    try {
      expect(h.host.urban.mount(c, car)).toBe(RESULT_OK); h.run(800);
      expect(ents.seat[c.ent]).toBe(car + 1);
      h.host.urban.dismount(c); expect(h.host.urban.occupancy.pending(c.pid)).not.toBeNull(); h.run(800);
      expect(ents.seat[c.ent]).toBe(0); expect(c.drive).toBe(-1);
      const x = ents.x[c.ent]!, y = ents.y[c.ent]!, z = ents.z[c.ent]!;
      expect(y).toBeGreaterThan(1);
      expect(capsuleFree(h.world, x, y, z, move.radius, move.height)).toBe(true);
      expect(capsuleFree(h.world, x, y - .04, z, move.radius, move.height)).toBe(false);
    } finally { h.host.shutdown(); }
  });
}

for (const obstacle of ["wall", "ceiling"] as const) test(`graded doorway cannot bypass an intervening ${obstacle}`, () => {
  const { h, c, car, ents, move, point, stand } = camp(0);
  try {
    const x = point[0]!, z = point[2]!, y = stand(x, z);
    ents.setPosition(c.ent, x + 1.1, stand(x + 1.1, z), z); h.world.history.discontinuity(c.ent);
    h.world.structs.add(h.reg.index.get(`door:${obstacle}`)!, obstacle === "wall" ? x + .55 : x,
      obstacle === "wall" ? y + 1.4 : y + move.height - .1, z, 0, 0, 16000);
    expect(capsuleFree(h.world, ents.x[c.ent]!, ents.y[c.ent]!, ents.z[c.ent]!, move.radius, move.height)).toBe(true);
    expect(h.host.urban.mount(c, car)).toBe(RESULT_OBSTRUCTED);
    expect(h.host.urban.occupancy.pending(c.pid)).toBeNull(); expect(ents.seat[c.ent]).toBe(0);
  } finally { h.host.shutdown(); }
});

test("graded entry rechecks a newly obstructed door at its native action commit", () => {
  const { h, c, car, ents, move, point, stand } = camp(0);
  try {
    expect(h.host.urban.mount(c, car)).toBe(RESULT_OK);
    h.world.structs.add(h.reg.index.get("door:ceiling")!, point[0]!, stand(point[0]!, point[2]!) + move.height - .1, point[2]!, 0, 0, 16000);
    h.run(800);
    expect(h.host.urban.occupancy.pending(c.pid)).toBeNull(); expect(ents.seat[c.ent]).toBe(0); expect(c.drive).toBe(-1);
  } finally { h.host.shutdown(); }
});
