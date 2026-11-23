import { expect, test } from "bun:test";
import { CONCEPT003_ART } from "../../content/vehicles/concept003-art.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { vehicleDoor } from "../../shared/sim/vehicle-body.ts";
import { Harness } from "../fixtures/net.ts";
import { seedRoadFleet } from "../../tools/urban/fixtures.ts";

test("Concept 003 drives five riders from its four doors on the test lot", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [] });
  try {
    seedRoadFleet(h.host);
    const kind = h.reg.index.get(CONCEPT003_ART.id)!;
    const rec = [...h.host.records.byPid.values()].find(record => record.kind === kind)!;
    const car = h.host.records.entOf.get(rec.pid)!;
    const def = h.reg.vehicle[kind]!;
    expect(def.seats.map(seat => seat.door)).toEqual([0, 1, 2, 3, 3]);
    expect(def.wheels.map(w => w.bone)).toEqual(CONCEPT003_ART.bones.slice(1, 5));
    const ents = h.world.ents, row = ents.vrow[car]!;
    for (const seat of def.seats) {
      const rider = h.join(seat.id);
      h.run(400);
      const client = h.client(rider)!, p = [0, 0, 0];
      h.host.urban.door(car, seat, h.reg.move[ents.kind[client.ent]!]!.radius, p);
      ents.setPosition(client.ent, p[0]!, p[1]! + .05, p[2]!);
      h.world.history.discontinuity(client.ent);
      expect(h.host.urban.mount(client, car)).toBe(RESULT_OK);
      h.run(200);
      expect(vehicleDoor(ents.vehicleDoors[row]!, seat.door!)).toBeGreaterThan(0);
      h.run(800);
      expect(h.host.urban.occupancy.occupant(rec.pid, seat.id)).toBe(client.pid);
    }
    expect(ents.vehicleDoors[row]).toBe(0);
    const x = ents.x[car]!, z = ents.z[car]!;
    h.pilots[0]!.moveZ = 1;
    h.run(1800);
    expect(Math.hypot(ents.x[car]! - x, ents.z[car]! - z)).toBeGreaterThan(2);
  } finally { h.host.shutdown(); }
});
