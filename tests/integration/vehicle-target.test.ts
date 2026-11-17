import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { STANCE_CROUCH } from "../../shared/sim/character.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

test("interaction targeting follows an inverted car's hull and ignores its former upright box", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(2)) });
  try {
    const session = h.join("overturned-car"); h.run(400);
    const c = h.client(session)!, ents = h.world.ents;
    const car = h.host.spawnVehicle("core:compact", 64, 64, 0), v = ents.vrow[car]!;
    const height = h.reg.vehicle[ents.kind[car]!]!.spec.height;
    // Rest the inverted roof on the ground. Its actual hull is below its authored base.
    ents.setPosition(car, 64, height, 64);
    ents.vehicleQx[v] = ents.vehicleQy[v] = ents.vehicleQw[v] = 0;
    ents.vehicleQz[v] = 1; ents.vehicleRoll[v] = Math.PI;
    ents.stance[c.ent] = STANCE_CROUCH; c.heldYaw = 16384; c.heldPitch = 0;
    ents.setPosition(c.ent, 60.2, 0, 64);
    expect(h.host.death.target(c, 3.5)).toBe(car);
    // The same ray raised one chassis height meets only the obsolete upright proxy.
    ents.setPosition(c.ent, 60.2, height, 64);
    expect(h.host.death.target(c, 3.5)).toBe(-1);
  } finally { h.host.shutdown(); }
});
