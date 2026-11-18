import { expect, test } from "bun:test";
import { ROAD_FLEET } from "../../content/vehicles/road-fleet.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePack, frozenPack } from "../fixtures/pack.ts";

for (const [check, packed] of [[test, frozenPack], [artTest, corePack]] as const) {
  check(`enclosed road fleet protects every normally boarded occupant from native raptor bites (${packed.name})`, () => {
    const pack = packed();
    for (const species of ROAD_FLEET) {
      const h = new Harness({}, 19, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs, map: writeMap(flatMap(4)) });
      try {
        const a = h.world.ents, car = h.host.spawnVehicle(species.id, 100, 100, 0, 0), def = species.vehicle!;
        expect(car).toBeGreaterThanOrEqual(0);
        const occupants = def.seats.map((seat, slot) => {
          const s = h.join(`crew-${slot}`); h.run(400);
          const c = h.client(s)!, p = [0, 0, 0];
          h.host.urban.door(car, seat, h.reg.move[a.kind[c.ent]!]!.radius, p);
          a.setPosition(c.ent, p[0]!, p[1]! + .05, p[2]!); h.world.history.discontinuity(c.ent);
          expect(h.host.urban.mount(c, car)).toBe(RESULT_OK); h.run(800);
          expect(a.seat[c.ent]).toBe(car + 1); expect(a.seatSlot[c.ent]).toBe(slot + 1);
          h.host.survival.gods.delete(c.pid);
          const rec = h.host.records.byPid.get(c.pid)!;
          return { c, rec, health: h.host.survival.value(rec, V_HEALTH) };
        });
        const vehicle = h.host.records.byPid.get(a.pid[car]!)!, hp = h.host.survival.value(vehicle, V_HEALTH);
        let minimumCrew = Infinity;
        // Real AI chase/strike windows against each side, not direct Combat.bite calls or synthetic damage.
        for (const [side, [dx, dz]] of [[2.6, .2], [.4, 3.4], [.4, -3.4], [-2.6, .2]].entries()) {
          const target = occupants[side % occupants.length]!.c;
          const raptor = h.host.spawnCreature("core:raptor", a.x[car]! + dx!, a.z[car]! + dz!, 30);
          h.host.creatures.mind.provoke(raptor, a.x[target.ent]!, a.z[target.ent]!, target.ent);
          for (let tick = 0; tick < 180; tick++) {
            h.server.tick();
            for (const actor of occupants) minimumCrew = Math.min(minimumCrew, h.host.survival.value(actor.rec, V_HEALTH) - actor.health);
          }
          h.host.creatures.mind.stay(raptor, h.world.tick + 10000);
          a.setPosition(raptor, 180, 0, 180); h.world.history.discontinuity(raptor);
        }
        expect(minimumCrew, species.id).toBe(0);
        expect(h.host.survival.value(vehicle, V_HEALTH), species.id).toBeLessThan(hp);
        for (const { c } of occupants) expect(a.seat[c.ent], species.id).toBe(car + 1);
        // Projectiles retain the real openings: neither front nor rear passengers become invulnerable.
        const eye = new Float64Array(3);
        for (const { c } of occupants) {
          expect(h.host.urban.eye(c.ent, eye)).toBe(true);
          const sign = def.seats[a.seatSlot[c.ent]! - 1]!.anchor[0] < 0 ? -1 : 1;
          // This coupe's forward-leaning passenger lies behind its swept A-pillar from the side.
          const front = species.id === "core:berlinetta" && a.seatSlot[c.ent] === 2;
          expect(h.host.combat.castBodies(-1, eye[0]! + (front ? 0 : sign * 3), eye[1]!, eye[2]! + (front ? 3 : 0), front ? 0 : -sign, 0, front ? -1 : 0, 3.1), `${species.id} ${a.seatSlot[c.ent]} window`).toBe(c.ent);
        }
      } finally { h.host.shutdown(); }
    }
  });
}
