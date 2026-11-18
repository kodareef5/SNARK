import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { makeHandle } from "../../shared/ids.ts";
import { CMD_VEHICLE, RESULT_OK, VEHICLE_INSPECT } from "../../shared/net/protocol.ts";
import { vehicleDoor } from "../../shared/sim/vehicle-body.ts";
import { seedRoadFleet } from "../../tools/urban/fixtures.ts";
import { Harness } from "../fixtures/net.ts";

test("the test-drive lot parks the eight vehicles once and the family van boards at its rear sliding doors", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [] });
  try {
    expect(seedRoadFleet(h.host)).toBe(8);
    expect(seedRoadFleet(h.host)).toBe(0);
    const player = h.join("rider"); h.run(350);
    h.say(player, "enablecheats");
    const client = h.client(player)!, ents = h.world.ents;
    const rec = [...h.host.records.byPid.values()].find(r => r.kind === h.reg.index.get("core:caravan"))!;
    const car = h.host.records.entOf.get(rec.pid)!, def = h.reg.vehicle[rec.kind]!;
    for (const seat of def.seats.slice(2)) {
      const door = seat.door!, point = [0, 0, 0];
      h.host.urban.door(car, seat, h.reg.move[ents.kind[client.ent]!]!.radius, point);
      h.say(player, `tp ${point[0]} ${point[2]}`);
      expect(h.host.urban.mount(client, car)).toBe(RESULT_OK);
      h.run(200);
      expect(vehicleDoor(ents.vehicleDoors[ents.vrow[car]!]!, door)).toBeGreaterThan(0);
      for (let d = 0; d < def.doors.length; d++) if (d !== door) expect(vehicleDoor(ents.vehicleDoors[ents.vrow[car]!]!, d)).toBe(0);
      h.run(550);
      expect(h.host.urban.occupancy.occupant(rec.pid, seat.id)).toBe(client.pid);
      h.host.urban.dismount(client); h.run(1250);
      expect(ents.seat[client.ent]).toBe(0);
      expect(ents.vehicleDoors[ents.vrow[car]!]!).toBe(0);
    }
  } finally { h.host.shutdown(); }
});

test("inspecting and closing the panel van's cargo moves its curbside door through the ordinary service command", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [] });
  try {
    const player = h.join("cargo"); h.run(400);
    h.say(player, "enablecheats");
    expect(h.say(player, "gmsummon cargo_van")[0]).toContain("summoned core:panel_van");
    const client = h.client(player)!, ents = h.world.ents;
    const rec = [...h.host.records.byPid.values()].find(r => r.kind === h.reg.index.get("core:panel_van"))!;
    const car = h.host.records.entOf.get(rec.pid)!, row = ents.vrow[car]!;
    h.say(player, `tp ${ents.x[car]! - 2} ${ents.z[car]}`);
    const inspect = () => player.command(CMD_VEHICLE, w => { w.u8(VEHICLE_INSPECT); w.u32(makeHandle(car, ents.gen[car]!)); });
    inspect(); h.run(700);
    expect(client.open).toBe(rec.pid);
    expect(vehicleDoor(ents.vehicleDoors[row]!, 2)).toBe(1);
    expect(vehicleDoor(ents.vehicleDoors[row]!, 0)).toBe(0);
    inspect(); h.run(800);
    expect(client.open).toBe(0);
    expect(ents.vehicleDoors[row]).toBe(0);
  } finally { h.host.shutdown(); }
});
