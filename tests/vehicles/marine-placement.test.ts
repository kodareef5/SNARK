import { expect, test } from "bun:test";
import { vehicleFitsWorld } from "../../server/vehicle-service.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { RESULT_OBSTRUCTED, RESULT_OK } from "../../shared/net/protocol.ts";
import { boatRestY } from "../../shared/sim/boat.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

test("parking and deployment find a flagship whose stern crosses into the next chunk", () => {
  const h = new Harness({}, 1, 30, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(4, { seaLevel: 7 })) });
  try {
    const s = h.join("shipwright"); h.run(400);
    const c = h.client(s)!, actor = h.host.records.byPid.get(c.pid)!;
    const kit = h.reg.index.get("core:boat_assembly")!, launch = h.reg.vehicle[h.reg.vehicleDeploy[kit]!]!;
    if (launch.movement !== "boat") throw Error("expected the launch assembly");
    const y = boatRestY(launch.spec, 7);
    const x = 96, parked = h.host.spawnVehicle("core:sovereign", x, 64.25);
    expect(parked).toBeGreaterThanOrEqual(0);
    expect(h.host.spawnVehicle("core:sovereign", x, 46)).toBe(-1);
    h.world.ents.setPosition(c.ent, x + 7, y, 48);
    expect(h.host.items.mint(actor, kit, 1)).toBe(1);
    const inventory = h.host.items.inv(actor), slot = inventory.item.indexOf(kit);
    expect(h.host.vehicles.deploy(c, slot, x, y, 48, 0)).toBe(RESULT_OBSTRUCTED);
    expect(inventory.total(kit)).toBe(1);
    h.world.ents.setPosition(c.ent, x + 7, y, 35);
    expect(h.host.vehicles.deploy(c, slot, x, y, 35, 0)).toBe(RESULT_OK);
    expect(inventory.total(kit)).toBe(0);
  } finally { h.host.shutdown(); }
});

test("catamaran placement clears a low piling in the tunnel and rejects it under a sponson", () => {
  const h = new Harness({}, 1, 30, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(4, { seaLevel: 7 })) });
  try {
    const def = h.reg.vehicle[h.reg.index.get("core:manta")!]!;
    if (def.movement !== "boat") throw Error("expected a catamaran");
    const y = boatRestY(def.spec, 7), x = 96, z = 96, world = h.world;
    const pillar = h.reg.index.get("core:pillar")!;
    const post = (px: number) => world.structs.add(pillar, px, y + .55 - h.reg.halfY[pillar]!, z, 0, 0, 100);
    const inTunnel = post(x);
    expect(vehicleFitsWorld(world, x, y, z, 0, def)).toBe(true);
    world.structs.remove(inTunnel); post(x + 1.35);
    expect(vehicleFitsWorld(world, x, y, z, 0, def)).toBe(false);
  } finally { h.host.shutdown(); }
});
