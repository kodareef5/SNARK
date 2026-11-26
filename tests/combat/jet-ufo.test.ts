// The jet against a map event's craft, each through the real engine (server/mapevent, server/vehicle-weapons.ts): a
// missile locks the craft by its name, its blast breaks the shield, the cannon's rounds then count whole, and the craft
// comes down to the crate its kind sets down. The two meet only through the sky (server/sky.ts).

import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_PRIMARY, BTN_SECONDARY } from "../../shared/sim/character.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { LOCK_LOCKED } from "../../server/vehicle-weapons.ts";
import { target } from "../fixtures/event-kinds.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

test("a missile locks a map event's craft, breaks its shield, and the cannon brings it down to its crate", () => {
  // The craft hangs 300 m ahead of the jet's nose at the height of its gun, drifting across it at a metre a second.
  const muzzleOf = (h: Harness, e: number): readonly number[] => h.reg.vehicle[h.world.ents.kind[e]!]!.weapons!.cannon!.muzzle;
  let craftAt = { x: 0, y: 0, z: 0 };
  const h = new Harness({}, 8, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(16)), modules: [target({ get x() { return craftAt.x; }, get y() { return craftAt.y; }, get z() { return craftAt.z; }, speed: 1, seconds: 40, health: 1200 })] });
  try {
    const pilot = h.join("pilot");
    h.run(1200);
    const c = h.client(pilot)!, ents = h.world.ents;
    const e = h.host.spawnVehicle("core:jet", 300, 100, 0, 0);
    const entry = h.reg.vehicle[ents.kind[e]!]!.seats[0]!.entry;
    ents.setPosition(c.ent, 300 + entry[0], entry[1], 100 + entry[2]);
    expect(h.host.urban.mount(c, e)).toBe(RESULT_OK);
    h.run(1500);
    const muzzle = muzzleOf(h, e);
    craftAt = { x: 300 + muzzle[0]!, y: muzzle[1]!, z: 400 };
    const made = h.host.mapEvents.call("target", { source: "test" });
    if (typeof made === "string") throw new Error(made);
    h.run(1500);
    const craft = made.crafts[0]!;
    // Locked by its name, as any lockable craft is.
    h.pilots[0]!.buttons = BTN_SECONDARY;
    for (let k = 0; k < 40 && h.host.vehicleWeapons.lockOf(e).state !== LOCK_LOCKED; k++) h.run(100);
    expect(h.host.vehicleWeapons.lockOf(e).sky?.name).toBe("Target");
    h.run(150);
    expect(pilot.arms.now?.name).toBe("Target");
    // Held locked until the craft crosses the nose, so the cannon is in line while its shield is broken.
    const across = (): number => (h.host.mapEvents.views(made)[0] as { x: number }).x - craftAt.x;
    for (let k = 0; k < 300 && across() < -2; k++) h.run(100);
    expect(h.host.vehicleWeapons.lockOf(e).state).toBe(LOCK_LOCKED);
    // Its missile goes off on the hull: a heavy blow, which breaks the shield and goes through whole.
    const before = craft.health;
    h.pilots[0]!.buttons = 0;
    for (let k = 0; k < 60 && (h.host.vehicleWeapons.launched === 0 || h.host.vehicleWeapons.flying.length > 0); k++) h.run(100);
    expect(h.host.vehicleWeapons.detonated).toBe(1);
    expect(craft.shieldUntil).toBeGreaterThan(h.world.tick);
    expect(before - craft.health).toBeGreaterThan(100);
    // While it is broken the cannon's rounds count whole, and they bring it down.
    h.pilots[0]!.buttons = BTN_PRIMARY;
    for (let k = 0; k < 40 && craft.down === 0; k++) h.run(100);
    h.pilots[0]!.buttons = 0;
    expect(craft.down).toBeGreaterThan(0);
    expect(craft.lastBy).toBe(c.pid);
    // It comes to rest, and its kind sets its crate down by it.
    for (let k = 0; k < 100 && made.crates.length === 0; k++) h.run(100);
    expect(made.crates.length).toBe(1);
  } finally {
    h.host.shutdown();
  }
});
