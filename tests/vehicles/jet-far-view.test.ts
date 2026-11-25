// Entities a session is sent past its view's ring (Replication.far): an airborne jet someone flies, seen a kilometre off,
// a parked one not, and the list shared by every session centred in one chunk without crowding out its players.

import { expect, test } from "bun:test";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_JUMP, BTN_MOD } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { rules } from "../kit/kit.ts";

const seen = (s: ClientSession, e: number): boolean => { const r = new RemoteSample(); s.sampleRemote(r); return r.id.subarray(0, r.count).includes(e); };

test("a far entity is in a view past its ring while its reach takes the view in, and two sessions in one chunk share it", () => {
  const h = new Harness({}, 3, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(32)) });
  try {
    const a = h.join("a"), b = h.join("b"); h.run(1200);
    const ents = h.world.ents;
    ents.setPosition(h.client(a)!.ent, 1000, 0, 1000); ents.setPosition(h.client(b)!.ent, 1003, 0, 1002);
    h.run(1500);
    // Any entity will do: a dummy 1 km off, put in the list every tick.
    const e = h.host.spawnVehicle("core:helicopter", 1000, 2000, 0, 0);
    let reach = 1200;
    const step = h.host.vehicleWeapons.step.bind(h.host.vehicleWeapons);
    h.host.vehicleWeapons.step = () => { step(); h.server.replication.far(e, reach); };
    h.run(1000);
    expect([seen(a, e), seen(b, e)]).toEqual([true, true]);
    reach = 900;
    h.run(1500);
    expect([seen(a, e), seen(b, e)]).toEqual([false, false]);
  } finally { h.host.shutdown(); }
});

test("an airborne jet is sent a kilometre off, and a parked one is not", () => {
  const h = new Harness({}, 8, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(32)) });
  try {
    const pilot = h.join("pilot"), far = h.join("far"); h.run(1200);
    const c = h.client(pilot)!, ents = h.world.ents;
    const e = h.host.spawnVehicle("core:jet", 1000, 300, 0, 0);
    const entry = h.reg.vehicle[ents.kind[e]!]!.seats[0]!.entry;
    ents.setPosition(c.ent, 1000 + entry[0], 0, 300 + entry[2]);
    expect(h.host.urban.mount(c, e)).toBe(RESULT_OK);
    ents.setPosition(h.client(far)!.ent, 1000, 0, 1400);
    h.run(1500);
    expect(c.drive).toBe(e);
    expect(seen(far, e)).toBe(false);
    h.pilots[0]!.buttons = BTN_MOD | BTN_JUMP;
    h.run(4000);
    expect(ents.flags[e]! & F_GROUNDED).toBe(0);
    expect(Math.hypot(ents.x[e]! - 1000, ents.z[e]! - 1400)).toBeGreaterThan(1000);
    expect(seen(far, e)).toBe(true);
    expect(pilot.driving).toBe(e);
  } finally { h.host.shutdown(); }
});

test("a crowded view still holds its players before a far entity", () => {
  const h = new Harness({}, 4, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(32)), config: rules({ ViewCap: 64 }) });
  try {
    const a = h.join("a"), b = h.join("b"); h.run(1200);
    const ents = h.world.ents;
    ents.setPosition(h.client(a)!.ent, 1000, 0, 1000); ents.setPosition(h.client(b)!.ent, 1010, 0, 1000);
    // More creatures round them than a view holds.
    for (let k = 0; k < 100; k++) expect(h.host.spawnCreature("core:dodo", 985 + (k % 10) * 3, 985 + Math.floor(k / 10) * 3, 1)).toBeGreaterThanOrEqual(0);
    h.run(1500);
    expect(seen(a, h.client(b)!.ent)).toBe(true);
    const far = h.host.spawnVehicle("core:helicopter", 1000, 1900, 0, 0);
    const step = h.host.vehicleWeapons.step.bind(h.host.vehicleWeapons);
    h.host.vehicleWeapons.step = () => { step(); h.server.replication.far(far, 2000); };
    h.run(1500);
    expect(seen(a, h.client(b)!.ent)).toBe(true);
    expect(seen(a, far)).toBe(true);
  } finally { h.host.shutdown(); }
});
