// A harvesting blow reaches its owner with the kind and point the server found.

import { expect, test } from "bun:test";
import { BTN_PRIMARY } from "../../shared/sim/character.ts";
import { nodesOf, standFacing } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";

test("each blow on a tree or rock reports its surface point only to the gatherer", () => {
  const h = new Harness({}, 3, 60, { dev: true, wild: false });
  try {
    const owner = h.join("ada"), witness = h.join("bo");
    h.run(600);
    h.say(owner, "enablecheats");
    const pilot = h.pilots[0]!;
    const land = (): number => {
      let count = 0;
      const run = (ms: number): void => h.run(ms, () => {
        if (!owner.strike) return;
        expect(owner.strike.node).toBe(expectedKind);
        const e = h.ent(owner), ents = h.world.ents;
        const dx = owner.strike.x - ents.x[e]!, dy = owner.strike.y - (ents.y[e]! + 1.62), dz = owner.strike.z - ents.z[e]!;
        const distance = Math.hypot(dx, dy, dz);
        expect(distance).toBeGreaterThan(0);
        expect(distance).toBeLessThanOrEqual(2.21);
        const along = (dx * Math.sin(pilot.yaw) + dz * Math.cos(pilot.yaw)) * Math.cos(pilot.pitch) + dy * Math.sin(pilot.pitch);
        expect(along / distance).toBeGreaterThan(0.99);
        count++;
        owner.strike = null;
      });
      pilot.buttons = BTN_PRIMARY;
      run(290);
      pilot.buttons = 0;
      run(450);
      return count;
    };
    let expectedKind = 0;
    for (const name of ["core:tree", "core:rock"]) {
      const node = nodesOf(h, name, 256, 256).find((spot) => standFacing(h, owner, pilot, spot, 1.9));
      expect(node).toBeDefined();
      expectedKind = node!.kind;
      expect(land()).toBe(1);
      const harvest = h.host.harvest!, table = harvest.field.store.chunks[node!.chunk]!;
      table.hp[node!.index] = 1;
      expect(land()).toBe(1);
      expect(harvest.field.standing(node!.chunk, node!.index)).toBe(0);
      expect(land()).toBe(0);
    }
    expect(witness.strike).toBeNull();
  } finally {
    h.host.shutdown();
  }
});
